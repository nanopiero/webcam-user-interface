"""Application assembly and dependency lifetime. Route modules contain the HTTP contracts."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from psycopg import Error as PostgresError
from psycopg_pool import PoolTimeout

from webcam_ui.api.frontend import attach_frontend
from webcam_ui.providers.catalogue import SupplementaryCatalogue
from webcam_ui.providers.skaping import SkapingImages
from webcam_ui.providers.windy import WindyImages
from webcam_ui.security.admin import AdminSecurity
from webcam_ui.settings import BackendSettings
from webcam_ui.storage.database import Database
from webcam_ui.storage.queries import Queries

logger = logging.getLogger(__name__)


def create_app(settings: BackendSettings, *, database: Database | None = None,
               security: AdminSecurity | None = None,
               provider: WindyImages | None = None, skaping: SkapingImages | None = None) -> FastAPI:
    database = database or Database(settings.database)
    security = security or AdminSecurity(settings.auth)
    provider = provider or WindyImages(settings.providers)
    skaping = skaping or SkapingImages(settings.providers)

    @asynccontextmanager
    async def lifespan(app):
        database.open()
        try:
            database.migrate()
            yield
        finally:
            provider.close()
            skaping.close()
            database.close()

    app = FastAPI(title="Webcam observations API", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.database = database
    app.state.queries = Queries(database)
    app.state.security = security
    app.state.provider = provider
    app.state.skaping = skaping
    app.state.catalogue = SupplementaryCatalogue(settings.supplementary_webcams)

    @app.exception_handler(PostgresError)
    @app.exception_handler(PoolTimeout)
    async def unavailable(request: Request, error: Exception):
        logger.error("Database request failed (%s)", type(error).__name__)
        return JSONResponse(status_code=503, content={"detail": "observation database unavailable"})

    from webcam_ui.api.routes import administration, catalogue, health, webcams
    app.include_router(health.router)
    app.include_router(webcams.router)
    app.include_router(administration.router)
    app.include_router(catalogue.router)
    attach_frontend(app, settings.api)
    return app
