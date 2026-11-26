from dataclasses import dataclass
from unittest.mock import Mock, patch

from webcam_ui.ingestion.mqtt import MQTTListener, read_credentials
from webcam_ui.ingestion.service import IngestResult
from webcam_ui.settings import MQTTSettings


def test_supplied_credential_format_read_without_shell_execution(tmp_path):
    path = tmp_path / "credentials"
    path.write_text("-username example-user\n--pw 'example-password-with-spaces $(not-executed)'\n")
    assert read_credentials(path) == ("example-user", "example-password-with-spaces $(not-executed)")


def listener(tmp_path, service):
    credentials = tmp_path / "credentials"
    credentials.write_text("-u example -P example")
    with patch("webcam_ui.ingestion.mqtt.mqtt.Client"):
        return MQTTListener(MQTTSettings(credentials_file=credentials), service)


@dataclass
class Message:
    payload: bytes = b"example"
    qos: int = 1
    mid: int = 42


def test_acknowledgement_occurs_only_after_successful_commit(tmp_path):
    events = []
    service = Mock()
    service.ingest.side_effect = lambda *a, **k: (events.append("commit"), IngestResult(1, 0, 0, 0, {}))[1]
    client = Mock()
    client.ack.side_effect = lambda *a: (events.append("ack"), 0)[1]
    listener(tmp_path, service)._on_message(client, None, Message())
    assert events == ["commit", "ack"]


def test_failed_transaction_disconnects_without_acknowledging(tmp_path):
    service = Mock()
    service.ingest.side_effect = OSError("database unavailable")
    client = Mock()
    listener(tmp_path, service)._on_message(client, None, Message())
    client.ack.assert_not_called()
    client.disconnect.assert_called_once()


def test_publisher_qos_zero_is_observed_without_fictitious_ack(tmp_path):
    service = Mock()
    service.ingest.return_value = IngestResult(1, 0, 0, 0, {})
    client = Mock()
    subject = listener(tmp_path, service)
    subject._on_message(client, None, Message(qos=0))
    client.ack.assert_not_called()
    assert subject.registry.get_sample_value("webcam_mqtt_messages_total", {"qos": "0"}) == 1
