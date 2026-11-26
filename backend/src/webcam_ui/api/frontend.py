"""Serve the compiled UI alongside the API; unknown API/asset paths remain 404s."""

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from webcam_ui.settings import APISettings


class Assets(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


def attach_frontend(app: FastAPI, settings: APISettings) -> None:
    directory = settings.frontend_dist_directory
    if (directory / "assets").is_dir():
        app.mount("/assets", Assets(directory=directory / "assets"), name="frontend-assets")

    @app.get("/", include_in_schema=False)
    def index():
        if (directory / "index.html").is_file():
            return FileResponse(directory / "index.html", media_type="text/html",
                                headers={"Cache-Control": "no-cache"})
        return JSONResponse({"service": "webcam-user-interface", "stage": "backend",
                             "status_url": "/api/status", "api_documentation": "/docs"})
