"""Keeps the container's runtime requirements in step with pyproject.toml and the lock file."""

from __future__ import annotations

import tomllib
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parents[1]


def _pins(lines: list[str]) -> dict[str, str]:
    pins: dict[str, str] = {}
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        name, _, version = line.partition("==")
        pins[name.strip().lower()] = version.strip()
    return pins


def test_runtime_requirements_match_pyproject() -> None:
    pyproject = tomllib.loads((SERVICE_DIR / "pyproject.toml").read_text(encoding="utf-8"))
    declared = _pins(pyproject["project"]["dependencies"])
    runtime = _pins((SERVICE_DIR / "requirements.txt").read_text(encoding="utf-8").splitlines())

    assert runtime == declared


def test_every_runtime_requirement_is_pinned_identically_in_the_lock_file() -> None:
    runtime = _pins((SERVICE_DIR / "requirements.txt").read_text(encoding="utf-8").splitlines())
    locked = _pins((SERVICE_DIR / "requirements.lock").read_text(encoding="utf-8").splitlines())

    for name, version in runtime.items():
        assert locked.get(name) == version, f"{name} differs between requirements.txt and the lock"


def test_runtime_requirements_exclude_development_tools() -> None:
    runtime = _pins((SERVICE_DIR / "requirements.txt").read_text(encoding="utf-8").splitlines())

    for dev_tool in ("pytest", "ruff", "httpx2"):
        assert dev_tool not in runtime
