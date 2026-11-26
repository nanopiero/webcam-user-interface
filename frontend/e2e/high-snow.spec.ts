import { expect, test } from "@playwright/test";

test("high snow is solid vivid violet in single and grouped markers, metadata and observation-specific histories", async ({ page }) => {
  const now = new Date().toISOString();
  const camera = (p: string, name: string, cls: string, x = 2) => ({ p, name, cls, x, y: 47,
    altitude: 100, country: "FR", qs: 2, u: false, w: null, t: now, vl: null, vu: null, value: null });
  const high = camera("high", "High view", "snow.high");
  const undifferentiated = camera("undifferentiated", "Undifferentiated view", "snow.undifferentiated");
  const solo = camera("solo", "Single high view", "snow.high", 4);
  const points = [1, 1, 10, 31].map((snow_class, index) => ({ id: index + 1,
    t: new Date(Date.now() - (4 - index) * 300000).toISOString(), lower: 1, upper: 2, snow_class,
    snow_qualification: 2, snow_threshold_low: index ? -2.5 : null, snow_threshold_high: index ? 0 : null,
    calibrated_lower: null, calibrated_upper: null, calibrated_center: null,
    model_version: "example", postprocessing_version: null, quality_code: 0 }));
  await page.route("**/frontend-config.json", async route => {
    const config = await (await route.fetch()).json();
    await route.fulfill({ json: { ...config, map: { ...config.map, center: [2, 47], zoom: 5.5 } } });
  });
  await page.route("**/api/map?*", route => route.fulfill({ json: { type: "FeatureCollection", parameter: "snow", at: now,
    counts: { sites: 2, cameras: 3 }, features: [
      { type: "Feature", geometry: { type: "Point", coordinates: [2, 47] }, properties: { id: "group", platform: "group",
        name: "Snow comparison", cams: [high, undifferentiated], n: 2, cls: "snow.high", u: false,
        tie: true, pie: ["snow.high", "snow.undifferentiated"] } },
      { type: "Feature", geometry: { type: "Point", coordinates: [4, 47] }, properties: { id: "solo", platform: "solo",
        name: solo.name, cams: [solo], n: 1, cls: "snow.high", u: false } },
    ] } }));
  await page.route("**/api/supplementary-webcams", route => route.fulfill({ json: {
    type: "FeatureCollection", enabled: false, counts: { csv_webcams: 0, visible: 0, now_near_database: 0 }, features: [],
  } }));
  const provider = { page_url: "https://images.example.org/high", image_url: "https://images.example.org/high.svg", image_embeddable: true, available: true };
  await page.route("**/api/webcams/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/history")) return route.fulfill({ json: { processing_stream_id: "high", parameter: "snow",
      intervals: points, without_raw_interval: [], truncated: false, next_cursor: null } });
    return route.fulfill({ json: path.endsWith("/provider") ? provider : { processing_stream_id: "high",
      source_stream_id: "high", platform: "group", platform_name: "Snow comparison", name: high.name,
      latitude: 47, longitude: 2, altitude: 100, country: "FR", provider_kind: null, tags: [], blacklisted: false,
      predictions: [{ parameter: "snow", download_timestamp: now, snow_class: 31, snow_qualification: 2,
        processing_timestamp: "2026-11-17T10:00:02Z", received_at: "2026-11-17T10:00:05Z",
        snow_raw_lower: 1, snow_raw_upper: 2, snow_threshold_low: -2.5, snow_threshold_high: 0 }], provider } });
  });
  await page.route("https://images.example.org/**", route => route.fulfill({ contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="steelblue"/></svg>' }));
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && /layers\.|source.*sites/i.test(message.text())) errors.push(message.text()); });
  await page.goto("/");
  await expect(page.locator(".map-wrap")).toHaveAttribute("aria-busy", "false");
  await page.getByRole("checkbox", { name: "Auto · 30 s" }).uncheck();
  await expect(page.getByLabel("Sites in map view")).toHaveText("2 sites in view");
  const legend = page.getByRole("complementary", { name: "Map colour legend" });
  await expect(legend.getByText("High snow cover", { exact: true })).toBeVisible();
  await expect(legend.getByText("Undifferentiated snow cover", { exact: true })).toBeVisible();
  const canvas = page.locator(".maplibregl-canvas");
  const screenshot = await canvas.screenshot();
  const violetPixels = await page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    return [2, 4].map(longitude => {
      const centre = Math.round(canvas.width / 2 + (longitude - 2) * 512 * 2 ** 5.5 / 360);
      let count = 0;
      for (let y = Math.floor(canvas.height / 2) - 15; y <= canvas.height / 2 + 15; y++) {
        for (let x = centre - 15; x <= centre + 15; x++) {
          const offset = (y * canvas.width + x) * 4;
          if (Math.abs(pixels[offset] - 208) < 20 && pixels[offset + 1] < 20 && pixels[offset + 2] > 235) count++;
        }
      }
      return count;
    });
  }, screenshot.toString("base64"));
  expect(violetPixels.every(count => count > 40)).toBeTruthy();
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  const picker = page.getByRole("region", { name: "Cameras at selected site" });
  await expect(picker.getByRole("button", { name: "1. High view" }).locator("span")).toHaveCSS("background-color", "rgb(208, 0, 255)");
  await expect(picker.getByRole("button", { name: "1. High view" }).locator("span")).toHaveCSS("background-image", "none");
  await picker.getByRole("button", { name: "1. High view" }).click();
  const detail = page.getByRole("complementary", { name: "Webcam details" });
  await expect(detail.getByText("High snow cover · uncertain", { exact: true })).toBeVisible();
  await expect(detail.locator('dt:has-text("Processed") + dd')).toHaveText("2026-11-17 10:00:02 UTC");
  await expect(detail.locator('dt:has-text("UI backend reception") + dd')).toHaveText("2026-11-17 10:00:05 UTC");
  await expect(detail.locator('dt:has-text("Lower snow threshold") + dd')).toHaveText("-2.5");
  await expect(detail.locator('dt:has-text("Upper snow threshold") + dd')).toHaveText("0");
  await detail.getByRole("button", { name: "Open snow history" }).click();
  const history = page.getByRole("article").filter({ hasText: "Snow history" });
  await expect(history.locator(".chart-footer")).toContainText("4 observations");
  const chart = history.getByRole("img");
  await chart.focus(); await page.keyboard.press("Home");
  await expect(history.locator(".chart-readout")).toContainText("Class: Undifferentiated snow");
  await expect(history.locator(".chart-readout")).toContainText("Upper snow threshold: Not supplied");
  await page.keyboard.press("ArrowRight");
  await expect(history.locator(".chart-readout")).toContainText("Class: High snow cover");
  await expect(history.locator(".chart-readout")).toContainText("Upper snow threshold: 0");
  await page.keyboard.press("End");
  await expect(history.locator(".chart-readout")).toContainText("Class: High snow cover · uncertain");
  await page.screenshot({ path: "test-results/high-snow-classes.png", fullPage: true });
  await history.getByRole("button", { name: "Raw model interval" }).click();
  await chart.focus(); await page.keyboard.press("End");
  await expect(history.locator(".chart-readout")).toContainText("Lower snow threshold: -2.5");
  await expect(history.locator(".chart-note")).toContainText("violet ticks show the upper threshold");
  await page.screenshot({ path: "test-results/high-snow-thresholds.png", fullPage: true });
  expect(errors).toEqual([]);
});
