#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >>"${ILO_TEST_DOCKER_LOG:?}"
case "${1:-} ${2:-}" in
  "compose version" | "info ") exit 0 ;;
esac
if [[ " $* " == *" inspect "* ]]; then printf '[]\n'; fi
