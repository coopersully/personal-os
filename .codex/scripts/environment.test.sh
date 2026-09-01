#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"

bash -n "$ROOT/.codex/scripts/environment.sh"
grep -Fq 'compose-runtime-manager.mjs' "$ROOT/.codex/scripts/environment.sh"
grep -Fq 'docker compose' "$ROOT/.codex/scripts/environment.sh"
if grep -Eq 'runtime tier|reaper-enable|active-root' "$ROOT/.codex/scripts/environment.sh"; then
  printf 'legacy tier lifecycle remains in environment.sh\n' >&2
  exit 1
fi

printf 'environment lifecycle contract passed\n'
