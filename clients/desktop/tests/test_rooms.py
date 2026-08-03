"""Tests for household room catalog."""

from __future__ import annotations

from jarvis_client.rooms import normalize_room, room_choices, room_label_ru


def test_normalize_room_aliases() -> None:
    assert normalize_room("office") == "office"
    assert normalize_room("Офис") == "office"
    assert normalize_room("кабинет") == "office"
    assert normalize_room("Kitchen") == "kitchen_living"
    assert normalize_room("living room") == "kitchen_living"
    assert normalize_room("Kid's room") == "kids_room"
    assert normalize_room("василисин оффис") == "kids_office"
    assert normalize_room("basement") is None
    assert normalize_room("") is None
    assert normalize_room(None) is None


def test_room_choices_and_labels() -> None:
    choices = room_choices()
    assert len(choices) == 10
    assert room_label_ru("office") == "Офис"
    assert all(rid and label for rid, label in choices)
