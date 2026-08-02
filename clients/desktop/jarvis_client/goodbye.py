"""Detect explicit session-end phrases («Спасибо Джарвис», etc.)."""

from __future__ import annotations

import re
import unicodedata

# Whole-utterance patterns after normalization (lowercase, no punct).
_GOODBYE_EXACT = frozenset(
    {
        "спасибо джарвис",
        "спасибо джарвис спасибо",
        "благодарю джарвис",
        "пока джарвис",
        "до свидания джарвис",
        "всё джарвис",
        "все джарвис",
        "на этом всё джарвис",
        "на этом все джарвис",
        "thank you jarvis",
        "thanks jarvis",
        "bye jarvis",
        "goodbye jarvis",
    }
)

# Allow trailing fillers: «спасибо джарвис.» / «спасибо, джарвис!»
_GOODBYE_PREFIX = (
    "спасибо джарвис",
    "благодарю джарвис",
    "пока джарвис",
    "до свидания джарвис",
    "thank you jarvis",
    "thanks jarvis",
    "bye jarvis",
    "goodbye jarvis",
)


def normalize_utterance(text: str) -> str:
    text = unicodedata.normalize("NFKC", text or "")
    text = text.casefold().strip()
    text = text.replace("ё", "е")
    # Drop punctuation / extra spaces
    text = re.sub(r"[^\w\s]+", " ", text, flags=re.UNICODE)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def is_goodbye_utterance(text: str) -> bool:
    """True if the user turn is an explicit end (not a command that mentions thanks)."""
    norm = normalize_utterance(text)
    if not norm:
        return False
    if norm in _GOODBYE_EXACT:
        return True
    # Short utterances that start with goodbye and have little else
    for prefix in _GOODBYE_PREFIX:
        if norm == prefix:
            return True
        if norm.startswith(prefix + " "):
            rest = norm[len(prefix) :].strip()
            # allow only tiny fillers after the phrase
            if rest in {"", "пожалуйста", "все", "всё", "ладно", "ок", "окей"}:
                return True
            if len(rest.split()) <= 1 and len(rest) <= 12:
                return True
    # «джарвис спасибо» / «jarvis thanks»
    if norm in {"джарвис спасибо", "джарвис пока", "jarvis thanks", "jarvis bye"}:
        return True
    return False
