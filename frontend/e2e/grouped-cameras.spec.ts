import { expect, test } from "@playwright/test";

test("a grouped disc expands and both camera markers open their own provider images", async ({ page }) => {
  const now = new Date().toISOString();
  let mapRequests = 0;
  const camera = (p: string, name: string, cls: string, x = 2) => ({ p, name, cls, x, y: 47,
    altitude: 100, country: "FR", qs: 2, u: false, w: null, t: now, vl: null, vu: null, value: null });
  const north = camera("north", "North view", "snow.undifferentiated");
  const south = camera("south", "South view", "snow.none");
  const solo = camera("solo", "Single view", "snow.none", 4);
  await page.route("**/frontend-config.json", async route => {
    const configuration = await (await route.fetch()).json();
    await route.fulfill({ json: { ...configuration, map: { ...configuration.map, center: [2, 47], zoom: 5.5 } } });
  });
  await page.route("**/api/map?*", route => { mapRequests += 1; return route.fulfill({ json: { type: "FeatureCollection", parameter: "snow", at: now,
    qualified_only: true, counts: { sites: 2, cameras: 3 }, features: [
      { type: "Feature", geometry: { type: "Point", coordinates: [2, 47] }, properties: { id: "group", platform: "group",
        name: "Two-camera site", cams: [north, south], n: 2, cls: "snow.none", u: false, tie: true,
        pie: ["snow.undifferentiated", "snow.none"] } },
      { type: "Feature", geometry: { type: "Point", coordinates: [4, 47] }, properties: { id: "solo", platform: "solo",
        name: "Single-camera site", cams: [solo], n: 1, cls: "snow.none", u: false } },
    ] } }); });
  await page.route("**/api/supplementary-webcams", route => route.fulfill({ json: {
    type: "FeatureCollection", enabled: false, minimum_distance_metres: 250,
    counts: { csv_webcams: 0, visible: 0, now_near_database: 0 }, features: [],
  } }));
  await page.route("**/api/webcams/**", route => {
    const path = new URL(route.request().url()).pathname;
    const id = path.split("/")[3];
    const selected = id === "north" ? north : south;
    const provider = { page_url: `https://images.example.org/${id}`, image_url: `https://images.example.org/${id}.svg`,
      image_embeddable: true, available: true };
    return route.fulfill({ json: path.endsWith("/provider") ? provider : { processing_stream_id: id,
      source_stream_id: id, platform: "group", platform_name: "Two-camera site", name: selected.name,
      latitude: 47, longitude: 2, altitude: 100, country: "FR", provider_kind: null, tags: [], blacklisted: false,
      predictions: [], provider } });
  });
  await page.route("https://images.example.org/**", route => route.fulfill({ contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="steelblue"/></svg>' }));
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".map-wrap")).toHaveAttribute("aria-busy", "false");
  await page.getByRole("checkbox", { name: "Auto · 30 s" }).uncheck();
  const canvas = page.locator(".maplibregl-canvas");
  const box = (await canvas.boundingBox())!;
  await expect.poll(async () => await page.getByLabel("Sites in map view").textContent()).toBe("2 sites in view");
  await page.screenshot({ path: "test-results/grouped-marker-size.png", fullPage: true });
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  const picker = page.getByRole("region", { name: "Cameras at selected site" });
  await expect(picker.getByRole("button", { name: "1. North view" })).toBeVisible();
  await expect(picker.getByRole("button", { name: "2. South view" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Webcam details" })).toHaveCount(0);
  await page.waitForTimeout(600); // The group centres with a 450 ms map animation before camera clicks.
  const centreX = box.width / 2 + (box.width > 650 ? -185 : 0);
  await canvas.click({ position: { x: centreX, y: box.height / 2 - 17 } });
  const detail = page.getByRole("complementary", { name: "Webcam details" });
  await expect(detail.getByRole("img", { name: /^Current view from/ })).toHaveAttribute("src", "https://images.example.org/north.svg");
  await canvas.click({ position: { x: centreX, y: box.height / 2 + 17 } });
  await expect(detail.getByRole("img", { name: /^Current view from/ })).toHaveAttribute("src", "https://images.example.org/south.svg");
  await expect(detail.getByRole("combobox", { name: "Webcam", exact: true })).toHaveCount(0);
  await expect(picker.getByRole("button", { name: "2. South view" })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: "test-results/expanded-webcam-group.png", fullPage: true });
  await page.getByRole("button", { name: "Collapse webcam group" }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.getByLabel("Visible WEOW webcams").locator("strong")).toHaveText("3");
  expect(errors).toEqual([]);
  expect(mapRequests).toBe(1);
});
