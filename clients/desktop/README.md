# CreaJarvis Desktop Client

Host-side voice UI that replaces `clients/web-ptt`. Talks to Core Voice Gateway over WebSocket.

## Requirements

- Core running (`docker compose up`) on `:8787`
- Python 3.11+
- Microphone + speakers

## Install

```bash
cd clients/desktop
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# optional voice wake (hey jarvis ≈ Джарвис):
pip install openwakeword
```

## Run

```bash
export VOICE_GATEWAY_URL=ws://127.0.0.1:8787/voice
# optional: openWakeWord until microWakeWord streaming is wired
export JARVIS_USE_OPENWAKEWORD=1

python -m jarvis_client
# UI: http://127.0.0.1:5173
```

## UX

1. **Connect** — opens WS + mic (no Realtime yet).
2. **Wake** — Space / Wake button, or «Джарвис» / «hey jarvis» if a wake backend is active.
3. Core plays **«Я тут»** (`ack.play`).
4. Speak a command (silence ends the turn → `audio.commit`).
5. After the reply, a **5 minute** armed window allows follow-ups without wake; then `session.end`.
6. Or say **«Спасибо Джарвис»** / **«Пока Джарвис»** — after the short reply, session ends immediately (no 5 min wait).

Half-duplex: mic is not streamed to Realtime while ack/assistant audio plays.

## microWakeWord («Джарвис»)

Target path for ESP / Raspberry:

1. Train with [microwakeword-trainer](https://github.com/interkelstar/microwakeword-trainer) (see `example_ru_jarvis.yaml`).
2. Copy the `.tflite` to `models/jarvis.tflite` or set `JARVIS_WAKE_MODEL`.
3. Install a TFLite interpreter (`tflite-runtime` or `ai-edge-litert`).

The desktop client loads the file today; full streaming feature extraction (matching the trainer) is the next firmware-aligned step. Until then use **hotkey** or `JARVIS_USE_OPENWAKEWORD=1`.

## Ack swap

`RealtimeAckPlayer` sends `{ "type": "ack.play" }`. Later replace with a local wav player implementing the same `play()` / `cancel()` port — FSM unchanged.

## Tests

```bash
cd clients/desktop
pip install pytest
pytest
```

## Env

| Variable | Default | Meaning |
|----------|---------|---------|
| `VOICE_GATEWAY_URL` | `ws://127.0.0.1:8787/voice` | Gateway WS |
| `JARVIS_UI_PORT` | `5173` | NiceGUI port |
| `JARVIS_WAKE_MODEL` | `models/jarvis.tflite` | microWakeWord model |
| `JARVIS_USE_OPENWAKEWORD` | unset | Enable hey_jarvis detector |
