# ADR-006: Persistent household devices

- **Status:** Accepted
- **Date:** 2026-08-03
- **Updated:** 2026-08-03 — controlled room vocabulary

## Context

ADR-005 introduced live `DeviceRegistry` presence (`deviceId`, `displayName`, caps, exclusive voice). That inventory vanished on disconnect/restart and had no room/purpose — Jarvis could not answer «какие устройства» or «это кухня».

## Decision

### 1. Prisma `Device`

Persistent row per client `deviceId` (UUID PK): `displayName`, optional `room` (`DeviceRoom` enum) / `purpose` (free-text), `kind` (`desktop|pi|esp|other`), last-seen caps, `firstSeenAt` / `lastSeenAt`, `archived`.

### 2. Controlled rooms (not free-text)

`room` is a fixed household catalog (stable id + RU label + EN/RU aliases). Hello may send an **id or alias**; Core normalizes to the id or rejects with `hello invalid room`. Empty/omitted room remains allowed.

| id | RU |
|----|-----|
| `master_bedroom` | Спальня |
| `master_bathroom` | Ванная |
| `kitchen_living` | Кухня (open-plan / living room) |
| `garage` | Гараж |
| `office` | Офис |
| `poker_room` | Покерная комната |
| `play_room` | Игровая |
| `kids_room` | Детская (Василиса) |
| `kids_office` | Детский офис (Василиса) |
| `guest_room` | Гостевая |

Catalog: Core [`src/devices/rooms.ts`](../src/devices/rooms.ts), desktop [`clients/desktop/jarvis_client/rooms.py`](../clients/desktop/jarvis_client/rooms.py). Purpose stays free-text.

### 3. Auto-register on hello

Successful authenticated `hello` **upserts** via `DeviceStore.upsertFromHello`. Always updates `lastSeenAt` + caps; non-empty `displayName` / `room` / `purpose` / `kind` overwrite; empty/omitted client fields do **not** wipe values already stored from a previous hello.

### 4. Live vs inventory

- `DeviceRegistry` — ephemeral sockets + voice owner (unchanged role).
- `DeviceStore` — durable inventory; `GET /debug/devices` lists rows with `online`, `room`, `room_label`.

### 5. LLM

On `session.start`, Realtime instructions append a short device block (this device + siblings/online). Tool: `device_list` (read-only). Device name / room / purpose are **not** editable via voice — only via client Settings / hello fields.

## Consequences

- Desktop Settings uses a room dropdown; hello sends catalog ids; `device_meta.json` stores ids.
- Clients must use a real UUID `deviceId` (Prisma `@db.Uuid`).
- Targeted notify-by-room and pairing/allowlist remain future work.
- See [ADR-005](ADR-005-multi-device-gateway.md) for gateway auth and voice ownership.
