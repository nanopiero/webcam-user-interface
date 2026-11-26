import { expect, test } from "@playwright/test";

for (const parameter of ["snow", "visibility"] as const) {
  test(`${parameter} shows fresh fills, ageing rings and expired dots per camera, including expanded groups`, async ({ page }) => {
    const policy = parameter === "snow" ? { fresh_minutes: 30, max_age_minutes: 180 }
      : { fresh_minutes: 15, max_age_minutes: 30 };
    const cls = parameter === "snow" ? "snow.undifferentiated" : "visibility.0_1500";
    const camera = (p: string, x: number, freshness: "fresh" | "ageing" | "expired") => {
      const expired = freshness === "expired";
      const age = freshness === "fresh" ? 1 : (expired ? policy.max_age_minutes : policy.fresh_minutes) + 1;
      return { p, name: p, x, y: 47, altitude: 100, country: "FR", qs: 2, freshness,
        cls: expired ? "white" : cls, u: false, w: expired ? "stale" : null,
        t: new Date(Date.now() - age * 60000).toISOString(),
        vl: parameter === "visibility" && !expired ? 100 : null,
        vu: parameter === "visibility" && !expired ? 1200 : null, value: null };
    };
    const groups = [
      [camera("fresh", -3, "fresh")], [camera("ageing", -1, "ageing")],
      [camera("expired", 1, "expired")],
      [camera("group-fresh", 3, "fresh"), camera("group-ageing", 3, "ageing"), camera("group-expired", 3, "expired")],
      [camera("old-one", 5, "expired"), camera("old-two", 5, "expired")],
    ];
    await page.route("**/frontend-config.json", async route => {
      const config = await (await route.fetch()).json();
      await route.fulfill({ json: { ...config, default_parameter: parameter,
        map: { ...config.map, center: [1, 47], zoom: 5.5 } } });
    });
    await page.route("**/api/map?*", route => route.fulfill({ json: {
      type: "FeatureCollection", parameter, at: new Date().toISOString(), freshness: policy,
      counts: { sites: 5, cameras: 8 }, features: groups.map(cams => ({ type: "Feature",
        geometry: { type: "Point", coordinates: [cams[0].x, 47] }, properties: {
          id: cams[0].p, platform: cams[0].p, name: cams[0].name, cams, n: cams.length,
          cls: cams[0].cls, u: false, tie: false,
        } })),
    } }));
    await page.route("**/api/supplementary-webcams", route => route.fulfill({ json: {
      type: "FeatureCollection", enabled: false, counts: { csv_webcams: 0, visible: 0, now_near_database: 0 }, features: [],
    } }));
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/");
    await expect(page.locator(".map-wrap")).toHaveAttribute("aria-busy", "false");
    await page.getByRole("checkbox", { name: "Auto · 30 s" }).uncheck();
    await expect(page.getByLabel("Sites in map view")).toHaveText("5 sites in view");
    const legend = page.getByLabel("Observation age");
    await expect(legend).toContainText(parameter === "snow" ? "30 min–3 h: white ring" : "15 min–30 min: white ring");
    await expect(legend).toContainText(parameter === "snow" ? "From 3 h: small white dot" : "From 30 min: small white dot");
    const legendColour = parameter === "snow" ? "rgb(31, 111, 178)" : "rgb(255, 140, 0)";
    await expect(legend.locator(".freshness-solid")).toHaveCSS("background-color", legendColour);
    await expect(legend.locator(".freshness-ring")).toHaveCSS("background-color", legendColour);
    await page.waitForTimeout(200);
    const mapCanvas = page.locator(".maplibregl-canvas");
    const screenshot = await mapCanvas.screenshot();
    const samples = await page.evaluate(async base64 => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0);
      const rgb = (longitude: number, dx: number, dy: number) => {
        const x = Math.round(canvas.width / 2 + (longitude - 1) * 512 * 2 ** 5.5 / 360 + dx);
        return [...context.getImageData(x, Math.round(canvas.height / 2 + dy), 1, 1).data].slice(0, 3);
      };
      let width = 0;
      for (let dx = -12; dx <= 12; dx++) if (rgb(5, dx, 0).every(value => value > 245)) width++;
      return { fresh: rgb(-3, 0, -2), ageingCentre: rgb(-1, 0, 2), ageingRim: rgb(-1, 0, 5),
        groupFresh: rgb(3, 3, -3), groupAgeingCentre: rgb(3, 0, 3), groupAgeingRim: rgb(3, 0, 8),
        groupExpired: rgb(3, -7, -4), oldGroupWidth: width };
    }, screenshot.toString("base64"));
    const upper = parameter === "snow" ? [31, 111, 178] : [160, 0, 80];
    const lower = parameter === "snow" ? upper : [0, 0, 68];
    for (const rgb of [samples.fresh, samples.groupFresh]) {
      rgb.forEach((value, index) => expect(Math.abs(value - upper[index])).toBeLessThan(25));
    }
    for (const rgb of [samples.ageingRim, samples.groupAgeingRim, samples.groupExpired]) {
      expect(rgb.every(value => value > 240)).toBeTruthy();
    }
    for (const rgb of [samples.ageingCentre, samples.groupAgeingCentre]) {
      rgb.forEach((value, index) => expect(Math.abs(value - lower[index])).toBeLessThan(25));
    }
    expect(samples.oldGroupWidth).toBeGreaterThanOrEqual(4);
    expect(samples.oldGroupWidth).toBeLessThanOrEqual(8);
    await page.screenshot({ path: `test-results/${parameter}-freshness.png`, fullPage: true });

    const box = (await mapCanvas.boundingBox())!;
    await mapCanvas.click({ position: { x: box.width / 2 + 2 * 512 * 2 ** 5.5 / 360, y: box.height / 2 } });
    await expect(page.getByRole("region", { name: "Cameras at selected site" })).toBeVisible();
    await page.waitForTimeout(700); // Complete the map's expansion/focus animation.
    const expanded = await mapCanvas.screenshot();
    const centre = await page.evaluate(async base64 => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0);
      return [...context.getImageData(Math.round(canvas.width / 2 - 185 + 17 * Math.cos(Math.PI / 6)),
        Math.round(canvas.height / 2 + 8.5 + 2), 1, 1).data].slice(0, 3);
    }, expanded.toString("base64"));
    centre.forEach((value, index) => expect(Math.abs(value - lower[index])).toBeLessThan(25));
    expect(errors).toEqual([]);
  });
}
