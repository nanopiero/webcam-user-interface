# Frontend

The production API serves the built React application at `/`, assets at `/assets/`, and JSON
under `/api/`. Requests use the same origin as the page, so the existing Nginx HTTPS/viewer
authentication covers both. No browser token or separate frontend server is required.

## Using the map

The header shows `EUMETNET · Snow & visibility · ROI: <configured name>`. The left panel places
the webcam/qualification/display toggles first, **Show bordering webcams** below **Additional webcams**,
then border overlays and altitude controls. WEOW and additional webcam counts sit above the legend
in the right panel and follow the active filters.

- **Show bordering webcams** uses `filters.allowed_countries` in the backend configuration.
  Startup requests only `roi.countries` (France for this deployment). **Show bordering webcams**
  loads all the other configured countries together through one checkbox. Turning it off returns to
  the ROI countries. Neighbours load on first selection and can then be hidden/shown from cache.
  Cameras without published country remain excluded from these country-scoped views.
  **Refresh** and automatic refresh request every selected country, retaining the country and altitude
  selections. Supplementary black dots have no published country and keep their independent toggle;
  the catalogue is also refreshed and restricted to the deployment bounding box.
- Switch between **Snow** and **Visibility**. Small white dots indicate no recent observation
  for the selected parameter, including cameras that have never sent that parameter. In snow mode,
  recent unqualified observations use normal-sized white discs; unknown qualification counts as
  unqualified. Observation availability is independent of the provider image: small white dots
  remain clickable and can show current images. The legend uses the reference administrative UI's
  snow and fog palettes. An uncertainty ring is shown only when the published class supports it.
- **Qualified scenes only** starts enabled in both views. Snow qualification is read from the
  published status, independently of the snow class. Recent unqualified or unknown results remain as
  white discs, with no uncertainty ring. Turning the toggle off loads their published snow colours.
  The camera positions stay available. Visibility cameras
  are currently assumed qualified (2), so the toggle leaves visibility results unchanged.
  Refresh retains the qualification, country and altitude selections. Webcam metadata shows
  qualification; stored histories retain their published predictions and qualification codes.
- Select a site on the map, or search by name, platform, provider or source-stream ID.
  Supplementary webcams also match their provider hostname. Search uses the downloaded data and
  respects the selected countries, bounding box and display filters; it does not load hidden countries.
  Sites are grouped by published platform identity. A group with several views uses a disc 50%
  larger than a single-camera marker, following the admin UI's 9:6 size ratio. Every map click uses
  the same rule: one webcam opens its popup directly; several webcams open **Choose a webcam · N**.
  This applies both to a single grouped marker and to several overlapping markers. Choosing a view
  opens its own provider image. Click the unchanged marker again to choose another view. Grouped
  discs retain their coloured sectors and stay at the published site location throughout selection.
  A group containing only cameras without recent observations stays a small white dot and still
  offers each view in the chooser. Click the map background to close the popup/chooser.
  The left panel contains altitude controls rather than a full webcam list: **All altitudes**,
  **Below 500 m**, **500–1,000 m**, **Above 1,000 m**. The middle band includes both endpoints.
  Both WEOW and supplementary points use the filter; unknown altitudes appear under All.
- Overlapping markers keep their fill, ageing ring and outline together in one cached image.
  Drawing order is stable by marker identity within each layer; additional dots remain above site
  markers. Every click involving several webcams opens the same compact chooser
  with each webcam's name and colour, including covered tiny dots and individual views of groups.
  Choosing a webcam opens its own popup. A single webcam opens directly.
  The chooser uses already loaded, currently visible data and the existing four-pixel tolerance;
  hidden webcams and transparent image padding do not enlarge the selection. Escape, map movement,
  filter changes or the close button dismiss it. Only choosing a webcam requests its details/image.
- WEOW icons use 65% of their original width/height, with their outlines included in the cached
  image; the small black dots and legend swatches keep
  their sizes. **WEOW webcams**, **Additional webcams**, **Hide white markers**, altitude controls
  and search operate on the downloaded camera data. They update cached map filters/visibility
  without requesting webcam data or rebuilding the map. Manual/automatic refresh and changing
  the observation parameter/time still fetch fresh data.
- **Borders** has a national-border toggle and one **French regions & departments** toggle, which
  shows/hides regions in red and departments in thinner black lines together. French administrative
  controls and their datasets are available only when `roi.name`
  is **France**, independently of the country checkboxes. Each applicable dataset loads once. Repeated show/hide changes only the layer's
  visibility. These overlay controls do not remove faint lines baked into the raster basemap.
- **Latest** refreshes every 30 seconds when auto-refresh is enabled. **View time** selects the
  latest observation available as of the given UTC time. The backend's `api.snow_freshness` and
  `api.visibility_freshness` blocks each configure `fresh_minutes` and `max_age_minutes`.
  Snow defaults to **30 minutes / 180 minutes**, visibility to **15 minutes / 30 minutes**.
  Before the first threshold, markers are fully coloured. From the first threshold, they have a white
  outer ring with their colours retained in the centre. At the second threshold, every classification
  or unqualified white disc becomes a small white dot. Mixed-age groups use camera sectors even if
  their classes agree; each ageing sector has a white outer arc, and an expired sector is white.
  The chooser retains each camera's colour and ageing ring. The legend reads the effective thresholds from
  the map response. Qualification rules apply to both fresh and ageing observations.
  Age uses `download_timestamp` (`properties.datetime` in MQTT); acquisition, processing,
  publication and UI reception times never extend it. Historical maps measure age against the
  selected map time. Once the parameter's maximum age has elapsed since observations stopped,
  only small white WEOW dots and small black supplementary dots remain.
  The details panel explicitly labels its numerical summary as the latest received observation;
  history can end at the selected map time.
- The webcam popup puts **Latest prediction** first in its observation section, followed by three
  UTC clocks: **Download in E-SOH** (`download_timestamp`), **Processed** (`processing_timestamp`),
  and **UI backend reception** (`received_at`). Missing times remain explicitly unavailable.
  The selected camera's title appears once, in the header. **Tags and stream identifiers** exposes
  the stored `properties.keywords`, source stream ID, published derived/processing suffixes and
  local UI derived/processing IDs. The UI IDs are deterministic hashes, not the unpublished full
  operational stream IDs. No additional metadata tables or operational lookup are used.
- The current provider logo appears to the right of **Current image** on the same compact header row for recognized
  Windy, Skaping, Fintraffic and Météo Centre sources. Original logos and source attribution live
  in the repository's [`logos/`](../logos/README.md) directory and are bundled as local assets.
  Supplementary webcams offer a single provider-page link, with other distinct published links
  kept separately. The current provider image is not linked to a specific processed frame:
  publications do not supply an immutable image URL, image identifier or content checksum. The
  popup states that exact correspondence is unverified; no archive or matching service is added.
- Open snow and visibility histories independently. Snow distinguishes no snow (grey), intermediate
  cover (light blue), undifferentiated snow (blue), and **High snow cover** (solid vivid violet).
  High cover requires a published snow class of `1`/`31` and both thresholds on that same observation.
  Older observations without thresholds stay undifferentiated. Unavailable
  classes are white. No snow-coverage percentage or class is inferred from a raw model interval.
  The raw model interval remains available through a separate tab, with lower/upper thresholds
  drawn as black/violet dashed step lines using the values published with each observation.
  The classes view shows those same thresholds against a separate right-hand **Thresholds (raw)**
  axis; the left axis remains categorical. Missing thresholds leave gaps. The readout and webcam
  metadata retain the exact published values, including zero; historical thresholds are never backfilled.
  Each panel keeps its selected webcam and loaded range while the map selection changes. A solid
  black vertical guide follows the current map time above, without resetting the chart zoom or
  requesting history again. The chart legend gives that UTC time and indicates when it is outside
  the visible chart range. Choose a preset or custom UTC range, up to the configured limit.
  **Load older observations** follows continuation pages when a range exceeds the server page size.
- Raw intervals are model outputs; visibility raw values are not metres. **Calibrated · m** shows
  published visibility bounds and the published centre, when supplied. No midpoint is inferred.
  Intervals are discrete vertical bars; missing results use a labelled **Unavailable** row and are
  never filled or interpolated. Histories use [Dygraphs](https://dygraphs.com/) with drag-to-zoom,
  Shift-drag panning, touch pinch, a range selector and explicit **Zoom in**, **Zoom out**, and
  **Reset zoom** buttons. Zoom/pan operate on downloaded data without map/history requests;
  double-click resets the view. Move over a chart or focus it and use arrow/Home/End keys for the
  numerical readout. Dygraphs is loaded only when a history is opened.
- Selecting a webcam automatically loads its current provider image at the top of its details.
  **Reload image** resolves a fresh current URL; **Open provider page** opens the original resource.
  Windy URL resolution and Skaping public-page image metadata resolution happen on the backend.
  The browser never receives the Windy API key. Providers
  may prohibit embedding or expose only HTTP images; the panel offers an external link when
  embedding is unavailable. Images are not archived by this application.
- The vertical band on the right explains marker colours. Optional supplementary CSV webcams appear
  as small black dots and can be searched and selected. The legend calls them **Additional webcams**.
  Their popup shows source metadata/provider links and explains that they have no WEOW observations.
  See [supplementary webcams](supplementary-webcams.md).
  Published uMap image, video and iframe connection methods are used automatically. Windy and
  Skaping current images are resolved on the backend for supplementary webcams too. If a provider
  prevents embedding, the original source link remains available.
- **Admin** opens the independent application login. Once signed in, select a webcam and supply
  an optional reason to hide it. Restore it through **Administrator → Hidden webcams**. Hiding
  changes only this map; ingestion and historical records continue unchanged.

## Configuration

Copy `config/frontend.example.json` to the ignored `config/frontend.local.json` (initialization
does this automatically). It is mounted read-only and loaded on page start; reload the browser
after editing it. It contains no credentials.

Countries are configured once in `config/backend.local.toml` under `filters.allowed_countries`.
The `[roi]` section sets the ROI name and initial country/countries. The API adds both settings to
`/frontend-config.json`; do not duplicate them in the frontend JSON.
See [deploying for another country](backend-operations.md#configure-before-starting) for an example.

| Setting | Purpose |
| --- | --- |
| `map.center`, `map.zoom` | Initial Bourges/France view; independent of backend geographic filtering |
| `map.basemap` | Raster tile URL(s), visible attribution and provider maximum zoom |
| `map.marker_scale` | WEOW icon width/height multiplier; default 0.65, black dots unchanged |
| `map.borders` | Initial overlay visibility; French regions and departments are enabled together if either flag is true |
| `default_parameter`, `parameters` | Initial mode and offered observation modes |
| `pie_sector_limit` | Maximum displayed tied-class pie sectors (backend also caps at 12) |
| `diagram.initial_days`, `diagram.max_days` | Initial history span and maximum selectable span |
| `visibility_display.ceiling_metres` | Display ceiling for calibrated visibility charts |
| `visibility_display.saturated_band_metres` | Display band for values above that ceiling |

The original interval/centre values remain unchanged by the chart display ceiling. The history
API enforces its own maximum range independently. The default OpenStreetMap tile service needs
Internet access from the viewer's browser. Keep its attribution visible and follow its
[tile usage policy](https://operations.osmfoundation.org/policies/tiles/); configure another
provider when deployment traffic or provider terms require it. There is no offline tile prefetch.

## Code and development

`src/app` composes the page and owns selection/time state. `src/api` is the only HTTP layer.
Each feature directory owns its own rendering and local state. `history/series.ts` contains pure
history merging and value interpretation; `chartData.ts` prepares the published values for Dygraphs,
`chartPlotter.ts` draws discrete intervals/classes, and `HistoryChart.tsx` owns chart interactions
and the map-time guide. Reference palettes/sprites are isolated in `map/icons.ts`;
scene, calibration-management and image-archive controls are intentionally absent.
`map/countries.ts` and `CountryFilter.tsx` own country labels, counts and selection controls.
`map/roi.ts` is the administrative border profile registry; add other teams' ROI layers there.
`map/overlap.ts` finds all webcams under a click and deduplicates individual group views.
`map/WebcamChooser.tsx` presents the shared chooser for groups and overlapping markers.
Both use already downloaded data. Only a chosen webcam's popup requests provider metadata.
`map/useMapData.ts` owns scoped loading/refresh and `map/cache.ts` merges refreshed countries,
including removals, while retaining hidden cached countries. Browser requests bypass the HTTP cache.
`map/presentation.ts` computes country/altitude-specific grouped classes from cached cameras.
Country selection updates the cached map source; altitude and other display controls update
filters/icon selection. Neither recreates the map or requests observation data. Border snapshots
and provenance are documented in
[`map/data/README.md`](../frontend/src/features/map/data/README.md).
The MapLibre worker is bundled and served from the application origin, following the
[MapLibre Vite installation instructions](https://maplibre.org/maplibre-gl-js/docs/#installation).

With Node 22.22.2 or newer:

```bash
cd frontend
npm ci
npm run dev
```

The development server proxies `/api/` and `/frontend-config.json` to localhost:8080. Use the
HTTPS production origin to exercise real administrator sessions. Production uses the Docker
`web` build target, copies only compiled assets into the Python runtime, and keeps the API port
bound to localhost. A backend-only build still exposes the collection API for deployment staging.

```bash
npm run build
npm test
npx playwright install chromium
UI_TEST_BASE_URL=http://127.0.0.1:8080 npm run test:browser
```

The browser checks require a populated observation database. They read the live map/history,
check desktop/mobile layouts, and mock administrative requests so they never hide a live webcam.
Backend integration tests separately verify real authentication, CSRF and blacklist persistence
against disposable PostgreSQL schemas. Browser screenshots and traces stay in ignored
`frontend/test-results/`; they are not public repository fixtures.
