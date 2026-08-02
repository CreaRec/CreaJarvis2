from __future__ import annotations

from jarvis_client.wake import HotkeyWake


def test_hotkey_wake_fires_when_started() -> None:
    hits: list[int] = []
    w = HotkeyWake(lambda: hits.append(1))
    w.trigger()
    assert hits == []
    w.start()
    w.trigger()
    assert hits == [1]
    w.stop()
    w.trigger()
    assert hits == [1]
