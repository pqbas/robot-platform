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
