import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from back.config import AppMode, config as app_config
from back.database import close_db, init_db
from back.routes.camellones import router as camellones_router
from back.routes.config_routes import router as config_router
from back.routes.counting import router as counting_router
from back.routes.dashboard import router as dashboard_router
from back.routes.device_context import router as device_context_router
from back.routes.locations import router as locations_router
from back.routes.recordings import router as recordings_router
from back.routes.stream import router as stream_router
from back.routes.auth import router as auth_router
from back.routes.setup import router as setup_router
from back.routes.sync import router as sync_router
from back.services.camera import close_all_connections
from back.services.nvenc_init import init_nvenc

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_nvenc()
    await init_db()

    # Seed standard ultralytics models (server mode — source of truth)
    if app_config.mode == AppMode.SERVER:
        from back.services.seed_library_models import seed_library_models

        await seed_library_models()

    # Start sync loop in robot mode (if server URL is configured)
    sync_task = None
    if app_config.mode == AppMode.ROBOT and app_config.sync.server_url:
        from back.services.sync_loop import start_sync_loop

        sync_task = asyncio.create_task(start_sync_loop())

    # TensorRT conversion reconciler + poller (robot only)
    poller_task = None
    if app_config.mode == AppMode.ROBOT:
        from back.services.perception.conversion_poller import (
            reconcile_orphaned_conversions,
            run_poller,
        )

        await reconcile_orphaned_conversions()
        poller_task = asyncio.create_task(run_poller())

    yield

    if sync_task:
        sync_task.cancel()
    if poller_task:
        poller_task.cancel()
    await close_all_connections()
    await close_db()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(stream_router)
app.include_router(counting_router)
app.include_router(camellones_router)
app.include_router(locations_router)
app.include_router(recordings_router)
app.include_router(config_router)
app.include_router(dashboard_router)
app.include_router(sync_router)
app.include_router(setup_router)
app.include_router(auth_router)

# Robot-only routes
if app_config.mode == AppMode.ROBOT:
    from back.routes.models_local import router as models_local_router

    app.include_router(device_context_router)
    app.include_router(models_local_router)

# Admin CRUD routes — server mode only
if app_config.mode == AppMode.SERVER:
    from back.routes.admin_models import router as admin_models_router
    from back.routes.empresas import router as empresas_router
    from back.routes.fundos import router as fundos_router
    from back.routes.users import router as users_router

    from back.routes.devices import router as devices_router

    app.include_router(users_router)
    app.include_router(empresas_router)
    app.include_router(fundos_router)
    app.include_router(admin_models_router)
    app.include_router(devices_router)

# Serve React frontend in server mode
if app_config.mode == AppMode.SERVER:
    FRONT_DIST = Path(__file__).resolve().parent.parent / "front" / "dist"

    if not (FRONT_DIST / "index.html").exists():
        logging.warning(
            "front/dist no encontrado; correr 'make build-front'. "
            "La UI devolverá 503 hasta que exista."
        )
    else:
        app.mount(
            "/assets",
            StaticFiles(directory=FRONT_DIST / "assets"),
            name="assets",
        )

        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa_fallback(full_path: str):
            if full_path.startswith("api/"):
                raise HTTPException(status_code=404)
            candidate = FRONT_DIST / full_path
            if full_path and candidate.is_file():
                return FileResponse(candidate)
            # 404 para dotfiles/dotdirs (.env, .git/config, .aws/credentials)
            # y para cualquier path con extensión que no matchee archivo real
            # (.php, .bak, etc.). SPA routes son /login, /dashboard, /vision —
            # sin extensión y sin segmentos ocultos.
            segments = full_path.split("/")
            if any(s.startswith(".") for s in segments):
                raise HTTPException(status_code=404)
            if "." in segments[-1]:
                raise HTTPException(status_code=404)
            return FileResponse(FRONT_DIST / "index.html")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=app_config.server.port)
