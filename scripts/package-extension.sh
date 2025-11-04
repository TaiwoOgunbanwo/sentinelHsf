#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
PACKAGE_NAME="sentinel-extension.zip"

mkdir -p "${DIST_DIR}"
cd "${ROOT_DIR}"

zip -r "${DIST_DIR}/${PACKAGE_NAME}" extension \
  -x "extension/content/__pycache__/*" \
     "extension/**/*.map" >/dev/null

echo "[Sentinel] Extension packaged at ${DIST_DIR}/${PACKAGE_NAME}" 
