# Guía de despliegue

## Robot (Jetson)

```bash
./deploy/install.sh robot
```

Instala el backend con SQLite en puerto 8080, workers de inferencia, cámara, grabación y conversión.

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
...
```

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
