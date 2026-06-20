# Desplegar el server en esta PC (LABINM)

> Guía **específica de esta computadora** (`LABINMPC3`, Windows 11 + Docker Desktop).
> Es para seguir paso a paso al actualizar el server containerizado ya instalado.
> Para una instalación desde cero o en otra máquina, ver [`README.md`](./README.md).

## Datos fijos de esta máquina

| Cosa | Valor en esta PC |
|------|------------------|
| Carpeta del repo | `C:\Users\LABINMPC3\robot-platform` |
| Shell | PowerShell |
| Proyecto Compose | **`robot-platform`** (siempre pasar `-p robot-platform`) |
| Archivo de entorno | `.env.server` (siempre pasar `--env-file .env.server`) |
| Compose file | `docker-compose.server.yml` |
| Volumen de la DB **bueno** | `robot-platform_pgdata` |
| Stack | back + nginx + postgres + tailscale (front es one-shot) |
| Puerto LAN | `80` |
| URL pública (Funnel) | `https://labinm-robot-server.tailfe3013.ts.net` |
| Git push | credenciales locales en `.git/.git-credentials` (push directo, no toca el GitHub global de la PC) |

⚠️ **Existe un set de volúmenes huérfano** `robot-platform-containerize-server_*` (nombre viejo,
de antes de fijar `name:`). **No es el bueno y está vacío/desactualizado.** El bueno es el que
empieza con `robot-platform_` a secas. Nunca apuntar el stack a los `-containerize-server_*`.

⚠️ **Nunca** usar `down -v` ni `docker volume rm robot-platform_pgdata`: eso borra la base.

⚠️ **No** definir `COMPOSE_PROJECT_NAME` en `.env.server`: pisa el `name: robot-platform` del
compose y vuelve a crear stacks/volúmenes duplicados. Dejarlo comentado/ausente.

---

## Receta de actualización (lo normal)

Sirve cuando ya hay cambios mergeados a `master`. Casi siempre solo cambia el **backend**
(código Python horneado en la imagen), entonces basta reconstruir y recrear `back`.

Todos los comandos se corren desde `C:\Users\LABINMPC3\robot-platform` en PowerShell.

### 1. Capturar el estado de la DB (para verificar después que no cambió)

```powershell
docker volume inspect robot-platform_pgdata --format "Created={{.CreatedAt}} Mount={{.Mountpoint}}"
docker exec robot-platform-postgres-1 psql -U platform -d robot_platform -t -c "SELECT 'recordings='||count(*) FROM recordings UNION ALL SELECT 'sessions='||count(*) FROM sessions UNION ALL SELECT 'users='||count(*) FROM users;"
docker exec robot-platform-postgres-1 psql -U platform -d robot_platform -t -c "SELECT version_num FROM alembic_version;"
```

Anotar el `Created` del volumen, los conteos y el `version_num` de alembic.

### 2. Bajar el código nuevo

```powershell
git fetch origin
git merge --ff-only origin/master
git log --oneline -1 HEAD
```

### 3. Ver qué cambió (decide qué reconstruir)

```powershell
git show --stat --oneline HEAD
```

- Cambió algo en `src/back/**` → reconstruir y recrear **back** (caso normal).
- Cambió algo en `src/front/**` → además reconstruir y recrear **front** + **nginx**.
- Hay archivos nuevos en `src/back/alembic/versions/**` → **hay migración** (paso 5).

### 4. Reconstruir la imagen del back

```powershell
docker compose -p robot-platform --env-file .env.server -f docker-compose.server.yml build back
```

(Si también cambió el front: `... build back front`.)

### 5. Aplicar migraciones — SOLO si hay revisiones nuevas

Si el paso 3 no mostró archivos nuevos en `alembic/versions/`, **saltar este paso**.

> ⚠️ **No usar `docker compose run --rm back ...` para migrar en esta PC.** Aunque funciona,
> Compose trae `postgres` como dependencia (`depends_on`) y **lo recrea/reinicia** — un reinicio
> innecesario de la base (los datos no se pierden, pero corta conexiones y resetea su uptime).

**Método recomendado: `docker exec` sobre el `back-1` que ya está corriendo.** No toca postgres.
Como el código está horneado en la imagen, el `back-1` viejo todavía **no** tiene la revisión
nueva en disco; hay que copiársela primero (o recrear el back antes de migrar). Lo más simple es
copiar la(s) revisión(es) nueva(s) al contenedor vivo y correr alembic ahí:

```powershell
# Copiar la(s) revisión(es) nueva(s) del paso 3 al contenedor vivo
docker cp src/back/alembic/versions/<NUEVA>.py robot-platform-back-1:/app/back/alembic/versions/
# Aplicar
docker exec robot-platform-back-1 uv run alembic -c back/alembic.ini upgrade head
# Confirmar
docker exec robot-platform-back-1 uv run alembic -c back/alembic.ini current   # debe imprimir "<rev> (head)"
```

El `back-1` vivo siempre tiene credenciales buenas (arrancó con la password correcta), así que
este método nunca choca con un eventual desalineo de `POSTGRES_PASSWORD` en `.env.server`.

> **Alternativa (si el back-1 no estuviera corriendo)**: `docker compose run --rm back ... upgrade head`.
> Acepta que reinicia postgres. Si falla con `InvalidPasswordError` / `password authentication failed`,
> la `POSTGRES_PASSWORD` de `.env.server` se desalineó del rol real → realinear primero
> (ver `memory/postgres-volume-restore-password.md`).

Verificar que los datos siguen intactos tras migrar (mismas filas que el paso 1):

```powershell
docker exec robot-platform-postgres-1 psql -U platform -d robot_platform -t -c "SELECT 'recordings='||count(*) FROM recordings UNION ALL SELECT 'sessions='||count(*) FROM sessions UNION ALL SELECT 'users='||count(*) FROM users;"
```

### 6. Recrear los contenedores con el código nuevo

Caso normal (solo back) — **`--no-deps` para NO tocar postgres ni tailscale**:

```powershell
docker compose -p robot-platform --env-file .env.server -f docker-compose.server.yml up -d --no-deps --force-recreate back
```

Si también cambió el front (refresca el bundle servido por nginx):

```powershell
docker compose -p robot-platform --env-file .env.server -f docker-compose.server.yml up -d --no-deps --force-recreate front nginx
```

### 7. Verificar

```powershell
# Contenedores: postgres/tailscale/nginx deben conservar su uptime (no reiniciados)
docker compose -p robot-platform ps

# El back arrancó limpio
docker logs robot-platform-back-1 --tail 30

# El volumen de la DB es EL MISMO (mismo Created que en el paso 1) y mismas filas
docker volume inspect robot-platform_pgdata --format "Created={{.CreatedAt}} Mount={{.Mountpoint}}"
docker exec robot-platform-postgres-1 psql -U platform -d robot_platform -t -c "SELECT 'recordings='||count(*) FROM recordings UNION ALL SELECT 'sessions='||count(*) FROM sessions UNION ALL SELECT 'users='||count(*) FROM users;"
```

Señales de OK en los logs del back:
- `Application startup complete.` y `Uvicorn running on http://0.0.0.0:9090`
- El robot sincronizando: `GET /api/sync/health ... 200 OK`
- **Sin** `InvalidPasswordError` / `password authentication failed`.

> `GET /api/health` devuelve **401** y es normal (requiere auth). Que responda 401 (y no 502)
> ya confirma que nginx → back funciona.

---

## Trampas conocidas en esta PC

- **`front` aparece como `Exited`**: normal. Solo copia el bundle al volumen `front-dist` y termina (`restart: "no"`).
- **`port is already allocated` (0.0.0.0:80)**: quedó un `nginx` viejo tomando el puerto. `docker compose -p robot-platform -f docker-compose.server.yml down` (¡**sin** `-v`!) y volver a `up -d`.
- **La base aparece vacía / no entran las credenciales de siempre**: el stack quedó apuntando al volumen huérfano `robot-platform-containerize-server_pgdata`. Asegurarse de pasar SIEMPRE `-p robot-platform` y que `COMPOSE_PROJECT_NAME` no esté en `.env.server`.
- **`TS_AUTHKEY is not set` / la password cae al default**: faltó `--env-file .env.server` en el comando de compose. La interpolación `${...}` del compose solo lee el archivo pasado con `--env-file` (no el `env_file:` del servicio). Agregarlo a todos los comandos.

---

## Subir cambios a GitHub desde esta PC

Las credenciales están guardadas localmente (`.git/.git-credentials`, dentro de `.git/`, no se
commitea) y el repo está configurado para ignorar el Credential Manager global. El push sale
directo sin registrar nada en el GitHub global de la máquina:

```powershell
git push origin master
```

Si el token caduca o se rota, regenerarlo en GitHub (fine-grained, con **Contents: Read and
write**) y actualizar `https://pqbas:<TOKEN>@github.com` en `.git/.git-credentials`.
