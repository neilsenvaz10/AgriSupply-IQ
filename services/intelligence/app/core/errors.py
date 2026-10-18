"""Centralised error handling producing the standard error contract.

No handler ever returns a stack trace, an exception message from application code, a file
path or a submitted value. Details are logged server-side (with secrets redacted).
"""

from __future__ import annotations

import logging
from http import HTTPStatus

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import request_id_var
from app.schemas.errors import ErrorCode, ErrorDetail, ErrorResponse, FieldIssue

logger = logging.getLogger("app.errors")

_STATUS_TO_CODE: dict[int, ErrorCode] = {
    400: "BAD_REQUEST",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    413: "PAYLOAD_TOO_LARGE",
    422: "VALIDATION_ERROR",
    503: "REQUEST_TIMEOUT",
}

_MESSAGES: dict[ErrorCode, str] = {
    "BAD_REQUEST": "The request could not be processed.",
    "NOT_FOUND": "The requested resource was not found.",
    "METHOD_NOT_ALLOWED": "This method is not supported for this resource.",
    "PAYLOAD_TOO_LARGE": "The request body is too large.",
    "VALIDATION_ERROR": "The request is invalid.",
    "REQUEST_TIMEOUT": "The request took too long to process.",
    "INTERNAL_ERROR": "An unexpected error occurred.",
}


def error_response(
    status_code: int,
    code: ErrorCode,
    *,
    details: list[FieldIssue] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    """Build a response in the standard error format (with the current request id)."""
    body = ErrorResponse(
        error=ErrorDetail(
            code=code,
            message=_MESSAGES[code],
            request_id=request_id_var.get(),
            details=details,
        )
    )
    return JSONResponse(
        status_code=status_code,
        content=body.model_dump(by_alias=True, exclude_none=True),
        headers=headers,
    )


async def _http_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, StarletteHTTPException):  # registered for this type only
        return error_response(HTTPStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR")
    code = _STATUS_TO_CODE.get(exc.status_code)
    if code is None:
        code = "BAD_REQUEST" if exc.status_code < 500 else "INTERNAL_ERROR"
    # Keep framework-supplied headers such as `Allow` on 405.
    headers = dict(exc.headers) if exc.headers else None
    return error_response(exc.status_code, code, headers=headers)


async def _validation_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, RequestValidationError):  # registered for this type only
        return error_response(HTTPStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR")
    # Only the location and the rule that failed are returned; the submitted value
    # (`input`) and rule parameters (`ctx`) are deliberately dropped.
    issues = [
        FieldIssue(
            field=".".join(str(part) for part in error.get("loc", ()) if part != "body") or "body",
            problem=str(error.get("type", "invalid")),
        )
        for error in exc.errors()
    ]
    return error_response(422, "VALIDATION_ERROR", details=issues)


async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error(
        "unhandled error",
        exc_info=(type(exc), exc, None),
        extra={"method": request.method, "path": request.url.path},
    )
    return error_response(HTTPStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR")


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(StarletteHTTPException, _http_exception_handler)
    app.add_exception_handler(RequestValidationError, _validation_exception_handler)
    app.add_exception_handler(Exception, _unhandled_exception_handler)
