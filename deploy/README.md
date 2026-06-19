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
