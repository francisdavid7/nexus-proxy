#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(
  cd "$(
    dirname "${BASH_SOURCE[0]}"
  )/.."
  pwd
)"

cd "$ROOT_DIR"

step() {
  printf '\n\033[1;36m==> %s\033[0m\n' "$1"
}

fail() {
  printf '\n\033[1;31mPrivacy release gate failed.\033[0m\n'
}

trap fail ERR

: "${PROXY_ADDRESS:?PROXY_ADDRESS is required}"
: "${PROXY_USERNAME:?PROXY_USERNAME is required}"
: "${PROXY_SECRET:?PROXY_SECRET is required}"

step "Formatting proxy-engine source"

gofmt -w \
  internal/privacy \
  internal/proxy \
  cmd/privacy-check

step "Running proxy-engine tests"

timeout --foreground 180s \
  go test \
    -v \
    -count=1 \
    ./...

step "Running static analysis"

timeout --foreground 180s \
  go vet ./...

step "Building privacy verifier"

mkdir -p bin

timeout --foreground 180s \
  env CGO_ENABLED=0 \
  go build \
    -v \
    -trimpath \
    -ldflags='-s -w' \
    -o bin/nexus-privacy-check \
    ./cmd/privacy-check

step "Running live proxy privacy verification"

timeout --foreground 180s \
  ./bin/nexus-privacy-check

printf '\n\033[1;32mPrivacy release gate passed.\033[0m\n'
