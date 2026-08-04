# CreaJarvis Desktop Client

Host-side native voice UI (PySide6) that replaces `clients/web-ptt`. Talks to Core Voice Gateway over WebSocket.

## Requirements

- Core running (`docker compose up`) on `:8787`
- Python 3.11+
- Microphone + speakers
- Desktop GUI session (macOS / Linux with X11 or Wayland / Windows)

On Linux, install PortAudio for the mic stack, e.g. `libportaudio2` (Debian/Ubuntu) or `portaudio` (Fedora).

## Install

```bash
cd clients/desktop
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

First openWakeWord start may download ONNX models (~few MB).

## Run

Core must be up (`docker compose up` on `:8787`). Then from repo root:

```bash
./clients/desktop/run.sh
```

Or manually:

```bash
cd clients/desktop
source .venv/bin/activate   # create venv + pip install -r requirements.txt first if needed
export VOICE_GATEWAY_URL=ws://127.0.0.1:8787/voice
# same token as Core .env JARVIS_GATEWAY_TOKEN
export JARVIS_GATEWAY_TOKEN=change-me-lan-token
# optional: disable openWakeWord (custom microWakeWord only)
# export JARVIS_USE_OPENWAKEWORD=0

python -m jarvis_client
# opens a native Qt window with a Three.js (WebGL) cinematic orb
```

The Main orb uses **Qt WebEngine + Three.js** when available (`PySide6-Addons`). Falls back to a 2D QPainter orb if WebEngine is missing, or when `JARVIS_ORB_2D=1` / `QT_QPA_PLATFORM=offscreen` (tests).

Set `JARVIS_AUTO_CONNECT=0` to skip connecting on startup. Gateway URL, household token, device name, room, and purpose are under **Settings**; then use **Connect** on **Main**. For another machine on the LAN, point `VOICE_GATEWAY_URL` at `ws://<core-lan-ip>:8787/voice` and use the same token. Each install persists a `deviceId` under `~/.config/crea-jarvis/device_id` (ADR-005) and optional meta in `device_meta.json` (ADR-006).

## UX

1. **Connect** — opens WS, sends `hello`, then mic (no Realtime yet). Autoconnect runs on launch by default.
2. **Wake** — Space / Wake button, or «Джарвис» / «hey jarvis» if a wake backend is active. If another device owns voice, you get a «Голос занят» toast.
3. Core plays **«Я тут»** (`ack.play`).
4. Speak a command (silence ends the turn → `audio.commit`).
5. After the reply, a **5 minute** armed window allows follow-ups without wake; then `session.end`.
6. Or say **«Спасибо Джарвис»** / **«Пока Джарвис»** — after the short reply, session ends immediately (no 5 min wait).

Half-duplex: mic is not streamed to Realtime while ack/assistant audio plays.

Reminders / plans arrive as an in-app toast banner (and a system tray message when available) on any connected notifiable device. **Debug** tab refreshes Core `/debug/*` tables with the Bearer token.

## microWakeWord («Джарвис»)

1. Train with [microwakeword-trainer](https://github.com/interkelstar/microwakeword-trainer).
2. Copy `.tflite` (+ JSON) to `models/jarvis.tflite`.
3. Desktop also enables **openWakeWord** `hey_jarvis` by default (say «hey jarvis» or «Джарвис»).

If a custom model never wakes on speech (scores stay near 0 while silence spikes), retrain — the stock `probability_cutoff: 0.9` template will not help a weak export. Tune via `models/jarvis.json` / `JARVIS_WAKE_CUTOFF`. Disable openWakeWord with `JARVIS_USE_OPENWAKEWORD=0`.

## Ack swap

`RealtimeAckPlayer` sends `{ "type": "ack.play" }`. Later replace with a local wav player implementing the same `play()` / `cancel()` port — FSM unchanged.

## Tests

```bash
cd clients/desktop
pip install pytest
# Qt UI tests use an offscreen platform plugin
export QT_QPA_PLATFORM=offscreen
pytest
```

## Env

| Variable | Default | Meaning |
|----------|---------|---------|
| `VOICE_GATEWAY_URL` | `ws://127.0.0.1:8787/voice` | Gateway WS (use Core LAN IP for remote desktops) |
| `JARVIS_GATEWAY_TOKEN` | (required) | Same household token as Core |
| `JARVIS_DEVICE_NAME` | unset | Optional display name in `hello` |
| `JARVIS_DEVICE_ROOM` | unset | Optional room id or alias (`office`, `кухня`, …) |
| `JARVIS_DEVICE_PURPOSE` | unset | Optional purpose in `hello` |
| `JARVIS_CONFIG_DIR` | `~/.config/crea-jarvis` | Where `device_id` / `device_meta.json` are stored |
| `JARVIS_AUTO_CONNECT` | `1` | Connect on startup |
| `JARVIS_WAKE_MODEL` | `models/jarvis.tflite` | microWakeWord model |
| `JARVIS_WAKE_CUTOFF` | from `jarvis.json` (0.32) | Detection threshold |
| `JARVIS_WAKE_MIN_RMS` | from `jarvis.json` (500) | Ignore silence spikes |
| `JARVIS_WAKE_DEBUG` | unset | Log peak prob / RMS each ~1s |
| `JARVIS_USE_OPENWAKEWORD` | `1` | `0` disables hey_jarvis detector |
| `JARVIS_OWW_THRESHOLD` | `0.05` | Soft peak cutoff (end of speech) |
| `JARVIS_OWW_STRONG_THRESHOLD` | `0.4` | Instant wake if score is strong |
| `QT_QPA_PLATFORM` | (system) | Set to `offscreen` for headless tests |

The Main orb shows a stub weather bead on ring A (`+12°`) — larger than the red beads, inset from the rim, still orbiting with them — via `jarvis_client.weather.current_weather()`. Swap that function later for a live provider; the bridge is `OrbWidget.set_weather(payload)`.
