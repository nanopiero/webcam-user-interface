import pytest
from argon2 import PasswordHasher
from webcam_ui.security.admin import AdminSecurity
from webcam_ui.settings import AuthSettings


def test_default_development_password_is_refused_in_production(tmp_path):
    password = tmp_path / "hash"
    password.write_text(PasswordHasher().hash("1234"))
    secret = tmp_path / "secret"
    secret.write_text("example-session-secret-that-is-long-enough")
    settings = AuthSettings(password_hash_file=password, session_secret_file=secret)
    with pytest.raises(ValueError, match="development password"):
        AdminSecurity(settings)
    settings.allow_development_credentials = True
    assert AdminSecurity(settings)
