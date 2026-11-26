import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { ExpressionSpecification, GeoJSONSource, Map as LibreMap } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { FeatureCollection, Point } from "geojson";
import type { AltitudeBand, BorderVisibility, FrontendConfiguration, Parameter, SiteFeature, SupplementaryFeature } from "../../api/contracts";
import { MARKER_RADIUS, classColour } from "./icons";
import { addBorderLayers, showBorderLayers } from "./borders";
import { initialBorderVisibility } from "./roi";
import { ALTITUDE_BANDS, SMALL_DOT_RADIUS, cameraSector, markerScale, markerZoomScale, siteForAltitude, siteSectors, smallWhiteMarker } from "./presentation";
import { expandedCameraPositions, groupMarkerFactor } from "./expansion";
import { markerSprite } from "./sprites";
import { markersAtPoint, webcamChoices, type ClickMarker, type WebcamTarget } from "./overlap";
import OverlapMenu from "./OverlapMenu";

// MapLibre 6 requires an explicit bundled worker URL when used with Vite.
maplibregl.setWorkerUrl(workerUrl);

function markerSize(scale: number, unit = 1, factorProperty?: string, smallProperty?: string): ExpressionSpecification {
  const at = (zoomScale: number): number | ExpressionSpecification => {
    const normal: number | ExpressionSpecification = factorProperty
      ? ["*", zoomScale * scale * unit, ["coalesce", ["get", factorProperty], 1]]
      : zoomScale * scale * unit;
    return smallProperty ? ["case", ["boolean", ["get", smallProperty], false], SMALL_DOT_RADIUS * unit / 15, normal] : normal;
  };
  return ["interpolate", ["linear"], ["zoom"], 3, at(0.55), 8, at(0.85), 12, at(1)];
}

interface Props {
  configuration: FrontendConfiguration;
  sites: SiteFeature[];
  allSites: SiteFeature[];
  parameter: Parameter;
  altitudeBand: AltitudeBand;
  showObserved: boolean;
  showSupplementary: boolean;
  borders: BorderVisibility;
  selected: SiteFeature | null;
  selectedCameraId: string;
  expanded: SiteFeature | null;
  onExpand: (site: SiteFeature | null) => void;
  supplementary: SupplementaryFeature[];
  allSupplementary: SupplementaryFeature[];
  selectedSupplementary: SupplementaryFeature | null;
  onSelect: (site: SiteFeature, camera?: string) => void;
  onSelectSupplementary: (webcam: SupplementaryFeature) => void;
}

// One WebGL source for all sites; only the selected site uses interactive HTML.
export default function MapView({ configuration, sites, allSites, parameter, altitudeBand, showObserved, showSupplementary, borders, selected, selectedCameraId, expanded, onExpand, onSelect, supplementary, allSupplementary, selectedSupplementary, onSelectSupplementary }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LibreMap | null>(null);
  const sitesRef = useRef(sites);
  const onSelectRef = useRef(onSelect);
  const expandedRef = useRef(expanded);
  const onExpandRef = useRef(onExpand);
  const supplementaryRef = useRef(supplementary);
  const onSupplementaryRef = useRef(onSelectSupplementary);
  const focusedId = useRef<string | null>(null);
  sitesRef.current = sites;
  onSelectRef.current = onSelect;
  expandedRef.current = expanded;
  onExpandRef.current = onExpand;
  supplementaryRef.current = supplementary;
  onSupplementaryRef.current = onSelectSupplementary;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [visibleSites, setVisibleSites] = useState(0);
  const [chooser, setChooser] = useState<{ choices: WebcamTarget[]; left: number; top: number } | null>(null);

  function choose(target: WebcamTarget) {
    setChooser(null);
    if (target.kind === "supplementary") onSupplementaryRef.current(target.webcam);
    else if (target.camera) onSelectRef.current(target.site, target.camera.p);
    else if (target.site.properties.n > 1) onExpandRef.current(
      expandedRef.current?.properties.id === target.site.properties.id ? null : target.site);
    else onSelectRef.current(target.site);
  }

  useEffect(() => { setChooser(null); }, [sites, supplementary, expanded, parameter, altitudeBand]);

  useEffect(() => {
    if (!container.current) return;
    let instance: LibreMap;
    try {
      instance = new maplibregl.Map({
        container: container.current,
        center: configuration.map.center,
        zoom: configuration.map.zoom,
        maxZoom: 18,
        attributionControl: { compact: true },
        style: {
          version: 8,
          sources: { basemap: { type: "raster", tiles: configuration.map.basemap.tiles,
            tileSize: 256, maxzoom: configuration.map.basemap.maxzoom ?? 19,
            attribution: configuration.map.basemap.attribution } },
          layers: [{ id: "background", type: "background", paint: { "background-color": "#e8ede9" } },
            { id: "basemap", type: "raster", source: "basemap", paint: { "raster-saturation": -0.55 } }],
        },
      });
    } catch {
      setError("The map needs WebGL. You can still select a webcam from the list.");
      return;
    }
    map.current = instance;
    instance.on("error", event => {
      if (/worker|sites/i.test(event.error.message)) setError("Map markers could not load. Reload the page to retry.");
    });
    instance.on("idle", () => {
      if (instance.getLayer("sites")) {
        const visible = instance.queryRenderedFeatures({ layers: ["sites", "supplementary", "cameras"] });
        setVisibleSites(new Set(visible.map(feature => `${feature.source}:${feature.properties.id}`)).size);
      }
    });
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    instance.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    const resize = new ResizeObserver(() => instance.resize());
    resize.observe(container.current);
    instance.on("load", () => {
      addBorderLayers(instance, initialBorderVisibility(configuration.roi.name, configuration.map.borders), configuration.roi.name);
      instance.addSource("sites", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      const scale = markerScale(configuration.map.marker_scale);
      instance.addLayer({ id: "sites", type: "symbol", source: "sites", layout: {
        "icon-image": ["get", "icon_all"], "icon-allow-overlap": true, "icon-ignore-placement": true,
        "symbol-sort-key": ["get", "order"], "symbol-z-order": "source",
        "icon-size": markerSize(scale, 1, "factor_all", "small_all"),
      } });
      instance.addSource("supplementary", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      instance.addLayer({ id: "supplementary", type: "symbol", source: "supplementary", layout: {
        "icon-image": ["get", "icon"], "icon-size": SMALL_DOT_RADIUS / MARKER_RADIUS,
        "icon-allow-overlap": true, "icon-ignore-placement": true,
        "symbol-sort-key": ["get", "order"], "symbol-z-order": "source",
      } });
      instance.addSource("selection", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      instance.addLayer({ id: "selection", type: "circle", source: "selection", paint: {
        "circle-radius": 21, "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": "#087d92", "circle-stroke-width": 3,
      } });
      instance.addSource("camera-links", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      instance.addLayer({ id: "camera-links", type: "line", source: "camera-links", paint: {
        "line-color": "#555555", "line-width": 1.5, "line-dasharray": [0.75, 1.5],
      } });
      instance.addSource("expanded-cameras", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      instance.addLayer({ id: "cameras", type: "symbol", source: "expanded-cameras", layout: {
        "icon-image": ["get", "icon"], "icon-size": markerSize(scale, 1, undefined, "small"),
        "icon-allow-overlap": true, "icon-ignore-placement": true,
        "symbol-sort-key": ["get", "order"], "symbol-z-order": "source",
      } });
      for (const layer of ["sites", "supplementary", "cameras"]) {
        instance.on("mouseenter", layer, () => { instance.getCanvas().style.cursor = "pointer"; });
        instance.on("mouseleave", layer, () => { instance.getCanvas().style.cursor = ""; });
      }
      instance.on("movestart", () => setChooser(null));
      instance.on("click", event => {
        const normal = scale * markerZoomScale(instance.getZoom());
        const radius = (small: boolean, group = 1, uncertain = false, additional = false) => small
          ? SMALL_DOT_RADIUS + (additional ? 0.6 : uncertain ? 1.6 : 1)
          : MARKER_RADIUS * normal * group + (uncertain ? 3.2 : 2) * normal;
        const markers: ClickMarker[] = [];
        for (const site of sitesRef.current) {
          if (site.properties.id === expandedRef.current?.properties.id) continue;
          markers.push({ centre: instance.project(site.geometry.coordinates),
            radius: radius(site.properties.cams.every(smallWhiteMarker), groupMarkerFactor(site.properties.n), site.properties.u),
            target: { kind: "observed", site } });
        }
        for (const webcam of supplementaryRef.current) markers.push({ centre: instance.project(webcam.geometry.coordinates),
          radius: radius(true, 1, false, true), target: { kind: "supplementary", webcam } });
        const expandedSite = expandedRef.current;
        if (expandedSite) for (const point of expandedCameraPositions(expandedSite,
          coordinates => instance.project(coordinates), pixel => instance.unproject([pixel.x, pixel.y]).toArray())) {
          markers.push({ centre: instance.project(point.coordinates), radius: radius(smallWhiteMarker(point.camera), 1, point.camera.u),
            target: { kind: "observed", site: expandedSite, camera: point.camera } });
        }
        const hits = markersAtPoint(markers, event.point);
        if (hits.length === 1) { choose(hits[0]); return; }
        if (hits.length > 1) {
          const choices = webcamChoices(hits);
          if (choices.length === 1) { choose(choices[0]); return; }
          setChooser({ choices,
            left: Math.max(8, Math.min(event.point.x + 12, instance.getContainer().clientWidth - 308)),
            top: Math.max(8, Math.min(event.point.y + 12, instance.getContainer().clientHeight - 280)) });
          return;
        }
        setChooser(null);
        onExpandRef.current(null);
      });
      setReady(true);
    });
    return () => { resize.disconnect(); instance.remove(); map.current = null; setReady(false); };
  }, [configuration]);

  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    const features = [...allSites].sort((a, b) => a.properties.id.localeCompare(b.properties.id)).map((site, order) => {
      const icons: Record<string, string | boolean | number> = {};
      for (const altitude of ALTITUDE_BANDS) {
        const variant = siteForAltitude(site, altitude, parameter);
        if (!variant) continue;
        const properties = variant.properties;
        const sectors = siteSectors(variant, configuration.pie_sector_limit);
        const small = properties.cams.every(smallWhiteMarker);
        const group = groupMarkerFactor(properties.n);
        icons[`icon_${altitude}`] = markerSprite(instance, sectors, { small, group, uncertain: properties.u });
        icons[`factor_${altitude}`] = group;
        icons[`small_${altitude}`] = small;
      }
      return { type: "Feature" as const, geometry: site.geometry,
        properties: { id: site.properties.id, order, ...icons } };
    });
    (instance.getSource("sites") as GeoJSONSource).setData({ type: "FeatureCollection", features });
  }, [allSites, parameter, ready, configuration.pie_sector_limit]);

  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    const icon = markerSprite(instance, [{ lower: "#111111", upper: "#111111", ageing: false }], { small: true, supplementary: true });
    const features = [...allSupplementary].sort((a, b) => a.properties.id.localeCompare(b.properties.id)).map((feature, order) => ({
      ...feature, properties: { ...feature.properties, icon, order },
    }));
    (instance.getSource("supplementary") as GeoJSONSource).setData({ type: "FeatureCollection", features });
  }, [allSupplementary, ready]);

  // Toggle cached features/layers. No source replacement, map recreation, or HTTP request.
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    instance.setLayoutProperty("sites", "visibility", showObserved ? "visible" : "none");
    for (const layer of ["cameras", "camera-links"]) instance.setLayoutProperty(layer, "visibility", showObserved ? "visible" : "none");
    instance.setLayoutProperty("sites", "icon-image", ["coalesce", ["image", ["get", `icon_${altitudeBand}`]], ["image", ["get", "icon_all"]]]);
    const visibleSites: ExpressionSpecification = ["all", ["in", ["get", "id"], ["literal", sites.map(site => site.properties.id)]], ["!=", ["get", "id"], expanded?.properties.id ?? ""]];
    instance.setFilter("sites", visibleSites);
    instance.setLayoutProperty("sites", "icon-size", markerSize(markerScale(configuration.map.marker_scale), 1, `factor_${altitudeBand}`, `small_${altitudeBand}`));
    instance.setLayoutProperty("supplementary", "visibility", showSupplementary ? "visible" : "none");
    instance.setFilter("supplementary", ["in", ["get", "id"], ["literal", supplementary.map(item => item.properties.id)]]);
  }, [ready, sites, supplementary, altitudeBand, showObserved, showSupplementary, expanded, configuration.map.marker_scale]);

  useEffect(() => {
    if (ready && map.current) showBorderLayers(map.current, borders);
  }, [ready, borders]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const instance = map.current;
    const render = () => {
      const points = expanded ? expandedCameraPositions(expanded, coordinates => instance.project(coordinates),
        pixel => instance.unproject([pixel.x, pixel.y]).toArray()) : [];
      (instance.getSource("expanded-cameras") as GeoJSONSource).setData({ type: "FeatureCollection",
        features: [...points].sort((a, b) => a.camera.p.localeCompare(b.camera.p)).map(({ camera, coordinates }, order) => {
          const sectors = [cameraSector(camera)];
          const small = smallWhiteMarker(camera);
          const icon = markerSprite(instance, sectors, { small, uncertain: camera.u });
          return { type: "Feature" as const, geometry: { type: "Point" as const, coordinates },
            properties: { id: expanded!.properties.id, p: camera.p, icon, order, small } };
        }) });
      (instance.getSource("camera-links") as GeoJSONSource).setData({ type: "FeatureCollection",
        features: points.map(({ coordinates }) => ({ type: "Feature" as const, properties: {},
          geometry: { type: "LineString" as const, coordinates: [expanded!.geometry.coordinates, coordinates] } })) });
      let geometry = selectedSupplementary?.geometry ?? selected?.geometry ?? null;
      const selectedPoint = selected?.properties.id === expanded?.properties.id
        ? points.find(point => point.camera.p === selectedCameraId) : null;
      if (selectedPoint) geometry = { type: "Point", coordinates: selectedPoint.coordinates };
      const selection: FeatureCollection<Point> = { type: "FeatureCollection", features: geometry
        ? [{ type: "Feature", geometry, properties: {} }] : [] };
      (instance.getSource("selection") as GeoJSONSource).setData(selection);
    };
    render();
    if (expanded) instance.on("move", render);
    return () => { if (expanded) instance.off("move", render); };
  }, [ready, expanded, selected, selectedCameraId, selectedSupplementary]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const selection = expanded ?? selectedSupplementary ?? selected;
    if (selection && focusedId.current !== selection.properties.id) map.current.easeTo({ center: selection.geometry.coordinates,
      offset: [map.current.getContainer().clientWidth > 650 ? -185 : 0, 0], duration: 450 });
    focusedId.current = selection?.properties.id ?? null;
  }, [expanded, selected, selectedSupplementary, ready]);

  return <div className="map-wrap" aria-busy={!ready}>
    <div ref={container} className="map" aria-label="Webcam observation map" />
    <button className="map-home" title="Return to the initial map extent" onClick={() => map.current?.easeTo({
      center: configuration.map.center, zoom: configuration.map.zoom, duration: 600,
    })}>Reset view</button>
    {chooser && <OverlapMenu choices={chooser.choices} position={{ left: chooser.left, top: chooser.top }}
      onChoose={choose} onClose={() => setChooser(null)} />}
    {expanded && showObserved && <section className="camera-picker" aria-label="Cameras at selected site">
      <div className="panel-heading"><strong>{expanded.properties.n} webcam views</strong><button className="icon-button" aria-label="Collapse webcam group" onClick={() => onExpand(null)}>×</button></div>
      <div className="camera-choices">{expanded.properties.cams.map((camera, index) => <button key={camera.p}
        className={selected?.properties.id === expanded.properties.id && selectedCameraId === camera.p ? "active" : ""}
        aria-pressed={selected?.properties.id === expanded.properties.id && selectedCameraId === camera.p}
        onClick={() => onSelect(expanded, camera.p)}><span className="camera-choice-dot" style={{ background: classColour(camera.cls) }} />{index + 1}. {camera.name}</button>)}</div>
    </section>}
    {ready && <div className="map-visible-count" aria-label="Sites in map view">{visibleSites.toLocaleString()} sites in view</div>}
    {error && <div className="map-notice" role="status">{error}</div>}
  </div>;
}
