"""Rate limiter instance — isolated module to avoid circular imports.

Import this limiter in both back.main (to register it on app.state and add the
exception handler) and back.routes.auth (to apply the @limiter.limit decorator).
"""

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
