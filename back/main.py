import asyncio
import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from back.config import AppMode, config as app_config
from back.database import close_db, init_db
from back.routes.camellones import router as camellones_router
from back.routes.config_routes import router as config_router
from back.routes.counting import router as counting_router
from back.routes.dashboard import router as dashboard_router
from back.routes.locations import router as locations_router
from back.routes.stream import router as stream_router
from back.routes.auth import router as auth_router
from back.routes.sync import router as sync_router
from back.services.camera import close_all_connections
from back.services.nvenc_init import init_nvenc

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_nvenc()
    await init_db()

    # Start sync loop in robot mode (if server URL is configured)
    sync_task = None
    if app_config.mode == AppMode.ROBOT and app_config.sync.server_url:
        from back.services.sync_loop import start_sync_loop

        sync_task = asyncio.create_task(start_sync_loop())

    yield

    if sync_task:
        sync_task.cancel()
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
app.include_router(config_router)
app.include_router(dashboard_router)
app.include_router(sync_router)
app.include_router(auth_router)

# Admin CRUD routes — server mode only
if app_config.mode == AppMode.SERVER:
    from back.routes.admin_models import router as admin_models_router
    from back.routes.empresas import router as empresas_router
    from back.routes.fundos import router as fundos_router
    from back.routes.users import router as users_router

    app.include_router(users_router)
    app.include_router(empresas_router)
    app.include_router(fundos_router)
    app.include_router(admin_models_router)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=app_config.server.port)
