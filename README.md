# Sentinel Hate Speech Detector

Sentinel is a Chrome manifest v3 extension paired with a secure Flask API that classifies in-page text for hate speech using a DeBERTa ONNX model. It was created as part of a dissertation project and focuses on fast highlighting, human review controls, and feedback capture.

## Architecture & Layout

```
.
├── backend/                   # Flask API + SQLite feedback store
│   ├── app.py
│   └── requirements.txt
├── extension/
│   ├── content/               # content scripts
│   │   └── content.js
│   └── ui/                    # popup + options surfaces
│       ├── options.html
│       ├── options.js
│       ├── popup.html
│       └── popup.js
├── manifest.json              # Chrome MV3 manifest
├── AGENTS.md                  # contributor playbook
├── HANDOFF.md                 # context for future maintainers
└── README.md
```

- **Chrome extension** (`extension/`):
  - `content/content.js` injects the scanner, batches text into `/predict` or `/predict/batch`, dedupes flagged spans, and renders inline controls.
  - `ui/popup.*` powers the action popup (manual analysis, scan trigger, sensitivity slider, highlight-style selector, feedback queue/history).
  - `ui/options.*` persists highlight style and threshold settings.
- **Flask backend** (`backend/app.py`):
  - Loads `TaiwoOgun/deberta-v3-hate-speech-onnx` via `optimum.onnxruntime`.
  - Exposes `/predict`, `/predict/batch`, and `/report`.
  - Persists reviewer feedback to `backend/reports.db` (SQLite) and serves HTTPS using a self-signed cert (generated with `pyOpenSSL`).

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
   - Load the repository root as an unpacked extension in `chrome://extensions`.
   - Popup slider controls sensitivity (`chrome.storage.sync`), radio buttons switch highlight style, and the scan button triggers analysis.

3. **Feedback**
   - Inline “Not hate?” / “Flag” controls POST to `/report`, disable during submission, queue failed attempts for retry, and remove highlights when dismissals succeed.
   - The popup shows pending feedback count plus a recent history pulled from `chrome.storage.local`.

## Recent Decisions

- Added a `/report` endpoint and SQLite store for reviewer feedback.
- Refined blur/redact controls into a single inline pill with show/hide toggle plus feedback buttons.
- Deduped highlighted ranges so blur/redact controls appear once per detected snippet and grouped blur/redact toggles manage all fragments at once.
- Added a sensitivity slider to the popup; both popup and options share `chrome.storage` values.
- Added highlight-style controls directly to the popup for quick adjustments (options page remains available).
- Hardened the feedback path with retry/backoff, offline queuing (via `chrome.storage.local`), and a popup audit history.
- Hardened backend imports: optional torch, friendly errors when dependencies are missing.

## Limitations & Next Steps

- Auto-detection is manual (requires clicking “Scan This Page”).
- Feedback path is wired; consider retry UI/backoff for repeated failures.
- No automated tests yet—manual verification recommended after each change.
- Background service worker pending for shared state, telemetry, and eventual automatic scanning.

---

- See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow and commit conventions.
- See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for expected behavior.
