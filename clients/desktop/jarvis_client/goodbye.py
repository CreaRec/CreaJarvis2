"""Detect explicit session-end phrases («Спасибо Джарвис», etc.)."""

from __future__ import annotations

import re
import unicodedata

_FILLERS = frozenset({"", "пожалуйста", "все", "ладно", "ок", "окей"})

# Whole-utterance patterns after normalization (lowercase, no punct, ё→е).
_GOODBYE_EXACT = frozenset(
    {
        "пока",
        "все",
        "до свидания",
        "давай до свидания",
        "давай пока",
        "спасибо джарвис",
        "спасибо джарвис спасибо",
        "благодарю джарвис",
        "пока джарвис",
        "до свидания джарвис",
        "все джарвис",
        "на этом все джарвис",
        "джарвис спасибо",
        "джарвис пока",
        "джарвис все",
        "джарвис до свидания",
        "thank you jarvis",
        "thanks jarvis",
        "bye jarvis",
        "goodbye jarvis",
        "jarvis thanks",
        "jarvis bye",
    }
)

# Allow trailing fillers: «спасибо джарвис.» / «спасибо, джарвис!»
_GOODBYE_PREFIX = (
    "спасибо джарвис",
    "благодарю джарвис",
    "пока джарвис",
    "до свидания джарвис",
    "все джарвис",
    "на этом все джарвис",
    "давай до свидания",
    "до свидания",
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


def _short_name_plus_farewell(norm: str) -> bool:
    """«Джарвис пока» and STT mangling like «Старый пока» — one short token + farewell."""
    words = norm.split()
    if len(words) == 2 and words[1] == "пока" and 1 <= len(words[0]) <= 20:
        return True
    if (
        len(words) == 3
        and words[1] == "до"
        and words[2] == "свидания"
        and 1 <= len(words[0]) <= 12
    ):
        return True
    return False


def is_goodbye_utterance(text: str) -> bool:
    """True if the user turn is an explicit end (not a command that mentions thanks)."""
    norm = normalize_utterance(text)
    if not norm:
        return False
    if norm in _GOODBYE_EXACT:
        return True
    if _short_name_plus_farewell(norm):
        return True
    # Short utterances that start with goodbye and have little else
    for prefix in _GOODBYE_PREFIX:
        if norm == prefix:
            return True
        if norm.startswith(prefix + " "):
            rest = norm[len(prefix) :].strip()
            if rest in _FILLERS:
                return True
            if len(rest.split()) <= 1 and len(rest) <= 12:
                return True
    return False
