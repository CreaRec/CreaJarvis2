# Jarvis client — Home Assistant Voice PE

ESPHome external component `jarvis_gateway` turns a Voice PE into a headless CreaJarvis client (`kind: esp`) over the same Voice Gateway protocol as the desktop app.

MVP: wake / center button (via HA **Jarvis wake** button or patched automations) → `ack.play` («Я тут») → mic uplink → reply on speaker → ARMED 5 min → goodbye → `session.end`. Second wake while the session is open cancels it (`session.end`, stops playback). Notify digests pulse LED + beep.

## Prerequisites

| Piece | Notes |
|-------|--------|
| **Core** | Deployed server (`docs/docker.md`). PE must reach **`ws://<CORE_LAN_IP>:8787/voice`** on Wi‑Fi. Tailscale-only hostnames do **not** work from ESP. |
| **Token** | Same `JARVIS_GATEWAY_TOKEN` as server `.env` |
| **HA** | Docker OK. Stock Assist / local STT wizard is **not** required (Docker cannot install add-ons). |
| **ESPHome** | Device Builder Docker (`:6052`) **or** host `esphome` CLI. Prefer CLI if discovery/Take control is empty on Docker Desktop Mac. |
| **Voice PE** | On Wi‑Fi; optional presence in HA for OTA/logs. Rollback: [web installer](https://esphome.github.io/home-assistant-voice-pe/) |

HA Internal URL (for stock Assist media only): `http://<HA_LAN_IP>:8123` — not related to Jarvis WS.

## Secrets

```sh
cp secrets.yaml.example secrets.yaml
```

Edit:

- `jarvis_gateway_url` — deployed Core LAN (this house: `ws://192.168.1.135:8787/voice`)
- `syslog_host` — same Core LAN IP (UDP syslog → `esp-syslog-bridge` on port 1514)
- `jarvis_gateway_token` — household token
- `jarvis_device_id` — stable UUID v4
- `wifi_*`, `api_encryption_key`, `ota_password`

Never commit `secrets.yaml`.

Firmware also enables ESPHome `syslog` (`INFO`) to that host. After flash, Loki:

```logql
{service_name="crea-jarvis-client"}
```

Bridge must be running on the Core host (`docs/docker.md`).

## Flash

### Option A — ESPHome CLI (recommended on Mac)

```sh
cd clients/esp-voice-pe
export PATH="$HOME/.local/bin:$PATH"   # if esphome was installed via pipx
esphome run jarvis-voice-pe.yaml --device 192.168.1.155
```

Uses vendored `vendor/home-assistant-voice.yaml` (Assist removed; center/wake → `jarvis_gateway`). First flash may need USB; later OTA wireless.

### Option B — Device Builder UI

1. Open `http://<mac-lan>:6052`
2. **Advanced → Import from file** — import `jarvis-voice-pe.yaml` + copy `components/` and `secrets.yaml` into the Builder config dir (`~/esphome-config`)
3. Install → Wireless / USB

Do **not** rely on “Take control” discovery in Docker Desktop (mDNS often empty).

## Wake word

On-device **Hey Jarvis** (`micro_wake_word` model `hey_jarvis`). Firmware starts mWW after Core `hello.ok` while idle/armed; stops during an active session and when Mute is on. Center button / HA **Jarvis wake** still work.

Say clearly: **“Hey Jarvis”** (English). Russian «Джарвис» is not in this model.

2. After connect + hello:  
   `curl -H "Authorization: Bearer $JARVIS_GATEWAY_TOKEN" http://<CORE_LAN_IP>:8787/debug/devices`  
   → device `kind: esp`, `online: true`
3. Press **Jarvis wake** (or button) → hear «Я тут»
4. Speak a command → reply on speaker
5. Press wake again while listening/speaking/armed → session cancels
6. «Спасибо Джарвис» → session ends after playback

## Rollback

USB → [Voice PE web installer](https://esphome.github.io/home-assistant-voice-pe/) → erase → stock firmware → re-adopt in HA.

## Layout

```text
clients/esp-voice-pe/
  jarvis-voice-pe.yaml
  secrets.yaml.example
  README.md
  vendor/home-assistant-voice.yaml  # upstream PE YAML, Assist removed
  components/jarvis_gateway/        # ESPHome external component (+ fsm/goodbye/base64 headers)
  host_tests/                       # g++ unit tests (no ESP toolchain)
```

## Host tests

```sh
chmod +x host_tests/run.sh
./host_tests/run.sh
```

GitHub Actions (`test` job) runs `./host_tests/run.sh`.  
`npm test` also covers `src/esp-voice-pe/goodbye.test.ts`.

## Protocol (summary)

1. `hello` (`kind: esp`, caps voice+notify) → `hello.ok`
2. `session.start` → `ready` → `ack.play` → `audio.delta`*
3. `audio.append` (PCM16 @ 24 kHz base64) → `audio.commit`
4. `audio.delta`* → `response.done`
5. ARMED / idle 5 min → `session.end`; second wake while open → cancel `session.end`
6. Notify: `reminder.*` / `plan.today_digest` → beep + LED phase

See ADR-005 / ADR-006 and desktop `fsm.py`.

## Known limits

- JSON+base64 on ESP32: keep mic chunks short (~20–40 ms)
- Half-duplex: no mic uplink during ACK/SPEAKING
- Core must be on the same L2/L3 path as PE Wi‑Fi
