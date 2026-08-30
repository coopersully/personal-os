#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

required_files=(
  "AGENTS.md"
  ".codex/environments/environment.toml"
)

for file in "${required_files[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "Missing required file: $file" >&2
    exit 1
  fi
done

bash -n ./.codex/scripts/environment.sh
bash -n ./.codex/scripts/environment.test-docker.sh
node --check ./.codex/scripts/production-runtime.mjs
bash ./.codex/scripts/environment.test.sh

echo "Codex local environment check passed."
