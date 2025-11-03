# Sentinel Hate Speech Detector

Sentinel is a Chrome manifest v3 extension paired with a secure Flask API that classifies in-page text for hate speech using a DeBERTa ONNX model. It was created as part of a dissertation project and focuses on fast highlighting, human review controls, and feedback capture.

## Architecture

- **Chrome extension** (`popup.html/js`, `options.html/js`, `content.js`)
  - Injects a scanner that batches visible text into `/predict` and `/predict/batch`.
  - Provides inline controls (show/hide, “Not hate?”, “Flag”) for blur/redact modes.
  - Offers a popup for manual analysis, sensitivity tuning, and scan status.
- **Flask backend** (`backend/app.py`)
  - Loads `TaiwoOgun/deberta-v3-hate-speech-onnx` via `optimum.onnxruntime`.
  - Exposes `/predict`, `/predict/batch`, and `/report`.
  - Persists reviewer feedback to `backend/reports.db` (SQLite) and serves over HTTPS with a self-signed cert (via `pyOpenSSL`).

## Stack

| Layer | Dependencies |
| --- | --- |
| Extension | Chrome MV3, Node/NPM for packaging (scripts TBD) |
| Backend | Python 3.10+, `flask`, `flask-cors`, `torch` (optional GPU), `transformers`, `onnx`, `optimum[onnxruntime]`, `pyOpenSSL`, `sqlite3` |
| Model | Hugging Face `TaiwoOgun/deberta-v3-hate-speech-onnx` (ONNX) |

See `backend/requirements.txt` for the exact Python packages (currently unpinned).

## Running Locally

1. **Backend**
   ```bash
   cd backend
   pip install -r requirements.txt
   python app.py
   ```
   - Generates `backend/reports.db` and self-signed certs under `~/.finalextension/`.
   - Serves `https://localhost:5000/predict` (accept the cert in Chrome). HTTP is available as a fallback for non-HTTPS pages.
   - **Trust the cert once**: open `~/.finalextension/localhost-cert.pem` in Keychain Access, set “When using this certificate” to “Always Trust”, then restart Chrome. Without this step the browser will keep showing “Not Secure” warnings and block requests on HTTPS pages.
   - Alternative: generate a trusted dev cert with [`mkcert`](https://github.com/FiloSottile/mkcert) and update `cert_file`/`key_file` paths in `backend/app.py`.

2. **Extension**
   - `npm install` (future build scripts TBD).
   - Load the `FinalExtension/` directory as an unpacked extension in `chrome://extensions`.
   - Popup slider controls sensitivity (`chrome.storage.sync`) and the scan button triggers analysis.

3. **Feedback**
   - Inline “Not hate?” / “Flag” controls POST to `/report`, disable during submission, and remove highlights when dismissed.

## Recent Decisions

- Added a `/report` endpoint and SQLite store for reviewer feedback.
- Refined blur/redact controls into a single inline pill with show/hide toggle plus feedback buttons.
- Deduped highlighted ranges so blur/redact controls appear once per detected snippet.
- Added a sensitivity slider to the popup; both popup and options share `chrome.storage` values.
- Hardened backend imports: optional torch, friendly errors when dependencies are missing.

## Limitations & Next Steps

- Auto-detection is manual (requires clicking “Scan This Page”).
- Feedback path is wired; consider retry UI/backoff for repeated failures.
- No automated tests yet—manual verification recommended after each change.
- Background service worker pending for shared state, telemetry, and eventual automatic scanning.
