"""Bounded PostgreSQL reads for maps, webcam popups, history, and ingestion monitoring."""

from datetime import datetime

from webcam_ui.storage.database import Database


class Queries:
    def __init__(self, database: Database):
        self.database = database

    def map_rows(self, parameter: str, at: datetime, limit: int,
                 bbox: tuple[float, float, float, float] | None = None,
                 altitude_band: str = "all", allowed_countries: list[str] | None = None,
                 include_unknown_country: bool = True, qualified_only: bool = False) -> list[dict]:
        coordinates = ""
        values = [qualified_only and parameter == "snow", parameter, at]
        if bbox:
            coordinates = """
                AND COALESCE(latest.longitude, p.longitude) BETWEEN %s AND %s
                AND COALESCE(latest.latitude, p.latitude) BETWEEN %s AND %s
            """
            values += [bbox[0], bbox[2], bbox[1], bbox[3]]
        country_filter = ""
        if allowed_countries is not None:
            country_filter = """
                AND ((%s AND COALESCE(latest.country, p.country) IS NULL)
                     OR COALESCE(latest.country, p.country) = ANY(%s))
            """
            values.extend([include_unknown_country, allowed_countries])
        values.append(limit + 1)
        altitude_filter = {
            "low": "AND COALESCE(latest.altitude, p.altitude) < 500",
            "middle": "AND COALESCE(latest.altitude, p.altitude) BETWEEN 500 AND 1000",
            "high": "AND COALESCE(latest.altitude, p.altitude) > 1000",
        }.get(altitude_band, "")
        with self.database.connection() as connection:
            return connection.execute(f"""
                SELECT p.processing_stream_id, p.name, p.provider_kind,
                       d.naming_authority, d.platform, d.platform_name, d.source_stream_id,
                       COALESCE(latest.latitude, p.latitude) AS latitude,
                       COALESCE(latest.longitude, p.longitude) AS longitude,
                       COALESCE(latest.altitude, p.altitude) AS altitude,
                       COALESCE(latest.country, p.country) AS country,
                       latest.download_timestamp, latest.snow_qualification, latest.visibility_qualification,
                       latest.snow_threshold_low, latest.snow_threshold_high,
                       CASE WHEN NOT %s OR latest.snow_qualification = 2
                            THEN latest.snow_class END AS snow_class,
                       latest.visibility_lower, latest.visibility_upper,
                       latest.visibility_center
                FROM processing_stream p
                JOIN derived_stream d USING (derived_stream_id)
                LEFT JOIN LATERAL (
                    -- Limit each indexed stream lookup before choosing across streams;
                    -- sorting a camera's complete history gets slower as output grows.
                    SELECT observation.* FROM (
                        SELECT s.observation_stream_id FROM observation_stream s
                        WHERE s.processing_stream_id = p.processing_stream_id AND s.parameter = %s
                    ) stream
                    CROSS JOIN LATERAL (
                        SELECT o.* FROM output o
                        WHERE o.observation_stream_id = stream.observation_stream_id
                          AND o.download_timestamp <= %s
                        ORDER BY o.download_timestamp DESC,
                                 o.processing_timestamp DESC NULLS LAST, o.output_id DESC LIMIT 1
                    ) observation
                    ORDER BY observation.download_timestamp DESC,
                             observation.processing_timestamp DESC NULLS LAST,
                             observation.output_id DESC LIMIT 1
                ) latest ON true
                WHERE NOT EXISTS (SELECT 1 FROM webcam_blacklist b
                                  WHERE b.processing_stream_id = p.processing_stream_id)
                {coordinates}
                {altitude_filter}
                {country_filter}
                ORDER BY p.processing_stream_id LIMIT %s
            """, values).fetchall()

    def webcam(self, processing_stream_id: str) -> dict | None:
        with self.database.connection() as connection:
            return connection.execute("""
                SELECT p.*, d.naming_authority, d.platform, d.platform_name,
                       d.source_stream_id, d.derived_suffix,
                       EXISTS (SELECT 1 FROM webcam_blacklist b
                               WHERE b.processing_stream_id = p.processing_stream_id) AS blacklisted
                FROM processing_stream p JOIN derived_stream d USING (derived_stream_id)
                WHERE p.processing_stream_id = %s
            """, (processing_stream_id,)).fetchone()

    def webcam_coordinates(self) -> list[tuple[float, float]]:
        """Include blacklisted webcams: hiding an existing camera must not add a near duplicate."""
        with self.database.connection() as connection:
            rows = connection.execute("SELECT DISTINCT latitude, longitude FROM processing_stream").fetchall()
        return [(row["latitude"], row["longitude"]) for row in rows]

    def latest(self, processing_stream_id: str) -> list[dict]:
        with self.database.connection() as connection:
            return connection.execute("""
                SELECT DISTINCT ON (s.parameter) s.parameter, s.standard_name, s.unit, o.*
                FROM output o JOIN observation_stream s USING (observation_stream_id)
                WHERE s.processing_stream_id = %s
                ORDER BY s.parameter, o.download_timestamp DESC,
                         o.processing_timestamp DESC NULLS LAST, o.output_id DESC
            """, (processing_stream_id,)).fetchall()

    def history(self, processing_stream_id: str, parameter: str, start: datetime,
                end: datetime, limit: int, cursor: tuple[datetime, int] | None = None) -> list[dict]:
        condition = "AND (o.download_timestamp, o.output_id) < (%s, %s)" if cursor else ""
        values = [processing_stream_id, parameter, start, end]
        if cursor:
            values.extend(cursor)
        values.append(limit + 1)
        with self.database.connection() as connection:
            return connection.execute(f"""
                SELECT s.parameter, s.unit, o.* FROM output o
                JOIN observation_stream s USING (observation_stream_id)
                WHERE s.processing_stream_id = %s AND s.parameter = %s
                  AND o.download_timestamp BETWEEN %s AND %s {condition}
                ORDER BY o.download_timestamp DESC, o.output_id DESC LIMIT %s
            """, values).fetchall()

    def statistics(self) -> dict:
        with self.database.connection() as connection:
            observations = connection.execute("""
                SELECT s.parameter, count(*) AS observations,
                       min(o.download_timestamp) AS oldest,
                       max(o.download_timestamp) AS newest,
                       count(*) FILTER (WHERE o.country IS NULL) AS without_country
                FROM output o JOIN observation_stream s USING (observation_stream_id)
                GROUP BY s.parameter ORDER BY s.parameter
            """).fetchall()
            counts = connection.execute("""
                SELECT (SELECT count(*) FROM processing_stream) AS webcams,
                       (SELECT count(*) FROM webcam_blacklist) AS blacklisted
            """).fetchone()
            listeners = connection.execute("""
                SELECT connected, heartbeat_at, last_message_at, last_persisted_at,
                       received_messages, accepted_observations, duplicate_observations,
                       filtered_observations, invalid_observations, qos0_messages, qos1_messages
                FROM listener_state ORDER BY client_id
            """).fetchall()
        return {**counts, "parameters": observations, "listeners": listeners}

    def blacklist(self) -> list[dict]:
        with self.database.connection() as connection:
            return connection.execute("""
                SELECT b.*, p.name FROM webcam_blacklist b
                JOIN processing_stream p USING (processing_stream_id)
                ORDER BY b.updated_at DESC, b.processing_stream_id
            """).fetchall()

    def set_blacklisted(self, processing_stream_id: str, reason: str, username: str) -> bool:
        with self.database.connection() as connection:
            result = connection.execute("""
                INSERT INTO webcam_blacklist (processing_stream_id, reason, updated_by)
                SELECT processing_stream_id, %s, %s FROM processing_stream
                WHERE processing_stream_id = %s
                ON CONFLICT (processing_stream_id) DO UPDATE SET
                    reason = EXCLUDED.reason, updated_by = EXCLUDED.updated_by, updated_at = now()
                RETURNING processing_stream_id
            """, (reason, username, processing_stream_id)).fetchone()
        return result is not None

    def unblacklist(self, processing_stream_id: str):
        with self.database.connection() as connection:
            connection.execute("DELETE FROM webcam_blacklist WHERE processing_stream_id = %s",
                               (processing_stream_id,))
