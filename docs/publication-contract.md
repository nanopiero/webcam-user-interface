# Verified publication contract

Reference snapshots studied for this implementation:

- ML service `codex`, commit `1f08a15877a8d1ad4e0f143a1ac9fc614c33972f`:
  [`weow_ml/publication/esoh.py`](https://github.com/nanopiero/webcam-iot-ml-services/blob/1f08a15877a8d1ad4e0f143a1ac9fc614c33972f/weow_ml/publication/esoh.py),
  publication contract, SQL migrations, and the UI map/history/icon modules.
- E-SOH commit `34aa90aba88875fe2724e1f82a25fea867438f14`:
  [`ingest/api/model.py`](https://github.com/EUMETNET/e-soh/blob/34aa90aba88875fe2724e1f82a25fea867438f14/ingest/api/model.py),
  `main.py`, `messages.py`, `ingest.py` and `send_mqtt.py`.
- `ML_services_architecture`: the `architecture` and
  `architecture_upstream_ingestion_service` documents, read without changing that repository.
- [Windy v3 documentation](https://api.windy.com/webcams/docs).

Implemented mapper behavior takes precedence over older illustrative architecture examples.

## Shape and meaning

The operational publisher sends one snow and/or one visibility feature per eligible image.
The E-SOH observation geometry uses `coordinates: {lat, lon}`; the parser also accepts standard
GeoJSON `[lon, lat]` coordinates. The API always produces standard GeoJSON arrays.

Identity is `(naming_authority, platform, standard_name, level, function, period, instrument)`.
The implemented instrument template is `{source_stream_id}_{parameter}_{derived_suffix}_{processing_suffix}`.
The source/view components recognized from that template allow the two parameters to share a camera.

| Published value | Retained interpretation |
| --- | --- |
| `properties.datetime` | Observation/download timestamp, converted to UTC |
| `history.raw_interval=(lower, upper)` | Original model prediction interval; not a calibrated interval |
| `history.snow_class=...` | Snow classification when published |
| `history.snow_threshold_low`, `history.snow_threshold_high` | Optional finite snow thresholds in raw model units, stored on each observation |
| `history.snow_qualification=qualified/disqualified/incomplete` | Stored as the ML service's compact snow-status codes: 2 / 0 / 1 |
| `history.country=FR` | Published country code, normalized to uppercase and stored with the observation |
| `history.calibrated_interval=(lower, upper)` | Final published visibility bounds in metres |
| Visibility `content.value` | Published calibrated centre in metres; not the midpoint of those bounds |
| `"NaN"` scalar | Absent value; never stored as floating NaN or turned into zero |
| Acquisition/processing/provider/publication history timestamps | Optional distinct provenance timestamps |
| `properties.data_id` / top-level `id` | Optional E-SOH publication identifier |
| `properties.pubtime` | Optional E-SOH publication timestamp |
| `links[rel=about]` | Public provider page/image link, when HTTP(S) |
| `title`, platform name, coordinates, altitude, keywords | Lightweight display metadata |

Both snow and visibility remain enabled. Publications may contain only a raw interval;
that interval remains in history and no derived number/class is estimated. The current snow mapper
always emits a `"NaN"` scalar because its class is not a measured snow-area fraction. A future
non-NaN snow scalar is rejected as contract drift rather than silently discarded.

Snow classifications use the reference codes `0` (no snow), `10` (intermediate), and `1`
(undifferentiated snow), with uncertain variants `30`, `310`, `31`. When both snow thresholds
were published with a `1` or `31`, its display class is **High snow cover**, shown in solid vivid
violet. The published class code remains unchanged. No-snow and intermediate codes retain
their own classes even when both thresholds are present. A missing threshold leaves `1`/`31`
undifferentiated; the UI never reconstructs a class from the raw interval.
The UI presents these as categories rather than a fraction/percentage. A live verification on
2026-11-17 found snow records containing `raw_interval` and `content.value="NaN"` without any
`snow_class` field. Those observations cannot produce a categorical marker: they remain white,
and their categorical histories mark the class unavailable while retaining the separate raw values.

The parser rejects N0V0 image-ingestion notifications, unsupported parameters, non-finite or
reversed intervals, invalid coordinates, and timestamps without a timezone. It never evaluates
history text or the local mosquitto credential file as code.

## Observation qualification

Live messages verified on 2026-11-18 publish `snow_qualification` in history independently of
`snow_class`: disqualified scenes can publish a class too. The publisher uses the
[ML service's snow-status mapping](https://github.com/nanopiero/webcam-iot-ml-services/blob/codex/weow_ml/publication/esoh.py):
0 disqualified, 1 incomplete, 2 qualified. The local `output` observation table stores this as
nullable `snow_qualification SMALLINT`; the decision is the same `status == 2` rule used by the
[reference UI](https://github.com/nanopiero/webcam-iot-ml-services/blob/codex/weow_ml/ui/icons.py).
No qualification calculation, scene table or operational database lookup is introduced.

When the listener first receives a known qualification for a webcam, missing qualifications on
its historical snow observations are filled using its latest published status. Reported historical
qualifications remain intact. This backfill is checked once per webcam per listener run, rather
than running a history update for every observation. Old fingerprints remain valid for redelivery.

Visibility cameras are considered qualified (2), including historical visibility observations.
The nullable `visibility_qualification SMALLINT` column is populated with that explicit assumption;
there is no MQTT visibility-qualification reader or external lookup.

`/api/map` defaults to `qualified_only=true`. For snow, results whose status is 0, 1 or unknown
are withheld from the map result: the webcam remains as a white disc and its prediction's
uncertainty ring is withheld too. Qualified and unqualified results are selected from the same latest
observation; the query never substitutes an older qualified prediction for a newer unqualified one.
Turning the filter off retrieves the published classes. Visibility remains unchanged because its
assumed status is 2. The filter is offered in both views. Stored classes and historical predictions
remain available, with the qualification code returned as metadata.

## Topic and transport

The E-SOH reference topic is:

```text
{MQTT_TOPIC_PREPEND}/{naming_authority}/{platform}/{standard_name}
```

The prepend is deployment-specific and must be supplied by the operator. It is not the upstream
ingestion service's `{topic_prefix}/{transformation_version}` / N0V0 topic. Broker host, port and
topics are deliberately not inferred from unrelated upstream infrastructure.

The UI requests QoS 1, uses verified TLS, a stable persistent MQTT 3.1.1 client identity, and
manual acknowledgements after database commit. The reference E-SOH `send_message` calls
`client.publish(...)` without a `qos` argument, which means **publisher QoS 0**. Consequently,
its current messages can remain best effort even with a QoS-1 subscription. A subscription alone
does not make offline messages recoverable. No retrospective backfill is implemented in this phase.

The listener's metrics and `/api/status` count the QoS actually received. The live deployment's
effective QoS must be checked there; reading the reference code does not prove the deployed broker
or publisher version. Reconnection cannot recover messages that a QoS-0 publisher already lost.

## Country publication

Live messages verified on 2026-11-18 carry `country=XX` in the semicolon-separated
`properties.history`. The listener reads this field for both parameters and remains compatible
with `properties.country` and `properties.country_code`. All supplied sources must agree after
normalization; a conflict is rejected rather than silently selecting a country.

Missing/null/empty country is retained as SQL `NULL` and bypasses the country filter. A supplied
two-letter ASCII code is normalized to uppercase and filtered against `filters.allowed_countries`.
That same configuration supplies the frontend's single bordering-webcam toggle. Each observation retains its
published country, and a later observation without country does not erase known camera metadata.
No country is inferred from WIGOS/platform strings, source prefixes or coordinates. An optional
independent bounding box is enabled by default and also limits map reads. The ROI country/countries
are selected initially; neighbouring and unknown-country cameras are loaded only when requested.
Received-country availability is measurable in `/api/status`.

The older reference E-SOH properties schema dropped unrecognized country properties, which is why
the current publisher uses history. Older stored observations are not retroactively assigned country.
The same live verification also found `snow_threshold_low` and optional `snow_threshold_high` in
history. Migration 003 adds nullable columns on `output`; each new observation retains its own
thresholds. Existing rows stay NULL rather than borrowing today's calibration. Map classification,
popup metadata and historical views use the thresholds from their corresponding observation.
Raw historical charts draw the lower/upper thresholds as black/violet ticks at their observation
times; no threshold is interpolated or backfilled into an earlier observation.

## Upstream identity limitation

In the inspected E-SOH implementation, its generated `timeseries_id` and the `/json` batch
deduplication key do not include `instrument`, despite the architectural seven-field identity.
The UI does not trust that shortened ID: it constructs its own full identity including instrument.
However, it cannot recover separate observations already collapsed by upstream batch deduplication.
This is documented rather than changing either reference repository.

The published stream suffixes are lowercased, so the UI cannot promise the exact original
operational processing-stream identifier. Its internal IDs are stable published-data identities,
not invented namespace, scene, processing status or calibration facts.

## Verification boundaries

Synthetic fixtures exercise the implemented mapping and real PostgreSQL persistence. No private
captured payloads, broker addresses, credentials, certificate contents or API keys belong in tests
or this public repository. Live connection verification is recorded separately in deployment output;
unit/integration tests do not establish that a real broker is receiving observations.
