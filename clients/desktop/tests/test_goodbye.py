from __future__ import annotations

from jarvis_client.goodbye import is_goodbye_utterance, normalize_utterance


def test_normalize_strips_punct() -> None:
    assert normalize_utterance("Спасибо, Джарвис!") == "спасибо джарвис"


def test_goodbye_phrases() -> None:
    assert is_goodbye_utterance("Спасибо Джарвис")
    assert is_goodbye_utterance("спасибо, джарвис!")
    assert is_goodbye_utterance("Пока Джарвис")
    assert is_goodbye_utterance("thank you jarvis")
    assert is_goodbye_utterance("Джарвис, спасибо")


def test_not_goodbye_commands() -> None:
    assert not is_goodbye_utterance("спасибо джарвис поставь таймер на 5 минут")
    assert not is_goodbye_utterance("который час")
    assert not is_goodbye_utterance("")
