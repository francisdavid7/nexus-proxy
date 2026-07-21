#!/bin/sh

set -eu

TLS_ENABLED="${PROXY_TLS_ENABLED:-false}"

case "$(printf '%s' "$TLS_ENABLED" | tr '[:upper:]' '[:lower:]')" in
  true|1|yes)
    CERT_SOURCE="${PROXY_TLS_CERT_SOURCE:-/tls-source/tls.crt}"
    KEY_SOURCE="${PROXY_TLS_KEY_SOURCE:-/tls-source/tls.key}"

    CERT_FILE="${PROXY_TLS_CERT_FILE:-/run/nexus-tls/tls.crt}"
    KEY_FILE="${PROXY_TLS_KEY_FILE:-/run/nexus-tls/tls.key}"

    if [ ! -r "$CERT_SOURCE" ]; then
      echo "TLS certificate is not readable: $CERT_SOURCE" >&2
      exit 1
    fi

    if [ ! -r "$KEY_SOURCE" ]; then
      echo "TLS private key is not readable: $KEY_SOURCE" >&2
      exit 1
    fi

    mkdir -p /run/nexus-tls

    cp "$CERT_SOURCE" "$CERT_FILE"
    cp "$KEY_SOURCE" "$KEY_FILE"

    chmod 0644 "$CERT_FILE"
    chmod 0600 "$KEY_FILE"

    chown nexus:nexus "$CERT_FILE" "$KEY_FILE"
    ;;
esac

exec su-exec nexus:nexus nexus-proxy
