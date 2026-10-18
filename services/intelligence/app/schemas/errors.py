"""Error response contract.

Deliberately identical in shape to the Express API::

    {"error": {"code": "NOT_FOUND", "message": "...", "requestId": "..."}}
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ErrorCode = Literal[
    "BAD_REQUEST",
    "NOT_FOUND",
    "METHOD_NOT_ALLOWED",
    "PAYLOAD_TOO_LARGE",
    "VALIDATION_ERROR",
    "REQUEST_TIMEOUT",
    "INTERNAL_ERROR",
]


class FieldIssue(BaseModel):
    """One validation problem. Never echoes the submitted value."""

    field: str
    problem: str


class ErrorDetail(BaseModel):
    code: ErrorCode
    message: str
    request_id: str | None = Field(default=None, serialization_alias="requestId")
    details: list[FieldIssue] | None = None


class ErrorResponse(BaseModel):
    error: ErrorDetail
