"""Server-mode authentication middleware.

Enforces JWT authentication on all /api/* paths in server mode,
except those in the explicit whitelist managed by auth_guard.py.
Only mounted when ROBOT_MODE=server.
"""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from back.services.auth_guard import _is_whitelisted, validate_server_request


class ServerAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Only guard /api/* — static assets and SPA routes are already handled
        if path.startswith("/api/"):
            if not _is_whitelisted(path):
                try:
                    validate_server_request(request)
                except Exception as exc:
                    # FastAPI HTTPException carries status_code and detail
                    status_code = getattr(exc, "status_code", 401)
                    detail = getattr(exc, "detail", "Authentication required")
                    headers = getattr(exc, "headers", None) or {}
                    return JSONResponse(
                        status_code=status_code,
                        content={"detail": detail},
                        headers=headers,
                    )

        return await call_next(request)
