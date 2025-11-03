# Contributing to Sentinel

Thank you for investing time in Sentinel! These guidelines help us collaborate effectively and keep the project stable.

## Getting Started

1. Fork the repository and clone your fork.
2. Install backend requirements and launch the API:
   ```bash
   cd backend
   pip install -r requirements.txt
   python app.py
   ```
3. Trust the generated certificate (`~/.finalextension/localhost-cert.pem`) via Keychain Access or `mkcert`, then restart Chrome.
4. Load the extension (Developer Mode → Load unpacked → repository root).

## Branch & Commit Strategy

- Create feature branches (`feat/auto-scan`, `fix/blur-toggle`) off `main`.
- Follow [Conventional Commits](https://www.conventionalcommits.org/) (e.g., `feat: add auto-scan toggle`, `fix: debounce mutation observer`).
- Keep commits focused; run lint/tests before pushing.

## Development Workflow

- Use 2-space indentation for extension JS/HTML and 4-space for Python.
- Place extension files under `extension/` (see README for layout); backend lives in `backend/`.
- Run relevant checks before PRs:
  ```bash
  npm run lint       # when available
  python backend/app.py  # ensure server loads the ONNX model
  ```
- Capture manual test steps or screenshots when UI changes.

## Pull Requests

Each PR should include:

- Summary of the change and motivation
- Testing evidence (commands run, screenshots, or videos)
- Checklist of outstanding issues or follow-up tasks

Request review after checks pass. Seek alignment on design changes via an issue or discussion before implementing.

## Reporting Issues

Use the issue templates to file bugs and feature requests. When reporting a bug, include reproduction steps, expected vs. actual outcomes, and logs if available.

Thank you for helping Sentinel grow!
