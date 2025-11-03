# Handoff Snapshot (2025-11-01)

## Current Status
- Chrome MV3 extension + Flask backend run locally.
- ONNX model (`TaiwoOgun/deberta-v3-hate-speech-onnx`) loads via `optimum.onnxruntime`; GPU optional (torch fallback to CPU).
 - Content script now scopes highlights to canonical text containers, dedupes flagged spans, and renders consolidated blur/redact controls with show/hide + feedback buttons.
- Backend exposes `/predict`, `/predict/batch`, `/report`; feedback persistence via `backend/reports.db`.
- Popup includes a live sensitivity slider synced through `chrome.storage.sync`.

## Open Challenges / Known Gaps
- No automated detection yet; user must click “Scan This Page”.
- No background service worker to coordinate settings/telemetry.
- No automated tests; manual verification only.
- UI polish: ensure control pills don’t overflow on very narrow layouts.

## Immediate Next Steps
1. Verify dismissal clears `processedSignatures` so rescans respect new thresholds/styles (adjust if needed).
2. Begin background worker planning (shared state + telemetry) now that feedback path is live.
3. Explore automatic scanning toggles (MutationObserver + throttled batches).

## Paths / Artifacts / Data
- Extension root: `FinalExtension/`
  - `popup.html`, `popup.js`, `options.html`, `options.js`, `content.js`
  - `manifest.json` (MV3, permissions include http/https localhost)
- Backend: `backend/`
  - `app.py` (Flask API, DB init)
  - `requirements.txt`
  - `reports.db` (SQLite feedback store)
- TLS artifacts: `~/.finalextension/localhost-cert.pem`, `~/.finalextension/localhost-key.pem`

## Recent Testing / Logs
- Manual test only: load backend (`python backend/app.py`), accept HTTPS cert in Chrome, load extension, run `Scan This Page`, verify blur controls appear once per post.
- No automated test suite yet; no CI logs available.

## API Contracts / Model Outputs
- `POST /predict` → `{"label": "NOT_HATE"|"HATE", "score": 0.xx}`
- `POST /predict/batch` → `{"results": [{"label": ..., "score": ...}, ...]}`
- `POST /report` (pending wiring) expects `{"text": "...", "report_type": "not_hate"|"flag"}` and returns `{"status": "ok"}`
- Model: sequence classification; scores already normalized.

## Environment / Tooling
- Python 3.10+ (system Python used; no virtualenv yet). Avoid spawning duplicate envs—reuse same interpreter and `pip install -r backend/requirements.txt`.
- Node/NPM available for future packaging (no build scripts defined yet).
- Required packages: `flask`, `flask-cors`, `torch` (optional for GPU), `transformers`, `onnx`, `optimum[onnxruntime]`, `pyOpenSSL`.
- Chrome (or Chromium) with developer mode to load unpacked extension.

## Notes
- Do not delete `backend/reports.db`; it stores feedback history.
- Accept the self-signed cert once per browser session; otherwise fetches will fail.
- When editing `content.js`, prefer modularization soon—file is large but the current structure relies on globals.
- Keep README/HANDOFF in sync with dependency or workflow changes.
