"""Tests para el servido del frontend React en modo SERVER.

Cobertura requerida por validation.md:
- GET /           → 200, text/html, body contiene <div id="root">
- GET /dashboard  → 200, mismo HTML que GET / (SPA fallback)
- GET /api/sync/health → 200 con JSON (regresión)
- GET /assets/<no-existe>.js → 404
"""

import pytest


@pytest.mark.asyncio
async def test_root_returns_spa(client):
    resp = await client.get("/")
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    assert "text/html" in resp.headers.get("content-type", ""), (
        f"Expected text/html, got {resp.headers.get('content-type')}"
    )
    assert '<div id="root">' in resp.text, "index.html debe contener <div id=\"root\">"


@pytest.mark.asyncio
async def test_api_health_regression(client):
    resp = await client.get("/api/sync/health")
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    assert resp.headers.get("content-type", "").startswith("application/json"), (
        f"Expected JSON, got {resp.headers.get('content-type')}"
    )


@pytest.mark.asyncio
async def test_assets_nonexistent_returns_404(client):
    resp = await client.get("/assets/non-existent-chunk-abc123.js")
    assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"


@pytest.mark.parametrize(
    "path",
    [
        # Dotfiles / secrets típicos de scanners
        "/.env",
        "/.git/config",
        "/.git/HEAD",
        "/.aws/credentials",
        "/.DS_Store",
        "/.env.production",
        "/.env.bak",
        "/.envrc",
        "/.bash_history",
        "/.netrc",
        "/.svn/entries",
        # Paths con extensión que no son archivos reales
        "/config.env",
        "/wp-login.php",
        "/configuration.php.bak",
        "/serverless.yml",
        "/Dockerfile",
        "/Procfile",
        "/Jenkinsfile",
        "/main.py",
        "/wsgi.py",
        # FastAPI auto-docs deshabilitados en server mode
        "/docs",
        "/redoc",
        "/openapi.json",
        # Endpoints de otras stacks (Elasticsearch, haproxy, etc.)
        "/metrics",
        "/server/info",
        "/_cat/indices",
        "/v1/kv/",
        "/haproxy",
        "/aws/credentials",
        # Paths anidados que terminan en archivo
        "/backend/.env",
        "/build/.env",
        "/config/master.key",
        "/.github/workflows/ci.yml",
        # Random strings que no son SPA routes
        "/zz-nonexistent-test-8492.html",
        "/aa-also-nonexistent-7183.php",
    ],
)
@pytest.mark.asyncio
async def test_unknown_paths_return_404(client, path):
    """Los scanners no deben recibir 200 con index.html en paths sensibles."""
    resp = await client.get(path)
    assert resp.status_code == 404, (
        f"{path} devolvió {resp.status_code}; debe ser 404"
    )


@pytest.mark.parametrize(
    "path",
    [
        "/login",
        "/dashboard",
        "/vision",
        "/mapa",
        "/recordings",
        "/settings",
        "/setup",
        "/admin/users",
        "/admin/empresas",
        "/admin/fundos",
        "/admin/devices",
        "/admin/models",
    ],
)
@pytest.mark.asyncio
async def test_spa_routes_return_index_html(client, path):
    """Las rutas SPA del frontend deben devolver index.html (200)."""
    resp = await client.get(path)
    assert resp.status_code == 200, f"{path} debe devolver 200, no {resp.status_code}"
    assert '<div id="root">' in resp.text
