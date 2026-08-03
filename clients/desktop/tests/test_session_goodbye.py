"""Goodbye end-session races (late STT vs armed)."""

from __future__ import annotations

from unittest.mock import MagicMock

from jarvis_client.fsm import FsmConfig, State, VoiceFsm
from jarvis_client.session import SessionController


def _bare_controller() -> SessionController:
    ctrl = object.__new__(SessionController)
    ctrl._end_after_goodbye = False
    ctrl._on_log = lambda _m: None
    ctrl._on_toast = None
    ctrl.audio = MagicMock()
    ctrl.gateway = MagicMock()
    ended: list[int] = []
    ctrl._ended = ended  # type: ignore[attr-defined]
    ctrl.fsm = VoiceFsm(
        config=FsmConfig(idle_timeout_s=3600),
        on_end_session=lambda: ended.append(1),
    )
    return ctrl


def test_late_goodbye_transcript_ends_armed_session() -> None:
    ctrl = _bare_controller()
    ctrl.fsm.state = State.ARMED

    SessionController._on_gateway_message(
        ctrl,
        {"type": "transcript", "role": "user", "text": "Джарвис пока"},
    )

    assert ctrl.fsm.state == State.IDLE
    assert ctrl._ended == [1]  # type: ignore[attr-defined]


def test_after_playback_rechecks_goodbye_before_staying_armed() -> None:
    """Flag flips false→true between check and on_playback_drained."""
    ctrl = _bare_controller()
    ctrl.fsm.state = State.SPEAKING
    ctrl.audio.wait_playback_idle = MagicMock(return_value=True)

    original_drained = ctrl.fsm.on_playback_drained

    def drained_then_mark_goodbye() -> None:
        ctrl._end_after_goodbye = True
        original_drained()

    ctrl.fsm.on_playback_drained = drained_then_mark_goodbye  # type: ignore[method-assign]

    SessionController._after_response_playback(ctrl)

    assert ctrl.fsm.state == State.IDLE
    assert ctrl._ended == [1]  # type: ignore[attr-defined]


def test_goodbye_during_speaking_waits_for_playback() -> None:
    ctrl = _bare_controller()
    ctrl.fsm.state = State.SPEAKING

    SessionController._on_gateway_message(
        ctrl,
        {"type": "transcript", "role": "user", "text": "Пока Джарвис"},
    )

    assert ctrl._end_after_goodbye is True
    assert ctrl.fsm.state == State.SPEAKING
    assert ctrl._ended == []  # type: ignore[attr-defined]
