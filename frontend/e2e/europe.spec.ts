import { expect, test } from "@playwright/test";

const countries = ["FR", "DE", "GB", "FI", "IS", "PT", "CY"];

test.use({ storageState: { cookies: [], origins: [] } });

test("Europe defaults to English, loads every configured country and refreshes them without a neighbour toggle", async ({ page }) => {
  await page.clock.install();
  await page.route("**/frontend-config.json", async route => {
    const frontend = await (await route.fetch()).json();
    await route.fulfill({ json: { ...frontend, language: "roi", roi: { name: "Europe", countries }, countries,
      map: { ...frontend.map, center: [12, 55], zoom: 3 } } });
  });
  await page.route("**/api/supplementary-webcams", route => route.fulfill({ json: {
    type: "FeatureCollection", enabled: false, counts: {}, features: [],
  } }));
  const requests: URL[] = [], files: string[] = [];
  page.on("request", request => { if (request.url().includes(".geojson")) files.push(request.url()); });
  await page.route("**/api/map?*", route => {
    const url = new URL(route.request().url()); requests.push(url);
    return route.fulfill({ json: { type: "FeatureCollection", parameter: "snow", at: new Date().toISOString(),
      counts: { sites: 0, cameras: 0 }, features: [],
    } });
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator(".roi-label")).toHaveText("ROI: Europe");
  await expect(page.locator(".map-wrap")).toHaveAttribute("aria-busy", "false");
  await page.getByRole("checkbox", { name: "Auto · 30 s" }).uncheck();
  await expect(page.getByRole("checkbox", { name: "Show bordering webcams" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "French regions & departments" })).toHaveCount(0);
  await expect.poll(() => files.length).toBe(1);
  expect(files[0]).toMatch(/national-/);
  expect(requests).toHaveLength(1);
  expect(new Set(requests[0].searchParams.get("countries")!.split(","))).toEqual(new Set(countries));
  expect(requests[0].searchParams.get("include_unknown_country")).toBe("false");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  await page.getByRole("checkbox", { name: "Auto · 30 s" }).check();
  await page.clock.fastForward(30000);
  await expect.poll(() => requests.length).toBe(3);
  for (const request of requests) expect(new Set(request.searchParams.get("countries")!.split(","))).toEqual(new Set(countries));
});
