"""Security headers middleware.

Adds defensive HTTP response headers to every response.
HSTS is only added in SERVER mode (robots run over HTTP locally and HSTS
would break that flow).
"""

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from back.config import AppMode, config as app_config


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if app_config.mode == AppMode.SERVER:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response
