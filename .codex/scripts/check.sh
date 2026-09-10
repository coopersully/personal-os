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
)

for file in "${required_files[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "Missing required file: $file" >&2
    exit 1
  fi
done

bash -n ./.codex/scripts/environment.sh
bash -n ./.codex/scripts/check-pr-body.sh

grep -Eq '^## Work map$' .github/pull_request_template.md &&
  grep -Eq '^- Project: \[Nohmi\]\(https://linear\.app/coopersully/project/nohmi-6799e74a853f\)' .github/pull_request_template.md &&
  grep -Eq '^- Task: \[COO-000\]' .github/pull_request_template.md || {
  echo "Pull request template is missing the required Work map fields" >&2
  exit 1
}

echo "Codex repository check passed."
