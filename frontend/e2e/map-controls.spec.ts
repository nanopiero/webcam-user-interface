import { expect, test } from "@playwright/test";

test("display and border toggles reuse the map and cached data without HTTP reloads", async ({ page }) => {
  const watched: string[] = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (/^\/api\/(map|status|supplementary-webcams)$/.test(path) || /\/(national|regions|departments)-[^/]+\.geojson$/.test(path)) watched.push(path);
  });
  const [initialResponse] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/map" && response.ok()),
    page.goto("/"),
  ]);
  const initial = await initialResponse.json();
  await expect(page.locator(".map-wrap")).toHaveAttribute("aria-busy", "false");
  await expect.poll(() => watched.filter(path => path.endsWith(".geojson")).length).toBe(3);
  await expect.poll(async () => Number((await page.getByLabel("Sites in map view").textContent())?.replace(/[^0-9]/g, ""))).toBeGreaterThan(0);
  await page.getByRole("checkbox", { name: "Auto · 30 s" }).uncheck();
  await page.locator(".maplibregl-canvas").evaluate(element => { element.dataset.mapInstance = "original"; });
  watched.length = 0;
  const bands = [
    ["Below 500 m", (height: number | null) => height != null && height < 500],
    ["500–1,000 m", (height: number | null) => height != null && height >= 500 && height <= 1000],
    ["Above 1,000 m", (height: number | null) => height != null && height > 1000],
  ] as const;
  const cams = initial.features.flatMap((feature: { properties: { cams: { altitude: number | null }[] } }) => feature.properties.cams);
  for (const [label, predicate] of bands) {
    await page.getByRole("button", { name: label, exact: true }).click();
    const expected = cams.filter((camera: { altitude: number | null }) => predicate(camera.altitude)).length;
    await expect(page.getByLabel("Visible WEOW webcams").locator("strong")).toHaveText(expected.toLocaleString());
  }
  await page.getByRole("button", { name: "All altitudes", exact: true }).click();
  await page.getByRole("checkbox", { name: "WEOW webcams", exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "Additional webcams · black dots", exact: true }).uncheck();
  await expect(page.getByLabel("Sites in map view")).toHaveText("0 sites in view");
  await page.getByRole("checkbox", { name: "WEOW webcams", exact: true }).check();
  await expect.poll(async () => Number((await page.getByLabel("Sites in map view").textContent())?.replace(/[^0-9]/g, ""))).toBeGreaterThan(0);
  await page.getByRole("checkbox", { name: "Additional webcams · black dots", exact: true }).check();
  await page.getByRole("checkbox", { name: "Hide white markers", exact: true }).check();
  await page.getByRole("checkbox", { name: "Hide white markers", exact: true }).uncheck();
  for (const name of ["National borders", "French regions & departments"]) {
    await page.getByRole("checkbox", { name, exact: true }).uncheck();
    await page.getByRole("checkbox", { name, exact: true }).check();
  }
  await expect.poll(async () => Number((await page.getByLabel("Sites in map view").textContent())?.replace(/[^0-9]/g, ""))).toBeGreaterThan(0);
  await page.waitForTimeout(500); // Allow the final WebGL style update to be presented before capture.
  await page.screenshot({ path: "test-results/borders-and-small-icons.png", fullPage: true });
  await expect(page.locator(".maplibregl-canvas")).toHaveAttribute("data-map-instance", "original");
  expect(watched).toEqual([]);
});
