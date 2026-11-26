"""Atomic, idempotent observation writes. A successful return means the transaction committed."""

from collections.abc import Iterable

from webcam_ui.domain.observations import Observation
from webcam_ui.storage.database import Database


class ObservationWriter:
    def __init__(self, database: Database, client_id: str):
        self.database = database
        self.client_id = client_id
        self._qualification_backfilled: set[str] = set()

    @staticmethod
    def _insert(connection, observation: Observation) -> bool:
        o, i = observation, observation.identity
        connection.execute("""
            INSERT INTO derived_stream
                (derived_stream_id, naming_authority, platform, source_stream_id,
                 derived_suffix, platform_name)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (derived_stream_id) DO NOTHING
        """, (i.derived_stream_id, i.naming_authority, i.platform, i.source_stream_id,
              i.derived_suffix, o.platform_name))
        connection.execute("""
            INSERT INTO processing_stream
                (processing_stream_id, derived_stream_id, processing_suffix, name,
                 latitude, longitude, altitude, country, provider_kind,
                 provider_webcam_id, provider_url, tags, metadata_timestamp)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (processing_stream_id) DO UPDATE SET
                name = EXCLUDED.name, latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude, altitude = EXCLUDED.altitude,
                country = COALESCE(EXCLUDED.country, processing_stream.country),
                provider_kind = EXCLUDED.provider_kind,
                provider_webcam_id = EXCLUDED.provider_webcam_id,
                provider_url = EXCLUDED.provider_url, tags = EXCLUDED.tags,
                metadata_timestamp = EXCLUDED.metadata_timestamp, updated_at = now()
            WHERE EXCLUDED.metadata_timestamp >= processing_stream.metadata_timestamp
        """, (i.processing_stream_id, i.derived_stream_id, i.processing_suffix, o.name,
              o.latitude, o.longitude, o.altitude, o.country, o.provider_kind,
              o.provider_webcam_id, o.provider_url, list(o.tags), o.download_timestamp))
        connection.execute("""
            INSERT INTO observation_stream
                (observation_stream_id, processing_stream_id, naming_authority, platform,
                 standard_name, level, function, period, instrument, parameter, unit)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (observation_stream_id) DO NOTHING
        """, (i.observation_stream_id, i.processing_stream_id, i.naming_authority, i.platform,
              i.standard_name, i.level, i.function, i.period, i.instrument, o.parameter, o.unit))
        result = connection.execute("""
            INSERT INTO output (
                observation_stream_id, fingerprint, download_timestamp, latitude, longitude,
                altitude, country, snow_raw_lower, snow_raw_upper, snow_class,
                visibility_raw_lower, visibility_raw_upper, visibility_lower, visibility_upper,
                visibility_center, acquisition_timestamp, processing_timestamp,
                provider_timestamp, publication_timestamp, esoh_pubtime, publication_id,
                model_version, postprocessing_version, image_access, processing_level, quality_code,
                snow_qualification, visibility_qualification, snow_threshold_low, snow_threshold_high)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (fingerprint) DO NOTHING RETURNING output_id
        """, (i.observation_stream_id, o.fingerprint, o.download_timestamp, o.latitude,
              o.longitude, o.altitude, o.country,
              o.raw_lower if o.parameter == "snow" else None,
              o.raw_upper if o.parameter == "snow" else None, o.snow_class,
              o.raw_lower if o.parameter == "visibility" else None,
              o.raw_upper if o.parameter == "visibility" else None,
              o.visibility_lower, o.visibility_upper, o.visibility_center,
              o.acquisition_timestamp, o.processing_timestamp, o.provider_timestamp,
              o.publication_timestamp, o.esoh_pubtime, o.publication_id, o.model_version,
              o.postprocessing_version, o.image_access, o.processing_level, o.quality_code,
              o.snow_qualification, o.visibility_qualification, o.snow_threshold_low, o.snow_threshold_high))
        return result.fetchone() is not None

    @staticmethod
    def _backfill_qualification(connection, processing_stream_id: str):
        """Use the latest published webcam status for missing historical snow qualifications."""
        connection.execute("""
            WITH current_qualification AS (
                SELECT o.snow_qualification FROM output o
                JOIN observation_stream s USING (observation_stream_id)
                WHERE s.processing_stream_id = %s AND s.parameter = 'snow'
                  AND o.snow_qualification IS NOT NULL
                ORDER BY o.download_timestamp DESC,
                         o.processing_timestamp DESC NULLS LAST, o.output_id DESC LIMIT 1
            )
            UPDATE output o SET snow_qualification = current_qualification.snow_qualification
            FROM observation_stream s, current_qualification
            WHERE o.observation_stream_id = s.observation_stream_id
              AND s.processing_stream_id = %s AND s.parameter = 'snow'
              AND o.snow_qualification IS NULL
        """, (processing_stream_id, processing_stream_id))

    def write(self, observations: Iterable[Observation], *, filtered: int = 0,
              invalid: int = 0, qos: int = 1) -> tuple[int, int]:
        inserted = duplicates = 0
        backfilled = set()
        with self.database.connection() as connection:
            for observation in observations:
                if self._insert(connection, observation):
                    inserted += 1
                else:
                    duplicates += 1
                identifier = observation.identity.processing_stream_id
                if (observation.snow_qualification is not None
                        and identifier not in self._qualification_backfilled):
                    backfilled.add(identifier)
            for identifier in backfilled:
                self._backfill_qualification(connection, identifier)
            connection.execute("""
                INSERT INTO listener_state (
                    client_id, last_message_at, last_persisted_at, received_messages,
                    accepted_observations, duplicate_observations, filtered_observations,
                    invalid_observations, qos0_messages, qos1_messages)
                VALUES (%s, now(), CASE WHEN %s > 0 THEN now() ELSE NULL END,
                        1, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (client_id) DO UPDATE SET
                    last_message_at = now(),
                    last_persisted_at = CASE WHEN EXCLUDED.accepted_observations > 0
                        THEN now() ELSE listener_state.last_persisted_at END,
                    received_messages = listener_state.received_messages + 1,
                    accepted_observations = listener_state.accepted_observations + EXCLUDED.accepted_observations,
                    duplicate_observations = listener_state.duplicate_observations + EXCLUDED.duplicate_observations,
                    filtered_observations = listener_state.filtered_observations + EXCLUDED.filtered_observations,
                    invalid_observations = listener_state.invalid_observations + EXCLUDED.invalid_observations,
                    qos0_messages = listener_state.qos0_messages + EXCLUDED.qos0_messages,
                    qos1_messages = listener_state.qos1_messages + EXCLUDED.qos1_messages
            """, (self.client_id, inserted, inserted, duplicates, filtered, invalid,
                  int(qos == 0), int(qos == 1)))
        # Mark complete only after commit; retries must not skip a rolled-back backfill.
        self._qualification_backfilled.update(backfilled)
        return inserted, duplicates

    def heartbeat(self, connected: bool):
        with self.database.connection() as connection:
            connection.execute("""
                INSERT INTO listener_state (client_id, connected) VALUES (%s, %s)
                ON CONFLICT (client_id) DO UPDATE SET
                    connected = EXCLUDED.connected, heartbeat_at = now()
            """, (self.client_id, connected))

    @staticmethod
    def backfill_visibility_qualification(database: Database, batch_size: int = 2000) -> int:
        """Fill past visibility in short transactions while normal collection continues."""
        filled, after_id = 0, 0
        while True:
            with database.connection() as connection:
                rows = connection.execute("""
                    WITH batch AS (
                        SELECT o.output_id FROM output o
                        JOIN observation_stream s USING (observation_stream_id)
                        WHERE s.parameter = 'visibility' AND o.visibility_qualification IS NULL
                          AND o.output_id > %s
                        ORDER BY o.output_id LIMIT %s FOR UPDATE OF o SKIP LOCKED
                    )
                    UPDATE output o SET visibility_qualification = 2
                    FROM batch WHERE o.output_id = batch.output_id RETURNING o.output_id
                """, (after_id, batch_size)).fetchall()
            if not rows:
                return filled
            filled += len(rows)
            after_id = max(row["output_id"] for row in rows)
