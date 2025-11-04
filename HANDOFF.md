# Handoff Snapshot (2025-11-03)

## Current Status

- Chrome MV3 extension + Flask backend run locally (trust the SAN-enabled `~/.finalextension/localhost-cert.pem` in Keychain to silence HTTPS warnings, or set `SENTINEL_HTTP_ONLY=1` to skip TLS during development).
- ONNX model (`TaiwoOgun/deberta-v3-hate-speech-onnx`) loads via `optimum.onnxruntime`; GPU optional (torch fallback to CPU).
- Content script (`extension/content/content.js`) now scopes highlights to canonical text containers, delegates tooltip/inline UI to `content/overlay.js`, dedupes flagged spans, and queues feedback with retry/backoff.
- Backend exposes `/predict`, `/predict/batch`, `/report`; feedback persistence via `backend/reports.db`.
- Popup includes a live sensitivity slider, highlight-style selector, a feedback activity panel (pending count + history) backed by `chrome.storage.local`, and an auto-scan toggle.
- Content helpers are modularised (`extension/content/feedback.js`, `extension/content/dom.js`, `extension/content/overlay.js`, `extension/config.js`) to keep the bootstrap file slim.
- Background service worker injects the scanner automatically when auto-scan is enabled, proxies all backend fetches (content scripts talk to it via runtime messages), and therefore sidesteps mixed-content blocks on HTTPS pages.
- Auto-scan reliability improvements: background fetch retries, offline detection, and injection failures bubble up to the popup so examiners immediately know why a scan stopped.
- Feedback UX polish: inline buttons now reflect sent/queued/error states, popup history gains relative timestamps, and examiners can dismiss entries once reviewed.
- Simplified status line replaces the old telemetry panel, surfacing a single human-readable update (ready, scanning, results, or issues) for examiners.
- Activity & Status card now co-locates the status line with the pending badge and history list, keeping examiner attention in one place.
- Jest unit tests cover `extension/content/dom.js`; run `npm install && npm test` to validate helper logic before exam sessions.
- Auto-scan allow list: options page now accepts domain entries and the background worker only auto-injects on those hosts, keeping manual scans available everywhere.
- Security posture simplified: API key plumbing was removed so the extension assumes a trusted localhost backend without bundling secrets.

## Additions & Refinements

- Content script fully modularised: DOM helpers, overlay renderer, feedback queue, and config constants live in isolated modules, shrinking the injected payload.
- Inline highlight/blur/redact UX dedupes spans, enforces a single show/hide toggle per detection, and wires `Not hate?/Flag` buttons to `/report`.
- Popup now features manual analyzer, confidence slider, highlight-style radios, live scan status, feedback activity list, pending-queue badge, and auto-scan toggle.
- Options page mirrors sensitivity + highlight-style controls with `chrome.storage.sync` persistence shared with the popup.
- Feedback manager supports offline queueing, retry/backoff, and history stored in `chrome.storage.local`, while `/report` writes to SQLite (`backend/reports.db`).
- Background worker proxies all prediction/report traffic (with HTTP fallback) and orchestrates auto-scan injections.
- Auto-scan toggle now notifies active tabs to halt observers immediately when disabled, so rescans stop without forcing a reload.
- Auto-scan UI refinement ensures the manual scan button disables and re-labels itself when automatic monitoring is active, reinforcing the current mode to examiners.
- Scripts (`setup-cert.sh`, `dev-server.sh`) automate mkcert provisioning, virtualenv setup, and backend launch.
- TLS story improved: SAN-enabled self-signed certs, mkcert workflow, and optional `SENTINEL_HTTP_ONLY=1` for plain HTTP demos.
- Documentation (README, AGENTS, this HANDOFF) now captures cert workflows, feature breadth, and testing expectations for examiners.
- Convenience tooling: `scripts/dev-http.sh` boots the backend in HTTP-only mode, while `scripts/package-extension.sh` emits `dist/sentinel-extension.zip` for easy unpacked installs.

## Open Challenges / Known Gaps

- Auto-scan requires host permissions and currently injects via service worker once granted—verify UX messaging remains clear.
- No automated tests; manual verification only.
- UI polish: ensure control pills don’t overflow on very narrow layouts and that grouped blur/redact controls adapt to extremely long snippets.

## Immediate Next Steps

1. Stress-test auto-scan across busy feeds (verify we throttle mutation rescans and avoid double injections).
2. Capture telemetry/shared state in the background worker (toward future analytics + auto-detection toggles).
3. Expand permissions UX so users can opt into specific hosts instead of global `<all_urls>`.

## Paths / Artifacts / Data

- Extension files: `extension/`
  - `content/content.js`
  - `content/overlay.js`
  - `background.js`
  - `config.js`
  - `ui/popup.html`, `ui/popup.js`, `ui/options.html`, `ui/options.js`
  - `manifest.json` (MV3, permissions include http/https localhost + optional all-sites access for auto-scan)
- Backend: `backend/`
  - `app.py` (Flask API, DB init)
  - `requirements.txt`
  - `reports.db` (SQLite feedback store)
- TLS artifacts: `~/.finalextension/localhost-cert.pem`, `~/.finalextension/localhost-key.pem`

## Recent Testing / Logs

- Manual test only: load backend (`python backend/app.py`), accept HTTPS cert in Chrome, load extension, run `Scan This Page`, verify blur controls appear once per post.
- With auto-scan enabled, navigate to a supported site, refresh, and confirm the scanner injects automatically; disable the toggle and ensure observers stop on existing tabs (no further automatic rescans).
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
- If mkcert certificates are not supplied, trust `~/.finalextension/localhost-cert.pem` manually (Keychain → Always Trust). The generated cert now carries SAN entries for `localhost`, `127.0.0.1`, and `::1`, so Chrome accepts it once trusted. Alternatively set `SENTINEL_HTTP_ONLY=1` before running `python backend/app.py` to expose plain HTTP for quick testing.
- Feedback queue + history persist in `chrome.storage.local` under keys `debPendingReports` and `debFeedbackHistory`; flushes trigger automatically when connectivity returns.
- Auto-scan state is stored in `chrome.storage.sync` (`autoScanEnabled`) and mirrored by the background service worker.
- Scripts: `scripts/setup-cert.sh` provisions mkcert certs; `scripts/dev-server.sh` wraps setup and launches the backend in one step.
- When editing `extension/content/content.js`, note that key helpers now live in `extension/content/feedback.js`, `extension/content/dom.js`, and `extension/content/overlay.js`; keep new logic modular.
- Keep README/HANDOFF in sync with dependency or workflow changes.
