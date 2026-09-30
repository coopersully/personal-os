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
COMPOSE_MANAGER="$ROOT/.codex/scripts/compose-runtime-manager.mjs"
PRODUCTION_RUNTIME_HELPER="${ILO_PRODUCTION_RUNTIME_HELPER:-$ROOT/.codex/scripts/production-runtime.mjs}"
AGENT_SKILL_RELEASE_MANIFEST="$ROOT/packages/domain/src/ilo-setup-release.json"
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
  if [[ -f "$ROOT/scripts/migrate-agent-skill-environment.mjs" && -f "$AGENT_SKILL_RELEASE_MANIFEST" ]]; then
    node "$ROOT/scripts/migrate-agent-skill-environment.mjs" \
      "$PRIMARY_ENV_FILE" \
      "$AGENT_SKILL_RELEASE_MANIFEST"
  fi
  if [[ "$ROOT" != "$PRIMARY_ROOT" ]]; then cp "$PRIMARY_ENV_FILE" "$ENV_FILE"; chmod 600 "$ENV_FILE"; fi
}

load_env() {
  ensure_primary_env
  set -a
  source "$ENV_FILE"
  set +a
  [[ -n "${APP_ENCRYPTION_KEY:-}" && "$APP_ENCRYPTION_KEY" != "replace-with-32-byte-base64-key" ]] || die "The primary .env needs a valid APP_ENCRYPTION_KEY."
  [[ -n "${MCP_INTERNAL_SECRET:-}" && "$MCP_INTERNAL_SECRET" != "replace-with-a-random-32-character-secret" ]] || die "The primary .env needs a valid MCP_INTERNAL_SECRET."
}

require_docker() { docker info >/dev/null 2>&1 || die "Docker is not running. Start Docker Desktop, then try again."; }

allocate_loopback_ports() {
  node -e 'const net=require("node:net");const servers=Array.from({length:4},()=>net.createServer());Promise.all(servers.map(s=>new Promise((ok,fail)=>{s.once("error",fail);s.listen(0,"127.0.0.1",ok)}))).then(()=>{process.stdout.write(servers.map(s=>s.address().port).join(","));return Promise.all(servers.map(s=>new Promise(ok=>s.close(ok))))})'
}

command_setup() {
  check_toolchain; ensure_primary_env
  log "Installing the locked workspace dependencies..."
  pnpm install --frozen-lockfile
  bash "$ROOT/.codex/scripts/check.sh"
  log "Setup complete. Run Start to build and launch this worktree's Compose project."
}

command_start() { check_toolchain; load_env; require_docker; exec node "$COMPOSE_MANAGER" start --root "$ROOT"; }
command_stop() { node "$COMPOSE_MANAGER" stop --root "$ROOT"; }

run_production_runtime_helper() {
  node "$PRODUCTION_RUNTIME_HELPER" "$1" --root "$ROOT" --run-dir "$RUN_DIR"
}

command_production_start() {
  local allocated_ports web_port api_port mcp_port database_port
  require_command git; require_command node; require_command pnpm; require_command curl
  require_command lsof; require_command aws; require_command session-manager-plugin
  node "$COMPOSE_MANAGER" stop --root "$ROOT"
  load_env
  allocated_ports="$(allocate_loopback_ports)"
  IFS=',' read -r web_port api_port mcp_port database_port <<<"$allocated_ports"
  exec node "$PRODUCTION_RUNTIME_HELPER" start \
    --root "$ROOT" \
    --run-dir "$RUN_DIR" \
    --web-port "$web_port" \
    --api-port "$api_port" \
    --mcp-port "$mcp_port" \
    --database-port "$database_port" \
    --web-url "http://127.0.0.1:$web_port" \
    --api-url "http://127.0.0.1:$api_port" \
    --mcp-url "http://127.0.0.1:$mcp_port"
}

command_fixtures() {
  check_toolchain; load_env; require_docker
  node "$COMPOSE_MANAGER" fixtures --root "$ROOT"
}

usage() { printf '%s\n' 'Usage: bash ./.codex/scripts/environment.sh <setup|start|stop|restart|status|logs|config|gc|purge|production-start|production-stop|production-status|fixtures|test|e2e|verify|build>'; }

cd "$ROOT"
case "${1:-}" in
  setup) command_setup ;;
  start) command_start ;;
  stop) command_stop ;;
  restart) command_stop; command_start ;;
  production-start) command_production_start ;;
  production-stop) run_production_runtime_helper stop ;;
  production-status) run_production_runtime_helper status ;;
  status | config | gc | purge)
    command_name="$1"; shift; node "$COMPOSE_MANAGER" "$command_name" --root "$ROOT" "$@" ;;
  logs) node "$COMPOSE_MANAGER" logs --root "$ROOT" ;;
  fixtures) command_fixtures ;;
  test) check_toolchain; require_docker; pnpm test:coverage ;;
  e2e) check_toolchain; require_docker; pnpm test:e2e ;;
  verify) check_toolchain; require_docker; pnpm check; pnpm test:e2e ;;
  build) check_toolchain; pnpm build ;;
  *) usage; exit 2 ;;
esac
