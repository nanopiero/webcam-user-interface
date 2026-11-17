# Implement webcam-user-interface — Phase 1

Implement a standalone, read-only webcam visualization application in:

https://github.com/nanopiero/webcam-user-interface

The application will run on a separate EWC tenancy, subscribe to **E-SOH MQTT GeoJSON observations**, maintain its own PostgreSQL database, and reuse the existing ML service's administrative visualization interface.

## 1. Reference implementations

Study these resources before coding:

- [ML service, `codex` branch](https://github.com/nanopiero/webcam-iot-ml-services/tree/codex), especially `weow_ml/publication/`, `weow_ml/ui/`, `ui/src/`, and the SQL migrations.
- [Publication contract](https://github.com/nanopiero/webcam-iot-ml-services/blob/codex/development/publication_contract.md).
- [ML service documentation](https://nanopiero.github.io/webcam-iot-ml-services/).
- The `architecture` and `architecture_upstream_ingestion_service` documents in [ML_services_architecture](https://github.com/nanopiero/ML_services_architecture).
- [E-SOH MQTT implementation](https://github.com/EUMETNET/e-soh).

Use the **`codex` branch**, not `main`, for the operational ML service. Prioritize actual implemented behavior over outdated documentation.

Do not modify the reference repositories.

## 2. Deployment and configuration

Create a Docker Compose deployment containing PostgreSQL, an MQTT subscriber, a Python/FastAPI backend, and the React/MapLibre frontend.

The PostgreSQL host data directory must be **`/data/db_ui`**, configurable in the backend configuration. Database content must survive container restarts and rebuilds.

Provide two independent configuration files:

**Backend configuration**

- Allowed countries, default: `FR, ES, IT, DE, CH, LU, BE`.
- Optional geographic bounding box, enabled by default and approximately matching the initial France-scale map extent.
- MQTT connection and subscription settings.
- PostgreSQL settings and host storage path.
- Other backend parameters.

**Frontend configuration**

- Initial map center: Bourges, longitude `2.398`, latitude `47.084`.
- Initial zoom/extent: approximately metropolitan France.
- Visualization settings.

The geographic filtering rectangle and visible map limits are **independent settings**, although their defaults should correspond.

## 3. MQTT ingestion

Consume the **E-SOH MQTT GeoJSON observations published by the operational ML service**, not the upstream `N0V0` image-ingestion notifications.

The local `.secrets` directory already contains:

- `esoh-ca.crt`
- `mosquitto_sub`, with the information needed to subscribe to the relevant MQTT topic

Inspect these files locally to establish the broker connection, TLS configuration, authentication and topic. Never display or commit their secrets.

Use MQTT **QoS 1** for subscription, with reconnection, stable client identity and idempotent database writes. Check and document the effective publisher QoS, which may limit end-to-end delivery guarantees.

Parse the actual E-SOH observation fields, including:

- Coordinates and platform/instrument identifiers.
- Observation timestamp and publication identifiers.
- Parameter name (`surface_snow_area_fraction` or `visibility_in_air`).
- Raw prediction intervals from `properties.history`.
- Snow classification, when available.
- Calibrated visibility interval and visibility value, when available.
- Webcam name, relevant metadata and provider link.

Support **both snow and visibility publication**. Do not assume that snow is disabled.

One image may produce separate snow and visibility observations. Preserve the distinction between raw predictions and calibrated or classified results.

## 4. Geographic filtering

Keep the country filtering logic with the seven configured countries.

- **If a country field is present in the received MQTT GeoJSON, apply the configured country filter.**
- **If the country field is absent, skip the country filter entirely for that observation.**
- Do not infer the country from coordinates or platform identifiers.
- Apply the independently configured geographic bounding-box filter in either case.
- Store the country code when supplied, or `NULL` otherwise.

The country field will be added later to the JSON sent to E-SOH. Make its parsing optional and straightforward to extend.

Check whether E-SOH preserves the new field through ingestion and MQTT publication; document any upstream schema limitation rather than silently relying on it.

## 5. PostgreSQL database

Reuse the operational database's **relevant structure, names and conventions** wherever the published data supports them, especially stream identities, prediction outputs and latest-observation access.

Keep the database lightweight:

- Store every distinct accepted observation, including historical predictions.
- Preserve timestamps, parameter, raw interval, derived result, coordinates, necessary webcam metadata and provider links.
- Prevent duplicate records caused by MQTT redelivery.
- Maintain efficient indexes for map queries, latest predictions and historical diagrams.
- Do **not** store complete MQTT/GeoJSON payloads.
- Do **not** store binary metadata, archived images, scene-calibration data or a publication outbox.
- Do **not** automatically delete old observations.

Do not invent operational processing statuses or fields that cannot be reconstructed from the published observations.

Provide database migrations and document the differences from the operational schema.

## 6. Frontend and historical diagrams

Reuse the existing administrative UI's appearance and relevant functionality:

- Interactive map with webcam markers.
- Snow and visibility visualization modes.
- Existing marker classifications and legends where the published data supports them.
- Site grouping and webcam selection.
- Webcam metadata popup.
- Historical prediction diagrams following the existing admin UI's presentation.

**Keep historical prediction diagrams for both snow and visibility, but omit the corresponding images.**

Remove scene-history views, scene-management controls, image archives, operational database dependencies and any features requiring unpublished calibration data.

Show missing predictions as missing rather than estimating them.

The popup should offer access to the provider's **current** webcam image or page, not archived images.

## 7. Independent webcam blacklist

Implement a local blacklist, stored in the new PostgreSQL database.

Blacklisted webcams must be hidden from the map without deleting their observations.

Changing the blacklist must require administrator authentication.

Initial development credentials:

- Username: `admin`
- Password: `1234`

Store the password as a secure hash, protect all administrative write endpoints, and provide a mechanism to replace these initial credentials. Never expose the default password in a public deployment.

The blacklist must not affect the operational ML service.

## 8. Provider images

Use the provider information available in the published observations.

For providers exposing a direct HTTP(S) webcam page or image link, reuse that link.

For **Windy**, first check whether a public provider link can be used without the API. If the current image requires Windy Webcams API v3:

- Use a dedicated Windy API key stored in `.secrets`.
- Resolve the webcam identifier reliably using the published identifiers and the existing ingestion implementation.
- Perform API requests on the backend only.
- Resolve expiring image URLs on demand, using a short cache where appropriate.
- Never expose the Windy API key to the browser.

Handle missing or unavailable provider links gracefully. Do not download, store or archive webcam images.

## 9. Secrets and repository safety

**Immediately add `.secrets` and all nested `.secrets` directories to `.gitignore`.**

Also exclude secrets from Docker build contexts through `.dockerignore`.

Mount secrets and certificates read-only at runtime. Commit only example configuration files with placeholders.

Verify that no broker credentials, certificates, API tokens, administrator secrets or private operational infrastructure information enter the new repository, which is public.

## 10. Scope and acceptance criteria

Implement phase 1 completely: MQTT ingestion, filtering, PostgreSQL persistence, API, map, popups, historical prediction diagrams, provider links and authenticated blacklist.

**Do not implement supplementary webcam CSV import yet.** That functionality belongs to phase 2.

Provide tests covering:

- E-SOH GeoJSON parsing for snow and visibility.
- Country filtering when a country is present, and bypass when absent.
- Independent geographic bounding-box filtering.
- MQTT deduplication and persistent history.
- Latest predictions and historical diagram data.
- Blacklist authentication and behavior.
- Provider-link resolution.

Verify that the application starts with Docker Compose, ingests representative observations, displays webcams and their predictions, and preserves database records across restarts.

Deliver the implementation, configuration examples, migrations, tests and concise deployment documentation. Report any limitations verified in the actual MQTT contract.

Keep the application lightweight and independent of the operational ML infrastructure.
