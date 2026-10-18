"""Request guard: correlation id, bounded request handling and one access-log line.

Implemented as a single ASGI-level HTTP middleware so every response (including errors
produced here) carries ``X-Request-Id``.

Limits (all configurable, see ``app.config``):
- Declared request bodies above ``max_body_bytes`` are rejected with 413 before routing.
  (Chunked uploads without a Content-Length are not inspected: the service accepts no
  request bodies yet. Revisit when the first body-accepting endpoint is added.)
- Handlers that do not finish within ``request_timeout_s`` are cancelled and answered 503.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
import uuid
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response

from app.config import Settings
from app.core.errors import error_response
from app.core.logging import request_id_var

logger = logging.getLogger("app.access")

_SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9._\-]{8,64}$")

CallNext = Callable[[Request], Awaitable[Response]]


def _incoming_request_id(request: Request) -> str:
    supplied = request.headers.get("x-request-id")
    if supplied is not None and _SAFE_REQUEST_ID.fullmatch(supplied):
        return supplied
    return str(uuid.uuid4())


def install_request_guard(app: FastAPI, settings: Settings) -> None:
    @app.middleware("http")
    async def request_guard(request: Request, call_next: CallNext) -> Response:
        request_id = _incoming_request_id(request)
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        response: Response

        try:
            declared = request.headers.get("content-length")
            if (
                declared is not None
                and declared.isdigit()
                and int(declared) > settings.max_body_bytes
            ):
                response = error_response(413, "PAYLOAD_TOO_LARGE")
            else:
                try:
                    response = await asyncio.wait_for(
                        call_next(request), timeout=settings.request_timeout_s
                    )
                except TimeoutError:
                    response = error_response(503, "REQUEST_TIMEOUT")
                except Exception as exc:
                    logger.error(
                        "unhandled error",
                        exc_info=(type(exc), exc, None),
                        extra={"method": request.method, "path": request.url.path},
                    )
                    response = error_response(500, "INTERNAL_ERROR")

            response.headers["X-Request-Id"] = request_id
            logger.info(
                "request",
                extra={
                    "method": request.method,
                    "path": request.url.path,  # query string deliberately omitted
                    "status": response.status_code,
                    "durationMs": round((time.perf_counter() - started) * 1000),
                },
            )
            return response
        finally:
            request_id_var.reset(token)
