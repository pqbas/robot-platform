# Exposing the server via Tailscale Funnel

The backend in `server` mode runs on `127.0.0.1:9090` by default. Tailscale Funnel exposes it publicly without a domain or firewall changes.

## Prerequisites (once per machine)

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

The second command prints an authentication URL. Open it in a browser and authenticate with the lab account.

In the panel at https://login.tailscale.com/admin/dns, enable:

- **MagicDNS**
- **HTTPS Certificates**

Check the assigned hostname:

```bash
tailscale status --json | python3 -c "import json,sys; print(json.load(sys.stdin)['Self']['DNSName'])"
```

## Build the frontend

```bash
make build-front
```

Without this step the server starts but `https://<host>.ts.net/` returns 503 until `front/dist/` exists.

## Configure the public URL (CORS)

In `.env.server`:

```bash
SERVER_PUBLIC_URL=https://<host>.<tailnet>.ts.net
```

If this variable is not set, the server starts with open CORS (`*`) and logs a warning on startup.

## Enable public access

With the backend running (`make run-server` or `make deploy-server`):

```bash
sudo tailscale funnel --bg 9090
```

`tailscale funnel status` shows the public URL (`https://<host>.<tailnet>.ts.net`).

`make deploy-server` automates this step: it detects the hostname, renders nginx with Tailscale TLS certificates, and enables the funnel.

## Create the first admin

```bash
make create-admin
```

The script prompts for username and password on stdin (not persisted in `.env` or logs).

## Disable public access

```bash
sudo tailscale funnel --https=443 off
```

More details and troubleshooting in [`deploy/README.md`](../deploy/README.md).

## Troubleshooting: "el Funnel me rechaza / no me deja entrar" (DNS)

Síntoma: la URL pública `https://<host>.<tailnet>.ts.net` no carga desde
algunos dispositivos/redes, de forma **intermitente** ("a ratos funciona, a
ratos no"). El Funnel parece caído aunque `tailscale funnel status` diga `on`.

**Causa (30-jul-2026):** NO es el Funnel. Es el **resolver DNS del cliente**.
El nombre del Funnel vive en la zona firmada con DNSSEC `*.ts.net`, y **Google
Public DNS (8.8.8.8 / 8.8.4.4) devuelve `NXDOMAIN`** ("dominio inexistente")
para ese nombre de forma intermitente (negative cache), mientras que Cloudflare
(1.1.1.1) y Quad9 (9.9.9.9) lo resuelven bien. Si la PC/router está apuntando
solo a Google DNS, el navegador ni siquiera intenta conectar → parece que el
Funnel "rechaza". En este caso la red del laboratorio entregaba `8.8.8.8`.

### Diagnóstico (confirmar que es esto y no el Funnel)

```bash
# 1. El Funnel del lado servidor está OK (contenedor tailscale):
docker exec robot-platform-tailscale-1 tailscale funnel status
#   → "Funnel on: https://<host>.<tailnet>.ts.net" + proxy http://nginx:80

# 2. Probar la ruta pública SALTÁNDOSE el DNS (forzar la IP de ingress).
#    Si esto da 200, el Funnel/nginx/backend funcionan y el problema es DNS:
curl -sS -i --resolve <host>.<tailnet>.ts.net:443:<ingress-ip> https://<host>.<tailnet>.ts.net/

# 3. Comparar resolvers — el que falla es el culpable:
nslookup -type=A <host>.<tailnet>.ts.net 8.8.8.8   # → NXDOMAIN (Google, falla)
nslookup -type=A <host>.<tailnet>.ts.net 1.1.1.1   # → 209.177.x.x (Cloudflare, OK)
nslookup -type=A <host>.<tailnet>.ts.net 9.9.9.9   # → 209.177.x.x (Quad9, OK)
```

La `<ingress-ip>` se obtiene del paso 3 con Cloudflare/Quad9 (son IPs anycast de
Tailscale Funnel, p.ej. `209.177.145.97`).

### Solución

- **Permanente y para toda la LAN:** en el **router**, cambiar los DNS de
  `8.8.8.8` / `8.8.4.4` a `1.1.1.1` (primario) y `9.9.9.9` (secundario).
- **Por dispositivo (si no se puede tocar el router):** cambiar el DNS de ese
  equipo/celular a `1.1.1.1`. En Android sirve "DNS privado" → `one.one.one.one`.

No se cambia nada del servidor ni de Tailscale: el Funnel ya está bien; el
arreglo es solo *quién resuelve el nombre*.
