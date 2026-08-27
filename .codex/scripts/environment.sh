#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

ROOT="$(git rev-parse --show-toplevel)"
GIT_COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir)"
PRIMARY_ROOT="$(cd "$(dirname "$GIT_COMMON_DIR")" && pwd -P)"
RUN_DIR="$ROOT/.codex/run"
LOG_DIR="$RUN_DIR/logs"
PRIMARY_ENV_FILE="$PRIMARY_ROOT/.env"
ENV_FILE="$ROOT/.env"
OVERLAY_FILE="$ROOT/.env.codex.local"
MANAGER="$ROOT/.codex/scripts/runtime-manager.mjs"
mkdir -p "$LOG_DIR"

log() { printf '[ilo] %s\n' "$*"; }
die() { printf '[ilo] error: %s\n' "$*" >&2; exit 1; }
require_command() { command -v "$1" >/dev/null 2>&1 || die "Required command '$1' is not installed."; }

check_toolchain() {
  require_command git; require_command node; require_command pnpm; require_command docker
  local node_major pnpm_major
  node_major="$(node -e 'process.stdout.write(process.versions.node.split(".")[0])')"
  pnpm_major="$(pnpm --version | cut -d. -f1)"
  ((node_major >= 22)) || die "Node 22 or newer is required; found $(node --version)."
  ((pnpm_major >= 11)) || die "pnpm 11 or newer is required; found $(pnpm --version)."
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required."
}

generate_base64_key() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -base64 32 | tr -d '\n';
  else node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))'; fi
}

generate_hex_secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32 | tr -d '\n';
  else node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))'; fi
}

ensure_primary_env() {
  if [[ ! -f "$PRIMARY_ENV_FILE" ]]; then
    local temporary encryption_key mcp_secret
    encryption_key="$(generate_base64_key)"; mcp_secret="$(generate_hex_secret)"
    temporary="$(mktemp "$PRIMARY_ROOT/.env.codex.XXXXXX")"
    sed -e "s|^APP_ENCRYPTION_KEY=.*|APP_ENCRYPTION_KEY=$encryption_key|" \
      -e "s|^MCP_INTERNAL_SECRET=.*|MCP_INTERNAL_SECRET=$mcp_secret|" \
      "$PRIMARY_ROOT/.env.example" >"$temporary"
    chmod 600 "$temporary"; mv "$temporary" "$PRIMARY_ENV_FILE"
    log "Created the primary checkout .env with generated local secrets."
  fi
  if [[ "$ROOT" != "$PRIMARY_ROOT" ]]; then cp "$PRIMARY_ENV_FILE" "$ENV_FILE"; chmod 600 "$ENV_FILE"; fi
}

load_env() {
  ensure_primary_env
  set -a
  source "$ENV_FILE"
  if [[ -f "$OVERLAY_FILE" ]]; then source "$OVERLAY_FILE"; fi
  set +a
  [[ -n "${APP_ENCRYPTION_KEY:-}" && "$APP_ENCRYPTION_KEY" != "replace-with-32-byte-base64-key" ]] || die "The primary .env needs a valid APP_ENCRYPTION_KEY."
  [[ -n "${MCP_INTERNAL_SECRET:-}" && "$MCP_INTERNAL_SECRET" != "replace-with-a-random-32-character-secret" ]] || die "The primary .env needs a valid MCP_INTERNAL_SECRET."
}

require_docker() { docker info >/dev/null 2>&1 || die "Docker is not running. Start Docker Desktop, then try again."; }

command_setup() {
  check_toolchain; ensure_primary_env
  node "$MANAGER" gc --root "$ROOT"
  node "$MANAGER" reaper-status --root "$ROOT" || true
  log "Installing the locked workspace dependencies..."
  pnpm install --frozen-lockfile
  bash "$ROOT/.codex/scripts/check.sh"
  log "Setup complete. Run Start to allocate and launch this checkout."
}

command_start() { check_toolchain; load_env; require_docker; exec node "$MANAGER" start --root "$ROOT"; }
command_stop() { node "$MANAGER" stop --root "$ROOT"; }

command_logs() {
  local requested="${1:-}" name file; local names=(api mcp web)
  if [[ -n "$requested" ]]; then case "$requested" in api | mcp | web) names=("$requested") ;; *) die "Unknown service '$requested'." ;; esac; fi
  for name in "${names[@]}"; do
    file="$LOG_DIR/$name.log"; printf '\n===== %s =====\n' "$name"
    if [[ -f "$file" ]]; then tail -n 160 "$file"; else printf 'No log file yet.\n'; fi
  done
}

usage() { printf '%s\n' 'Usage: bash ./.codex/scripts/environment.sh <setup|start|stop|restart|status|logs|config|list|doctor|gc|purge|activate|active-root|reaper-enable|reaper-disable|reaper-status|test|e2e|verify|build>'; }

cd "$ROOT"
case "${1:-}" in
  setup) command_setup ;;
  start) command_start ;;
  stop) command_stop ;;
  restart) command_stop; command_start ;;
  status | config | list | doctor | gc | purge | activate | active-root | reaper-enable | reaper-disable | reaper-status)
    command_name="$1"; shift; node "$MANAGER" "$command_name" --root "$ROOT" "$@" ;;
  logs) command_logs "${2:-}" ;;
  test) check_toolchain; require_docker; pnpm test:coverage ;;
  e2e) check_toolchain; require_docker; pnpm test:e2e ;;
  verify) check_toolchain; require_docker; pnpm check; pnpm test:e2e ;;
  build) check_toolchain; pnpm build ;;
  *) usage; exit 2 ;;
esac
