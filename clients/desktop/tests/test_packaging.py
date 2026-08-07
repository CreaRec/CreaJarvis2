"""Guard against setuptools flat-layout discovery regressions (CI pip install -e)."""

from __future__ import annotations

import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_setuptools_finds_only_jarvis_client() -> None:
    with (ROOT / "pyproject.toml").open("rb") as f:
        data = tomllib.load(f)
    find = data["tool"]["setuptools"]["packages"]["find"]
    assert find["include"] == ["jarvis_client*"]
    # models/ is asset data, not a Python package — must not be auto-discovered.
    assert (ROOT / "models").is_dir()
    assert not (ROOT / "models" / "__init__.py").exists()
