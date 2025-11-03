# Handoff Snapshot (2025-11-01)

## Current Status

- Chrome MV3 extension + Flask backend run locally (trust `~/.finalextension/localhost-cert.pem` in Keychain to silence HTTPS warnings).
- ONNX model (`TaiwoOgun/deberta-v3-hate-speech-onnx`) loads via `optimum.onnxruntime`; GPU optional (torch fallback to CPU).
- Content script (`extension/content/content.js`) now scopes highlights to canonical text containers, dedupes flagged spans, renders consolidated blur/redact controls with show/hide + feedback buttons, and queues feedback with retry/backoff.
- Backend exposes `/predict`, `/predict/batch`, `/report`; feedback persistence via `backend/reports.db`.
- Popup includes a live sensitivity slider, highlight-style selector, a feedback activity panel (pending count + history) backed by `chrome.storage.local`, and an auto-scan toggle.
- Background service worker injects the scanner automatically when auto-scan is enabled and host access is granted.

## Open Challenges / Known Gaps

- Auto-scan requires host permissions and currently injects via service worker once granted—verify UX messaging remains clear.
- No automated tests; manual verification only.
- No automated tests; manual verification only.
- UI polish: ensure control pills don’t overflow on very narrow layouts and that grouped blur/redact controls adapt to extremely long snippets.

## Immediate Next Steps

1. Stress-test auto-scan across busy feeds (verify we throttle mutation rescans and avoid double injections).
2. Capture telemetry/shared state in the background worker (toward future analytics + auto-detection toggles).
3. Expand permissions UX so users can opt into specific hosts instead of global `<all_urls>`.

## Paths / Artifacts / Data

- Extension files: `extension/`
  - `content/content.js`
  - `background.js`
  - `ui/popup.html`, `ui/popup.js`, `ui/options.html`, `ui/options.js`
  - `manifest.json` (MV3, permissions include http/https localhost + optional all-sites access for auto-scan)
- Backend: `backend/`
  - `app.py` (Flask API, DB init)
  - `requirements.txt`
  - `reports.db` (SQLite feedback store)
- TLS artifacts: `~/.finalextension/localhost-cert.pem`, `~/.finalextension/localhost-key.pem`

## Recent Testing / Logs

- Manual test only: load backend (`python backend/app.py`), accept HTTPS cert in Chrome, load extension, run `Scan This Page`, verify blur controls appear once per post.
- With auto-scan enabled, navigate to a supported site, refresh, and confirm the scanner injects automatically; disable the toggle and ensure injections stop.
- Spot-check feedback queue: toggle browser offline, submit “Not hate?” to confirm it queues, then go back online to ensure it flushes.
- No automated test suite yet; no CI logs available.

## API Contracts / Model Outputs

- `POST /predict` → `{"label": "NOT_HATE"|"HATE", "score": 0.xx}`
- `POST /predict/batch` → `{"results": [{"label": ..., "score": ...}, ...]}`
- `POST /report` expects `{"text": "...", "report_type": "not_hate"|"flag"}` and returns `{"status": "ok"}`
- Model: sequence classification; scores already normalized.

## Environment / Tooling

- Python 3.10+ (system Python used; no virtualenv yet). Avoid spawning duplicate envs—reuse same interpreter and `pip install -r backend/requirements.txt`.
- Node/NPM available for future packaging (no build scripts defined yet).
- Required packages: `flask`, `flask-cors`, `torch` (optional for GPU), `transformers`, `onnx`, `optimum[onnxruntime]`, `pyOpenSSL`.
- Chrome (or Chromium) with developer mode to load unpacked extension.

## Notes

- Do not delete `backend/reports.db`; it stores feedback history.
- Preferred TLS workflow:
  1. `mkdir -p ~/.finalextension/mkcert`
  2. `mkcert -install`
  3. `mkcert -cert-file ~/.finalextension/mkcert/localhost.pem -key-file ~/.finalextension/mkcert/localhost-key.pem localhost 127.0.0.1 ::1`
  4. Export `SENTINEL_CERT_FILE`/`SENTINEL_KEY_FILE` to those paths before `python backend/app.py`.
- If mkcert certificates are not supplied, trust `~/.finalextension/localhost-cert.pem` manually (Keychain → Always Trust) or Chrome will flag `https://localhost:5000` as insecure and block requests.
- Feedback queue + history persist in `chrome.storage.local` under keys `debPendingReports` and `debFeedbackHistory`; flushes trigger automatically when connectivity returns.
- Auto-scan state is stored in `chrome.storage.sync` (`autoScanEnabled`) and mirrored by the background service worker.
- When editing `extension/content/content.js`, prefer modularization soon—file is large but the current structure relies on globals.
- Keep README/HANDOFF in sync with dependency or workflow changes.
