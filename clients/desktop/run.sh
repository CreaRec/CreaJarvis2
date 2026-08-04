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
  # Ensure microWakeWord streaming stack for models/jarvis.tflite
  if ! python -c "from pymicro_wakeword import MicroWakeWordFeatures" 2>/dev/null; then
    echo "Installing pymicro-wakeword…"
    pip install "pymicro-wakeword>=2.4.0"
  fi
  if ! python -c "import openwakeword, onnxruntime" 2>/dev/null; then
    echo "Installing openwakeword + onnxruntime…"
    pip install "openwakeword>=0.6.0" "onnxruntime>=1.16"
  fi
fi

export VOICE_GATEWAY_URL="${VOICE_GATEWAY_URL:-ws://127.0.0.1:8787/voice}"
ENV_FILE="$ROOT/../../.env"
if [[ -z "${JARVIS_GATEWAY_TOKEN:-}" && -f "$ENV_FILE" ]]; then
  JARVIS_GATEWAY_TOKEN="$(grep -E '^JARVIS_GATEWAY_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r')"
  export JARVIS_GATEWAY_TOKEN
fi
if [[ -z "${JARVIS_GATEWAY_TOKEN:-}" ]]; then
  echo "warning: JARVIS_GATEWAY_TOKEN not set — Connect will fail until Settings has the household token" >&2
fi

exec python -m jarvis_client "$@"
