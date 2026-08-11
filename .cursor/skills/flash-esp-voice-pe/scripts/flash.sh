#!/usr/bin/env bash
# Run esp-voice-pe host tests, then compile + OTA flash Voice PE.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
PE_DIR="$ROOT/clients/esp-voice-pe"
DEVICE="${1:-${DEVICE:-192.168.1.155}}"
SKIP_UPLOAD="${SKIP_UPLOAD:-0}"

export PATH="${HOME}/.local/bin:${PATH}"

if [[ ! -f "$PE_DIR/secrets.yaml" ]]; then
  echo "error: missing $PE_DIR/secrets.yaml (copy from secrets.yaml.example)" >&2
  exit 1
fi

if ! command -v esphome >/dev/null 2>&1; then
  echo "error: esphome not on PATH (try: export PATH=\"\$HOME/.local/bin:\$PATH\")" >&2
  exit 1
fi

echo "==> host tests"
bash "$PE_DIR/host_tests/run.sh"

echo "==> compile jarvis-voice-pe.yaml"
(
  cd "$PE_DIR"
  esphome compile jarvis-voice-pe.yaml
)

if [[ "$SKIP_UPLOAD" == "1" ]]; then
  echo "==> SKIP_UPLOAD=1 — compile done, not uploading"
  exit 0
fi

echo "==> OTA upload → ${DEVICE}"
(
  cd "$PE_DIR"
  esphome upload jarvis-voice-pe.yaml --device "$DEVICE"
)

echo "==> flash OK (device ${DEVICE})"
