from __future__ import annotations

import time

from jarvis_client.fsm import FsmConfig, State, VoiceFsm


def test_wake_to_listening_via_ack() -> None:
    events: list[str] = []
    commits = []

    fsm = VoiceFsm(
        config=FsmConfig(idle_timeout_s=3600),
        on_start_session=lambda: events.append("start"),
        on_ack_play=lambda: events.append("ack"),
        on_commit=lambda: commits.append(1),
        on_mic_gate=lambda on: events.append(f"mic:{on}"),
    )

    fsm.on_wake()
    assert fsm.state == State.CONNECTING
    assert "start" in events

    fsm.on_session_ready()
    assert fsm.state == State.ACK
    assert "ack" in events
    assert not fsm.stream_to_gateway()

    fsm.on_ack_finished()
    assert fsm.state == State.LISTENING
    assert fsm.stream_to_gateway()


def test_silence_eos_commits() -> None:
    commits: list[int] = []
    fsm = VoiceFsm(
        config=FsmConfig(
            idle_timeout_s=3600,
            silence_eos_ms=200,
            min_utterance_ms=100,
            speech_rms_threshold=100,
        ),
        on_commit=lambda: commits.append(1),
    )
    fsm.state = State.LISTENING
    # speech
    for _ in range(5):
        fsm.on_capture_chunk(rms=500, duration_ms=40)
    assert fsm.state == State.LISTENING
    # silence
    for _ in range(10):
        fsm.on_capture_chunk(rms=10, duration_ms=40)
    assert fsm.state == State.PROCESSING
    assert commits == [1]
    assert not fsm.stream_to_gateway()


def test_mic_gated_in_ack_and_speaking() -> None:
    fsm = VoiceFsm(config=FsmConfig(idle_timeout_s=3600))
    fsm.state = State.ACK
    assert not fsm.stream_to_gateway()
    fsm.state = State.SPEAKING
    assert not fsm.stream_to_gateway()
    fsm.state = State.LISTENING
    assert fsm.stream_to_gateway()


def test_armed_speech_returns_to_listening() -> None:
    fsm = VoiceFsm(
        config=FsmConfig(idle_timeout_s=3600, speech_rms_threshold=100),
    )
    fsm.state = State.ARMED
    fsm.on_capture_chunk(rms=500, duration_ms=40)
    assert fsm.state == State.LISTENING


def test_idle_timeout_ends_session() -> None:
    ended: list[int] = []
    fsm = VoiceFsm(
        config=FsmConfig(idle_timeout_s=0.05),
        on_end_session=lambda: ended.append(1),
    )
    fsm.state = State.ARMED
    fsm.touch()
    time.sleep(0.2)
    assert fsm.state == State.IDLE
    assert ended == [1]


def test_wake_cancels_open_session() -> None:
    ended: list[int] = []
    started: list[int] = []
    fsm = VoiceFsm(
        config=FsmConfig(idle_timeout_s=3600),
        on_start_session=lambda: started.append(1),
        on_end_session=lambda: ended.append(1),
    )

    fsm.on_wake()
    assert fsm.state == State.CONNECTING
    assert started == [1]

    fsm.on_wake()  # cancel while CONNECTING
    assert fsm.state == State.IDLE
    assert ended == [1]

    fsm.state = State.LISTENING
    fsm.on_wake()
    assert fsm.state == State.IDLE
    assert ended == [1, 1]

    fsm.state = State.ARMED
    fsm.on_wake()
    assert fsm.state == State.IDLE
    assert ended == [1, 1, 1]
    assert started == [1]  # no new session from cancel wakes
