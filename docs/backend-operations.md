# Backend deployment and operation

## Host preparation

Use Docker Engine with the Compose plugin. PostgreSQL and all application runtime dependencies
run in containers; host PostgreSQL/Node installations are not needed for backend deployment.
The public gateway is configured separately in [nginx-rocky.md](nginx-rocky.md).

The application user (`sandbox`) initializes the repository and launches the application.
The administrator installs Docker and configures access once; Nginx and certificate management
remain administrator responsibilities. Docker-group membership grants root-equivalent access.
Use an approved Docker-access policy rather than running the application launcher as root.

## Initialize as the application user

```bash
cd /path/to/webcam-user-interface
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock
.venv/bin/python -m pip install --no-deps -e .
.venv/bin/webcam-ui init
```

For a new Europe deployment, use `.venv/bin/webcam-ui init --preset europe` instead.
The [Europe preset](../config/presets/europe/README.md) starts in English, loads all
configured European countries together and has no neighboring-country toggle.

Initialization is idempotent and preserves existing credentials and local settings. It creates:

| Ignored local file | Purpose |
| --- | --- |
| `config/backend.local.toml` | Backend configuration; set real broker/port/topics here |
| `config/frontend.local.json` | Independent display configuration, initially Bourges/France |
| `.secrets/db_password` | Random independent UI database password |
| `.secrets/session_secret` | Random application administrator session signing key |
| `.secrets/admin_password_hash` | Argon2 application administrator password hash |
| `.secrets/admin_initial_password` | Initial generated application password for local retrieval |
| `.secrets/mosquitto_sub` | Supplied MQTT username/password arguments; read as data only |
| `.secrets/esoh-ca.crt` | Supplied broker CA; TLS hostname verification stays enabled |
| `.secrets/wind_api_key` | Optional dedicated Windy key; mounted under the canonical runtime name |

The administrator username defaults to `admin`. Read the generated password locally; do not paste
it into chat, commands, public examples or Git. It is separate from the host Nginx `viewer` password.
For isolated local development only, `webcam-ui init --development` explicitly enables the initial
`admin`/`1234` credentials and development cookies. Production startup refuses that password.

The MQTT file can contain `-u USER --pw 'PASSWORD'` or the supplied `-username USER --pw PASSWORD`
form. Passwords with whitespace must be quoted as shell arguments, but no command is ever executed.
Only credentials come from this file; connection settings belong in the backend TOML.

## Configure before starting

Set the two observation-age thresholds per parameter in `config/backend.local.toml`:

```toml
[api.snow_freshness]
fresh_minutes = 30
max_age_minutes = 180

[api.visibility_freshness]
fresh_minutes = 15
max_age_minutes = 30
```

These are the defaults and this deployment's values. Below `fresh_minutes`, markers retain their
normal fill. From that age up to `max_age_minutes`, a white outer ring marks an ageing observation,
with its published snow/visibility colours retained in the centre. At `max_age_minutes` or older,
classified and unqualified cameras become small white dots. Grouped markers represent each camera's
age in its own sector when ages differ; expanding the group retains the same age treatment.
Qualification filtering still applies throughout the usable interval. Missing observations are
small white dots immediately. Provider images and stored histories remain available.

Ages use the published download/observation timestamp, never acquisition, processing, publication
or UI reception times. Historical maps measure age against their selected map time. The map response
provides the effective thresholds to the frontend legend, so there is no second setting to synchronize.
After observations stop, only small white WEOW dots and small black supplementary dots remain once
the parameter's maximum age is reached. Restart the API after changing threshold values; the listener
does not use them. When upgrading from the old single-threshold configuration, remove
`api.prediction_max_age_minutes`, add the two blocks above and rebuild both API and listener images
so both services recognize the updated configuration schema.

Set `mqtt.host`, `mqtt.port`, and `mqtt.topics` from the E-SOH observation connection information.
Keep `qos = 1`. Initialization generates a unique client ID; preserve it across restarts and run
one listener with that identity. Never reuse the operational ML consumer's ID.

The placeholder broker `.invalid` is deliberately rejected. Do not substitute an upstream N0V0
ingestion topic. The exact E-SOH observation prefix is deployment-specific.

Configure the ROI, the permitted neighbouring countries and the geographic rectangle together.
The actual France deployment uses:

```toml
[roi]
name = "France"
countries = ["FR"]

[filters]
allowed_countries = ["FR", "ES", "IT", "DE", "CH", "LU", "BE"]

[filters.bounding_box]
enabled = true
west = -6.0
south = 41.0
east = 10.0
north = 52.0
```

`roi.countries` must be a nonempty subset of `filters.allowed_countries`. At startup the browser
requests only the ROI countries and leaves neighbouring and unknown-country cameras unselected.
**Show bordering webcams** is the single country control: it adds/removes all configured non-ROI
countries together. The Netherlands is not in the France configuration. Neighbours load on
first selection, subsequent hide/show changes reuse cached data, and manual/automatic refresh requests
every currently selected country. Altitude and other display filters remain selected during refresh.

The geographic rectangle is enabled by default and applies both to incoming observations and to map
reads of previously stored cameras, including supplementary catalogue points. An API `bbox` can narrow
the deployment rectangle but cannot widen it. Old observations outside the rectangle remain stored.

`roi.name` selects the administrative border profile independently of the webcam country list.
Only the **France** profile loads French region/department data and offers those controls. Other
ROI names currently provide national borders; European teams can add their own administrative
profile in `frontend/src/features/map/roi.ts`, alongside attributed GeoJSON assets. To deploy elsewhere,
set `roi.name`, `roi.countries`, the allowed countries and the rectangle for that area. The frontend's
`map.center`/`map.zoom` are independent initial-view settings in `config/frontend.local.json`.
Supplementary CSV webcams remain a separate optional catalogue with their own toggle; replace or
disable the catalogue for another deployment.

After changing the country list, restart the API and listener, then reload the browser:

```bash
.venv/bin/webcam-ui compose restart api listener
```

The listener reads country from `properties.history` (`country=FR`), also accepting the older
`properties.country`/`country_code`. Each new observation stores the published country; the
camera metadata keeps the most recently supplied country. Conflicting sources are rejected.
Missing country stays SQL NULL and bypasses the ingestion country filter; those cameras remain
excluded from the browser's ROI/neighbor views. Country is never inferred from coordinates.
Old observations remain unchanged; webcams acquire country metadata as new messages arrive.
Changing the configured list also hides previously stored webcams with a known excluded country
from the map; their observations remain in the database.

`database.host_data_directory` defaults to `/data/db_ui`. The Compose wrapper reads it directly
from the backend file; there is no second storage setting to keep synchronized. The PostgreSQL
image initializes and owns that dedicated host directory. Keep existing contents when rebuilding.

Runtime secret paths in the example refer to the read-only mounts in `compose.yaml`. Changing
those paths also requires updating the corresponding mount targets. API and listener secret mounts
are separate: the API receives no MQTT credentials and the listener receives no administrator key.

## Start as the application user

As `sandbox`, from the repository root:

```bash
.venv/bin/webcam-ui compose up -d --build
.venv/bin/webcam-ui compose ps
.venv/bin/webcam-ui compose logs --tail=100 listener api
```

The wrapper reads the secret owner's UID/GID so the application runs unprivileged while still
reading files with mode 600. Initialize and invoke the wrapper as the application user. Docker daemon permission is a
separate host prerequisite; it does not change the API/listener container UID.
No PostgreSQL or MQTT host port is published. The API's host port is bound to `127.0.0.1:8080`.
Read-only bind mounts use shared SELinux labels; PostgreSQL's data mount uses a private label.

Migrations run under a lock at service startup. The API and listener are independently restartable.
When upgrading an existing database with qualification columns, fill old visibility observations
after the updated listener is collecting again:

```bash
.venv/bin/webcam-ui compose exec -T api python -m webcam_ui.cli backfill-visibility-qualification
```

The command assigns code 2 in short, resumable batches, preserving normal collection and avoiding
a large data update inside the schema migration. It is safe to repeat. Old snow qualifications are
filled automatically from each webcam's current published code as the listener receives it.

The API image builds and serves the React frontend at `/`. The listener uses the smaller backend
build target and runs independently of browser requests. To deploy frontend/API changes while
keeping MQTT collection uninterrupted:

```bash
.venv/bin/webcam-ui compose up -d --build --no-deps --wait api
```

This replaces the API container and preserves the database and listener containers.

To start just the API and database while MQTT connection settings are being confirmed:

```bash
.venv/bin/webcam-ui compose up -d --build postgres api
```

## Verify collection

On the host:

```bash
curl --fail http://127.0.0.1:8080/health/ready
curl --fail http://127.0.0.1:8080/api/status
```

The public equivalents pass through Nginx viewer authentication. `/api/status` reports counts
for each parameter, oldest/newest observation time, missing-country counts, listener heartbeat,
accepted/duplicate/filtered/invalid counts and actual received QoS. Do not equate an open MQTT
socket with confirmed data ingestion: accepted counts and latest timestamps must advance.
If counts remain zero, check topics, ACLs, enabled bbox/country filters and publication activity.

The listener exposes Prometheus metrics on container port 9090 without a published host port.
Readiness health checks require the listener to be connected with a recent heartbeat. A quiet
observation topic is acceptable: the heartbeat remains active even without received messages.

## Application administrator API

Use **Admin** in the frontend over HTTPS to sign in, select a webcam to hide it, or restore one
from the hidden-webcam list. The application credentials are independent of the gateway viewer
credentials. The generated initial password is kept in the local, ignored
`.secrets/admin_initial_password` file. The frontend performs these exchanges:

1. `POST /api/admin/login` with JSON username/password; save the HttpOnly cookie and CSRF token.
2. Use `GET /api/admin/blacklist` to inspect local exclusions.
3. `PUT /api/admin/blacklist/{processing_stream_id}` with JSON `{"reason":"..."}` and the
   `X-CSRF-Token` header; `DELETE` removes an exclusion.
4. `POST /api/admin/logout` with the CSRF header clears the browser cookie.

The Nginx viewer login alone cannot authorize any administrator write. API responses contain no
broker configuration, passwords, Windy API key or session signing secret.

Replace the application password as its local file owner:

```bash
.venv/bin/webcam-ui set-admin-password
.venv/bin/webcam-ui compose restart api
```

The command prompts without echoing and requires matching passwords of at least 12 characters.
Restarting loads the new hash and invalidates prior administrator sessions. The initial generated
password file is historical after a change; use the new password thereafter.

## Rebuild, restart and persistence

```bash
.venv/bin/webcam-ui compose restart listener
.venv/bin/webcam-ui compose up -d --build
```

Both commands preserve `/data/db_ui`. PostgreSQL storage is a host bind mount rather than a
container layer. There is no automatic history cleanup. Apply host backup and disk-capacity
management to that directory; stop or use a PostgreSQL-consistent backup procedure rather than
copying an actively changing data directory as if it were ordinary files.

Tests use synthetic observations and disposable PostgreSQL schemas. They do not seed the live
database with demonstration webcams. Live observations and test fixtures remain separate.
