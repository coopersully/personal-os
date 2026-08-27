#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ilo-environment-test.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT
PRIMARY="$TEST_ROOT/repo"
LINKED_A="$TEST_ROOT/linked-a"
LINKED_B="$TEST_ROOT/linked-b"

mkdir -p "$PRIMARY"
git -C "$PRIMARY" init -q
git -C "$PRIMARY" config user.email runtime-test@example.com
git -C "$PRIMARY" config user.name 'Runtime Test'
printf 'fixture\n' >"$PRIMARY/README.md"
git -C "$PRIMARY" add README.md
git -C "$PRIMARY" commit -qm initial
git -C "$PRIMARY" worktree add -q -b linked-a "$LINKED_A"
git -C "$PRIMARY" worktree add -q -b linked-b "$LINKED_B"

for checkout in "$PRIMARY" "$LINKED_A" "$LINKED_B"; do
  mkdir -p "$checkout/.codex/scripts" "$checkout/.codex/runtime"
  cp "$SOURCE_ROOT"/.codex/scripts/runtime-*.mjs "$checkout/.codex/scripts/"
  cp "$SOURCE_ROOT/.codex/scripts/environment.sh" "$checkout/.codex/scripts/"
  cp "$SOURCE_ROOT/.codex/runtime/compose.yaml" "$checkout/.codex/runtime/"
done

node "$LINKED_A/.codex/scripts/runtime-manager.mjs" acquire --root "$LINKED_A" >"$TEST_ROOT/a.txt" 2>&1 || {
  sed -n '1,120p' "$TEST_ROOT/a.txt" >&2
  exit 1
}
grep -Fq '  Tier:      2' "$TEST_ROOT/a.txt"
grep -Fq '  App:       http://localhost:8086' "$TEST_ROOT/a.txt"
grep -Fq '  API:       http://127.0.0.1:8793' "$TEST_ROOT/a.txt"
grep -Fq '  MCP:       http://127.0.0.1:8794' "$TEST_ROOT/a.txt"
grep -Fq '  PostgreSQL 127.0.0.1:55438' "$TEST_ROOT/a.txt"

node "$LINKED_A/.codex/scripts/runtime-manager.mjs" acquire --root "$LINKED_A" >"$TEST_ROOT/a-again.txt" &
pid_a=$!
node "$LINKED_B/.codex/scripts/runtime-manager.mjs" acquire --root "$LINKED_B" >"$TEST_ROOT/b.txt" &
pid_b=$!
wait "$pid_a" "$pid_b"
grep -Fq '  Tier:      2' "$TEST_ROOT/a-again.txt"
grep -Fq '  Tier:      3' "$TEST_ROOT/b.txt"

node "$LINKED_A/.codex/scripts/runtime-manager.mjs" activate 2 --root "$LINKED_A" >/dev/null
active="$(node "$LINKED_A/.codex/scripts/runtime-manager.mjs" active-root --root "$LINKED_A")"
[[ "$active" == "$(cd "$LINKED_A" && pwd -P)" ]]

status="$(cd "$LINKED_A" && bash ./.codex/scripts/environment.sh status)"
[[ "$status" == *'State: allocated'* ]]
printf 'environment lifecycle contract passed\n'
