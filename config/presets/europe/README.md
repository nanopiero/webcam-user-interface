# Europe deployment preset

For a **new deployment**, run from the repository root as the application user:

```bash
.venv/bin/webcam-ui init --preset europe
```

This creates the usual two local configuration files and credentials. Initialization
preserves existing settings and credentials: it does not switch an existing France
deployment to Europe. France remains the default for `webcam-ui init`.

The Europe configuration supplies:

- `roi.name = "Europe"`, with every permitted country in `roi.countries`.
- The same countries in `filters.allowed_countries`. All load at startup and refresh
  together; there is no neighboring-country toggle.
- An enabled rectangle: west **−32°**, south **27°**, east **60°**, north **82°**.
  It limits ingestion and map reads, including supplementary CSV points.
- An initial map centered at **12° E, 55° N**, zoom **3**, with national borders.
  The France-specific region/department controls are absent.
- `"language": "roi"`, which selects **English** for the Europe ROI. A saved browser
  choice or explicit configured language still takes precedence.

The editable country list follows the [UN M49 Europe country/area grouping](https://unstats.un.org/unsd/methodology/m49/),
plus Cyprus, Türkiye and the commonly published `XK` code for this operational
European webcam domain. Countries with territory beyond the rectangle are
limited by the rectangle.
Unknown country remains uninferred and excluded from the country-scoped UI, as in
France. No geographic classification service or new database structure is added.

Set the real broker, topics and TLS configuration in `config/backend.local.toml`
before starting the listener. The example contains placeholders. It keeps the
usual `/data/db_ui` persistence path and snow/visibility freshness thresholds.
The optional supplementary catalogue starts disabled, since the existing catalogue
is specific to France; an existing deployment may retain or replace its CSV.

For an **existing deployment**, merge only `[roi]`, `filters.allowed_countries`
and `[filters.bounding_box]` from this backend example into its local backend file.
Copy the Europe map view and language choice into its frontend file. Preserve its
broker, unique client ID, secret paths, database, providers and supplementary CSV
settings. Restart API and listener after changing their geographic configuration;
previously rejected observations become available only as new messages arrive.
Stored observations are retained.
