import { expect, test, type Page } from "@playwright/test";

async function mapConfiguration(page: Page) {
  await page.route("**/frontend-config.json", async route => {
    const config = await (await route.fetch()).json();
    await route.fulfill({ json: { ...config, default_parameter: "snow",
      map: { ...config.map, center: [2, 47], zoom: 5.5 } } });
  });
  await page.route("https://images.example.org/**", route => route.fulfill({ contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" fill="steelblue"/></svg>' }));
}

async function clickCentre(page: Page, count: number) {
  await page.goto("/");
  await expect(page.getByLabel("Sites in map view")).toHaveText(`${count} sites in view`);
  await page.getByRole("checkbox", { name: "Auto · 30 s" }).uncheck();
  const canvas = page.locator(".maplibregl-canvas");
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
}

for (const [kind, brand] of [["windy", "Windy"], ["skaping", "Skaping"], ["fintraffic", "Fintraffic"]]) {
  test(`${brand} popup has one title, local logo, published tags and clearly labelled stream IDs`, async ({ page }) => {
    await mapConfiguration(page);
    const now = new Date().toISOString();
    const camera = { p: "camera", name: "Example camera", x: 2, y: 47, altitude: 100, country: "FR", qs: 2,
      cls: "snow.none", u: false, w: null, t: now, vl: null, vu: null, value: null };
    await page.route("**/api/map?*", route => route.fulfill({ json: { type: "FeatureCollection", parameter: "snow",
      at: now, counts: { sites: 1, cameras: 1 }, features: [{ type: "Feature", geometry: { type: "Point", coordinates: [2, 47] },
        properties: { id: "site", platform: "example", name: "Example site", n: 1, cls: camera.cls, u: false, cams: [camera] } }] } }));
    await page.route("**/api/supplementary-webcams", route => route.fulfill({ json: { type: "FeatureCollection",
      enabled: false, counts: { csv_webcams: 0, visible: 0, now_near_database: 0 }, features: [] } }));
    const provider = { page_url: `https://${kind}.example.org/webcam`, image_url: "https://images.example.org/current.svg",
      available: true, image_embeddable: true };
    await page.route("**/api/webcams/**", route => route.fulfill({ json: route.request().url().includes("/provider")
      ? provider : { processing_stream_id: "camera", derived_stream_id: "local-derived-id", source_stream_id: "published-source",
        derived_suffix: "t0", processing_suffix: "p0s2v0", platform: "example", platform_name: "Example site",
        name: camera.name, latitude: 47, longitude: 2, altitude: 100, country: "FR", provider_kind: kind,
        tags: ["mountain", "outdoor"], blacklisted: false, predictions: [], provider } }));
    await clickCentre(page, 1);
    const popup = page.getByRole("complementary", { name: "Webcam details" });
    await expect(popup.getByRole("heading", { name: "Example camera", exact: true })).toBeVisible();
    await expect(popup.getByText("Example camera", { exact: true })).toHaveCount(1);
    const logo = popup.getByRole("img", { name: `${brand} logo` });
    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute("src", new RegExp(`^/assets/${kind}-`));
    await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBeTruthy();
    await expect(popup.getByRole("img", { name: "Current view from Example camera" })).toBeVisible();
    await expect(popup.getByText(/An exact match to the processed observation is not verified/)).toBeVisible();
    await popup.getByText("Tags (2) and stream identifiers", { exact: true }).click();
    await expect(popup.getByText("mountain", { exact: true })).toBeVisible();
    await expect(popup.locator('dt:has-text("Published derived suffix") + dd')).toHaveText("t0");
    await expect(popup.locator('dt:has-text("Published processing suffix") + dd')).toHaveText("p0s2v0");
    await expect(popup.locator('dt:has-text("UI derived stream ID") + dd')).toHaveText("local-derived-id");
    await expect(popup.locator('dt:has-text("UI processing stream ID") + dd')).toHaveText("camera");
    await page.screenshot({ path: `test-results/${kind}-popup-metadata.png`, fullPage: true });
  });
}

test("additional webcam popup shows the Météo Centre logo and one provider-page link", async ({ page }) => {
  await mapConfiguration(page);
  await page.route("**/api/map?*", route => route.fulfill({ json: { type: "FeatureCollection", parameter: "snow",
    at: new Date().toISOString(), counts: { sites: 0, cameras: 0 }, features: [] } }));
  const pageURL = "https://www.meteo-centre.fr/webcam/example/";
  await page.route("**/api/supplementary-webcams", route => route.fulfill({ json: { type: "FeatureCollection", enabled: true,
    counts: { csv_webcams: 1, visible: 1, now_near_database: 0 }, features: [{ type: "Feature", geometry: { type: "Point", coordinates: [2, 47] },
      properties: { id: "additional", name: "Additional view", altitude: 100, source_layer_name: "Example" } }] } }));
  await page.route("**/api/supplementary-webcams/**", route => route.fulfill({ json: route.request().url().includes("/provider")
    ? { page_url: pageURL, media: [{ kind: "image", url: "https://images.example.org/current.svg" }] }
    : { id: "additional", name: "Additional view", latitude: 47, longitude: 2, altitude: 100,
      altitude_source: null, provider_url: pageURL, links: [pageURL], description: "", metadata: {},
      source_layer_name: "Example", source_map_name: "uMap", source_map_url: null, exported_at: null } }));
  await clickCentre(page, 1);
  const popup = page.getByRole("complementary", { name: "Supplementary webcam details" });
  const logo = popup.getByRole("img", { name: "Météo Centre logo" });
  await expect(logo).toBeVisible();
  await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBeTruthy();
  await expect(popup.getByRole("link", { name: "Open provider webcam ↗" })).toHaveCount(1);
  expect(await popup.locator("a").evaluateAll((links, url) => links.filter(link => link.href === url).length, pageURL)).toBe(1);
  await page.screenshot({ path: "test-results/meteo-centre-popup.png", fullPage: true });
});
