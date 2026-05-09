# Auth Audit — Server Mode Routes

All routes mounted when `ROBOT_MODE=server`. Auth status checked against route handler signatures.

| Prefix | Method | Path | Auth status |
|--------|--------|------|-------------|
| `/api/auth` | POST | `/api/auth/login` | NONE (intentional — public) |
| `/api/auth` | POST | `/api/auth/logout` | JWT |
| `/api/sync` | GET | `/api/sync/health` | NONE (intentional — public) |
| `/api/sync` | POST | `/api/sync/pull` | API key (`_device_dep`) |
| `/api/sync` | POST | `/api/sync/push` | API key (`_device_dep`) |
| `/api/sync` | POST | `/api/sync/empresas` | API key (`_device_dep`) |
| `/api/sync` | POST | `/api/sync/fundos` | API key (`_device_dep`) |
| `/api/sync` | POST | `/api/sync/locations` | API key (`_device_dep`) |
| `/api/sync` | POST | `/api/sync/camellones` | API key (`_device_dep`) |
| `/api/sync` | POST | `/api/sync/sessions` | API key (`_device_dep`) |
| `/api/sync` | POST | `/api/sync/events` | API key (`_device_dep`) |
| `/api/sync` | POST | `/api/sync/recordings` | API key (`_device_dep`) |
| `/api/sync` | GET | `/api/sync/models` | API key (`_device_dep`) |
| `/api/sync` | GET | `/api/sync/device-context` | API key (`_device_dep`) |
| `/api/sync` | GET | `/api/sync/models/{uuid}` | API key (`_device_dep`) |
| `/api/sync` | POST | `/api/sync/recordings/{uuid}/upload` | API key (`_device_dep`) |
| `/api/locations` | GET | `/api/locations` | **NONE** |
| `/api/locations` | POST | `/api/locations` | **NONE** |
| `/api/locations` | PUT | `/api/locations/{id}/polygon` | **NONE** |
| `/api/locations` | DELETE | `/api/locations/{id}` | **NONE** |
| `/api/camellones` | GET | `/api/camellones` | **NONE** |
| `/api/camellones` | POST | `/api/camellones` | **NONE** |
| `/api/camellones` | PUT | `/api/camellones/{id}/location` | **NONE** |
| `/api/camellones` | GET | `/api/camellones/summary` | **NONE** |
| `/api/camellones` | GET | `/api/camellones/geo-summary` | **NONE** |
| `/api/recordings` | POST | `/api/recordings/start` | **NONE** |
| `/api/recordings` | POST | `/api/recordings/stop` | **NONE** |
| `/api/recordings` | GET | `/api/recordings/` | **NONE** |
| `/api/recordings` | GET | `/api/recordings/{uuid}/file` | **NONE** |
| `/api/recordings` | DELETE | `/api/recordings/{uuid}` | **NONE** |
| `/api/config` | GET | `/api/config/cameras` | **NONE** |
| `/api/config` | GET | `/api/config/camera` | **NONE** |
| `/api/config` | PUT | `/api/config/camera` | **NONE** |
| `/api/config` | GET | `/api/config/camera/resolution` | **NONE** |
| `/api/config` | PUT | `/api/config/camera/resolution` | **NONE** |
| `/api/config` | GET | `/api/config/counting` | **NONE** |
| `/api/config` | PUT | `/api/config/counting` | **NONE** |
| `/api/config` | GET | `/api/config/available-labels` | **NONE** |
| `/api/config` | POST | `/api/config/select-label` | **NONE** |
| `/api/config` | GET | `/api/config/setup-status` | **NONE** (setup.py mounts here) |
| `/api/dashboard` | GET | `/api/dashboard/stats` | JWT (`get_current_user`) |
| `/api/users` | GET | `/api/users/` | role admin |
| `/api/users` | POST | `/api/users/` | role admin |
| `/api/users` | PUT | `/api/users/{id}` | role admin |
| `/api/users` | DELETE | `/api/users/{id}` | role admin |
| `/api/empresas` | GET | `/api/empresas/` | role admin |
| `/api/empresas` | POST | `/api/empresas/` | role admin |
| `/api/empresas` | PUT | `/api/empresas/{uuid}` | role admin |
| `/api/empresas` | GET | `/api/empresas/{uuid}/fundos` | role admin |
| `/api/devices` | GET | `/api/devices/` | role admin |
| `/api/devices` | POST | `/api/devices/` | role admin |
| `/api/devices` | POST | `/api/devices/{id}/rotate-api-key` | role admin |
| `/api/devices` | GET | `/api/devices/{id}/models` | role admin |
| `/api/devices` | PUT | `/api/devices/{id}/models` | role admin |
| `/api/devices` | PUT | `/api/devices/{id}` | role admin |
| `/api/devices` | GET | `/api/devices/{id}/context` | role admin |

## Summary

Routes with **NONE** auth in server mode (gap to close with global guard):
- All of `/api/locations`, `/api/camellones`, `/api/recordings`, `/api/config/*`

Routes correctly protected before this phase:
- `/api/dashboard/stats` — JWT
- `/api/users/*`, `/api/empresas/*`, `/api/devices/*` — role admin (which wraps JWT)
- `/api/sync/*` (except `/health`) — device API key

Routes intentionally public (whitelist):
- `POST /api/auth/login`
- `GET /api/sync/health`
