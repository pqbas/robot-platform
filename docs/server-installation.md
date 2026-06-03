# Instalación del servidor (Windows / Docker Compose)

El servidor corre como un stack de Docker Compose: PostgreSQL, el backend FastAPI,
el frontend (build estático servido por nginx) y un contenedor de Tailscale que
expone la aplicación a internet vía Tailscale Funnel.

Esta guía cubre una máquina Windows que no tiene nada instalado.

## Índice

1. [Requisitos previos](#1-requisitos-previos)
2. [Clonar el repositorio](#2-clonar-el-repositorio)
3. [Crear el archivo `.env.server`](#3-crear-el-archivo-envserver)
4. [Levantar el servidor](#4-levantar-el-servidor)
5. [Acceso](#5-acceso)
6. [Post-instalación](#post-instalación)

## 1. Requisitos previos

Instala en este orden:

1. [Git for Windows](https://git-scm.com/download/win)
2. [Docker Desktop](https://www.docker.com/products/docker-desktop/), habilitando
   "Use WSL 2 backend" durante la instalación.

Docker Compose viene incluido en Docker Desktop, no hay nada extra que habilitar.
Verifica que ambos estén disponibles (Docker Desktop debe estar corriendo):

```powershell
git --version
docker compose version
```

## 2. Clonar el repositorio

```powershell
git clone <repo-url>
cd robot-platform
```

## 3. Crear el archivo `.env.server`

Crea un archivo llamado `.env.server` en la raíz del repo. Llénalo **antes** de
levantar el stack, porque el contenedor de Tailscale necesita `TS_AUTHKEY` al
arrancar y el backend lee estas variables al iniciar.

```env
ROBOT_MODE=server
PORT=9090
DATABASE_URL=postgresql+asyncpg://platform:CAMBIA_PASSWORD@postgres:5432/robot_platform
POSTGRES_PASSWORD=CAMBIA_PASSWORD
AUTH_SECRET_KEY=CAMBIA_SECRET
TS_AUTHKEY=tskey-auth-...
TS_HOSTNAME=robot-platform
COMPOSE_PROJECT_NAME=robot-platform
```

### Qué es cada variable y cómo obtenerla

| Variable | La consume | Para qué sirve | Cómo obtenerla |
|---|---|---|---|
| `ROBOT_MODE` | backend | Selecciona modo servidor | Valor fijo: `server` |
| `PORT` | backend | Puerto interno del backend | Valor fijo: `9090` |
| `DATABASE_URL` | backend | Conexión a PostgreSQL | Ver nota abajo |
| `POSTGRES_PASSWORD` | docker-compose | Contraseña de la base de datos | La inventas tú |
| `AUTH_SECRET_KEY` | backend | Firma y verifica los tokens JWT de sesión (seguridad de login) | La generas tú, cadena aleatoria larga |
| `TS_AUTHKEY` | docker-compose | Autentica el contenedor de Tailscale en tu red | Desde el panel de Tailscale |
| `TS_HOSTNAME` | docker-compose | Nombre de la máquina dentro de tu red Tailscale | Lo eliges tú |
| `COMPOSE_PROJECT_NAME` | Docker Compose | Prefijo de los contenedores/volúmenes | Opcional, lo eliges tú |

Notas importantes:

- `AUTH_SECRET_KEY` es la clave de seguridad real del proyecto. No existe ninguna
  variable `JWT_SECRET`: el código firma los JWT con `AUTH_SECRET_KEY`
  (ver `src/back/services/auth.py`). Si usas `JWT_SECRET` no tiene ningún efecto.
- En `DATABASE_URL` la contraseña debe ser **idéntica** a `POSTGRES_PASSWORD`.
  El host es `postgres` (el nombre del servicio en Compose), no `localhost`.
- Con `TS_HOSTNAME=robot-platform` la app queda accesible en
  `https://robot-platform.TU-TAILNET.ts.net`.

### Generar los secretos

`POSTGRES_PASSWORD` y `AUTH_SECRET_KEY` son valores que inventas tú. No hay un
sitio de donde descargarlos: generas una cadena aleatoria y la pegas en el
archivo. PowerShell trae un generador de identificadores únicos (GUID) que sirve.

1. Abre PowerShell.
2. Genera la contraseña de la base de datos. Copia la línea que imprime:

   ```powershell
   [guid]::NewGuid().ToString()
   ```

   Pega ese valor en **dos lugares** de `.env.server`: en `POSTGRES_PASSWORD` y
   dentro de `DATABASE_URL` (donde dice `CAMBIA_PASSWORD`). Deben ser idénticos.

3. Genera la clave de firma de tokens. Copia la línea que imprime:

   ```powershell
   "$([guid]::NewGuid())$([guid]::NewGuid())"
   ```

   Pega ese valor en `AUTH_SECRET_KEY`.

Ejemplo de cómo queda (con valores ya pegados):

```env
DATABASE_URL=postgresql+asyncpg://platform:a1b2c3d4-...@postgres:5432/robot_platform
POSTGRES_PASSWORD=a1b2c3d4-...
AUTH_SECRET_KEY=f9e8d7c6-...b5a4c3d2-...
```

### Obtener `TS_AUTHKEY`

1. Entra a [login.tailscale.com](https://login.tailscale.com).
2. Settings → Keys → Generate auth key.
3. Marca **Reusable** y **Ephemeral**.
4. Genera y copia el valor `tskey-auth-...` en `TS_AUTHKEY`.

## 4. Levantar el servidor

Con Docker Desktop corriendo, ejecuta estos cuatro comandos en orden. El último
es interactivo: te pedirá usuario y contraseña para el primer administrador.

```powershell
# 1. Construir las imágenes
docker compose --env-file .env.server -f docker-compose.server.yml build

# 2. Arrancar el stack (PostgreSQL, backend, frontend, Tailscale)
docker compose --env-file .env.server -f docker-compose.server.yml up -d

# 3. Crear las tablas en la base de datos
docker compose --env-file .env.server -f docker-compose.server.yml run --rm back uv run alembic -c src/back/alembic.ini upgrade head

# 4. Crear el usuario administrador (interactivo)
docker compose --env-file .env.server -f docker-compose.server.yml run --rm back uv run python -m src.back.scripts.create_admin
```

## 5. Acceso

- Local: `http://localhost`
- Internet (Tailscale Funnel): `https://TS_HOSTNAME.TU-TAILNET.ts.net`

## Post-instalación

Estos comandos no son parte de la instalación; sirven para operar el servidor
una vez que ya está corriendo.

```powershell
# Ver logs
docker compose --env-file .env.server -f docker-compose.server.yml logs -f

# Detener
docker compose --env-file .env.server -f docker-compose.server.yml down

# Reconstruir tras un git pull
docker compose --env-file .env.server -f docker-compose.server.yml build
docker compose --env-file .env.server -f docker-compose.server.yml up -d
```

En máquinas con `make` instalado (Linux/WSL) estos comandos tienen atajos:
`make compose-build`, `make compose-up`, `make compose-migrate`,
`make compose-create-admin`, `make compose-logs`, `make compose-down`.
