"""Process entry point: ``python -m app``.

Uvicorn handles SIGINT/SIGTERM itself: it stops accepting connections, lets in-flight
requests finish (up to the grace period) and runs the application's shutdown hooks.
"""

from __future__ import annotations

import sys

import uvicorn

from app.config import ConfigurationError, load_settings
from app.main import create_app

GRACEFUL_SHUTDOWN_SECONDS = 10


def main() -> int:
    try:
        settings = load_settings()
    except ConfigurationError as error:
        # Names of invalid variables only; never their values.
        sys.stderr.write(f"{error}\n")
        return 1

    uvicorn.run(
        create_app(settings),
        host=settings.host,
        port=settings.port,
        log_config=None,  # logging is configured by the app (JSON lines)
        access_log=False,  # the request guard writes one access line per request
        server_header=False,
        timeout_keep_alive=5,
        timeout_graceful_shutdown=GRACEFUL_SHUTDOWN_SECONDS,
        limit_concurrency=100,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
