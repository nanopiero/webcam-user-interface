import { expect, test } from "@playwright/test";

test("snow defaults to qualified results with white placeholders; the toggle preserves webcams and the availability legend", async ({ page }) => {
  const requests: URL[] = [];
  await page.route("**/api/map?*", route => {
    const url = new URL(route.request().url());
    requests.push(url);
    const parameter = url.searchParams.get("parameter") ?? "snow";
    const qualifiedOnly = parameter === "snow" && url.searchParams.get("qualified_only") !== "false";
    const statuses = [2, 0, 1, null];
    const cameras = statuses.map((status, index) => {
      const withheld = qualifiedOnly && status !== 2;
      return { p: `camera-${index}`, name: `Camera ${index}`, country: "FR", altitude: 100,
        x: 2 + index * 0.5, y: 47, qs: parameter === "snow" ? status : 2,
        cls: parameter === "visibility" ? "visibility.200_500" : withheld ? "white" : "snow.undifferentiated",
        u: parameter === "snow" && !withheld && status === 0,
        w: withheld ? status === null ? "qualification_unknown" : "scene_unqualified" : null,
        t: new Date().toISOString(), vl: parameter === "visibility" ? 250 : null,
        vu: parameter === "visibility" ? 400 : null, value: null };
    });
    return route.fulfill({ json: { type: "FeatureCollection", parameter, at: new Date().toISOString(), qualified_only: qualifiedOnly,
      counts: { sites: 4, cameras: 4 }, features: cameras.map(camera => ({ type: "Feature",
        geometry: { type: "Point", coordinates: [camera.x, camera.y] },
        properties: { id: camera.p, platform: camera.p, name: camera.name, n: 1, cls: camera.cls,
          u: camera.u, cams: [camera] } })),
    } });
  });
  await page.goto("/");
  await expect(page.locator(".map-wrap")).toHaveAttribute("aria-busy", "false");
  await page.getByRole("checkbox", { name: "Auto · 30 s" }).uncheck();
  const qualified = page.getByRole("checkbox", { name: "Qualified scenes only", exact: true });
  const count = page.getByLabel("Visible WEOW webcams").locator("strong");
  const legend = page.getByRole("complementary", { name: "Map colour legend" });
  await expect(legend.getByText("Recent snow observation · unqualified", { exact: true })).toBeVisible();
  await expect(legend.getByText("No recent snow observation", { exact: true })).toBeVisible();
  await expect(legend.getByText("Additional webcams", { exact: true })).toBeVisible();
  await expect(qualified).toBeChecked();
  await expect(count).toHaveText("4");
  const initialLegend = await legend.innerText();
  expect(requests[0].searchParams.get("qualified_only")).toBe("true");
  await page.locator(".maplibregl-canvas").evaluate(element => { element.dataset.mapInstance = "original"; });
  await page.getByRole("checkbox", { name: "Hide white markers", exact: true }).check();
  await expect(count).toHaveText("1");
  await qualified.uncheck();
  await expect(count).toHaveText("4");
  expect(requests.at(-1)!.searchParams.get("qualified_only")).toBe("false");
  await qualified.check();
  await expect(count).toHaveText("1");
  await page.getByRole("checkbox", { name: "Hide white markers", exact: true }).uncheck();
  await expect(count).toHaveText("4");
  expect(await legend.innerText()).toBe(initialLegend);
  await page.getByRole("checkbox", { name: "Show bordering webcams" }).check();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(qualified).toBeChecked();
  expect(requests.at(-1)!.searchParams.get("qualified_only")).toBe("true");
  await page.getByRole("button", { name: "Visibility", exact: true }).click();
  await expect(qualified).toBeChecked();
  await expect(count).toHaveText("4");
  await qualified.uncheck();
  await expect(count).toHaveText("4");
  await qualified.check();
  await expect(count).toHaveText("4");
  await page.getByRole("button", { name: "Snow", exact: true }).click();
  await expect(qualified).toBeChecked();
  await expect(count).toHaveText("4");
  expect(await legend.innerText()).toBe(initialLegend);
  await expect(page.locator(".maplibregl-canvas")).toHaveAttribute("data-map-instance", "original");
});
