import { expect, test, type Locator, type Page } from "@playwright/test";

async function chartFixture(page: Page, empty = false, olderDay = false) {
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
  await page.getByRole("checkbox", { name: "Auto · 30 s" }).uncheck();
  await page.getByRole("searchbox", { name: "Find a webcam" }).fill("chart-site");
  await page.getByLabel("Webcam search results").getByRole("button").click();
  return { at, stamps, requestedRanges, requests: () => historyRequests };
}

async function windowOf(chart: Locator) {
  return chart.evaluate(element => [Number((element as HTMLElement).dataset.windowStart), Number((element as HTMLElement).dataset.windowEnd)]);
}

async function hoverPaintedInterval(page: Page, chart: Locator, calibrated = false) {
  await chart.scrollIntoViewIfNeeded();
  const pixel = await chart.evaluate((element, calibrated) => {
    const canvas = element.querySelector("canvas")!, pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let x = 0; x < canvas.width; x++) {
      const hits: number[] = [];
      for (let y = 0; y < canvas.height; y++) {
        const offset = (y * canvas.width + x) * 4, [r, g, b] = pixels.slice(offset, offset + 3);
        if (calibrated ? r > g + 30 && g > b + 30 : b > r + 50 && g > r + 30) hits.push(y);
      }
      if (hits.length > 5) return { x: x * canvas.clientWidth / canvas.width,
        y: ((hits[0] + hits.at(-1)!) / 2) * canvas.clientHeight / canvas.height };
    }
    return null;
  }, calibrated);
  expect(pixel).not.toBeNull();
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + pixel!.x, box.y + pixel!.y);
}

test("Dygraphs snow classes, raw thresholds, zoom and map-time guide use published history without extra requests", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const fixture = await chartFixture(page);
  await page.getByRole("button", { name: "Open snow history" }).click();
  const history = page.getByRole("article").filter({ hasText: "Snow history" });
  const chart = history.getByRole("img");
  await expect(history.locator(".chart-footer")).toContainText("6 observations");
  await expect(chart.locator("canvas").first()).toBeVisible();
  await expect(chart.locator(".dygraph-y2label")).toHaveCount(0);
  await expect(history.locator(".chart-keys")).not.toContainText("snow threshold");
  await expect(chart.locator(".dygraph-rangesel-zoomhandle")).toHaveCount(0);
  expect((await chart.boundingBox())!.height).toBeLessThan(180);
  const mapBox = (await page.locator(".map-wrap").boundingBox())!;
  const chartBox = (await chart.boundingBox())!;
  expect(mapBox.y).toBeGreaterThanOrEqual(0);
  expect(chartBox.y + chartBox.height).toBeLessThan(1000);
  await expect(history.locator(".chart-map-time")).toBeVisible();
  await chart.focus(); await page.keyboard.press("Home");
  await expect(history.locator(".chart-readout")).toContainText("Class: Undifferentiated snow");
  await page.keyboard.press("ArrowRight");
  await expect(history.locator(".chart-readout")).not.toContainText("snow threshold:");
  await page.keyboard.press("ArrowRight");
  await expect(history.locator(".chart-readout")).toContainText("Class: High snow cover");
  await page.screenshot({ path: "test-results/dygraphs-snow-classes.png", fullPage: true });
  const original = await windowOf(chart), span = original[1] - original[0];
  await history.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect.poll(async () => { const range = await windowOf(chart); return range[1] - range[0]; }).toBeLessThan(span * 0.6);
  await history.getByRole("button", { name: "Zoom out", exact: true }).click();
  await expect.poll(async () => { const range = await windowOf(chart); return range[1] - range[0]; }).toBeGreaterThan(span * 0.9);
  await chart.scrollIntoViewIfNeeded();
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.35, box.y + 70);
  await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.7, box.y + 70, { steps: 10 }); await page.mouse.up();
  await expect.poll(async () => { const range = await windowOf(chart); return range[1] - range[0]; }).toBeLessThan(span * 0.8);
  await history.getByRole("button", { name: "Reset view", exact: true }).click();
  await expect.poll(async () => { const range = await windowOf(chart); return range[1] - range[0]; }).toBeGreaterThan(span * 0.99);
  // Move the map guide inside an already zoomed chart. Its zoom and loaded history stay intact.
  await history.getByRole("button", { name: "Zoom in", exact: true }).click();
  const zoomed = await windowOf(chart);
  const selected = new Date((zoomed[0] + zoomed[1]) / 2).toISOString().slice(0, 16);
  await page.getByLabel("Map time (UTC)").fill(selected);
  await page.getByRole("button", { name: "View time", exact: true }).click();
  await expect(history.locator(".chart-map-time")).toHaveAttribute("data-map-time", String(Date.parse(`${selected}Z`)));
  await expect(history.locator(".chart-map-time")).toBeVisible();
  expect(await windowOf(chart)).toEqual(zoomed);
  expect(fixture.requests()).toBe(1);
  await history.getByRole("button", { name: "Raw model interval" }).click();
  await chart.focus(); await page.keyboard.press("End");
  await expect(history.locator(".chart-readout")).toContainText("Lower snow threshold: 0");
  await expect(history.locator(".chart-readout")).toContainText("Interval: Not published");
  await expect(history.locator(".chart-note")).toContainText("Missing thresholds leave gaps");
  await page.screenshot({ path: "test-results/dygraphs-snow-raw.png", fullPage: true });
  expect(fixture.requests()).toBe(1);
  expect(errors).toEqual([]);
});

test("Dygraphs raw/calibrated visibility preserves exact centres, missing values and mobile zoom", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const fixture = await chartFixture(page);
  await page.getByRole("button", { name: "Open visibility history" }).click();
  const history = page.getByRole("article").filter({ hasText: "Visibility history" });
  const chart = history.getByRole("img");
  await expect(chart.locator("canvas").first()).toBeVisible();
  await hoverPaintedInterval(page, chart);
  await expect(page.getByRole("tooltip")).toContainText("Interval: -4 – -2");
  await expect(page.getByRole("tooltip").getByText(/^Interval:/)).toHaveText("Interval: -4 – -2");
  await chart.focus(); await page.keyboard.press("Home");
  await expect(history.locator(".chart-readout")).toContainText("Interval: -4 – -2");
  await history.getByRole("button", { name: "Calibrated · m" }).click();
  await hoverPaintedInterval(page, chart, true);
  await expect(page.getByRole("tooltip")).toContainText("Interval: 1,000 – 3,000 m");
  await expect(page.getByRole("tooltip")).toContainText("Published centre: 1,800 m");
  await chart.focus(); await page.keyboard.press("Home");
  await expect(history.locator(".chart-readout")).toContainText("Published centre: 1,800 m");
  await page.keyboard.press("ArrowRight");
  await expect(history.locator(".chart-readout")).toContainText("Interval: Not published");
  await page.keyboard.press("ArrowRight");
  await expect(history.locator(".chart-readout")).toContainText("Published centre: Not supplied");
  await page.keyboard.press("ArrowRight");
  await expect(history.locator(".chart-readout")).toContainText("20,000 – 90,000 m");
  await expect(history.locator(".chart-readout")).toContainText("Published centre: 45,000 m");
  await page.keyboard.press("End");
  await expect(history.locator(".chart-readout")).toContainText("Published centre: 0 m");
  await page.screenshot({ path: "test-results/dygraphs-visibility-calibrated.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await chart.scrollIntoViewIfNeeded();
  await history.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(history.locator(".chart-map-time")).toBeHidden();
  await expect(history.locator(".chart-keys")).toContainText("outside visible range");
  await history.getByRole("button", { name: "Reset view", exact: true }).click();
  await expect(history.locator(".chart-map-time")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: "test-results/dygraphs-mobile.png", fullPage: true });
  expect(fixture.requests()).toBe(1);
  expect(errors).toEqual([]);
});

test("Earlier/Later retrieve preceding days and double-click restores the selected period and zoom", async ({ page }) => {
  const fixture = await chartFixture(page, false, true);
  await page.getByRole("button", { name: "Open snow history" }).click();
  const history = page.getByRole("article").filter({ hasText: "Snow history" });
  const chart = history.getByRole("img");
  await expect(history.getByRole("combobox", { name: "History time range" })).toHaveValue("7");
  await expect(history.locator(".chart-footer")).toContainText("7 observations");
  await expect(history.locator(".chart-readout")).toHaveText("The black vertical line marks the selected map date and time.");
  await expect(history.getByText(/Hover (an interval|a class dot)/)).toHaveCount(0);
  expect(Date.parse(fixture.requestedRanges[0].end) - Date.parse(fixture.requestedRanges[0].start)).toBe(7 * 86400000);
  await expect(history.getByLabel("From (UTC)")).toHaveCount(0);
  await history.getByRole("combobox", { name: "History time range" }).selectOption("1");
  await expect(history.locator(".chart-footer")).toContainText("6 observations");
  const original = fixture.requestedRanges.at(-1)!;
  await history.getByRole("button", { name: "Earlier period" }).click();
  await expect(history.locator(".chart-footer")).toContainText("1 observations");
  await history.getByRole("img").focus(); await page.keyboard.press("Home");
  await expect(history.locator(".chart-readout")).toContainText("Class: Intermediate snow cover");
  await history.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect.poll(async () => { const range = await windowOf(chart); return range[1] - range[0]; }).toBeLessThan(86400000);
  await chart.dblclick({ position: { x: 240, y: 55 } });
  await expect(history.locator(".chart-footer")).toContainText("6 observations");
  await expect.poll(() => windowOf(chart)).toEqual([Date.parse(original.start), Date.parse(original.end)]);
  expect(fixture.requestedRanges.at(-1)).toEqual(original);
  await expect(history.getByRole("combobox", { name: "History time range" })).toHaveValue("1");
  // A later move from a different earlier period is cancelled by the same gesture.
  await history.getByRole("button", { name: "Earlier period" }).click();
  await expect(history.locator(".chart-footer")).toContainText("1 observations");
  await history.getByRole("button", { name: "Earlier period" }).click();
  await expect(history.locator(".chart-footer")).toContainText("0 observations");
  await history.getByRole("button", { name: "Later period" }).click();
  await expect(history.locator(".chart-footer")).toContainText("1 observations");
  await chart.dblclick({ position: { x: 240, y: 55 } });
  await expect(history.locator(".chart-footer")).toContainText("6 observations");
  expect(fixture.requestedRanges.at(-1)).toEqual(original);
  await history.getByRole("button", { name: "Dates", exact: true }).click();
  await expect(history.getByLabel("From (UTC)")).toBeVisible();
  expect(fixture.requests()).toBe(8);
});

test("empty Dygraphs histories keep the map-time guide and zoom controls without inventing results", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await chartFixture(page, true);
  await page.getByRole("button", { name: "Open snow history" }).click();
  const history = page.getByRole("article").filter({ hasText: "Snow history" });
  await expect(history.locator(".chart-footer")).toContainText("0 observations");
  await expect(history.locator(".chart-keys")).not.toContainText("snow threshold");
  await expect(history.locator(".chart-map-time")).toBeVisible();
  await history.getByRole("button", { name: "Zoom in", exact: true }).click();
  await history.getByRole("button", { name: "Reset view", exact: true }).click();
  await history.getByRole("button", { name: "Raw model interval" }).click();
  await expect(history.locator(".chart-keys")).toContainText("No thresholds published");
  await expect(history.getByRole("img").locator("canvas").first()).toBeVisible();
  expect(errors).toEqual([]);
});
