# Backend architecture

## Ownership and data flow

The listener and API are separate processes built from one Python package and container image.
Both use the new UI database. Neither has credentials for the operational database, S3, image
spool, Kafka, scene qualification or calibration services. The local blacklist affects only this UI.

The dependency direction is explicit:

1. `domain` defines the published observation and its identities; it has no I/O.
2. `ingestion.parser` validates the implemented E-SOH shape into that domain model.
3. `ingestion.filtering` applies country and bounding-box rules independently.
4. `ingestion.service` collects accepted features and asks `storage.writer` for one transaction.
5. `ingestion.mqtt` acknowledges QoS-1 messages only after that transaction commits.
6. `storage.queries` provides bounded reads; `api.presentation` formats map and history contracts.
7. HTTP routes delegate to those services. Provider resolution and administrator security have
   their own packages and do not belong in the parser or database queries.

There is no catch-all utilities module, image processing pipeline or dependency on ML code.

## Configuration

`config/backend.local.toml` is the backend's source of truth. Its strict Pydantic models reject
unknown keys and invalid bounds. Relative paths resolve against the configuration file.
Credentials are file references; their contents never enter configuration examples or API responses.

`config/frontend.local.json` independently controls the initial Bourges-centred map and display
options. Its visible extent does not change ingestion's bounding-box filter. The API serves it
at `/frontend-config.json` for the future same-origin frontend.

## Database

`storage/migrations/` contains immutable, numbered SQL migrations. A checksum registry and
transaction-scoped PostgreSQL advisory lock make concurrent API/listener startup safe. Changing
an applied migration is refused; subsequent changes require a new migration.

| Relation | Purpose |
| --- | --- |
| `derived_stream` | Published authority, platform/site, source-stream identity and derived suffix |
| `processing_stream` | Camera/view identity and its latest lightweight display metadata |
| `observation_stream` | Seven-field E-SOH time-series identity, including instrument and parameter |
| `output` | Every distinct accepted prediction, timestamps, coordinates and country at observation time |
| `latest_snow_outputs`, `latest_visibility_outputs` | Latest observation per camera and parameter |
| `webcam_blacklist` | Local administrator-maintained exclusions; observations remain intact |
| `listener_state` | Connection heartbeat and ingestion counters, never ML processing statuses |
| `schema_migration` | Applied migration versions and checksums |

### Differences from the operational schema

The names `derived_stream`, `processing_stream`, `output`, `download_timestamp`, prediction
columns and latest-output access follow the reference service where observations support them.
The published contract does **not** contain the original complete derived/processing identifiers:
the mapper extracts suffixes and lowercases them. The UI therefore uses deterministic SHA-256
identifiers built from the published authority/site/source/suffix components. It retains those
original published components separately. These IDs must not be mistaken for operational IDs.
Snow and visibility from the same recognized source/view share one camera, while preserving
their separate E-SOH time series. An unrecognized instrument is kept separate instead of guessing
a camera relationship.

No namespace, scene index, operational processing status, image ID, binary metadata, calibration
material, full GeoJSON/history payload, or publication outbox is stored. Their absence cannot
be reconstructed from the publications. Metadata is limited to what map/popups/provider links need.
Observation coordinates and nullable country remain attached to each historical prediction.
`output.snow_qualification` and `output.visibility_qualification` are compact SMALLINT metadata
columns on those observations. Snow uses the published 0/1/2 codes; visibility is assumed qualified
(2). Missing historical snow qualification is filled from the latest published status for the same
webcam as current messages arrive. No scene-level storage or qualification computation is added.

### Duplicate delivery and revisions

A fingerprint covers normalized, retained observation content. E-SOH's regenerated publication ID
and `pubtime` are excluded from that fingerprint, so republishing the same content is a duplicate.
The first publication identifiers remain available for provenance. Changed raw/derived predictions
or processing provenance are retained as separate observations even at the same image timestamp.
The two parameters never overwrite one another.

The output insert and ingestion counters commit together. Unique constraints protect against
concurrent duplicate writes. A failed transaction is not acknowledged; the listener reconnects
with a persistent MQTT identity. This protects QoS-1 redeliveries but cannot upgrade a QoS-0 publisher.

Latest queries order by observation time, processing time and row identity, so an older arrival
does not replace newer predictions. Indexes support latest access and bounded historical ranges.
For maps, an indexed lookup selects one eligible observation per time series before choosing
the latest across a camera's time series. This avoids sorting every historical observation for
each camera while preserving historical `at` queries and cameras with no matching observation.
There is no automatic observation-retention deletion. PostgreSQL data lives in the configured
host bind directory and survives container replacement.

## Read API

| Endpoint | Purpose |
| --- | --- |
| `GET /health/live` | Process liveness |
| `GET /health/ready` | Database connectivity |
| `GET /api/status` | Stored data counts, country availability, listener heartbeat and received QoS |
| `GET /api/config` | Non-secret API/display capabilities and ingestion filter settings |
| `GET /frontend-config.json` | Independent frontend settings |
| `GET /api/map?parameter=snow` | One GeoJSON feature per published site, cameras embedded |
| `GET /api/webcams/{id}` | Lightweight metadata, latest snow/visibility predictions and provider page |
| `GET /api/webcams/{id}/history` | Bounded, cursor-paginated raw and derived prediction history |
| `GET /api/webcams/{id}/provider` | Provider page; optional `current_image=true` requests current image metadata |

Map parameters are `snow` and `visibility`. `at` is an optional timezone-aware ISO timestamp;
`bbox` is `west,south,east,north`. History accepts `start`, `end`, `limit` and `cursor`. Ranges
over the configured one-year ceiling are rejected. Responses explicitly report truncation and
provide a continuation cursor; stored history is never trimmed to fit a diagram.

Map freshness is derived from each observation's download timestamp at request time, with independent
fresh/maximum ages for snow and visibility. It adds no database state. The response includes each
camera's age category and the effective thresholds used by the frontend legend. Ageing observations
retain their classes and visibility bounds until the maximum age; qualification filtering still applies.

Site grouping uses published platform identity, never geographical proximity. Marker vocabularies
and visibility interval bands follow the reference UI's supported rules. Missing/stale derived
predictions remain white even when a raw interval exists. Unknown qualification/quality states
are not fabricated. Visibility's published centre is preserved, never calculated as a midpoint.

## Administrator security

Nginx HTTP Basic Authentication controls viewer access. The application's administrator login is
independent and takes a JSON username/password at `POST /api/admin/login`. It uses Argon2 hashes
and short-lived signed HttpOnly/SameSite cookies. Production administrator access requires HTTPS;
Nginx supplies the forwarded scheme, and the API's published socket remains localhost-only.

The login response and `GET /api/admin/session` return a CSRF token. Every blacklist write and
logout requires it in `X-CSRF-Token`. Cross-origin writes are refused. Login attempts are limited.
Changing the password hash and restarting the API invalidates existing sessions.

`GET /api/admin/blacklist` requires a session. `PUT /api/admin/blacklist/{id}` accepts an optional
reason; `DELETE` removes an exclusion. Neither operation deletes predictions or calls an upstream
service. There is no image download, ingestion-write HTTP endpoint or operational administration API.

## Provider access

Published HTTP(S) provider links are reused without fetching them on the server. A Windy source
identified by the reference `win{numeric-id}` convention can link directly to its public page.
Only an explicit current-image request requires the backend Windy v3 API client. The dedicated
key stays in a read-only secret file; only the resulting expiring image URL reaches the browser.
The bounded cache lasts at most five minutes, below Windy's documented free-tier URL validity.
No webcam image bytes are downloaded, stored or archived. Missing keys, throttling and unavailable
images leave the provider page usable and return an explicit unavailable result.
