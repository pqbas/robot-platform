"""Server-mode auth guard — validation logic.

Called by ServerAuthMiddleware to enforce JWT on all /api/* paths
that are not in the whitelist.
"""

from fastapi import HTTPException, status
from starlette.requests import Request

from back.services.auth import decode_access_token

# Exact paths that are public (no auth required) in server mode
_PUBLIC_PATHS: frozenset[str] = frozenset(
    {
        "/api/auth/login",
        "/api/auth/logout",
        "/api/sync/health",
        "/api/config/setup-status",
    }
)

# Path prefixes whose auth is handled by their own dependency (_device_dep)
_DELEGATED_PREFIXES: tuple[str, ...] = ("/api/sync/",)


def _is_whitelisted(path: str) -> bool:
    """Return True if the request path should bypass the global auth guard."""
    if path in _PUBLIC_PATHS:
        return True
    for prefix in _DELEGATED_PREFIXES:
        if path.startswith(prefix):
            return True
    return False


def validate_server_request(request: Request) -> None:
    """Raise 401 if the request lacks a valid JWT.

    Only called for /api/* paths that are not whitelisted.
    Does NOT return the user — routes that need the user object still use
    Depends(get_current_user) individually.

    Token source, in order: the ``Authorization: Bearer`` header (used by the
    SPA's fetch calls), then the ``access_token`` cookie set at login. The cookie
    fallback exists because media elements (``<video>``/``<img>``) load their src
    via the browser and cannot attach an Authorization header — without it the
    recording playback endpoint would 401 for every authenticated user.
    """
    authorization = request.headers.get("Authorization", "")
    if authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
    else:
        token = request.cookies.get("access_token", "").strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    # decode_access_token raises HTTPException(401) on bad/expired token
    decode_access_token(token)
