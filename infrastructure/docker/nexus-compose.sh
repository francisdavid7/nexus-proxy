#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(
	cd "$(dirname "${BASH_SOURCE[0]}")"
	pwd
)"

cd "$SCRIPT_DIR"

COMPOSE_ARGS=(
	-f docker-compose.yml
)

if [ -f compose.auth.final.yml ]; then
	COMPOSE_ARGS+=(
		-f compose.auth.final.yml
	)
fi

if [ -f compose.tls.yml ]; then
	COMPOSE_ARGS+=(
		-f compose.tls.yml
	)
fi

exec docker compose \
	"${COMPOSE_ARGS[@]}" \
	"$@"
