#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

SOURCE_ROOT="$(git rev-parse --show-toplevel)"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ilo-environment-test.XXXXXX")"
export ILO_RUNTIME_DOCKER_BIN="$SOURCE_ROOT/.codex/scripts/environment.test-docker.sh"

cleanup() {
  rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT

REPO="$TEMP_ROOT/repo"
WORKTREE_A="$TEMP_ROOT/worktree-a"
WORKTREE_B="$TEMP_ROOT/worktree-b"

mkdir -p "$REPO/.codex/scripts"
cp "$SOURCE_ROOT/.codex/scripts/environment.sh" "$REPO/.codex/scripts/environment.sh"
git -C "$REPO" init -q
git -C "$REPO" config user.email test@example.com
git -C "$REPO" config user.name "Environment Test"
git -C "$REPO" add .codex/scripts/environment.sh
git -C "$REPO" commit -qm initial
git -C "$REPO" branch worktree-a
git -C "$REPO" branch worktree-b
git -C "$REPO" worktree add -q "$WORKTREE_A" worktree-a
git -C "$REPO" worktree add -q "$WORKTREE_B" worktree-b
WORKTREE_A="$(cd "$WORKTREE_A" && pwd -P)"
WORKTREE_B="$(cd "$WORKTREE_B" && pwd -P)"

assert_contains() {
  local output="$1" expected="$2"
  if [[ "$output" != *"$expected"* ]]; then
    printf 'Expected output to contain: %s\nActual output:\n%s\n' "$expected" "$output" >&2
    exit 1
  fi
}

# Regression: tier 2 is the registered Cooper worktree slot. Its port set must
# remain stable instead of changing whenever another git worktree is added.
(cd "$WORKTREE_A" && bash ./.codex/scripts/environment.sh activate 2 >/dev/null)
config_before="$(cd "$WORKTREE_A" && bash ./.codex/scripts/environment.sh config)"
assert_contains "$config_before" "Tier:      2"
assert_contains "$config_before" "App:       http://localhost:8086"
assert_contains "$config_before" "API:       http://127.0.0.1:8793"
assert_contains "$config_before" "MCP:       http://127.0.0.1:8794"
assert_contains "$config_before" "PostgreSQL 127.0.0.1:55438"

git -C "$REPO" branch aaa-earlier
git -C "$REPO" worktree add -q "$TEMP_ROOT/aaa-earlier" aaa-earlier
config_after="$(cd "$WORKTREE_A" && bash ./.codex/scripts/environment.sh config)"
if [[ "$config_after" != "$config_before" ]]; then
  printf 'Tier configuration changed after adding another worktree.\nBefore:\n%s\nAfter:\n%s\n' \
    "$config_before" "$config_after" >&2
  exit 1
fi

# Regression: another checkout cannot steal a tier that has an owned live
# process, even if it requests that tier explicitly.
(cd "$WORKTREE_A" && sleep 30) &
owned_pid="$!"
printf '%s\n' "$owned_pid" >"$WORKTREE_A/.codex/run/pids/web.pid"
if (cd "$WORKTREE_B" && bash ./.codex/scripts/environment.sh activate 2 >/dev/null 2>&1); then
  printf 'A second worktree stole tier 2 from a live owner.\n' >&2
  kill "$owned_pid" >/dev/null 2>&1 || true
  exit 1
fi
kill "$owned_pid" >/dev/null 2>&1 || true
wait "$owned_pid" 2>/dev/null || true
rm -f "$WORKTREE_A/.codex/run/pids/web.pid"

# Regression: an unowned or PID-reused process is never terminated merely
# because its working directory happens to be inside the checkout.
(cd "$WORKTREE_A" && sleep 30) &
foreign_pid="$!"
printf '%s\n' "$foreign_pid" >"$WORKTREE_A/.codex/run/pids/web.pid"
if (cd "$WORKTREE_A" && bash ./.codex/scripts/environment.sh stop >/dev/null 2>&1); then
  printf 'Stop reported success for a process without recorded ownership.\n' >&2
  exit 1
fi
if ! kill -0 "$foreign_pid" >/dev/null 2>&1; then
  printf 'Stop terminated a process without recorded service ownership.\n' >&2
  exit 1
fi
if [[ ! -f "$WORKTREE_A/.codex/run/pids/web.pid" ]]; then
  printf 'Stop erased the PID evidence for an unowned process.\n' >&2
  exit 1
fi
kill "$foreign_pid" >/dev/null 2>&1 || true
wait "$foreign_pid" 2>/dev/null || true
rm -f "$WORKTREE_A/.codex/run/pids/web.pid"

# Regression: Compose-only ownership blocks tier theft even when the original
# checkout has no source PID files left.
export TEST_DOCKER_OWNER="$WORKTREE_A"
if (cd "$WORKTREE_B" && bash ./.codex/scripts/environment.sh activate 2 >/dev/null 2>&1); then
  printf 'A second worktree stole tier 2 from a foreign Compose project.\n' >&2
  exit 1
fi
unset TEST_DOCKER_OWNER

# Regression: ownership checks fail closed when Compose omits either label or
# points the project at a different configuration file.
export TEST_DOCKER_OWNER="$WORKTREE_A"
export TEST_DOCKER_CONFIG=""
if (cd "$WORKTREE_A" && bash ./.codex/scripts/environment.sh config >/dev/null 2>&1); then
  printf 'Compose ownership accepted a missing config-file label.\n' >&2
  exit 1
fi
export TEST_DOCKER_CONFIG="$WORKTREE_A/other-compose.yaml"
if (cd "$WORKTREE_A" && bash ./.codex/scripts/environment.sh config >/dev/null 2>&1); then
  printf 'Compose ownership accepted the wrong config file.\n' >&2
  exit 1
fi
export TEST_DOCKER_READY=1
export TEST_DOCKER_OWNER=""
export TEST_DOCKER_CONFIG="/compose.yaml"
if (cd "$WORKTREE_A" && bash ./.codex/scripts/environment.sh config >/dev/null 2>&1); then
  printf 'Compose ownership accepted a missing working-directory label.\n' >&2
  exit 1
fi
unset TEST_DOCKER_READY TEST_DOCKER_OWNER TEST_DOCKER_CONFIG

export TEST_DOCKER_READY=1
export TEST_DOCKER_PS_FAIL=1
if (cd "$WORKTREE_A" && bash ./.codex/scripts/environment.sh config >/dev/null 2>&1); then
  printf 'Compose ownership failed open when Docker project inspection failed.\n' >&2
  exit 1
fi
unset TEST_DOCKER_READY TEST_DOCKER_PS_FAIL

# Regression: the saved project can resolve the worktree explicitly activated
# by Cooper Run, rather than blindly launching the primary checkout.
active_root="$(cd "$REPO" && bash ./.codex/scripts/environment.sh active-root)"
if [[ "$active_root" != "$WORKTREE_A" ]]; then
  printf 'Expected active root %s, got %s\n' "$WORKTREE_A" "$active_root" >&2
  exit 1
fi

# A second worktree gets a non-overlapping whole tier and cannot silently steal
# an active tier from a live assignment.
(cd "$WORKTREE_B" && bash ./.codex/scripts/environment.sh activate 3 >/dev/null)
config_b="$(cd "$WORKTREE_B" && bash ./.codex/scripts/environment.sh config)"
assert_contains "$config_b" "Tier:      3"
assert_contains "$config_b" "App:       http://localhost:8091"
assert_contains "$config_b" "API:       http://127.0.0.1:8798"
assert_contains "$config_b" "MCP:       http://127.0.0.1:8799"
assert_contains "$config_b" "PostgreSQL 127.0.0.1:55443"

# Regression: an explicit activation recovers from a stale local tier file
# instead of trying to reclaim that stale tier during script initialization.
printf '2\n' >"$WORKTREE_B/.codex/run/tier"
(cd "$WORKTREE_B" && bash ./.codex/scripts/environment.sh activate 3 >/dev/null)
recovered_config="$(cd "$WORKTREE_B" && bash ./.codex/scripts/environment.sh config)"
assert_contains "$recovered_config" "Tier:      3"

# Production lifecycle commands delegate the exact stable worktree ports without
# synthesizing the required production acknowledgement.
PRODUCTION_HELPER="$TEMP_ROOT/production-runtime-helper.mjs"
PRODUCTION_OUTPUT="$TEMP_ROOT/production-runtime-output.jsonl"
cp "$SOURCE_ROOT/.codex/scripts/production-runtime.test-helper.mjs" "$PRODUCTION_HELPER"
export ILO_PRODUCTION_RUNTIME_HELPER="$PRODUCTION_HELPER"
export ILO_PRODUCTION_TEST_OUTPUT="$PRODUCTION_OUTPUT"
(cd "$WORKTREE_A" && bash ./.codex/scripts/environment.sh production-status)
production_invocation="$(tail -n 1 "$PRODUCTION_OUTPUT")"
assert_contains "$production_invocation" '"acknowledgement":null'
assert_contains "$production_invocation" '"status"'
assert_contains "$production_invocation" '"--api-port","8793"'
assert_contains "$production_invocation" '"--mcp-port","8794"'
assert_contains "$production_invocation" '"--web-port","8086"'
assert_contains "$production_invocation" '"--database-port","55438"'
unset ILO_PRODUCTION_RUNTIME_HELPER ILO_PRODUCTION_TEST_OUTPUT

printf 'Codex environment lifecycle tests passed.\n'
