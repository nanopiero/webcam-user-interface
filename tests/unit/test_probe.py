import json
from collections import Counter

from webcam_ui.ingestion.probe import ProbeReport


def test_probe_report_serializes_received_observation_counts():
    report = ProbeReport(
        tls_verified=True,
        mqtt_connected=True,
        granted_subscription_qos=[1, 1],
        counts=Counter({"messages": 3, "snow": 2, "visibility": 1, "qos_0": 3}),
        latest_observation_times={"snow": "2026-11-17T10:00:00+00:00"},
    )
    decoded = json.loads(json.dumps(report.as_dict()))
    assert decoded["counts"] == {"messages": 3, "snow": 2, "visibility": 1, "qos_0": 3}
    assert decoded["tls_verified"] and decoded["mqtt_connected"]
    assert decoded["production_rows_written"] == 0
    assert report.counts["messages"] == 3


def test_failed_connection_report_is_serializable_without_messages():
    report = ProbeReport(error="ConnectionRefusedError")
    decoded = json.loads(json.dumps(report.as_dict()))
    assert decoded["counts"] == {}
    assert decoded["error"] == "ConnectionRefusedError"
    assert not decoded["mqtt_connected"]
