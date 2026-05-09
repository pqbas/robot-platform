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
async def test_spa_fallback_dashboard(client):
    resp = await client.get("/dashboard")
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    assert "text/html" in resp.headers.get("content-type", ""), (
        f"Expected text/html, got {resp.headers.get('content-type')}"
    )
    assert '<div id="root">' in resp.text, "SPA fallback debe devolver index.html"


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
