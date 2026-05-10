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
    """
    authorization = request.headers.get("Authorization", "")
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = authorization.removeprefix("Bearer ").strip()
    # decode_access_token raises HTTPException(401) on bad/expired token
    decode_access_token(token)
