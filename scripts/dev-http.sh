#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export SENTINEL_HTTP_ONLY=1
"${ROOT_DIR}/scripts/dev-server.sh"
