# Requirements: LAN-first upload de grabaciones

## Scope

El robot sube archivos MP4 al servidor solo cuando detecta que el servidor es alcanzable por red local (LAN). Si `SYNC_LAN_URL` no está configurado, o el probe a esa URL falla, el ciclo de upload se omite: no se sube por Tailscale/DERP. El upload de metadatos (sesiones, eventos, camellones) no se ve afectado.

## Inputs / Data

| Campo | Tipo | Requerido | Notas |
|-------|------|-----------|-------|
| `SYNC_LAN_URL` | string | No | URL base LAN del servidor, ej. `http://192.168.1.50:9090`. Si está vacío, upload deshabilitado. |

## Behavior

Antes de cada ciclo de `upload_pending_recordings`:

1. Si `SYNC_LAN_URL` está vacío, el ciclo termina sin subir nada.
2. Si está configurado, se hace un `GET {SYNC_LAN_URL}/api/sync/health` con timeout de 2s.
3. Si responde 200, se sube usando `SYNC_LAN_URL` como base (en lugar de `SYNC_SERVER_URL`).
4. Si no responde o responde con error, el ciclo termina sin subir nada.

El upload en sí reutiliza exactamente la lógica existente de `_upload_one`; solo cambia la URL base.

## Decisions

- **LAN-only, sin fallback a Tailscale** — Tailscale en modo userspace (Docker) usa DERP con ~2 Mbits/s de throughput; subir 100 MB tardaría ~6 min. Es preferible esperar a estar en LAN que degradar la experiencia.
- **Probe a `/api/sync/health`** — ya existe en `back/routes/sync.py`; no requiere nuevo endpoint. Timeout de 2s es suficiente para LAN y no bloquea el loop de sync.
- **`SYNC_LAN_URL` opcional** — robots que nunca estarán en LAN con el servidor simplemente no configuran el campo y el upload queda desactivado, sin romper nada.
- **Solo afecta uploads de archivos** — el sync de metadatos (`sync_push.py`, `sync_pull.py`) sigue usando `SYNC_SERVER_URL` por Tailscale sin cambios.

## Context

- Patrón existente: `back/services/sync_recordings_upload.py` — toda la lógica de upload a modificar.
- Config: `back/config.py` `SyncConfig` — agregar `lan_url` siguiendo el mismo patrón que `server_url`.
- Endpoint probe: `back/routes/sync.py` `GET /api/sync/health`.
