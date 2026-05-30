# Plan: LAN-first upload de grabaciones

## Group 1: Config

1. En `back/config.py`, agregar `lan_url` a `SyncConfig`:
   - `lan_url: str = os.getenv("SYNC_LAN_URL", "")` — justo debajo de `server_url`.

2. En `.env.robot` (archivo de ejemplo / documentación), agregar comentario:
   - `# SYNC_LAN_URL=http://192.168.1.x:9090  # URL LAN del servidor; si vacío, upload de videos deshabilitado`

---

## Group 2: Lógica de upload

3. En `back/services/sync_recordings_upload.py`, agregar función `_probe_lan`:
   ```python
   async def _probe_lan(http: aiohttp.ClientSession, lan_url: str) -> bool:
       try:
           async with http.get(f"{lan_url}/api/sync/health", timeout=aiohttp.ClientTimeout(total=2)) as resp:
               return resp.status == 200
       except Exception:
           return False
   ```

4. En `upload_pending_recordings`, al inicio del cuerpo (después del guard `if not config.sync.server_url`):
   - Agregar guard: `if not config.sync.lan_url: return`
   - Dentro del `async with aiohttp.ClientSession(...)`, antes del loop `for row in rows`:
     - Llamar `if not await _probe_lan(http, config.sync.lan_url): return`
   - En `_upload_one`, cambiar la URL base: recibir `base_url` como parámetro en lugar de usar `config.sync.server_url` directamente.
   - Pasar `config.sync.lan_url` como `base_url` desde `upload_pending_recordings`.

5. Actualizar firma de `_upload_one`:
   - De: `async def _upload_one(http, row)`
   - A: `async def _upload_one(http, row, base_url: str)`
   - Reemplazar `config.sync.server_url` por `base_url` en la construcción de `url`.
