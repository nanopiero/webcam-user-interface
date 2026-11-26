"""Argon2 passwords and short-lived, signed, HTTPS-only admin cookies with CSRF checks."""

import hashlib
import hmac
import secrets
import time
from collections import OrderedDict, deque
from threading import Lock

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import HTTPException, Request
from itsdangerous import BadSignature, URLSafeTimedSerializer

from webcam_ui.settings import AuthSettings, read_secret

COOKIE_NAME = "webcam_admin"


class AdminSecurity:
    def __init__(self, settings: AuthSettings):
        self.settings = settings
        self.hasher = PasswordHasher()
        self.password_hash = read_secret(settings.password_hash_file)
        self.secret = read_secret(settings.session_secret_file)
        if len(self.secret) < 32:
            raise ValueError("session_secret must contain at least 32 characters")
        if not settings.allow_development_credentials and self._password_matches("1234"):
            raise ValueError("the initial development password is forbidden in a public deployment")
        try:
            self.hasher.check_needs_rehash(self.password_hash)
        except InvalidHashError:
            raise ValueError("admin_password_hash is not a valid Argon2 hash") from None
        self.serializer = URLSafeTimedSerializer(self.secret, salt="webcam-ui-admin-v1")
        self.credential_version = hmac.new(self.secret.encode(), self.password_hash.encode(),
                                           hashlib.sha256).hexdigest()
        self.attempts: OrderedDict[str, deque] = OrderedDict()
        self.lock = Lock()

    def _password_matches(self, password: str) -> bool:
        try:
            return self.hasher.verify(self.password_hash, password)
        except (VerificationError, InvalidHashError):
            return False

    def origin(self, request: Request):
        origin = request.headers.get("origin")
        expected = str(request.base_url).rstrip("/")
        if origin and origin != expected:
            raise HTTPException(403, "cross-origin administration is forbidden")
        if request.url.scheme != "https" and not self.settings.allow_development_credentials:
            raise HTTPException(400, "administration requires HTTPS")

    def login(self, request: Request, username: str, password: str) -> tuple[str, str]:
        self.origin(request)
        address = request.client.host if request.client else "unknown"
        now = time.monotonic()
        with self.lock:
            if address not in self.attempts and len(self.attempts) >= 2048:
                self.attempts.popitem(last=False)
            attempts = self.attempts.setdefault(address, deque())
            self.attempts.move_to_end(address)
            while attempts and attempts[0] <= now - 60:
                attempts.popleft()
            if len(attempts) >= self.settings.login_attempts_per_minute:
                raise HTTPException(429, "too many login attempts", headers={"Retry-After": "60"})
            attempts.append(now)
        valid = self._password_matches(password)
        if not hmac.compare_digest(username.encode(), self.settings.username.encode()) or not valid:
            raise HTTPException(401, "invalid administrator credentials")
        csrf = secrets.token_urlsafe(32)
        return self.serializer.dumps({"user": username, "csrf": csrf,
                                      "credential_version": self.credential_version}), csrf

    def require(self, request: Request, *, write: bool = False) -> dict:
        try:
            session = self.serializer.loads(request.cookies.get(COOKIE_NAME, ""),
                                            max_age=self.settings.session_seconds)
            if session.get("user") != self.settings.username or not hmac.compare_digest(
                    session.get("credential_version", ""), self.credential_version):
                raise BadSignature("invalid session")
        except (BadSignature, TypeError, AttributeError):
            raise HTTPException(401, "administrator login required") from None
        if write:
            self.origin(request)
            if not hmac.compare_digest(request.headers.get("X-CSRF-Token", "").encode(), session.get("csrf", "").encode()):
                raise HTTPException(403, "invalid CSRF token")
        return session
