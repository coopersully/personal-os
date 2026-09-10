#!/usr/bin/env bash
set -euo pipefail

body="${PR_BODY:-}"

if [[ -z "$body" ]]; then
  echo "Pull request body is empty" >&2
  exit 1
fi

work_map=""
in_work_map=false

while IFS= read -r line; do
  line="${line%$'\r'}"

  if [[ "$line" == "## Work map" ]]; then
    in_work_map=true
    continue
  fi

  if [[ "$in_work_map" == true && "$line" == "## "* ]]; then
    break
  fi

  if [[ "$in_work_map" == true ]]; then
    work_map+="$line"$'\n'
  fi
done <<<"$body"

if [[ -z "$work_map" ]]; then
  echo "Pull request body is missing the required Work map section" >&2
  exit 1
fi

project_pattern='^- Project: \[Nohmi\]\(https://linear\.app/coopersully/project/nohmi-6799e74a853f\) — ([^<[:space:]].*)$'
task_pattern='^- Task: \[(COO-[1-9][0-9]*)\]\(https://linear\.app/coopersully/issue/(COO-[1-9][0-9]*)(/[^)]*)?\) — ([^<[:space:]].*)$'
project_count=0
task_count=0

while IFS= read -r line; do
  if [[ "$line" == "- Project:"* ]]; then
    if [[ ! "$line" =~ $project_pattern ]]; then
      echo "Work map Project row must use the live Nohmi Linear Project URL and describe the contribution" >&2
      exit 1
    fi
    project_count=$((project_count + 1))
  fi

  if [[ "$line" == "- Task:"* ]]; then
    if [[ ! "$line" =~ $task_pattern ]]; then
      echo "Every Work map Task row must link a concrete COO issue and describe the contribution" >&2
      exit 1
    fi
    if [[ "${BASH_REMATCH[1]}" != "${BASH_REMATCH[2]}" ]]; then
      echo "Work map Task label must match the COO issue key in its Linear URL" >&2
      exit 1
    fi
    task_count=$((task_count + 1))
  fi
done <<<"$work_map"

if [[ "$project_count" -ne 1 ]]; then
  echo "Work map must contain exactly one live Nohmi Project row" >&2
  exit 1
fi

if [[ "$task_count" -lt 1 ]]; then
  echo "Work map must contain at least one concrete COO Task row" >&2
  exit 1
fi

echo "Pull request Work map check passed."
