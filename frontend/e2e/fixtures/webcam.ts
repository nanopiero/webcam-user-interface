import type { Page } from "@playwright/test";

export async function chartFixture(page: Page, empty = false, olderDay = false) {
  const now = Math.floor(Date.now() / 60000) * 60000;
  const at = new Date(now).toISOString();
  const stamps = [8, 6, 4, 2, 1, 0.5].map(hours => new Date(now - hours * 3600000).toISOString());
  const base = { lower: -4, upper: -2, snow_class: null, snow_threshold_low: null, snow_threshold_high: null,
    calibrated_lower: null, calibrated_upper: null, calibrated_center: null,
    model_version: "example-model", postprocessing_version: "example-postprocessing", quality_code: 0 };
  const snow = [
    { ...base, snow_class: 1 },
    { ...base, snow_class: 10, snow_threshold_low: -1 },
    { ...base, snow_class: 1, snow_threshold_low: -1, snow_threshold_high: 0 },
    { ...base, snow_class: 31, snow_threshold_low: -0.5, snow_threshold_high: 0.5 },
    { ...base, lower: null, upper: null },
    { ...base, lower: null, upper: null, snow_class: 10, snow_threshold_low: 0, snow_threshold_high: 1 },
  ].map((point, index) => ({ ...point, id: index + 1, t: stamps[index] }));
  if (olderDay) snow.push({ ...base, id: 7, t: new Date(now - 36 * 3600000).toISOString(), snow_class: 10 });
  const visibility = [
    { ...base, calibrated_lower: 1000, calibrated_upper: 3000, calibrated_center: 1800 },
    { ...base },
    { ...base, calibrated_lower: 5000, calibrated_upper: 8000 },
    { ...base, calibrated_lower: 20000, calibrated_upper: 90000, calibrated_center: 45000 },
    { ...base, lower: null, upper: null },
    { ...base, calibrated_lower: 0, calibrated_upper: 1000, calibrated_center: 0 },
  ].map((point, index) => ({ ...point, id: index + 1, t: stamps[index] }));
  let historyRequests = 0;
  const requestedRanges: { start: string; end: string }[] = [];
  await page.route("**/frontend-config.json", async route => {
    const configuration = await (await route.fetch()).json();
    await route.fulfill({ json: { ...configuration, map: { ...configuration.map, center: [2, 47], zoom: 5.5 } } });
  });
  await page.route("**/api/map?*", route => {
    const params = new URL(route.request().url()).searchParams;
    const camera = { p: "chart-camera", name: "Chart camera", x: 2, y: 47, altitude: 100, country: "FR", qs: 2,
      cls: "snow.high", u: false, w: null, t: at, vl: 1000, vu: 3000, value: 1800 };
    return route.fulfill({ json: { type: "FeatureCollection", parameter: params.get("parameter"), at: params.get("at") ?? at,
      counts: { sites: 1, cameras: 1 }, features: [{ type: "Feature", geometry: { type: "Point", coordinates: [2, 47] },
        properties: { id: "chart-site", platform: "chart-site", name: "Chart site", cams: [camera], n: 1, cls: camera.cls, u: false } }] } });
  });
  await page.route("**/api/supplementary-webcams", route => route.fulfill({ json: { type: "FeatureCollection", enabled: false,
    counts: { csv_webcams: 0, visible: 0, now_near_database: 0 }, features: [] } }));
  await page.route("**/api/webcams/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/history")) {
      historyRequests++;
      const start = url.searchParams.get("start")!, end = url.searchParams.get("end")!;
      requestedRanges.push({ start, end });
      const points = (empty ? [] : url.searchParams.get("parameter") === "snow" ? snow : visibility)
        .filter(point => Date.parse(point.t) >= Date.parse(start) && Date.parse(point.t) <= Date.parse(end));
      return route.fulfill({ json: { processing_stream_id: "chart-camera", parameter: url.searchParams.get("parameter"),
        intervals: points.filter(point => point.lower != null), without_raw_interval: points.filter(point => point.lower == null),
        truncated: false, next_cursor: null } });
    }
    const provider = { page_url: "https://example.org/webcam", image_url: null, available: false, image_embeddable: false };
    return route.fulfill({ json: url.pathname.endsWith("/provider") ? provider : { processing_stream_id: "chart-camera",
      derived_stream_id: "derived", source_stream_id: "source", platform: "chart-site", platform_name: "Chart site",
      name: "Chart camera", latitude: 47, longitude: 2, altitude: 100, country: "FR", provider_kind: null,
      tags: [], blacklisted: false, predictions: [], provider } });
  });
  await page.goto("/");
  await page.locator('.refresh-controls input[type="checkbox"]').uncheck();
  await page.locator("#webcam-search").fill("chart-site");
  await page.locator(".search-results button").first().click();
  return { at, stamps, requestedRanges, requests: () => historyRequests };
}
