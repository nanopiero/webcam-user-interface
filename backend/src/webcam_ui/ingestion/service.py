"""The transport-independent ingestion boundary used by MQTT, replay, and integration tests."""

from collections import Counter
from dataclasses import dataclass

from webcam_ui.ingestion.filtering import rejection_reason
from webcam_ui.ingestion.parser import ObservationError, parse_feature, payload_features
from webcam_ui.settings import FilterSettings
from webcam_ui.storage.writer import ObservationWriter


@dataclass(frozen=True)
class IngestResult:
    accepted: int
    duplicates: int
    filtered: int
    invalid: int
    reasons: dict[str, int]


class IngestionService:
    def __init__(self, writer: ObservationWriter, filters: FilterSettings,
                 maximum_payload_bytes: int = 1048576):
        self.writer, self.filters = writer, filters
        self.maximum_payload_bytes = maximum_payload_bytes

    def ingest(self, payload: bytes, *, qos: int = 1) -> IngestResult:
        observations, reasons = [], Counter()
        filtered = invalid = 0
        try:
            features = payload_features(payload, self.maximum_payload_bytes)
        except ObservationError as error:
            features, invalid = [], 1
            reasons[str(error)] += 1
        for feature in features:
            try:
                observation = parse_feature(feature)
            except ObservationError as error:
                invalid += 1
                reasons[str(error)] += 1
                continue
            reason = rejection_reason(observation, self.filters)
            if reason:
                filtered += 1
                reasons[reason] += 1
            else:
                observations.append(observation)
        accepted, duplicates = self.writer.write(observations, filtered=filtered,
                                                 invalid=invalid, qos=qos)
        return IngestResult(accepted, duplicates, filtered, invalid, dict(reasons))
