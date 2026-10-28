#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

required_files=(
  "AGENTS.md"
  ".codex/environments/environment.toml"
  ".codex/scripts/check-pr-body.sh"
  ".agents/skills/create-pr/SKILL.md"
  ".agents/skills/linear-work-sync/SKILL.md"
  ".agents/skills/ship-it/SKILL.md"
  ".agents/skills/ship-it/scripts/evaluate_readiness.py"
  ".agents/skills/ship-it/scripts/evaluate_readiness_test.py"
  ".github/pull_request_template.md"
  "docs/engineering/pr-rubric.md"
  "docs/engineering/acceptance-contract.md"
  "docs/engineering/acceptance-policy.json"
  "docs/engineering/code-standards.md"
  ".agents/skills/deep-review/SKILL.md"
  ".agents/skills/handoff/SKILL.md"
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

for file in ./.codex/scripts/*.sh; do
  bash -n "$file"
done

for file in ./.codex/scripts/*.mjs; do
  node --check "$file"
done

node --test \
  ./.codex/scripts/worktree-runtime.test.mjs \
  ./.codex/scripts/compose-runtime-manager.test.mjs
bash ./.codex/scripts/environment.test.sh
PYTHONDONTWRITEBYTECODE=1 python3 .codex/scripts/verification-runner.test.py
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s ./.agents/skills/ship-it/scripts -p '*_test.py'

grep -Eq '^## Work map$' .github/pull_request_template.md &&
  grep -Eq '^- Project: \[Nohmi\]\(https://linear\.app/coopersully/project/nohmi-6799e74a853f\)' .github/pull_request_template.md &&
  grep -Eq '^- Task: \[COO-000\]' .github/pull_request_template.md || {
  echo "Pull request template is missing the required Work map fields" >&2
  exit 1
}

grep -Fq 'types: [edited, opened, ready_for_review, reopened, synchronize]' .github/workflows/pr-metadata.yml || {
  echo "Metadata CI must revalidate the PR Work map whenever pull request metadata changes" >&2
  exit 1
}

node --test .github/scripts/collect-node-coverage.test.mjs
node --test .github/scripts/source-observation.test.mjs .github/scripts/wait-source-ci.test.mjs scripts/verification-plan.test.mjs scripts/development-plan.test.mjs
echo "Codex repository check passed."
