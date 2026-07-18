#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(
	cd "$(dirname "${BASH_SOURCE[0]}")/.."
	pwd
)"

CA_CERT="$ROOT_DIR/infrastructure/docker/certs/tls.crt"
PROXY_ADDRESS="${PROXY_TLS_ADDRESS:-https://localhost:8443}"

if [ ! -f "$CA_CERT" ]; then
	echo "TLS CA certificate not found: $CA_CERT"
	exit 1
fi

if [ -z "${PROXY_USERNAME:-}" ]; then
	read -rp "Proxy username: " PROXY_USERNAME
fi

if [ -z "${PROXY_SECRET:-}" ]; then
	read -rsp "Proxy secret: " PROXY_SECRET
	echo
fi

run_proxy_status() {
	local target="$1"
	local credentials="$2"

	curl \
		--max-time 30 \
		--silent \
		--show-error \
		--noproxy "" \
		--output /dev/null \
		--write-out '%{http_code}' \
		--proxy "$PROXY_ADDRESS" \
		--proxy-cacert "$CA_CERT" \
		--proxy-user "$credentials" \
		"$target" 2>/dev/null || true
}

assert_status() {
	local name="$1"
	local expected="$2"
	local actual="$3"

	if [ "$actual" = "$expected" ]; then
		printf '[PASS] %s — HTTP %s\n' "$name" "$actual"
		return
	fi

	printf '[FAIL] %s — expected HTTP %s, received %s\n' \
		"$name" \
		"$expected" \
		"${actual:-no response}"

	exit 1
}

echo
echo "Nexus TLS Proxy Verification"
echo "============================"
echo "Proxy endpoint: $PROXY_ADDRESS"
echo

HEALTH_STATUS="$(
	curl \
		--max-time 15 \
		--silent \
		--show-error \
		--noproxy "*" \
		--output /dev/null \
		--write-out '%{http_code}' \
		--cacert "$CA_CERT" \
		https://localhost:8443/healthz 2>/dev/null || true
)"

assert_status \
	"Encrypted listener health" \
	"200" \
	"$HEALTH_STATUS"

HTTP_STATUS="$(
	run_proxy_status \
		http://example.com/ \
		"$PROXY_USERNAME:$PROXY_SECRET"
)"

assert_status \
	"Authenticated HTTP through TLS proxy" \
	"200" \
	"$HTTP_STATUS"

HTTPS_STATUS="$(
	run_proxy_status \
		https://example.com/ \
		"$PROXY_USERNAME:$PROXY_SECRET"
)"

assert_status \
	"Authenticated HTTPS CONNECT through TLS proxy" \
	"200" \
	"$HTTPS_STATUS"

INVALID_STATUS="$(
	run_proxy_status \
		http://example.com/ \
		"$PROXY_USERNAME:${PROXY_SECRET}-invalid"
)"

assert_status \
	"Invalid credential rejection" \
	"407" \
	"$INVALID_STATUS"

LOOPBACK_STATUS="$(
	run_proxy_status \
		http://127.0.0.1/ \
		"$PROXY_USERNAME:$PROXY_SECRET"
)"

assert_status \
	"Loopback destination blocking" \
	"403" \
	"$LOOPBACK_STATUS"

METADATA_STATUS="$(
	run_proxy_status \
		http://169.254.169.254/latest/meta-data/ \
		"$PROXY_USERNAME:$PROXY_SECRET"
)"

assert_status \
	"Cloud metadata blocking" \
	"403" \
	"$METADATA_STATUS"

PORT_STATUS="$(
	run_proxy_status \
		http://example.com:22/ \
		"$PROXY_USERNAME:$PROXY_SECRET"
)"

assert_status \
	"Destination-port policy" \
	"403" \
	"$PORT_STATUS"

echo
echo "TLS PROXY VERIFICATION PASSED"
