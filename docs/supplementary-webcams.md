# Supplementary webcam catalogue

The API can read a CSV of additional webcams and show them as small black clickable dots.
These catalogue entries have no WEOW prediction history. They are never inserted into the
observation tables or assigned fabricated processing states or snow classes.

## Backend configuration

```toml
[supplementary_webcams]
enabled = true
csv_file = "/app/catalogue/umap-webcams.csv"
host_directory = "/path/on/host/to/webcam-data"
minimum_distance_metres = 250.0
maximum_rows = 50000
```

`host_directory` is mounted read-only at `/app/catalogue` by the Compose wrapper. `csv_file`
is the path inside that container. Mounting the directory lets an exporter atomically replace
the CSV without leaving the API bound to an old file. File changes are detected automatically.
The backend does not expose filesystem paths or serve the CSV directory as static files.

The exporter is intentionally maintained **outside the application repository**, alongside its
operator instructions and tests. It reads the public uMap layers and compares every candidate
against **all** database webcam coordinates, including blacklisted webcams. It retains a candidate
only when its nearest database webcam is strictly farther than 250 m. It does not remove distinct
uMap views merely because they are close to one another.

The API repeats the distance check against current database coordinates on each catalogue request,
so a CSV point disappears if a matching WEOW webcam arrives after the export. Distance is horizontal
great-circle distance using mean Earth radius 6,371,008.8 m; altitude is excluded from this comparison.
Neither the exporter nor the map modifies the operational ML service.

## CSV fields and provenance

Required columns: `id`, `name`, `lat`, `lon`. The supplied exporter also writes:

- `altitude` in metres, `altitude_source` and the independently retained `altitude_band`.
- `provider_url`, `links_json`, `media_json` (image/video/frame connection methods), `description`
  and complete source properties in `metadata_json`.
- Map/layer URLs and names, source feature ID and export timestamp.
- Nearest database webcam ID and distance, and the configured exclusion distance.

Altitude is extracted only from an explicit altitude property, geometry Z, or a number marked
as metres in the webcam name. An altitude-layer range is not converted into a guessed altitude.
Missing altitude stays blank in the CSV and is labelled “Not published” in the interface.

The public [Météo-France uMap](https://umap.openstreetmap.fr/fr/map/carte-des-webcams-creee-par-meteo-france_1043458)
contains border polygons, altitude-grouped webcam points, and a separate “Webcams en panne” layer.
The exporter excludes polygons and that explicitly out-of-service layer by default. Other webcam
availability is the source catalogue's claim; individual streams are not probed in bulk. All
published links and descriptions are preserved. The popup displays metadata as escaped text,
offers provider links, and attributes the source map.
The popup automatically uses the published image/video/player method, including uMap's double-brace
image and triple-brace iframe notation. Known Windy/Skaping links resolve current images on demand.
Only HTTPS media is embedded on the HTTPS application; original HTTP-only links remain external.

## Operation and checks

Run the external exporter as the application user with Docker access. Its defaults use the existing
API container for public HTTP requests and a read-only SQL query, without exposing PostgreSQL or
copying credentials into the script. It writes a CSV and a sibling `.report.json` atomically.
Re-run it when a fresh catalogue snapshot is wanted; no periodic job is installed implicitly.

After initially enabling the setting, rebuild the API and listener together because both validate
the shared backend configuration:

```bash
.venv/bin/webcam-ui compose up -d --build --wait
```

Later CSV replacements need only the frontend's normal refresh. Read-only catalogue endpoints are
`GET /api/supplementary-webcams` (optionally `?bbox=west,south,east,north`) and
`GET /api/supplementary-webcams/{id}`. Unknown/malformed/missing files produce a catalogue-specific
error; the main observation map remains independent. Unit/integration tests cover the 250 m
boundary, date line, poles, CSV reloads, missing altitude, metadata and blacklisted database matches.
`GET /api/supplementary-webcams/{id}/provider` returns the on-demand provider media methods. It does
not proxy, download or store image/video content.
