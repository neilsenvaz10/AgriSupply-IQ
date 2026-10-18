"""Write the FastAPI OpenAPI document to ``docs/api/intelligence.openapi.json``.

    python scripts/export_openapi.py

``tests/test_openapi_contract.py`` fails when the committed file no longer matches the code.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings
from app.main import create_app

TARGET = Path(__file__).resolve().parents[3] / "docs" / "api" / "intelligence.openapi.json"


def build_document() -> dict[str, object]:
    return create_app(Settings()).openapi()


def render(document: dict[str, object]) -> str:
    return json.dumps(document, indent=2, sort_keys=True) + "\n"


if __name__ == "__main__":
    TARGET.write_text(render(build_document()), encoding="utf-8", newline="\n")
    print(f"wrote {TARGET}")
