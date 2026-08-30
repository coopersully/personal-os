#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

required_files=(
  "AGENTS.md"
  ".codex/environments/environment.toml"
  ".codex/runtime/compose.yaml"
  ".codex/scripts/environment.test.sh"
  ".codex/scripts/environment.test-docker.sh"
  ".codex/scripts/runtime-registry.mjs"
  ".codex/scripts/runtime-resources.mjs"
  ".codex/scripts/runtime-reconciler.mjs"
  ".codex/scripts/runtime-supervisor.mjs"
  ".codex/scripts/runtime-manager.mjs"
  ".codex/scripts/runtime-reaper-install.mjs"
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

bash -n ./.codex/scripts/environment.sh ./.codex/scripts/environment.test.sh ./.codex/scripts/environment.test-docker.sh

for file in ./.codex/scripts/*.mjs; do
  node --check "$file"
done

node --test \
  ./.codex/scripts/runtime-registry.test.mjs \
  ./.codex/scripts/runtime-resources.test.mjs \
  ./.codex/scripts/runtime-reconciler.test.mjs \
  ./.codex/scripts/runtime-supervisor.test.mjs \
  ./.codex/scripts/runtime-manager.test.mjs \
  ./.codex/scripts/runtime-reaper-install.test.mjs
bash ./.codex/scripts/environment.test.sh

echo "Codex local environment check passed."
