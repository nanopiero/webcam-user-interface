# Bundled border overlays

Downloaded on 2026-11-17. Geometry is unchanged; unused feature properties are removed and JSON
is minified. Files are emitted as hashed frontend assets and served through the application's
existing static-asset route. MapLibre loads each source once and changes layer visibility when
the user toggles an overlay.

| File | Source | Display |
| --- | --- | --- |
| `national.geojson` | [Natural Earth 1:50m country land boundaries](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_boundary_lines_land.geojson) | Black, 1.7 px |
| `regions.geojson` | [Etalab / data.gouv.fr regions, 1,000 m generalisation](https://adresse.data.gouv.fr/data/contours-administratifs/latest/geojson/regions-1000m.geojson) | Red, 1.4 px |
| `departments.geojson` | [Etalab / data.gouv.fr departments, 1,000 m generalisation](https://adresse.data.gouv.fr/data/contours-administratifs/latest/geojson/departements-1000m.geojson) | Black, 0.6 px |

The French files retain the 18 regions and 101 departments, including their overseas regions
and departments. Additional overseas collectivities present in the original download are omitted:
region codes must contain two digits; department codes must contain two digits, `2A`, `2B`, or
one of `971`, `972`, `973`, `974`, `976`. Properties retained are `code`, `nom`, `name`, `NAME`.

Natural Earth data is [public domain](https://www.naturalearthdata.com/about/terms-of-use/).
French boundaries are generated from IGN ADMIN EXPRESS by
[data.gouv.fr's contours-administratifs](https://github.com/datagouv/contours-administratifs).
Source attribution is shown in the map. These are generalised display contours rather than
cadastral boundaries. The original raster basemap can contain its own faint administrative lines;
these controls govern the added vector overlays.
