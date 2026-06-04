# Configurar un robot contra el server público

Guía operativa para conectar un robot físico (Jetson) al server público vía Tailscale Funnel y validar que la sincronización funciona end-to-end.

## Prerrequisitos

1. **Server público activo** en `https://<machine>.<tailnet>.ts.net` (ej. `https://omen.tailfe3013.ts.net`). Verificar:

   ```bash
   curl -I https://omen.tailfe3013.ts.net/                  # → 200
   curl https://omen.tailfe3013.ts.net/api/sync/health      # → 200
   curl https://omen.tailfe3013.ts.net/api/recordings/      # → 401 (auth coverage activa)
   ```

   Si alguna falla:
   - 503 en `/`: falta compilar el frontend (`make build-front` en el host del server).
   - Timeout / DNS: Tailscale Funnel no está arriba; en el host del server: `tailscale funnel status`, y si hace falta `sudo tailscale funnel 443 on`.

2. **Admin con login funcional** en el server. Login en `https://<host>/login` con usuario y password real (no `admin/admin`). Si solo existe el seed `admin/admin`, rotarlo antes de seguir (`make create-admin` en el host del server).

3. **Robot físico (Jetson) con red** que resuelva `*.ts.net`. No requiere Tailscale instalado en el robot — el Funnel expone HTTPS público.

---

## Paso A — Crear device en el server

1. En cualquier red, abrir `https://<host>/login` y autenticarse como admin.
2. Ir a `/admin/devices` → **Crear device**.
3. Etiqueta sugerida: `robot-jetson-01` (o el código de inventario del robot).
4. **El modal mostrará la API key UNA SOLA VEZ.** Copiarla a un gestor de contraseñas. No se puede recuperar después; si se pierde hay que regenerarla (lo cual invalida la anterior).

La API key tiene formato de string largo aleatorio. Tratar como secreto: no commitear, no enviar por chat sin cifrar.

---

## Paso B — Configurar el robot

En el Jetson:

1. Levantar backend y frontend del robot:

   ```bash
   make run-robot      # backend en :8080
   make run-front      # frontend en :5173
   ```

2. Abrir `http://<jetson-ip>:5173/setup` (o `localhost:5173/setup` si estás en el propio Jetson).

3. Ingresar:
   - **Server URL**: `https://omen.tailfe3013.ts.net` (sin trailing slash).
   - **API Key**: la copiada en el Paso A.

4. Submit. Sin errores 4xx/5xx el backend persiste los valores en `.env.robot` y reinicia el `sync_loop`.

5. Verificar en el Jetson:

   ```bash
   grep -E "SYNC_SERVER_URL|SYNC_API_KEY" .env.robot
   ```

   Ambos valores deben coincidir con lo ingresado.

---

## Paso C — Verificar sync end-to-end

1. En el frontend del robot (`localhost:5173`), generar datos:
   - Crear una `location` y un camellón si todavía no existen.
   - Iniciar una `session` de conteo, generar 2-3 counting events, finalizarla.
   - Iniciar una grabación corta (~10-15 segundos) y detenerla.

2. Esperar el siguiente ciclo de `sync_loop` (~30 s). Inspeccionar logs del backend del robot:

   ```bash
   make logs
   ```

   Debe verse:
   - POST a `/api/sync/sessions`, `/api/sync/events`, `/api/sync/locations`, `/api/sync/recordings/upload` con status **200/201**.
   - **No** debe haber 401 (API key mal copiada) ni 404 (URL mal escrita).

3. Desde otra red (ej. 4G del celular, laptop fuera del lab), abrir `https://<host>/login` y verificar:
   - `/dashboard` → stats reflejan los nuevos eventos.
   - `/sessions` → la session creada aparece con sus eventos.
   - `/recordings` → el recording aparece y se puede reproducir/descargar (puede tardar más por el upload del archivo).
   - `/locations` → la location creada aparece.

Si los datos llegan, el robot está conectado. Done.

---

## Paso D — (Opcional) Subida de video por LAN

> **Importante:** el archivo **MP4 de las grabaciones solo se sube por LAN**, no por
> internet/Tailscale. La metadata (sessions, events, fila del recording) sí viaja por
> el `Server URL` del Paso B, pero **el video se queda pendiente indefinidamente** hasta
> que el robot pueda alcanzar al server por la red local. Si el robot y el server están
> en la misma LAN, configura esto; si no, las grabaciones nunca pasarán de "pendiente"
> a "subido".

1. En el frontend del robot, ir a **Ajustes → Servidor → "URL LAN (video)"**.

2. Ingresar la dirección del **server en la red local**, apuntando al **puerto de nginx
   (80)**, no al uvicorn interno:

   ```
   http://<ip-lan-del-server>        # ej. http://192.168.50.67
   ```

   - Es la IP **del server**, no la del robot, y debe estar en la **misma LAN**.
   - **No uses el puerto `:9090`.** En el deploy del server, `9090` es el uvicorn
     interno (bind a `127.0.0.1` dentro de docker) y está cerrado desde la LAN. nginx
     expone la API en el **80**, así que `http://<ip>` (sin puerto) es lo correcto.
   - Dejar el campo **vacío** deshabilita la subida por LAN.
   - Toma efecto en el siguiente ciclo de sync, sin reiniciar.

3. Verificar la IP/puerto correctos **desde el robot** antes de guardar:

   ```bash
   ping -c2 <ip-lan-del-server>                              # host alcanzable
   curl -s -o /dev/null -w "%{http_code}\n" \
     http://<ip-lan-del-server>/api/sync/health              # → 200
   ```

   Si el `curl` da `200`, esa es la URL a poner. Si da `000`/timeout, prueba otra IP o
   puerto (el server podría servir en otro puerto).

4. Genera una grabación corta, detenla, y en el próximo ciclo (`make logs`) debe verse el
   POST a `/api/sync/recordings/<uuid>/upload` con **200**. El recording pasa a "subido"
   (`uploaded_at`) cuando: (a) la grabación terminó, (b) su metadata ya se pusheó, (c) la
   LAN es alcanzable, y (d) la subida del MP4 + detecciones tiene éxito.

---

## Troubleshooting

### `make logs` muestra 401 al pushear

La API key es incorrecta o fue revocada. Volver a `/admin/devices` en el server, regenerar la key, y reconfigurar el robot desde `/setup`.

### `make logs` muestra timeout / connection refused

El server público no es alcanzable. Verificar desde una red externa:

```bash
curl -I https://<host>/
```

Si falla, en el host del server:

```bash
tailscale funnel status        # esperar listing en :443
sudo tailscale funnel 443 on   # si está apagado
```

### Los datos no aparecen en el server aunque el robot loguea 200

- `sync_loop` puede no haber ciclado aún. Esperar 30-60 s.
- Confirmar que estás logueado en el server con un usuario que tiene visibilidad sobre los datos del device.
- Revisar logs del server (`make logs` en el host del server) por errores de inserción.

### `sync_loop` no arranca después de submit en `/setup`

Reiniciar manualmente:

```bash
make restart       # en el Jetson
```

Y volver a confirmar `.env.robot`.

### `make logs` muestra `LAN no alcanzable (...) — upload omitido`

La metadata sincroniza pero las grabaciones no pasan de "pendiente": el robot no
alcanza al server en la `URL LAN (video)` configurada. Casi siempre es el **puerto**:
está puesto `:9090` (uvicorn interno, cerrado desde la LAN) en vez del **80** de nginx.
Desde el robot:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://<ip-lan-del-server>/api/sync/health   # → 200
```

Si da `200`, corregir el campo a `http://<ip-lan-del-server>` (sin `:9090`). Ver Paso D.

### Cambiar la API key en caliente

Si el operador del server regenera la key, el robot empezará a recibir 401. Para restaurar:

1. Operador copia la nueva key (mostrada UNA sola vez tras regenerar).
2. En el robot, ir a `/setup`, ingresar la misma URL y la nueva key, submit.
3. `sync_loop` se reinicia y vuelve a 200.

---

## Notas

- El robot **no necesita estar en Tailscale**. Habla HTTPS público contra `*.ts.net` como cualquier cliente externo.
- `.env.robot` contiene secretos (API key). Nunca commitear; el `.gitignore` ya lo excluye.
- Si el robot pierde internet, `sync_loop` retiene los datos localmente y reanuda al volver la conexión. No se pierden eventos.
