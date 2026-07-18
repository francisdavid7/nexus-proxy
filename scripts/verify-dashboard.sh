#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(
  cd "$(
    dirname "${BASH_SOURCE[0]}"
  )/.."
  pwd
)"

DASHBOARD_DIR="$ROOT_DIR/apps/dashboard"
BASE_URL="http://127.0.0.1:3000"

step() {
  printf '\n\033[1;36m==> %s\033[0m\n' "$1"
}

failure() {
  printf '\n\033[1;31mDashboard verification failed.\033[0m\n'
}

trap failure ERR

step "Checking control-plane availability"

curl \
  --fail \
  --silent \
  --show-error \
  "$BASE_URL/auth/login" \
  >/dev/null

step "Running dashboard lint and TypeScript checks"

cd "$DASHBOARD_DIR"

pnpm quality

step "Running public authentication tests"

pnpm run test:e2e:public

step "Running administrator portal tests"

pnpm run test:e2e:admin

printf '\n\033[1;32mDashboard verification passed successfully.\033[0m\n'
