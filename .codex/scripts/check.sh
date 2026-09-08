#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

required_files=(
  "AGENTS.md"
  ".codex/environments/environment.toml"
  ".codex/runtime/Dockerfile.dev"
  ".codex/runtime/compose.yaml"
  ".codex/scripts/environment.test.sh"
  ".codex/scripts/compose-runtime-manager.mjs"
  ".codex/scripts/worktree-runtime.mjs"
  ".codex/scripts/production-runtime.mjs"
  ".codex/scripts/production-runtime.test-helper.mjs"
  ".codex/scripts/production-runtime.test.ts"
)

for file in "${required_files[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "Missing required file: $file" >&2
    exit 1
  fi
done

bash -n ./.codex/scripts/environment.sh ./.codex/scripts/environment.test.sh

for file in ./.codex/scripts/*.mjs; do
  node --check "$file"
done

node --test \
  ./.codex/scripts/worktree-runtime.test.mjs \
  ./.codex/scripts/compose-runtime-manager.test.mjs
bash ./.codex/scripts/environment.test.sh

echo "Codex local environment check passed."
