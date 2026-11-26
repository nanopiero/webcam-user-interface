"""Small operational commands: initialize, migrate, listen, serve, inspect, and Compose."""

import argparse
import getpass
import json
import logging
import os
import secrets
import shutil
import subprocess
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import uvicorn
from argon2 import PasswordHasher

from webcam_ui.settings import load_settings
from webcam_ui.storage.database import Database


def _write_secret(path: Path, value: str):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as stream:
        stream.write(value + "\n")
    path.chmod(0o600)


def initialize(root: Path, development: bool = False):
    """Do not overwrite existing settings or credentials on repeat runs."""
    directory = root / ".secrets"
    directory.mkdir(exist_ok=True, mode=0o700)
    directory.chmod(0o700)
    local = root / "config/backend.local.toml"
    if not local.exists():
        content = (root / "config/backend.example.toml").read_text()
        content = content.replace('client_id = "webcam-ui-observations"',
                                  f'client_id = "webcam-ui-{uuid.uuid4().hex[:16]}"')
        if development:
            content = content.replace("allow_development_credentials = false",
                                      "allow_development_credentials = true")
        local.write_text(content)
        local.chmod(0o600)
    frontend = root / "config/frontend.local.json"
    if not frontend.exists():
        shutil.copyfile(root / "config/frontend.example.json", frontend)
    for name in ("db_password", "session_secret"):
        if not (directory / name).exists():
            _write_secret(directory / name, secrets.token_urlsafe(48))
    if not (directory / "admin_password_hash").exists():
        password = "1234" if development else secrets.token_urlsafe(24)
        _write_secret(directory / "admin_password_hash", PasswordHasher().hash(password))
        _write_secret(directory / "admin_initial_password", password)
    if not (directory / "wind_api_key").exists():
        _write_secret(directory / "wind_api_key", "")
    for path in directory.iterdir():
        if path.is_file() and not path.is_symlink():
            path.chmod(0o600)
    print("Local configuration and credentials initialized; existing values preserved.")
    print("Application admin username: admin. Initial password: .secrets/admin_initial_password")
    print("Set MQTT host, port and topics in config/backend.local.toml before starting the listener.")


def compose(root: Path, config: Path, arguments: list[str]) -> int:
    settings = load_settings(config)
    password = root / ".secrets/db_password"
    if not password.is_file():
        raise ValueError("run webcam-ui init as the application user first")
    owner = password.stat()
    if owner.st_uid == 0:
        raise ValueError("initialize .secrets as the application user, not root")
    env = dict(os.environ)
    env.update(UI_DB_DATA_DIRECTORY=str(settings.database.host_data_directory),
               UI_BACKEND_CONFIG=str(config.resolve()), UI_RUN_UID=str(owner.st_uid),
               UI_RUN_GID=str(owner.st_gid), UI_DATABASE_NAME=settings.database.name,
               UI_DATABASE_USER=settings.database.user, UI_API_PORT=str(settings.api.port))
    settings.supplementary_webcams.host_directory.mkdir(parents=True, exist_ok=True)
    env["UI_CATALOGUE_DIRECTORY"] = str(settings.supplementary_webcams.host_directory)
    if arguments[:1] == ["--"]:
        arguments = arguments[1:]
    if not arguments:
        arguments = ["ps"]
    return subprocess.run(["docker", "compose", "--project-directory", str(root),
                           "-f", str(root / "compose.yaml"), *arguments], env=env).returncode


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path,
                        default=Path(os.environ.get("WEBCAM_BACKEND_CONFIG", "config/backend.local.toml")))
    commands = parser.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init", help="initialize ignored local settings and strong credentials")
    init.add_argument("--development", action="store_true", help="local-only initial admin/1234 credentials")
    commands.add_parser("set-admin-password", help="replace the application admin password; restart API afterwards")
    for name in ("migrate", "listen", "serve", "status", "health-listener", "health-api"):
        commands.add_parser(name)
    commands.add_parser("backfill-visibility-qualification", help="fill past visibility qualification with code 2 in batches")
    probe_parser = commands.add_parser("probe", help="verify live TLS MQTT observations without Docker or PostgreSQL")
    probe_parser.add_argument("--seconds", type=int, default=30)
    probe_parser.add_argument("--maximum-messages", type=int, default=100)
    probe_parser.add_argument("--credentials-file", type=Path)
    probe_parser.add_argument("--ca-file", type=Path)
    docker = commands.add_parser("compose", help="derive Compose environment from backend settings")
    docker.add_argument("arguments", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    try:
        if args.command == "init":
            initialize(Path.cwd(), args.development)
            return 0
        if args.command == "set-admin-password":
            password = getpass.getpass("New application admin password: ")
            if len(password) < 12 or password != getpass.getpass("Repeat password: "):
                raise ValueError("passwords must match and contain at least 12 characters")
            _write_secret(Path.cwd() / ".secrets/admin_password_hash", PasswordHasher().hash(password))
            print("Password hash updated. Restart the API to apply and invalidate existing sessions.")
            return 0
        if args.command == "compose":
            return compose(Path.cwd(), args.config, args.arguments)
        settings = load_settings(args.config)
        if args.command == "probe":
            from webcam_ui.ingestion.probe import probe
            if not 1 <= args.seconds <= 300 or not 1 <= args.maximum_messages <= 10000:
                raise ValueError("probe duration must be 1–300 seconds and message limit 1–10000")
            result = probe(settings.mqtt, settings.filters, seconds=args.seconds,
                           maximum_messages=args.maximum_messages,
                           credentials_file=args.credentials_file, ca_file=args.ca_file)
            print(json.dumps(result.as_dict(), indent=2))
            return 0 if result.counts["snow"] + result.counts["visibility"] else 1
        if args.command == "serve":
            from webcam_ui.api.app import create_app
            uvicorn.run(create_app(settings), host=settings.api.host, port=settings.api.port,
                        proxy_headers=True, forwarded_allow_ips="*")
            return 0
        if args.command == "health-api":
            import httpx
            response = httpx.get(f"http://127.0.0.1:{settings.api.port}/health/ready", timeout=5,
                                 trust_env=False)
            return 0 if response.status_code == 200 else 1
        database = Database(settings.database)
        database.open()
        try:
            if args.command == "migrate":
                database.migrate()
                print("Database migrations applied.")
            elif args.command == "backfill-visibility-qualification":
                from webcam_ui.storage.writer import ObservationWriter
                database.migrate()
                filled = ObservationWriter.backfill_visibility_qualification(database)
                print(f"Past visibility observations assigned qualification 2: {filled}")
            elif args.command == "listen":
                from webcam_ui.ingestion.mqtt import MQTTListener
                from webcam_ui.ingestion.service import IngestionService
                from webcam_ui.storage.writer import ObservationWriter
                database.migrate()
                service = IngestionService(ObservationWriter(database, settings.mqtt.client_id),
                                           settings.filters, settings.mqtt.maximum_payload_bytes)
                MQTTListener(settings.mqtt, service).run()
            elif args.command == "status":
                from webcam_ui.storage.queries import Queries
                print(json.dumps(Queries(database).statistics(), default=str, indent=2))
            elif args.command == "health-listener":
                with database.connection() as connection:
                    row = connection.execute("SELECT connected, heartbeat_at FROM listener_state WHERE client_id = %s",
                                             (settings.mqtt.client_id,)).fetchone()
                return 0 if row and row["connected"] and row["heartbeat_at"] > datetime.now(UTC) - timedelta(seconds=90) else 1
        finally:
            database.close()
        return 0
    except KeyboardInterrupt:
        return 130
    except Exception as error:
        # Third-party connection exceptions may contain infrastructure details.
        # Only known, local validation messages are printed; secret values never are.
        from pydantic import ValidationError
        if isinstance(error, ValidationError):
            print("Invalid backend configuration: " + ", ".join(".".join(map(str, e["loc"]))
                  for e in error.errors(include_input=False)), file=sys.stderr)
        elif isinstance(error, ValueError) and type(error).__module__ == "builtins":
            print(str(error), file=sys.stderr)
        else:
            print(f"{args.command} failed ({type(error).__name__}); check service readiness and local configuration.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
