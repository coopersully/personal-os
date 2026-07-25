#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

ROOT="$(git rev-parse --show-toplevel)"
RUN_DIR="$ROOT/.codex/run"
PID_DIR="$RUN_DIR/pids"
LOG_DIR="$RUN_DIR/logs"
ENV_FILE="$ROOT/.env"

API_PORT=8787
MCP_PORT=8788
WEB_PORT=8080
DB_PORT=55432
API_URL="http://127.0.0.1:$API_PORT"
MCP_URL="http://127.0.0.1:$MCP_PORT"
WEB_URL="http://localhost:$WEB_PORT"
LOCAL_DATABASE_URL="postgres://personal_os:personal_os@127.0.0.1:$DB_PORT/personal_os"

mkdir -p "$PID_DIR" "$LOG_DIR"

log() {
  printf '[personal-os] %s\n' "$*"
}

warn() {
  printf '[personal-os] warning: %s\n' "$*" >&2
}

die() {
  printf '[personal-os] error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command '$1' is not installed."
}

check_toolchain() {
  require_command git
  require_command node
  require_command pnpm
  require_command curl
  require_command lsof
  require_command docker

  local node_major pnpm_major
  # `node -p` renders values with ANSI color codes when FORCE_COLOR is set,
  # which makes Bash arithmetic reject an otherwise valid major version.
  node_major="$(node -e 'process.stdout.write(process.versions.node.split(".")[0])')"
  pnpm_major="$(pnpm --version | cut -d. -f1)"
  ((node_major >= 22)) || die "Node 22 or newer is required; found $(node --version)."
  ((pnpm_major >= 11)) || die "pnpm 11 or newer is required; found $(pnpm --version)."
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required."
}

generate_encryption_key() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 | tr -d '\n'
  else
    node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))'
  fi
}

ensure_env_file() {
  if [[ -f "$ENV_FILE" ]]; then
    return
  fi

  local key temporary
  key="$(generate_encryption_key)"
  temporary="$(mktemp "$RUN_DIR/env.XXXXXX")"
  sed "s|^APP_ENCRYPTION_KEY=.*|APP_ENCRYPTION_KEY=$key|" "$ROOT/.env.example" >"$temporary"
  chmod 600 "$temporary"
  mv "$temporary" "$ENV_FILE"
  log "Created .env with a generated local encryption key."
}

load_env() {
  ensure_env_file
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a

  [[ -n "${DATABASE_URL:-}" ]] || die "DATABASE_URL is missing from .env."
  [[ -n "${APP_ENCRYPTION_KEY:-}" ]] || die "APP_ENCRYPTION_KEY is missing from .env."
  [[ "$APP_ENCRYPTION_KEY" != "replace-with-32-byte-base64-key" ]] ||
    die "Replace the placeholder APP_ENCRYPTION_KEY in .env or remove .env and run Setup again."

  APP_ENCRYPTION_KEY="$APP_ENCRYPTION_KEY" node -e '
    const value = process.env.APP_ENCRYPTION_KEY ?? "";
    const decoded = Buffer.from(value, "base64");
    if (decoded.length !== 32 || decoded.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) {
      process.stderr.write("APP_ENCRYPTION_KEY must be a base64-encoded 32-byte key.\n");
      process.exit(1);
    }
  ' || die "APP_ENCRYPTION_KEY is invalid."
}

docker_is_ready() {
  docker info >/dev/null 2>&1
}

require_docker() {
  docker_is_ready || die "Docker is not running. Start Docker Desktop, then run this action again."
}

pid_file() {
  printf '%s/%s.pid' "$PID_DIR" "$1"
}

log_file() {
  printf '%s/%s.log' "$LOG_DIR" "$1"
}

pid_is_running() {
  [[ -n "${1:-}" ]] && kill -0 "$1" >/dev/null 2>&1
}

pid_belongs_to_repo() {
  local command_line working_directory
  command_line="$(ps -p "$1" -o command= 2>/dev/null || true)"
  working_directory="$(lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
  [[ "$command_line" == *"$ROOT"* || "$working_directory" == "$ROOT"* ]]
}

terminate_pid() {
  local pid="$1"
  if ! pid_is_running "$pid"; then
    return
  fi
  if ! pid_belongs_to_repo "$pid"; then
    warn "Refusing to stop PID $pid because it does not belong to this repository."
    return 1
  fi

  pkill -TERM -P "$pid" >/dev/null 2>&1 || true
  kill -TERM "$pid" >/dev/null 2>&1 || true
  for _ in {1..40}; do
    if ! pid_is_running "$pid"; then
      return
    fi
    sleep 0.25
  done

  pkill -KILL -P "$pid" >/dev/null 2>&1 || true
  kill -KILL "$pid" >/dev/null 2>&1 || true
}

stop_managed_service() {
  local name="$1" file pid
  file="$(pid_file "$name")"
  if [[ ! -f "$file" ]]; then
    return 0
  fi
  pid="$(cat "$file")"
  if pid_is_running "$pid"; then
    log "Stopping $name (PID $pid)..."
    terminate_pid "$pid" || true
  fi
  rm -f "$file"
}

stop_supervisor() {
  local file pid
  file="$(pid_file supervisor)"
  if [[ ! -f "$file" ]]; then
    return 0
  fi
  pid="$(cat "$file")"
  if ! pid_is_running "$pid"; then
    rm -f "$file"
    return 0
  fi
  if ! pid_belongs_to_repo "$pid"; then
    warn "Refusing to stop supervisor PID $pid because it does not belong to this repository."
    rm -f "$file"
    return 1
  fi

  log "Requesting supervisor shutdown (PID $pid)..."
  kill -TERM "$pid" >/dev/null 2>&1 || true
  for _ in {1..40}; do
    if ! pid_is_running "$pid"; then
      rm -f "$file"
      return 0
    fi
    sleep 0.25
  done
  warn "Supervisor did not stop cleanly; forcing shutdown."
  terminate_pid "$pid" || true
  rm -f "$file"
}

clear_repo_port() {
  local port="$1" pid command_line
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if pid_belongs_to_repo "$pid"; then
      log "Stopping orphaned repository process on port $port (PID $pid)..."
      terminate_pid "$pid"
    else
      die "Port $port is used by PID $pid: $command_line"
    fi
  done < <(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
}

start_service() {
  local name="$1" port="$2" workdir="$3"
  shift 3
  local file output pid
  file="$(pid_file "$name")"
  output="$(log_file "$name")"
  : >"$output"

  pushd "$workdir" >/dev/null
  "$@" >>"$output" 2>&1 &
  pid="$!"
  disown "$pid" 2>/dev/null || true
  popd >/dev/null
  printf '%s\n' "$pid" >"$file"
  log "Started $name on port $port (PID $pid)."
}

wait_for_url() {
  local name="$1" url="$2" pid timeout_seconds="${3:-45}" elapsed=0
  pid="$(cat "$(pid_file "$name")")"
  while ((elapsed < timeout_seconds * 4)); do
    if curl --fail --silent --show-error --max-time 2 "$url" >/dev/null 2>&1; then
      return
    fi
    if ! pid_is_running "$pid"; then
      warn "$name exited before becoming ready."
      tail -n 80 "$(log_file "$name")" >&2 || true
      return 1
    fi
    sleep 0.25
    ((elapsed += 1))
  done
  warn "Timed out waiting for $name at $url."
  tail -n 80 "$(log_file "$name")" >&2 || true
  return 1
}

wait_for_postgres() {
  local elapsed=0
  while ((elapsed < 120)); do
    if docker compose exec -T postgres pg_isready -U personal_os -d personal_os >/dev/null 2>&1; then
      return
    fi
    sleep 0.5
    ((elapsed += 1))
  done
  docker compose logs --tail 80 postgres >&2 || true
  return 1
}

stop_source_services() {
  stop_managed_service web
  stop_managed_service mcp
  stop_managed_service api
}

stop_compose_apps() {
  if docker_is_ready; then
    docker compose stop web mcp api >/dev/null 2>&1 || true
  fi
}

runtime_is_healthy() {
  local name file pid
  for name in api mcp web; do
    file="$(pid_file "$name")"
    [[ -f "$file" ]] || return 1
    pid="$(cat "$file")"
    pid_is_running "$pid" || return 1
  done
  curl --fail --silent --max-time 2 "$API_URL/health/ready" >/dev/null 2>&1 || return 1
  curl --fail --silent --max-time 2 "$MCP_URL/health/live" >/dev/null 2>&1 || return 1
  curl --fail --silent --max-time 2 "$WEB_URL" >/dev/null 2>&1 || return 1
}

supervise_runtime() {
  local cleanup_started=0 name file pid

  cleanup_runtime() {
    if ((cleanup_started)); then
      return
    fi
    cleanup_started=1
    trap - EXIT INT TERM
    stop_source_services
    if docker_is_ready; then
      docker compose stop postgres >/dev/null 2>&1 || true
    fi
    rm -f "$(pid_file supervisor)"
  }

  handle_shutdown() {
    log "Shutdown requested."
    cleanup_runtime
    exit 0
  }

  trap cleanup_runtime EXIT
  trap handle_shutdown INT TERM
  printf '%s\n' "$$" >"$(pid_file supervisor)"

  while true; do
    for name in api mcp web; do
      file="$(pid_file "$name")"
      if [[ ! -f "$file" ]]; then
        warn "$name PID file disappeared; stopping the runtime."
        return 1
      fi
      pid="$(cat "$file")"
      if ! pid_is_running "$pid"; then
        warn "$name exited unexpectedly."
        tail -n 80 "$(log_file "$name")" >&2 || true
        return 1
      fi
    done
    sleep 1
  done
}

command_setup() {
  check_toolchain
  ensure_env_file
  load_env
  log "Installing the locked workspace dependencies..."
  pnpm install --frozen-lockfile
  bash "$ROOT/.codex/scripts/check.sh"
  log "Setup complete. Run Start to launch ilo."
}

command_start() {
  check_toolchain
  load_env
  require_docker

  if runtime_is_healthy; then
    log "ilo is already running."
    command_status
    return
  fi

  stop_source_services
  stop_compose_apps
  clear_repo_port "$WEB_PORT"
  clear_repo_port "$MCP_PORT"
  clear_repo_port "$API_PORT"

  log "Starting PostgreSQL on loopback port $DB_PORT..."
  docker compose up -d postgres
  wait_for_postgres || die "PostgreSQL did not become ready."

  start_service api "$API_PORT" "$ROOT" \
    env \
    ALLOWED_ORIGINS="$WEB_URL,tauri://localhost,http://tauri.localhost" \
    API_BASE_URL="$API_URL" \
    APP_BASE_URL="$WEB_URL" \
    DATABASE_URL="$LOCAL_DATABASE_URL" \
    GOOGLE_REDIRECT_URI="$API_URL/v1/connectors/google/callback" \
    MIGRATIONS_DIR="$ROOT/packages/database/migrations" \
    NODE_ENV=development \
    PORT="$API_PORT" \
    pnpm --filter @personal-os/api exec tsx src/main.ts
  wait_for_url api "$API_URL/health/ready" || {
    stop_source_services
    die "API startup failed."
  }

  start_service mcp "$MCP_PORT" "$ROOT" \
    env \
    HOST=127.0.0.1 \
    PERSONAL_OS_API_URL="$API_URL" \
    PORT="$MCP_PORT" \
    pnpm --filter @personal-os/mcp exec tsx src/http.ts
  wait_for_url mcp "$MCP_URL/health/live" || {
    stop_source_services
    die "MCP startup failed."
  }

  start_service web "$WEB_PORT" "$ROOT" \
    env VITE_API_BASE_URL="/" VITE_PROXY_API_TARGET="$API_URL" \
    pnpm --filter @personal-os/web exec vite \
    --host 127.0.0.1 \
    --port "$WEB_PORT" \
    --strictPort
  wait_for_url web "$WEB_URL" || {
    stop_source_services
    die "Web startup failed."
  }

  log "ilo is ready."
  printf '  App:       %s\n' "$WEB_URL"
  printf '  API:       %s/health/ready\n' "$API_URL"
  printf '  MCP:       %s/mcp\n' "$MCP_URL"
  printf '  PostgreSQL 127.0.0.1:%s\n' "$DB_PORT"
  printf '  Logs:      %s\n' "$LOG_DIR"
  log "The Start action remains attached so process failures stay visible. Use Stop to shut down."
  supervise_runtime
}

command_stop() {
  stop_supervisor
  stop_source_services

  if docker_is_ready; then
    log "Stopping ilo containers..."
    docker compose stop web mcp api postgres >/dev/null 2>&1 || true
  fi

  for port in "$WEB_PORT" "$MCP_PORT" "$API_PORT"; do
    clear_repo_port "$port"
  done
  log "ilo is stopped. PostgreSQL data is preserved."
}

service_status() {
  local name="$1" url="$2" file pid="" process="down" health="down"
  file="$(pid_file "$name")"
  if [[ -f "$file" ]]; then
    pid="$(cat "$file")"
    if pid_is_running "$pid"; then
      process="up (PID $pid)"
    fi
  fi
  if curl --fail --silent --max-time 2 "$url" >/dev/null 2>&1; then
    health="ready"
  fi
  printf '  %-10s %-18s %s\n' "$name" "$process" "$health"
  [[ "$process" == up* && "$health" == "ready" ]]
}

command_status() {
  local healthy=0 postgres_status="down"
  printf 'ilo local runtime\n'
  service_status web "$WEB_URL" || healthy=1
  service_status api "$API_URL/health/ready" || healthy=1
  service_status mcp "$MCP_URL/health/live" || healthy=1

  if docker_is_ready && docker compose exec -T postgres pg_isready -U personal_os -d personal_os >/dev/null 2>&1; then
    postgres_status="ready"
  else
    healthy=1
  fi
  printf '  %-10s %-18s %s\n' postgres "docker compose" "$postgres_status"
  printf '  %-10s %s\n' logs "$LOG_DIR"
  return "$healthy"
}

command_logs() {
  local requested="${1:-}" name file
  local names=(api mcp web)
  if [[ -n "$requested" ]]; then
    case "$requested" in
      api | mcp | web) names=("$requested") ;;
      *) die "Unknown service '$requested'. Use api, mcp, or web." ;;
    esac
  fi

  for name in "${names[@]}"; do
    file="$(log_file "$name")"
    printf '\n===== %s =====\n' "$name"
    if [[ -f "$file" ]]; then
      tail -n 160 "$file"
    else
      printf 'No log file yet.\n'
    fi
  done
}

command_test() {
  check_toolchain
  require_docker
  pnpm test:coverage
}

command_e2e() {
  check_toolchain
  require_docker
  pnpm test:e2e
}

command_verify() {
  check_toolchain
  require_docker
  pnpm check
  pnpm test:e2e
}

command_build() {
  check_toolchain
  pnpm build
}

usage() {
  cat <<'EOF'
Usage: bash ./.codex/scripts/environment.sh <command>

Commands:
  setup     Install locked dependencies and initialize local configuration.
  start     Start PostgreSQL and the current API, MCP, and web source.
  stop      Stop the local runtime while preserving PostgreSQL data.
  restart   Stop and start the local runtime.
  status    Report process and health-check state.
  logs      Print recent API, MCP, and web logs; optionally name one service.
  test      Run the test suite with the repository's 100% coverage gate.
  e2e       Run desktop and mobile Playwright acceptance tests.
  verify    Run mirror checks, lint, types, coverage, builds, and E2E tests.
  build     Build every application and package.
EOF
}

cd "$ROOT"
case "${1:-}" in
  setup) command_setup ;;
  start) command_start ;;
  stop) command_stop ;;
  restart)
    command_stop
    command_start
    ;;
  status) command_status ;;
  logs) command_logs "${2:-}" ;;
  test) command_test ;;
  e2e) command_e2e ;;
  verify) command_verify ;;
  build) command_build ;;
  *)
    usage
    exit 2
    ;;
esac
