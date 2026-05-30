# Validation: LAN-first upload de grabaciones

La fase está lista para merge cuando todos los checks manuales pasan y el tipo no reporta errores.

## Automated Tests

- [ ] `uv run pyright back/` no reporta errores nuevos en `config.py` ni `sync_recordings_upload.py`

## Manual Checks

- [ ] `SYNC_LAN_URL` vacío en `.env.robot`: reiniciar el robot, grabar un video, verificar en logs que `upload_pending_recordings` no intenta subir nada (`grep "upload" logs` sin hits de intento).
- [ ] `SYNC_LAN_URL` configurado pero servidor apagado: probe falla en 2s, ciclo omitido, log muestra aviso de LAN no alcanzable.
- [ ] `SYNC_LAN_URL` configurado y servidor en LAN activo: video sube usando la URL LAN (verificar en log que la URL del POST contiene la IP LAN, no la URL Tailscale).
- [ ] `uploaded_at` se actualiza en DB tras upload exitoso por LAN.
- [ ] El sync de metadatos (sesiones, camellones) sigue usando `SYNC_SERVER_URL` sin cambios.

## Definition of Done

Todos los checks manuales verificados en robot físico con servidor en la misma LAN. No hay regresiones en el sync de metadatos.
