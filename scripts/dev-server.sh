#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="${HOME}/.finalextension/mkcert"
CERT_FILE="${CERT_DIR}/localhost.pem"
KEY_FILE="${CERT_DIR}/localhost-key.pem"
VENV_DIR="${ROOT_DIR}/.venv"

echo "[Sentinel] Starting development backend..."

if [[ ! -f "${CERT_FILE}" || ! -f "${KEY_FILE}" ]]; then
  echo "[Sentinel] Certificates not found – running setup-cert.sh"
  "${ROOT_DIR}/scripts/setup-cert.sh"
fi

if [[ ! -d "${VENV_DIR}" ]]; then
  echo "[Sentinel] Creating Python virtual environment..."
  python3 -m venv "${VENV_DIR}"
fi

source "${VENV_DIR}/bin/activate"

echo "[Sentinel] Installing backend dependencies..."
pip install --upgrade pip >/dev/null
pip install -r "${ROOT_DIR}/backend/requirements.txt"

export SENTINEL_CERT_FILE="${CERT_FILE}"
export SENTINEL_KEY_FILE="${KEY_FILE}"

echo "[Sentinel] Launching backend (HTTPS on https://localhost:5000)..."
cd "${ROOT_DIR}/backend"
python app.py
