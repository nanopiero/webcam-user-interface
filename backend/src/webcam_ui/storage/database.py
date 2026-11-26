"""A small synchronous connection pool shared by API threads or one listener process."""

import hashlib
from contextlib import contextmanager
from importlib.resources import files

from psycopg.conninfo import make_conninfo
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from webcam_ui.settings import DatabaseSettings, read_secret


class Database:
    def __init__(self, settings: DatabaseSettings | None = None, *, conninfo: str | None = None):
        if conninfo is None:
            if settings is None:
                raise ValueError("database settings are required")
            conninfo = make_conninfo(
                host=settings.host, port=settings.port, dbname=settings.name,
                user=settings.user, password=read_secret(settings.password_file),
                connect_timeout=settings.connect_timeout_seconds,
                options=f"-c statement_timeout={settings.statement_timeout_seconds * 1000} -c timezone=UTC",
            )
        self.pool = ConnectionPool(conninfo, min_size=1,
                                   max_size=settings.pool_size if settings else 5,
                                   timeout=10, open=False, kwargs={"row_factory": dict_row})

    def open(self):
        self.pool.open(wait=True, timeout=15)

    def close(self):
        self.pool.close()

    @contextmanager
    def connection(self):
        with self.pool.connection() as connection:
            yield connection

    def migrate(self):
        """Apply immutable numbered SQL migrations under a transaction-scoped advisory lock."""
        with self.connection() as connection:
            connection.execute("SELECT pg_advisory_xact_lock(879112340)")
            connection.execute("""
                CREATE TABLE IF NOT EXISTS schema_migration (
                    version integer PRIMARY KEY, checksum text NOT NULL,
                    applied_at timestamptz NOT NULL DEFAULT now()
                )
            """)
            existing = {row["version"]: row["checksum"] for row in
                        connection.execute("SELECT version, checksum FROM schema_migration")}
            migrations = sorted(files("webcam_ui.storage").joinpath("migrations").iterdir(),
                                key=lambda entry: entry.name)
            for entry in migrations:
                if not entry.name.endswith(".sql"):
                    continue
                version = int(entry.name.split("_", 1)[0])
                sql = entry.read_text(encoding="utf-8")
                checksum = hashlib.sha256(sql.encode()).hexdigest()
                if version in existing:
                    if existing[version] != checksum:
                        raise RuntimeError("an applied migration was modified; create a new migration")
                    continue
                connection.execute(sql, prepare=False)
                connection.execute("INSERT INTO schema_migration (version, checksum) VALUES (%s, %s)",
                                   (version, checksum))

    def ready(self) -> bool:
        with self.connection() as connection:
            return connection.execute("SELECT 1 AS ready").fetchone()["ready"] == 1
