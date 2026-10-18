"""Structured (JSON-lines) logging with secret redaction and request correlation."""

from __future__ import annotations

import contextvars
import json
import logging
import re
import sys
from datetime import UTC, datetime
from typing import Any

# Correlation id of the request currently being handled (None outside a request).
request_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "request_id", default=None
)

# Matches `scheme://user:password@` so credentials never reach the logs.
_URL_CREDENTIALS = re.compile(r"(\b[a-z][a-z0-9+.\-]*://)[^/\s:@]+(?::[^/\s@]*)?@", re.IGNORECASE)

_LEVELS: dict[str, int] = {
    "silent": logging.CRITICAL + 10,
    "critical": logging.CRITICAL,
    "error": logging.ERROR,
    "warning": logging.WARNING,
    "info": logging.INFO,
    "debug": logging.DEBUG,
}

# Attributes present on every LogRecord; anything else was supplied via `extra=`.
_RESERVED = set(logging.LogRecord("", 0, "", 0, "", (), None).__dict__) | {"message", "asctime"}


def redact_secrets(text: str) -> str:
    """Remove ``user:password@`` from URL-like text."""
    return _URL_CREDENTIALS.sub(r"\1[redacted]@", text)


class JsonFormatter(logging.Formatter):
    """One JSON object per line. Exception *types* are logged; tracebacks only below INFO."""

    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "time": datetime.fromtimestamp(record.created, tz=UTC).isoformat(
                timespec="milliseconds"
            ),
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": redact_secrets(record.getMessage()),
        }
        request_id = request_id_var.get()
        if request_id is not None:
            entry["requestId"] = request_id
        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                entry[key] = redact_secrets(value) if isinstance(value, str) else value
        if record.exc_info and record.exc_info[0] is not None:
            entry["error_type"] = record.exc_info[0].__name__
            if record.exc_info[1] is not None:
                entry["error"] = redact_secrets(str(record.exc_info[1]))
        return json.dumps(entry, default=str)


def configure_logging(level: str) -> None:
    """Install a single JSON handler on the root logger and route uvicorn through it."""
    numeric = _LEVELS.get(level, logging.INFO)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())

    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(numeric)

    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.handlers[:] = []
        lg.propagate = True
        lg.setLevel(numeric)
