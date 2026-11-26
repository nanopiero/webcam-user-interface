# Webcam user interface

An independent E-SOH observation collector and webcam visualization application. It subscribes to the
operational ML service's **published snow and visibility observations**, maintains its
own PostgreSQL database, and never connects to the operational ML database or image archive.

## Application

The React/MapLibre frontend offers snow and visibility maps, site and camera selection,
webcam metadata, provider pages/current images, historical raw and calibrated intervals,
and authenticated local blacklist management. Missing derived results stay white on the map;
their raw predictions remain available in history. All observation times are displayed in UTC.
Snow history defaults to the three published categories, with raw model outputs in a separate tab.
Selecting a processed webcam automatically loads its provider's current image when available.
Published country codes are stored with observations. Backend `roi` settings select the initial
country/countries and administrative border profile. `filters.allowed_countries` adds the countries
offered by **Show bordering webcams**. The configured geographic rectangle limits both ingestion
and map reads. Startup loads the ROI countries; neighbours load on demand and refresh with the selection.
An optional external CSV catalogue adds small black clickable dots for webcams farther than
250 m from existing database webcams.

```text
E-SOH MQTT → TLS listener → PostgreSQL → FastAPI + compiled React UI → Nginx HTTPS
```

## Repository layout

```text
backend/src/webcam_ui/
  domain/          Published identities and supported marker classifications
  ingestion/       GeoJSON parser, geographic filters, transaction boundary, MQTT transport
  storage/         PostgreSQL pool, immutable SQL migrations, writes and bounded queries
  api/             Application assembly, map/history presentation, HTTP route modules
  security/        Application administrator sessions and CSRF protection
  providers/       Published provider links and on-demand Windy image-URL resolution
  settings.py      Strict backend configuration models and secret-file loading
  cli.py           Initialization, migrations, listener/API entrypoints, Compose wrapper
frontend/src/
  api/             Typed HTTP contracts and same-origin requests
  app/             Page composition, selection, time and refresh state
  features/map/    MapLibre layers, reference palettes, classification legend
  features/webcams/ Webcam metadata, latest predictions and current provider access
  features/history/ Paginated history, interval geometry and canvas charts
  features/admin/  Administrator session, login and local blacklist controls
  shared/          UTC and value formatting
frontend/tests/    History and authenticated HTTP contract tests
frontend/e2e/      Live read-only browser checks and mocked administrator interactions
config/            Separate backend TOML and frontend JSON examples
deploy/            Multi-stage application container and Nginx/certificate-renewal examples
logos/             Original provider logos and their official source attribution
docs/              Architecture, verified publication limitations, and deployment procedures
tests/             Unit tests and integration tests against an isolated real PostgreSQL
compose.yaml       PostgreSQL, API and listener; only localhost:8080 is published
```

## Start

Run initialization as the application user, from the repository root:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock
.venv/bin/python -m pip install --no-deps -e .
.venv/bin/webcam-ui init
```

For a new Europe-wide deployment, use `webcam-ui init --preset europe`. The
[Europe preset](config/presets/europe/README.md) uses English and loads its entire
country list directly, with no neighboring-country toggle.

Edit **`config/backend.local.toml`**: supply the MQTT broker, TLS port and observation
topic(s). The supplied `.secrets/mosquitto_sub` file is read as credential data, never executed.
Keep the CA in `.secrets/esoh-ca.crt` and the optional Windy key in `.secrets/wind_api_key`.
Initialization generates independent database and administrator credentials without printing them.

The application user (`sandbox`) starts the application after an administrator has configured
Docker access for that account:

```bash
.venv/bin/webcam-ui compose up -d --build
```

Use this wrapper so Compose receives the storage directory and runtime UID from the local
configuration/secret ownership. The PostgreSQL bind mount defaults to **`/data/db_ui`**.
The application is published only on **`127.0.0.1:8080`**, behind the host Nginx gateway.

- [Backend deployment and operation](docs/backend-operations.md)
- [Backend architecture and database](docs/backend-architecture.md)
- [Frontend usage, configuration and development](docs/frontend.md)
- [Supplementary webcam CSV and distance filtering](docs/supplementary-webcams.md)
- [Verified E-SOH publication contract and limitations](docs/publication-contract.md)
- [Rocky Linux Nginx HTTPS deployment](docs/nginx-rocky.md)
- [Original phase-1 instructions](codex_instructions.md)

## Test

```bash
.venv/bin/python -m pip install -e '.[dev]'
.venv/bin/pytest
.venv/bin/ruff check backend tests
cd frontend
npm ci
npm run build
npm test
```

On supported platforms, the development-only `pgserver` wheel supplies an isolated
PostgreSQL 16 instance; no sudo or running production database is needed. Alternatively,
set `WEBCAM_TEST_DATABASE_URL` to an exclusively disposable PostgreSQL test database.
Each test uses its own schema. These tests never read or change operational data.
Frontend development requires Node 22.22.2 or newer (or the supplied Node 22 build container).
The final runtime container serves compiled assets with Python; Node is only used during builds.
