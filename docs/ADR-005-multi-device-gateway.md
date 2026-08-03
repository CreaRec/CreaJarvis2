# ADR-005: Multi-device LAN Voice Gateway

- **Status:** Accepted
- **Date:** 2026-08-02

## Context

Core already binds `0.0.0.0` and treats every WebSocket as an anonymous delivery target. A household with several desktops needs one Core, many devices: shared auth, stable device identity, exclusive voice ownership, and notify fanout that does not race digests on the first `session.start`.

## Decision

### 1. LAN household, single user

- One Core on the home LAN; no public internet / TLS cloud in this wave.
- One household token (`JARVIS_GATEWAY_TOKEN`); no multi-tenant Prisma users.
- First client wave: `clients/desktop` only; protocol is multi-device ready for later Pi/ESP.

### 2. Hello + device identity

After WS connect, the first inbound message **must** be:

```json
{
  "type": "hello",
  "token": "<JARVIS_GATEWAY_TOKEN>",
  "deviceId": "<stable-uuid>",
  "displayName": "optional",
  "caps": { "voice": true, "notify": true }
}
```

Core replies `hello.ok` `{ deviceId, serverTime }` and registers the device in `DeviceRegistry`. Invalid/missing token → `error` + close. Reconnect with the same `deviceId` replaces the previous socket (one device = one connection).

### 3. Exclusive voice session

- At most one `voiceOwnerDeviceId` on Core.
- `session.start` claims ownership; if another device owns voice → `session.busy` `{ ownerDeviceId, ownerDisplayName? }` and no Realtime open.
- `audio.*` / `text` / `ack.play` only from the voice owner.
- `session.end` or owner disconnect releases ownership and closes Realtime.
- Notifications (`caps.notify`) work **without** a Realtime session.

### 4. Delivery semantics

- Live `reminder.fired`: broadcast to all notifiable OPEN devices; `completeDelivery` if `sent >= 1`, else `markMissed`.
- On successful `hello`: if missed reminders exist, **broadcast** `reminder.missed_digest` to all current notifiable devices, then household-level `completeDelivery`. Late joiners after complete do not get the toast (history remains in `/debug/reminders`).
- `plan.today_digest`: broadcast open-today items on hello the same way (snapshot; no DB delivery flag).

### 5. HTTP auth

- `GET /debug/*` requires `Authorization: Bearer <JARVIS_GATEWAY_TOKEN>` (401 otherwise).
- `GET /health` stays open (no secrets).

## Consequences

- Desktop must persist `deviceId`, send `hello` before any other WS traffic, and pass the token for debug HTTP.
- `scripts/smoke-text.ts` and any LAN clients must hello first.
- Open debug CORS without a bearer is no longer sufficient for LAN privacy.
- Pi/ESP clients can reuse the same hello + caps contract later without Core schema changes.
