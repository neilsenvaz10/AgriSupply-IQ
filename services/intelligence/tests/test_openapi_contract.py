"""The committed OpenAPI document must describe the code (see scripts/export_openapi.py)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

SERVICE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_DIR / "scripts"))

import export_openapi  # noqa: E402


def test_committed_openapi_document_matches_the_code() -> None:
    if not export_openapi.TARGET.parent.exists():
        pytest.skip("docs/api is not part of this checkout (container build context)")
    committed = json.loads(export_openapi.TARGET.read_text(encoding="utf-8"))

    assert committed == export_openapi.build_document(), (
        "docs/api/intelligence.openapi.json is stale: run "
        "`python scripts/export_openapi.py` in services/intelligence"
    )


def test_operational_endpoints_are_documented() -> None:
    paths = export_openapi.build_document()["paths"]

    assert set(paths) >= {"/health", "/ready"}  # type: ignore[arg-type]
