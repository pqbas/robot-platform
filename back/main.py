import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from back.database import close_db, init_db
from back.routes.camellones import router as camellones_router
from back.routes.counting import router as counting_router
from back.routes.stream import router as stream_router
from back.services.camera import close_all_connections

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield
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

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8080)
