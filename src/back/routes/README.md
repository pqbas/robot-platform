# back/routes — Auth contract

## Server mode: global auth guard

In server mode (`ROBOT_MODE=server`) every request to any `/api/*` path requires
a valid JWT, **except** the paths listed in the whitelist below.

The guard is implemented as `ServerAuthMiddleware` in
`back/middleware/server_auth.py`, which delegates validation to
`back/services/auth_guard.py`. It is mounted conditionally in `back/main.py`
only when `app_config.mode == AppMode.SERVER`.

### Whitelist (public paths — no auth required)

| Path | Reason |
|------|--------|
| `POST /api/auth/login` | Login flow — must be reachable before a token exists |
| `GET /api/sync/health` | Heartbeat used by monitoring infrastructure |
| `GET /api/config/setup-status` | Frontend reads this pre-login to decide between login screen vs setup screen; only returns `{configured, mode}` |
| `/api/sync/*` (prefix) | Sync routes carry their own device API key dependency (`_device_dep`); the guard delegates to that mechanism |

### How to add a new public path

1. Edit `back/services/auth_guard.py`.
2. Add the exact path to `_PUBLIC_PATHS` (for single endpoints) or a prefix to
   `_DELEGATED_PREFIXES` (for route families with their own auth).
3. Justify the addition in the commit message.

### Robot mode

The guard is not mounted in robot mode. The robot runs on a local network and
its routes remain accessible without authentication, as they were before this
phase.

## Per-route auth patterns

Routes that need the user object (e.g. to check `user.role`) still use
`Depends(get_current_user)` or `Depends(require_role(...))` individually.
The global guard only blocks unauthenticated requests early — it does not
replace route-level dependencies.

| Pattern | Example | Where defined |
|---------|---------|---------------|
| Global guard (server mode) | all `/api/*` not whitelisted | `back/middleware/server_auth.py` |
| JWT + user object | `dashboard.py` | `Depends(get_current_user)` in `back/services/auth.py` |
| Role check | `users.py`, `empresas.py`, `devices.py` | `Depends(require_role("admin"))` |
| Device API key | `sync.py` (`_device_dep`) | `Depends(verify_device_key)` in `back/services/auth.py` |
