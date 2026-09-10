#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

required_files=(
  "AGENTS.md"
  ".codex/environments/environment.toml"
  ".codex/scripts/check-pr-body.sh"
  ".agents/skills/create-pr/SKILL.md"
  ".agents/skills/linear-work-sync/SKILL.md"
  ".github/pull_request_template.md"
  "docs/engineering/pr-rubric.md"
  "docs/engineering/work-context.md"
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

bash -n ./.codex/scripts/check-pr-body.sh
bash -n ./.codex/scripts/environment.sh ./.codex/scripts/environment.test.sh

for file in ./.codex/scripts/*.mjs; do
  node --check "$file"
done

node --test \
  ./.codex/scripts/worktree-runtime.test.mjs \
  ./.codex/scripts/compose-runtime-manager.test.mjs
bash ./.codex/scripts/environment.test.sh

grep -Eq '^## Work map$' .github/pull_request_template.md &&
  grep -Eq '^- Project: \[Nohmi\]\(https://linear\.app/coopersully/project/nohmi-6799e74a853f\)' .github/pull_request_template.md &&
  grep -Eq '^- Task: \[COO-000\]' .github/pull_request_template.md || {
  echo "Pull request template is missing the required Work map fields" >&2
  exit 1
}

grep -Fq 'types: [edited, opened, ready_for_review, reopened, synchronize]' .github/workflows/ci.yml || {
  echo "CI must revalidate the PR Work map whenever pull request metadata changes" >&2
  exit 1
}

echo "Codex repository check passed."
