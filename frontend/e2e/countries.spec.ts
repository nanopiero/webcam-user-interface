import { expect, test, type Page } from "@playwright/test";

async function configure(page: Page, name: string, countries: string[]) {
  await page.route("**/frontend-config.json", async route => {
    const configuration = await (await route.fetch()).json();
    await route.fulfill({ json: { ...configuration, countries: ["FR", "DE", "BE"], roi: { name, countries },
      map: { ...configuration.map, center: [5, 49], zoom: 5 } } });
  });
  await page.route("**/api/supplementary-webcams", route => route.fulfill({ json: {
    type: "FeatureCollection", enabled: false, minimum_distance_metres: 250,
    counts: { csv_webcams: 0, visible: 0, now_near_database: 0 }, features: [],
  } }));
}

test("France starts alone, neighbours are loaded on demand, and manual/automatic refresh update all selected countries", async ({ page }) => {
  await page.clock.install();
  await configure(page, "France", ["FR"]);
  let generation = 0;
  const requests: URL[] = [];
  await page.route("**/api/map?*", route => {
    const url = new URL(route.request().url());
    requests.push(url);
    const selected = new Set(url.searchParams.get("countries")?.split(","));
    const cameras = [
      { p: "fr", country: "FR", altitude: 100, x: 2, y: 47 },
      { p: "de-low", country: "DE", altitude: 200, x: 7, y: 49 },
      { p: "de-high", country: "DE", altitude: 1200, x: 8, y: 50 },
      ...Array.from({ length: generation }, (_, index) => [
        { p: `fr-new-${index}`, country: "FR", altitude: 300, x: 3 + index * 0.2, y: 48 },
        { p: `de-new-${index}`, country: "DE", altitude: 400, x: 8 + index * 0.2, y: 49 },
      ]).flat(),
    ].filter(camera => selected.has(camera.country));
    return route.fulfill({ json: { type: "FeatureCollection", parameter: "snow", at: new Date().toISOString(),
      counts: { sites: cameras.length, cameras: cameras.length },
      features: cameras.map(camera => ({ type: "Feature", geometry: { type: "Point", coordinates: [camera.x, camera.y] },
        properties: { id: camera.p, platform: camera.p, name: camera.p, n: 1, cls: "snow.none", u: false,
          cams: [{ ...camera, name: camera.p, cls: "snow.none", u: false, w: null, t: null, vl: null, vu: null, value: null }] } })),
    } });
  });
  await page.goto("/");
  await expect(page.locator(".map-wrap")).toHaveAttribute("aria-busy", "false");
  await page.getByRole("checkbox", { name: "Auto · 30 s" }).uncheck();
  const visible = page.getByLabel("Visible WEOW webcams").locator("strong");
  const bordering = page.getByRole("checkbox", { name: "Show bordering webcams" });
  await expect(visible).toHaveText("1");
  expect(requests).toHaveLength(1);
  expect(requests[0].searchParams.get("countries")).toBe("FR");
  expect(requests[0].searchParams.get("include_unknown_country")).toBe("false");
  await expect(bordering).not.toBeChecked();
  await expect(page.locator(".country-filter").getByRole("checkbox")).toHaveCount(1);
  await expect(page.locator(".country-filter").getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "French regions & departments" })).toBeVisible();
  await page.locator(".maplibregl-canvas").evaluate(element => { element.dataset.mapInstance = "original"; });
  await bordering.check();
  await expect(visible).toHaveText("3");
  expect(requests).toHaveLength(2);
  await bordering.uncheck();
  await expect(visible).toHaveText("1");
  await bordering.check();
  await expect(visible).toHaveText("3");
  expect(requests).toHaveLength(2);
  await page.getByRole("button", { name: "Below 500 m", exact: true }).click();
  await expect(visible).toHaveText("2");
  generation = 1;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(visible).toHaveText("4");
  expect(new Set(requests.at(-1)!.searchParams.get("countries")!.split(","))).toEqual(new Set(["FR", "DE", "BE"]));
  await expect(bordering).toBeChecked();
  await expect(page.getByRole("button", { name: "Below 500 m", exact: true })).toHaveAttribute("aria-pressed", "true");
  generation = 2;
  await page.getByRole("checkbox", { name: "Auto · 30 s" }).check();
  await page.clock.fastForward(30000);
  await expect(visible).toHaveText("6");
  expect(new Set(requests.at(-1)!.searchParams.get("countries")!.split(","))).toEqual(new Set(["FR", "DE", "BE"]));
  await page.getByRole("checkbox", { name: "Auto · 30 s" }).uncheck();
  await page.getByRole("button", { name: "All altitudes", exact: true }).click();
  await expect(visible).toHaveText("7");
  await expect(page.locator(".maplibregl-canvas")).toHaveAttribute("data-map-instance", "original");
  await page.locator(".sidebar").evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: "test-results/roi-and-bordering-countries.png", fullPage: true });
});

test("a German ROI offers France as a neighbour without loading French administrative data", async ({ page }) => {
  await configure(page, "Germany", ["DE"]);
  const files: string[] = [];
  page.on("request", request => {
    if (request.url().includes(".geojson")) files.push(new URL(request.url()).pathname);
  });
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/map" && response.ok()),
    page.goto("/"),
  ]);
  expect(new URL(response.url()).searchParams.get("countries")).toBe("DE");
  await expect(page.locator(".map-wrap")).toHaveAttribute("aria-busy", "false");
  await page.getByRole("checkbox", { name: "Show bordering webcams" }).check();
  await expect(page.getByRole("checkbox", { name: "French regions & departments" })).toHaveCount(0);
  await expect.poll(() => files.length).toBe(1);
  expect(files[0]).toMatch(/national-/);
});
