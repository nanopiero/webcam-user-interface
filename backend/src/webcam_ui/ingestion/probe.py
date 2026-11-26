"""Bounded, read-only live MQTT verification without PostgreSQL or Docker."""

import ssl
import threading
import uuid
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

import paho.mqtt.client as mqtt

from webcam_ui.ingestion.filtering import rejection_reason
from webcam_ui.ingestion.mqtt import read_credentials
from webcam_ui.ingestion.parser import ObservationError, parse_feature, payload_features
from webcam_ui.settings import FilterSettings, MQTTSettings


@dataclass
class ProbeReport:
    tls_verified: bool = False
    mqtt_connected: bool = False
    granted_subscription_qos: list[int] = field(default_factory=list)
    counts: Counter = field(default_factory=Counter)
    latest_observation_times: dict[str, str] = field(default_factory=dict)
    error: str | None = None
    production_rows_written: int = 0

    def as_dict(self):
        # dataclasses.asdict reconstructs Counter from (key, value) pairs,
        # producing tuple keys instead of the original named counts.
        return {
            "tls_verified": self.tls_verified,
            "mqtt_connected": self.mqtt_connected,
            "granted_subscription_qos": list(self.granted_subscription_qos),
            "counts": dict(self.counts),
            "latest_observation_times": dict(self.latest_observation_times),
            "error": self.error,
            "production_rows_written": self.production_rows_written,
        }


def probe(settings: MQTTSettings, filters: FilterSettings, *, seconds: int = 30,
          maximum_messages: int = 100, credentials_file: Path | None = None,
          ca_file: Path | None = None) -> ProbeReport:
    """Use a separate short-lived client. Never publish, persist payloads, or reuse the collector ID."""
    report = ProbeReport()
    done = threading.Event()
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                         client_id="webcam-ui-probe-" + uuid.uuid4().hex[:16],
                         clean_session=True, protocol=mqtt.MQTTv311)
    username, password = read_credentials(credentials_file or settings.credentials_file)
    client.username_pw_set(username, password)
    client.tls_set(ca_certs=str(ca_file or settings.ca_file))
    client.connect_timeout = 10

    def connected(c, userdata, flags, reason, properties):
        report.mqtt_connected = not reason.is_failure
        if reason.is_failure:
            report.error = "mqtt_connection_refused"
            done.set()
            return
        for topic in settings.topics:
            result, _ = c.subscribe(topic, qos=1)
            if result != mqtt.MQTT_ERR_SUCCESS:
                report.error = "subscription_request_failed"
                done.set()

    def subscribed(c, userdata, mid, reasons, properties):
        report.granted_subscription_qos.extend(reason.value for reason in reasons)
        if any(reason.is_failure for reason in reasons):
            report.error = "subscription_refused"
            done.set()

    def received(c, userdata, message):
        report.counts["messages"] += 1
        report.counts[f"qos_{message.qos}"] += 1
        try:
            features = payload_features(message.payload, settings.maximum_payload_bytes)
        except ObservationError as error:
            report.counts[f"invalid_{error}"] += 1
            features = []
        for feature in features:
            try:
                observation = parse_feature(feature)
            except ObservationError as error:
                report.counts[f"invalid_{error}"] += 1
                continue
            report.counts[observation.parameter] += 1
            report.counts["with_country" if observation.country else "without_country"] += 1
            reason = rejection_reason(observation, filters)
            report.counts["filtered_" + reason if reason else "accepted_by_filters"] += 1
            report.counts["raw_intervals"] += int(observation.raw_lower is not None)
            report.counts["snow_classes"] += int(observation.snow_class is not None)
            report.counts["calibrated_visibility_intervals"] += int(observation.visibility_lower is not None)
            report.counts["visibility_values"] += int(observation.visibility_center is not None)
            stamp = observation.download_timestamp.isoformat()
            report.latest_observation_times[observation.parameter] = max(
                report.latest_observation_times.get(observation.parameter, stamp), stamp)
        if report.counts["messages"] >= maximum_messages:
            done.set()

    client.on_connect, client.on_subscribe, client.on_message = connected, subscribed, received
    try:
        client.connect(settings.host, settings.port, settings.keepalive_seconds)
        report.tls_verified = True
        client.loop_start()
        done.wait(seconds)
    except ssl.SSLCertVerificationError as error:
        report.error = "TLS verification failed: " + error.verify_message
    except OSError as error:
        report.error = type(error).__name__
    finally:
        client.disconnect()
        client.loop_stop()
    return report
