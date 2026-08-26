# Guía de despliegue

## Robot (Jetson)

```bash
./deploy/install.sh robot
```

Instala el backend con SQLite en puerto 8080, workers de inferencia, cámara, grabación y conversión.

Para conectar el robot al server público (crear device, configurar `/setup`, verificar sync end-to-end), ver [ROBOT_SETUP.md](./ROBOT_SETUP.md).

## Despliegue containerizado (server)

### Requisitos

Solo Docker (y Docker Compose v2). No se requiere Python, Node, nginx ni Tailscale en el host.

### Pasos

1. Generar una `TS_AUTHKEY` reusable (no efímera) en:
   <https://login.tailscale.com/admin/settings/keys>

2. Copiar y completar el archivo de entorno:

   ```bash
   cp .env.example .env.server
   # Editar .env.server: TS_AUTHKEY, TS_HOSTNAME, DATABASE_URL, SECRET_KEY, etc.
   ```

3. Construir las imágenes:

   ```bash
   docker compose -f docker-compose.server.yml build
   ```

4. Levantar postgres y tailscale primero (tailscale necesita autenticarse antes de que nginx lo use como Funnel):

   ```bash
   docker compose -f docker-compose.server.yml up -d postgres tailscale
   ```

5. Correr las migraciones de Alembic:

   ```bash
   docker compose -f docker-compose.server.yml run --rm back uv run alembic -c back/alembic.ini upgrade head
   ```

6. Crear el primer usuario admin:

   ```bash
   docker compose -f docker-compose.server.yml run --rm back uv run python -m back.scripts.create_admin
   ```

7. Levantar el resto de los servicios:

   ```bash
   docker compose -f docker-compose.server.yml up -d
   ```

La aplicación queda disponible en:
- LAN HTTP: `http://<IP-del-host>`
- Internet HTTPS via Funnel: `https://<TS_HOSTNAME>.<tailnet>.ts.net`

### Actualizar (Windows / Docker)

Para subir una versión nueva ya mergeada a `master`. En Windows no hay `make` ni
systemd, así que se usa Docker Compose directo. Desde la carpeta del repo
(PowerShell o terminal):

```bash
# 1. Traer el código actualizado
git checkout master
git pull

# 2. Reconstruir las imágenes que cambiaron (back y/o front)
docker compose -f docker-compose.server.yml build back front

# 3. Aplicar migraciones nuevas de Alembic
docker compose -f docker-compose.server.yml run --rm back uv run alembic -c back/alembic.ini upgrade head

# 4. Recrear los contenedores con las imágenes nuevas
docker compose -f docker-compose.server.yml up -d
```

Notas de actualización:

- **Frontend servido desde volumen**: nginx sirve el bundle desde el volumen
  `front-dist`; el servicio `front` solo copia `dist/` ahí y termina
  (`restart: "no"`). El `up -d` lo vuelve a ejecutar y refresca el bundle. Si por
  caché se ve la UI vieja, forzar:
  ```bash
  docker compose -f docker-compose.server.yml up -d --force-recreate front nginx
  ```
- **No se tocan `postgres` ni `tailscale`**: sus volúmenes (`pgdata`, `ts-state`)
  persisten; no se reconstruyen al actualizar.
- **Migraciones**: el paso 3 es idempotente (si no hay migraciones pendientes, no
  hace nada). En producción, respaldar el volumen `pgdata` antes de migrar.

#### Errores comunes al actualizar

- **`port is already allocated` (bind for 0.0.0.0:80)**: quedó corriendo el `nginx`
  del arranque anterior y todavía tiene tomado el puerto 80. Bajar el stack y
  volver a subirlo (recrea los contenedores viejos y libera el puerto):
  ```bash
  docker compose -f docker-compose.server.yml down
  docker compose -f docker-compose.server.yml up -d
  ```
  ⚠️ **Nunca usar `down -v`**: `-v` borra los volúmenes (incluida la base `pgdata`).
  Sin `-v`, los datos se conservan. Para confirmar que todo quedó arriba:
  `docker compose -f docker-compose.server.yml ps` (el servicio `front` aparece
  como `Exited` y es normal — solo copia el bundle y termina).

- **`password authentication failed for user platform`**: la contraseña de la base
  no coincide. `DATABASE_URL` se deriva de `POSTGRES_PASSWORD` (única fuente de
  verdad en `.env.server`). Postgres fija la contraseña al **crear** el volumen
  `pgdata` y no la cambia después: una vez creada la base, `POSTGRES_PASSWORD` no
  se cambia más. Si nunca se definió, el volumen se creó con el default
  `dev-password` → poner `POSTGRES_PASSWORD=dev-password` en `.env.server` y
  `docker compose -f docker-compose.server.yml up -d --force-recreate back`.

- **`TS_AUTHKEY is not set` (o la contraseña cae al default)**: la interpolación
  `${TS_AUTHKEY}`, `${POSTGRES_PASSWORD}`, `${TS_HOSTNAME}` del compose **no** se
  lee de `.env.server` automáticamente — Compose solo lee el archivo `.env` (a
  secas) o el que se le pase con `--env-file`. El `env_file:` del servicio `back`
  solo inyecta variables **dentro** de ese contenedor, no sirve para la
  interpolación. Solución: pasar `--env-file .env.server` en **todos** los comandos
  de compose:
  ```bash
  docker compose --env-file .env.server -f docker-compose.server.yml up -d
  ```
  (El `Makefile` ya lo hace en `make compose-*`; los comandos manuales de esta guía
  asumen que se agrega `--env-file .env.server`.)

- **La base aparece vacía / no entra con las credenciales de siempre**: el `back`
  está conectado a un volumen `pgdata` distinto al que tiene los datos. Pasa cuando
  cambia el **nombre del proyecto** (p. ej. al renombrar/mover la carpeta del repo,
  o al fijar `name:` en el compose): los volúmenes se nombran `<proyecto>_pgdata`,
  así que un proyecto nuevo apunta a un `pgdata` nuevo y vacío. Los datos **no se
  pierden** — siguen en el volumen viejo. Para identificarlo y migrarlos:
  ```bash
  docker volume ls          # busca las dos líneas que terminan en _pgdata
  ```
  Una será `robot-platform_pgdata` (el actual, vacío) y la otra tendrá el prefijo
  viejo (con los datos). Copiar el viejo al actual:
  ```bash
  # 1. Apagar el stack
  docker compose --env-file .env.server -f docker-compose.server.yml down
  # 2. Recrear limpio el volumen actual
  docker volume rm robot-platform_pgdata
  docker volume create robot-platform_pgdata
  # 3. Copiar TODO del volumen viejo al actual (no borra el viejo: queda de respaldo)
  docker run --rm -v <VOLUMEN_VIEJO>:/from -v robot-platform_pgdata:/to \
    alpine sh -c "cp -a /from/. /to/"
  # 4. Levantar de nuevo
  docker compose --env-file .env.server -f docker-compose.server.yml up -d
  ```
  Fijar `name: robot-platform` en el compose evita que esto se repita: ancla el
  nombre del proyecto (y de los volúmenes) sin importar dónde esté la carpeta.

#### Problemas de conectividad y subida de archivos

Incidencias reales de operación (jul-2026) y su solución. Ninguna requiere
reconstruir imágenes ni re-desplegar: son config de nginx (recreando solo ese
contenedor), DNS del cliente, o reloj del robot.

- **Subir videos falla / `413 Request Entity Too Large`**: el robot sube el MP4
  por `POST /api/sync/recordings/{uuid}/upload`, que entra por nginx. La ruta
  `/api/` limita el tamaño del cuerpo con `client_max_body_size` en
  `deploy/nginx.compose.conf.template`. Un video más grande que ese tope lo
  rechaza nginx con 413 **antes** de llegar al backend (aplica igual por LAN o
  por Funnel: ambos pasan por el mismo nginx). Subir el valor (ej. `5G`, o `0`
  = sin límite) y recrear **solo** nginx:
  ```bash
  # editar la línea `client_max_body_size` en deploy/nginx.compose.conf.template
  docker compose --env-file .env.server -f docker-compose.server.yml up -d --force-recreate nginx
  # verificar que el template se re-renderizó con el nuevo valor:
  docker exec robot-platform-nginx-1 grep client_max_body_size /etc/nginx/conf.d/default.conf
  ```

- **El Funnel "rechaza" / la página no carga desde algunos equipos (DNS)**: la
  URL pública `https://<host>.<tailnet>.ts.net` no carga de forma
  **intermitente** aunque `tailscale funnel status` diga `on`. No es el Funnel:
  es el **resolver DNS del cliente**. Google Public DNS (`8.8.8.8`/`8.8.4.4`)
  devuelve `NXDOMAIN` para el nombre `*.ts.net` de forma intermitente (negative
  cache), mientras Cloudflare (`1.1.1.1`) y Quad9 (`9.9.9.9`) lo resuelven bien.
  Solución: apuntar el DNS del **router** (o del dispositivo) a `1.1.1.1` /
  `9.9.9.9`. Diagnóstico completo (curl `--resolve`, comparación de resolvers)
  en [`docs/tailscale.md`](../docs/tailscale.md) → "Troubleshooting … (DNS)".

- **El robot marca "server unreachable" / `certificate is not valid yet`**: el
  robot no sincroniza y su log muestra un error TLS
  `SSL: CERTIFICATE_VERIFY_FAILED … certificate is not valid yet`. Causa: el
  **reloj del robot está atrasado**, con una fecha anterior al `notBefore` del
  certificado del Funnel (Let's Encrypt, emitido vía Tailscale). El robot cree
  que el certificado "aún no es válido" y rechaza el handshake — el server
  parece inalcanzable aunque esté perfecto. Común en Jetson que pierde la hora
  al reiniciar (RTC sin batería / sin NTP). Solución **en el robot**:
  ```bash
  date                                   # ¿fecha anterior a la emisión del cert?
  sudo date -u -s "AAAA-MM-DD HH:MM:SS"  # poner la hora UTC actual
  sudo hwclock -w                        # persistir en el reloj de hardware
  sudo timedatectl set-ntp true          # sync automática (evita que recurra)
  ```
  Si se resetea en **cada** reinicio pese a NTP, es la batería del RTC de la
  placa. Ver las fechas de validez del cert del server para comparar:
  ```bash
  echo | openssl s_client -connect <host>.<tailnet>.ts.net:443 2>/dev/null \
    | openssl x509 -noout -dates
  ```

### Notas

- **Coexistencia con systemd**: si el servicio `robot-platform.service` ya está corriendo en el host, ambos no pueden usar el puerto 9090 al mismo tiempo. Detener el servicio systemd antes de levantar compose (`sudo systemctl stop robot-platform`).
- **Conflicto de hostname en Tailscale**: si el host ya tiene Tailscale instalado y autenticado con el mismo hostname, el sidecar usará un hostname diferente (sufijo numérico). Usar un `TS_HOSTNAME` distinto para el contenedor o desautenticar el host primero.
- **TLS**: el sidecar de Tailscale termina TLS en el Funnel y proxea en HTTP plano a nginx. No se configura certificado en nginx.

---

## Server (PC del laboratorio)

### Requisitos previos

1. **PostgreSQL** disponible via Docker Compose (ver `docker-compose.server.yml`).
2. **Tailscale** instalado y autenticado:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Verificar que el hostname asignado es estable:

```bash
tailscale status
```

El hostname tendrá la forma `<machine>.<tailnet>.ts.net` (por ejemplo `labserver.gnu-narwhal.ts.net`).

3. Archivo `.env.server` con credenciales de PostgreSQL ya creado:

```
ROBOT_MODE=server
PORT=9090
DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/robotdb
SECRET_KEY=<clave-aleatoria-larga>
SERVER_PUBLIC_URL=https://<host>.<tailnet>.ts.net
...
```

`SERVER_PUBLIC_URL` restringe CORS a ese origen. Si no está definida, el server arranca con CORS abierto (`*`) y lo indica en el log de arranque como advertencia.

### Compilar el frontend (desarrollo)

Si se usa `make run-server` en lugar del instalador, compilar el frontend antes:

```bash
make build-front
```

Sin este paso el server arranca pero `https://<host>.ts.net/` devuelve 503 hasta que `front/dist/` exista.

### Instalación

```bash
./deploy/install.sh server
```

El instalador:
- Instala dependencias Python y Node.
- Compila el frontend.
- Corre migraciones de Alembic.
- Crea el primer usuario admin de forma interactiva (si la tabla de usuarios está vacía).
- Configura nginx con TLS desde los certificados de Tailscale.
- Activa Tailscale Funnel en puerto 443.
- Instala y arranca el servicio systemd.

### Crear admin manualmente (si el instalador se corrió en modo no-interactivo)

```bash
make create-admin
```

### URL pública

Después de la instalación, el server queda accesible en:

```
https://<machine>.<tailnet>.ts.net
```

Verificar que el funnel está activo:

```bash
tailscale funnel status
```

### Sobrevivencia a reinicios

`tailscaled` es un servicio systemd que arranca automáticamente con el host. El funnel persiste entre reinicios una vez activado con `sudo tailscale funnel 443 on`.

### Desactivar acceso público (emergencia)

```bash
sudo tailscale funnel 443 off
```

### Logs

```bash
make logs               # Backend
sudo journalctl -u nginx -f
sudo journalctl -u tailscaled -f
```
