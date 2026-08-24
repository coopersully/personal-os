#!/usr/bin/env bash

set -eu

case "${1:-}" in
  info)
    [[ "${TEST_DOCKER_READY:-0}" == "1" || -n "${TEST_DOCKER_OWNER:-}" ]]
    ;;
  ps)
    if [[ "${TEST_DOCKER_PS_FAIL:-0}" == "1" ]]; then
      exit 1
    fi
    if [[ "${TEST_DOCKER_READY:-0}" == "1" || -n "${TEST_DOCKER_OWNER:-}" ]]; then
      printf 'test-container\n'
    fi
    ;;
  inspect)
    if [[ "$*" == *"config_files"* ]]; then
      if [[ -n "${TEST_DOCKER_CONFIG+x}" ]]; then
        printf '%s\n' "$TEST_DOCKER_CONFIG"
      else
        printf '%s\n' "${TEST_DOCKER_OWNER:-}/compose.yaml"
      fi
    else
      printf '%s\n' "${TEST_DOCKER_OWNER:-}"
    fi
    ;;
  *)
    exit 1
    ;;
esac
