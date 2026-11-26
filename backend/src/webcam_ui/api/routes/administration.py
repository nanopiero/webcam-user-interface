"""Application administrator sessions and independent webcam blacklist writes."""

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field, SecretStr

from webcam_ui.security.admin import COOKIE_NAME

router = APIRouter(prefix="/api/admin", tags=["administration"])


class Login(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: SecretStr = Field(min_length=1, max_length=256)


class BlacklistEntry(BaseModel):
    reason: str = Field(default="", max_length=2000)


@router.post("/login")
def login(request: Request, body: Login, response: Response):
    security = request.app.state.security
    token, csrf = security.login(request, body.username, body.password.get_secret_value())
    response.set_cookie(COOKIE_NAME, token, max_age=security.settings.session_seconds,
                        secure=not security.settings.allow_development_credentials,
                        httponly=True, samesite="strict", path="/api/admin")
    response.headers["Cache-Control"] = "no-store"
    return {"username": security.settings.username, "csrf_token": csrf}


@router.get("/session")
def session(request: Request, response: Response):
    session = request.app.state.security.require(request)
    response.headers["Cache-Control"] = "no-store"
    return {"username": session["user"], "csrf_token": session["csrf"]}


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response):
    request.app.state.security.require(request, write=True)
    response.delete_cookie(COOKIE_NAME, path="/api/admin", secure=True,
                           httponly=True, samesite="strict")


@router.get("/blacklist")
def blacklist(request: Request):
    request.app.state.security.require(request)
    return {"items": request.app.state.queries.blacklist()}


@router.put("/blacklist/{processing_stream_id}")
def add(request: Request, processing_stream_id: str, body: BlacklistEntry):
    session = request.app.state.security.require(request, write=True)
    if not request.app.state.queries.set_blacklisted(processing_stream_id, body.reason, session["user"]):
        raise HTTPException(404, "webcam not found")
    return {"processing_stream_id": processing_stream_id, "blacklisted": True}


@router.delete("/blacklist/{processing_stream_id}", status_code=204)
def remove(request: Request, processing_stream_id: str):
    request.app.state.security.require(request, write=True)
    request.app.state.queries.unblacklist(processing_stream_id)
