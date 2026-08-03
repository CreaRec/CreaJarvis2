"""Controlled vocabulary of household rooms (mirrors Core ADR-006)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RoomDef:
    id: str
    label_ru: str
    aliases: tuple[str, ...]


DEVICE_ROOMS: tuple[RoomDef, ...] = (
    RoomDef(
        "master_bedroom",
        "Спальня",
        ("master_bedroom", "master bedroom", "спальня"),
    ),
    RoomDef(
        "master_bathroom",
        "Ванная",
        ("master_bathroom", "master bathroom", "ванная"),
    ),
    RoomDef(
        "kitchen_living",
        "Кухня",
        ("kitchen_living", "kitchen", "living room", "livingroom", "кухня"),
    ),
    RoomDef("garage", "Гараж", ("garage", "гараж")),
    RoomDef("office", "Офис", ("office", "офис", "кабинет")),
    RoomDef(
        "poker_room",
        "Покерная комната",
        ("poker_room", "poker room", "покерная", "покерная комната"),
    ),
    RoomDef(
        "play_room",
        "Игровая",
        ("play_room", "play room", "playroom", "игровая"),
    ),
    RoomDef(
        "kids_room",
        "Детская (Василиса)",
        (
            "kids_room",
            "kid's room",
            "kids room",
            "kidsroom",
            "vasilisa's room",
            "vasilisas room",
            "комната василисы",
            "детская",
            "детская комната",
        ),
    ),
    RoomDef(
        "kids_office",
        "Детский офис (Василиса)",
        (
            "kids_office",
            "kid's office",
            "kids office",
            "vasilisa's office",
            "vasilisas office",
            "василисин офис",
            "василисин оффис",
            "детский офис",
        ),
    ),
    RoomDef(
        "guest_room",
        "Гостевая",
        ("guest_room", "guest room", "guestroom", "гостевая"),
    ),
)


def _norm(raw: str) -> str:
    return " ".join(raw.strip().lower().replace("ё", "е").split())


_ALIAS_TO_ID: dict[str, str] = {}
for _room in DEVICE_ROOMS:
    for _alias in _room.aliases:
        _ALIAS_TO_ID[_norm(_alias)] = _room.id

_LABEL_BY_ID: dict[str, str] = {r.id: r.label_ru for r in DEVICE_ROOMS}


def normalize_room(value: str | None) -> str | None:
    """Return catalog id, or None if empty/unknown."""
    if value is None:
        return None
    key = _norm(value)
    if not key:
        return None
    return _ALIAS_TO_ID.get(key)


def room_label_ru(room_id: str) -> str:
    return _LABEL_BY_ID.get(room_id, room_id)


def room_choices() -> list[tuple[str, str]]:
    """(id, label_ru) for Settings combo."""
    return [(r.id, r.label_ru) for r in DEVICE_ROOMS]
