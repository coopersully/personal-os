#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
command -v uv >/dev/null || { echo 'Install uv before setting up the optional audio tools.' >&2; exit 1; }
uv venv --python 3.12 --allow-existing .tools/earshot
uv pip sync --python .tools/earshot/bin/python tools/audio/requirements.lock
