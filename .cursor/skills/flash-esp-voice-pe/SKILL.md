---
name: flash-esp-voice-pe
description: >-
  Run host tests then compile and OTA-flash the Home Assistant Voice PE
  (clients/esp-voice-pe) Jarvis firmware. Use when the user asks to flash,
  reflash, OTA, upload, or перепрошить the Voice PE / ESP device
  (jarvis-voice-pe, 192.168.1.155).
---

# Flash ESP Voice PE

## When to use

User wants to flash / OTA / перепрошить Voice PE with current `clients/esp-voice-pe` sources.

## Mandatory workflow

1. **Do not flash until tests pass.** Prefer the script below (tests + compile + OTA).
2. If tests fail: stop, report failures, do **not** upload.
3. Default device IP: `192.168.1.155` (override only if user gives another).
4. Ensure `export PATH="$HOME/.local/bin:$PATH"` so `esphome` is found (pipx).
5. Never commit `clients/esp-voice-pe/secrets.yaml`. Never run git commit/push as part of flash.
6. Summarize: firmware project version from `jarvis-voice-pe.yaml`, device IP, test result, OTA ok/fail.

## Script (preferred)

From repo root:

```bash
bash .cursor/skills/flash-esp-voice-pe/scripts/flash.sh
# or
bash .cursor/skills/flash-esp-voice-pe/scripts/flash.sh 192.168.1.155
```

Env overrides:
- `DEVICE` — OTA target IP (same as first arg)
- `SKIP_UPLOAD=1` — run tests + compile only
- `SKIP_COMPILE=0` — always compile (default); set only if script adds that later

Agent: run with a long block timeout (compile+OTA often 2–5+ minutes).

## Manual equivalent

```bash
export PATH="$HOME/.local/bin:$PATH"
cd clients/esp-voice-pe
./host_tests/run.sh
esphome compile jarvis-voice-pe.yaml
esphome upload jarvis-voice-pe.yaml --device 192.168.1.155
```

Optional related Core tests (not required for PE-only flash):

```bash
npm test -- src/esp-voice-pe/
```

## Prerequisites

| Need | Notes |
|------|--------|
| `secrets.yaml` | Present under `clients/esp-voice-pe/` (gitignored) |
| Network | Mac can reach device LAN IP; Core URL in secrets is LAN, not Tailscale |
| ESPHome CLI | `esphome` on PATH |

## After flash

- Device reboots; wait ~30s before wake test.
- Confirm project version in yaml if user asks what shipped.
- Logs: `esphome logs jarvis-voice-pe.yaml --device <IP>`
