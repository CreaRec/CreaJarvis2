#!/usr/bin/env bash
# Launch CreaJarvis desktop client (PySide6 HUD).
# Usage: ./run.sh   or   bash run.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ ! -d .venv ]]; then
  echo "Creating .venv…"
  python3 -m venv .venv
  # shellcheck disable=SC1091
  source .venv/bin/activate
  pip install -r requirements.txt
else
  # shellcheck disable=SC1091
  source .venv/bin/activate
  # Ensure WebEngine (3D orb) is present for existing venvs
  if ! python -c "from PySide6.QtWebEngineWidgets import QWebEngineView" 2>/dev/null; then
    echo "Installing PySide6-Addons (WebGL orb)…"
    pip install "PySide6-Addons>=6.6"
  fi
fi

export VOICE_GATEWAY_URL="${VOICE_GATEWAY_URL:-ws://127.0.0.1:8787/voice}"

exec python -m jarvis_client "$@"
