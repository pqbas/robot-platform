# Plan: Conectar robot al server público

## Group 1: Verificación pre-vuelo

1. Confirmar que el server público está vivo y la URL responde:
   - Desde laptop: `curl -I https://omen.tailfe3013.ts.net/` → 200.
   - `curl https://omen.tailfe3013.ts.net/api/sync/health` → 200 (whitelist).
   - `curl https://omen.tailfe3013.ts.net/api/recordings/` → 401 (Phase 22 activa).
   - Si Funnel está caído: `tailscale funnel --bg 9090` en el host del server.

2. Verificar que el server tiene un admin con login funcional:
   - Login en `https://omen.tailfe3013.ts.net/login` con credenciales reales (no admin/admin).
   - Si no hay admin con password fuerte → crearlo / rotarlo antes de continuar (queda fuera de scope formal pero es prerrequisito).

---

## Group 2: Crear device + API key en el server

3. Desde el frontend público autenticado: `/admin/devices` → crear device con label `robot-jetson-01` (o el que corresponda).

4. Capturar la API key que el modal muestra UNA sola vez. Guardarla temporalmente en un lugar seguro (gestor de contraseñas).
   - Si el modal NO muestra la key una sola vez (regresión / no implementado): commit puntual en `back/routes/devices.py` o `front/src/pages/admin/devices/...` para fixearlo. Documentar el fix en el commit.

---

## Group 3: Configurar robot

5. En el Jetson:
   - `make run-robot` levanta el backend.
   - `make run-front` levanta el frontend en `localhost:5173`.
   - Confirmar que `/setup` está accesible (modo robot, sin auth requerida en red local).

6. En `/setup` ingresar:
   - `Server URL`: `https://omen.tailfe3013.ts.net`
   - `Device ID`: el ID del device creado en step 3 (si el form lo pide; si solo pide URL+API key, omitir).
   - `API Key`: la capturada en step 4.
   - Submit.

7. Verificar que `.env.robot` se actualizó:
   - `grep SYNC_SERVER_URL .env.robot` → la URL pública.
   - `grep SYNC_API_KEY .env.robot` → la key (nunca commitear este archivo).

8. Verificar que `sync_loop` reinició:
   - Logs del backend robot: `make logs` → buscar mensaje de inicio del sync_loop con la nueva URL.

---

## Group 4: Validar sync end-to-end

9. Desde el frontend del robot (`localhost:5173`), generar datos:
   - Crear una `location` y un `camellón` si no existen.
   - Iniciar una `session` de conteo, generar 2-3 `counting events`, finalizarla.
   - Iniciar una grabación corta (10-15 seg) y detenerla.

10. Esperar el siguiente ciclo de `sync_loop` (típicamente 30s). Verificar logs:
    - `make logs` → debe mostrar requests POST exitosos a `/api/sync/sessions`, `/api/sync/events`, `/api/sync/locations`, etc.
    - NO debe haber 401 (mismatch de API key) ni 404 (URL mal).

11. Desde el frontend público (laptop, fuera del lab):
    - Login.
    - `/dashboard` → ver stats actualizadas (total sessions, total events).
    - `/sessions` → ver la session recién creada.
    - `/recordings` → ver el recording subido (puede tardar más por el upload del archivo).
    - `/locations` → ver la location creada.

---

## Group 5: Documentación

12. Crear `deploy/ROBOT_SETUP.md` con:
    - Prerrequisitos (server público activo, admin con login).
    - Paso A: crear device en `/admin/devices` (con screenshot/captura del modal de API key).
    - Paso B: configurar el robot desde `/setup` (URL + API key).
    - Paso C: verificar sync (qué buscar en `make logs`, qué buscar en el dashboard del server).
    - Troubleshooting: 401 (API key mal copiada), timeout (Funnel caído), datos no aparecen (sync_loop no arrancó).

13. Editar `deploy/README.md` para linkear `ROBOT_SETUP.md` desde la sección de operación.

14. Editar `CLAUDE.md` agregando una nota corta en sección "Modo" referenciando la nueva guía:
    - Solo si vale la pena; si la guía se descubre fácil desde `deploy/`, omitir.
