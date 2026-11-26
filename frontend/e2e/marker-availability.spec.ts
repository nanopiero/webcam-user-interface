import { expect, test } from "@playwright/test";

test("missing snow observations use CSV-sized white dots while recent unqualified observations stay large", async ({ page }) => {
  const now = new Date().toISOString();
  const cases = [
    { p: "missing", x: -2, w: "no_record", qs: null, t: null },
    { p: "stale", x: 0, w: "stale", qs: 0, t: "2026-01-01T00:00:00Z" },
    { p: "incomplete", x: 2, w: "scene_unqualified", qs: 1, t: now },
    { p: "unknown", x: 4, w: "qualification_unknown", qs: null, t: now },
  ];
  const features = cases.map(item => ({ type: "Feature", geometry: { type: "Point", coordinates: [item.x, 47] },
    properties: { id: item.p, platform: item.p, name: item.p, n: 1, cls: "white", u: false,
      cams: [{ ...item, name: item.p, y: 47, altitude: 100, country: "FR", cls: "white", u: false,
        vl: null, vu: null, value: null }] } }));
  await page.route("**/frontend-config.json", async route => {
    const config = await (await route.fetch()).json();
    await route.fulfill({ json: { ...config, map: { ...config.map, center: [2, 47], zoom: 5.5 } } });
  });
  await page.route("**/api/map?*", route => route.fulfill({ json: { type: "FeatureCollection",
    parameter: "snow", at: now, qualified_only: true, counts: { sites: 4, cameras: 4 }, features } }));
  await page.route("**/api/supplementary-webcams", route => route.fulfill({ json: {
    type: "FeatureCollection", enabled: true, minimum_distance_metres: 250,
    counts: { csv_webcams: 1, visible: 1, now_near_database: 0 }, features: [{ type: "Feature",
      geometry: { type: "Point", coordinates: [6, 47] },
      properties: { id: "csv", name: "CSV webcam", altitude: 100, source_layer_name: "Example" } }],
  } }));
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && /layers\.|source.*sites/i.test(message.text())) errors.push(message.text());
  });
  await page.goto("/");
  await expect(page.locator(".map-wrap")).toHaveAttribute("aria-busy", "false");
  await page.getByRole("checkbox", { name: "Auto · 30 s" }).uncheck();
  await expect(page.getByLabel("Sites in map view")).toHaveText("5 sites in view");
  await page.waitForTimeout(200); // Present the final WebGL frame before measuring the rendered discs.
  const screenshot = await page.locator(".maplibregl-canvas").screenshot();
  const widths = await page.evaluate(async base64 => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const width = (longitude: number, black = false) => {
      const x = Math.round(canvas.width / 2 + (longitude - 2) * 512 * 2 ** 5.5 / 360);
      const y = Math.floor(canvas.height / 2);
      const matches = (column: number) => {
        const offset = (y * canvas.width + column) * 4;
        const rgb = [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
        return black ? rgb.every(value => value < 60) : rgb.every(value => value > 245);
      };
      let left = x, right = x;
      while (left > x - 30 && matches(left - 1)) left--;
      while (right < x + 30 && matches(right + 1)) right++;
      return matches(x) ? right - left + 1 : 0;
    };
    return { missing: width(-2), stale: width(0), incomplete: width(2), unknown: width(4), csv: width(6, true) };
  }, screenshot.toString("base64"));
  for (const width of [widths.missing, widths.stale, widths.csv]) {
    expect(width).toBeGreaterThanOrEqual(4);
    expect(width).toBeLessThanOrEqual(8);
  }
  expect(widths.incomplete).toBeGreaterThan(widths.stale * 1.5);
  expect(widths.unknown).toBeGreaterThan(widths.missing * 1.5);
  await page.screenshot({ path: "test-results/white-marker-availability.png", fullPage: true });
  expect(errors).toEqual([]);
});
