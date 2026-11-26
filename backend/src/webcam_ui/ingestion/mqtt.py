"""TLS MQTT subscriber: persistent identity, QoS 1, reconnect, and acknowledgement after commit."""

import logging
import shlex
import signal
import threading
from pathlib import Path

import paho.mqtt.client as mqtt
from prometheus_client import CollectorRegistry, Counter, Gauge, start_http_server

from webcam_ui.ingestion.service import IngestionService
from webcam_ui.settings import MQTTSettings, read_secret

logger = logging.getLogger(__name__)


def read_credentials(path: Path) -> tuple[str, str]:
    """Read the supplied mosquitto argument file as data, never as an executable shell script."""
    try:
        tokens = shlex.split(read_secret(path), comments=True)
    except ValueError:
        raise ValueError("invalid MQTT credential-file format") from None
    values = {}
    options = {"-u": "username", "--username": "username", "-username": "username",
               "-P": "password", "--pw": "password", "--password": "password"}
    for index, token in enumerate(tokens[:-1]):
        if token in options:
            values[options[token]] = tokens[index + 1]
    if not values.get("username") or not values.get("password"):
        raise ValueError("MQTT credential file needs username and password options")
    return values["username"], values["password"]


class MQTTListener:
    def __init__(self, settings: MQTTSettings, service: IngestionService):
        self.settings, self.service = settings, service
        self.stop_event = threading.Event()
        self.registry = CollectorRegistry()
        self.messages = Counter("webcam_mqtt_messages_total", "Received messages", ["qos"], registry=self.registry)
        self.observations = Counter("webcam_observations_total", "Ingestion results", ["outcome"], registry=self.registry)
        self.connected = Gauge("webcam_mqtt_connected", "Broker connection state", registry=self.registry)
        self.last_message = Gauge("webcam_mqtt_last_message_timestamp_seconds", "Last received message", registry=self.registry)
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                                  client_id=settings.client_id, clean_session=False,
                                  protocol=mqtt.MQTTv311, manual_ack=True)
        username, password = read_credentials(settings.credentials_file)
        self.client.username_pw_set(username, password)
        self.client.tls_set(ca_certs=str(settings.ca_file))
        self.client.reconnect_delay_set(settings.reconnect_min_seconds, settings.reconnect_max_seconds)
        self.client.connect_timeout = 10
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_subscribe = self._on_subscribe
        self.client.on_message = self._on_message

    def _on_connect(self, client, userdata, flags, reason_code, properties):
        if reason_code.is_failure:
            self.connected.set(0)
            logger.warning("MQTT connection refused; retrying")
            return
        self.connected.set(1)
        for topic in self.settings.topics:
            result, _ = client.subscribe(topic, qos=1)
            if result != mqtt.MQTT_ERR_SUCCESS:
                logger.warning("MQTT subscription request failed")
                client.disconnect()

    def _on_subscribe(self, client, userdata, mid, reason_codes, properties):
        if any(code.is_failure for code in reason_codes):
            logger.error("MQTT subscription was refused")
            client.disconnect()
        elif any(code.value == 0 for code in reason_codes):
            logger.warning("MQTT broker granted subscription QoS 0; delivery remains best effort")

    def _on_disconnect(self, client, userdata, flags, reason_code, properties):
        self.connected.set(0)

    def _on_message(self, client, userdata, message):
        self.messages.labels(str(message.qos)).inc()
        self.last_message.set_to_current_time()
        try:
            result = self.service.ingest(message.payload, qos=message.qos)
        except Exception as error:
            # No ack on a database/transaction failure. A reconnect makes QoS-1
            # unacknowledged messages eligible for redelivery by the broker.
            logger.error("Observation transaction failed (%s); reconnecting without acknowledgement",
                         type(error).__name__)
            client.disconnect()
            return
        for outcome in ("accepted", "duplicates", "filtered", "invalid"):
            self.observations.labels(outcome).inc(getattr(result, outcome))
        if result.invalid:
            logger.warning("Rejected invalid observations: %s", result.reasons)
        if message.qos >= 1:
            result = client.ack(message.mid, message.qos)
            if result != mqtt.MQTT_ERR_SUCCESS:
                logger.warning("MQTT acknowledgement failed; duplicate redelivery is safe")

    def _heartbeat(self):
        while not self.stop_event.is_set():
            try:
                self.service.writer.heartbeat(self.client.is_connected())
            except Exception as error:
                logger.warning("Listener heartbeat failed (%s)", type(error).__name__)
            self.stop_event.wait(30)

    def stop(self, *_):
        self.stop_event.set()
        self.client.disconnect()

    def run(self):
        if self.settings.host.endswith(".invalid"):
            raise ValueError("configure the real MQTT broker before starting the listener")
        metrics_server, metrics_thread = start_http_server(self.settings.metrics_port, registry=self.registry)
        heartbeat = threading.Thread(target=self._heartbeat, name="listener-heartbeat", daemon=True)
        heartbeat.start()
        for number in (signal.SIGINT, signal.SIGTERM):
            signal.signal(number, self.stop)
        delay = self.settings.reconnect_min_seconds
        try:
            while not self.stop_event.is_set():
                try:
                    self.client.connect(self.settings.host, self.settings.port,
                                        self.settings.keepalive_seconds)
                    self.client.loop_forever(retry_first_connection=True)
                except OSError as error:
                    logger.warning("MQTT connection unavailable (%s); retrying", type(error).__name__)
                if self.stop_event.wait(delay):
                    break
                delay = min(delay * 2, self.settings.reconnect_max_seconds)
        finally:
            self.stop()
            heartbeat.join(timeout=6)
            try:
                self.service.writer.heartbeat(False)
            except Exception:
                logger.warning("Could not record listener shutdown")
            metrics_server.shutdown()
            metrics_server.server_close()
            metrics_thread.join(timeout=2)
