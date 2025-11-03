#!/usr/bin/env bash
set -euo pipefail

CERT_DIR="${HOME}/.finalextension/mkcert"
CERT_FILE="${CERT_DIR}/localhost.pem"
KEY_FILE="${CERT_DIR}/localhost-key.pem"

echo "[Sentinel] Preparing mkcert certificates..."

if ! command -v mkcert >/dev/null 2>&1; then
  echo "Error: mkcert is not installed." >&2
  echo "Install it from https://github.com/FiloSottile/mkcert and re-run this script." >&2
  exit 1
fi

mkdir -p "${CERT_DIR}"

echo "[Sentinel] Ensuring local CA is installed..."
mkcert -install >/dev/null 2>&1 || true

if [[ -f "${CERT_FILE}" && -f "${KEY_FILE}" ]]; then
  echo "[Sentinel] Existing certificates found at ${CERT_DIR}."
else
  echo "[Sentinel] Generating localhost certificates..."
  mkcert \
    -cert-file "${CERT_FILE}" \
    -key-file "${KEY_FILE}" \
    localhost 127.0.0.1 ::1
  echo "[Sentinel] Certificates created."
fi

echo "[Sentinel] Certificates ready:"
echo "  CERT: ${CERT_FILE}"
echo "  KEY : ${KEY_FILE}"
