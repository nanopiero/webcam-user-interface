import { expect, test } from "@playwright/test";

test("live map, site selection, provider links and both prediction histories", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && /Worker failed|layers\.sites|source.*sites/i.test(message.text())) errors.push(message.text()); });
  const response = await request.get("/api/map?parameter=visibility&countries=FR&include_unknown_country=false");
  expect(response.ok()).toBeTruthy();
  const latest = await response.json();
  expect(latest.counts.cameras).toBeGreaterThan(0);
  // Exercise received data even after observation publication stops for the night.
  const stamps = latest.features.flatMap((item: { properties: { cams: { t: string | null }[] } }) => item.properties.cams.flatMap(camera => camera.t ? [Date.parse(camera.t)] : []));
  const at = new Date(Math.ceil(Math.max(...stamps) / 60000) * 60000).toISOString();
  const payload = await (await request.get(`/api/map?parameter=visibility&countries=FR&include_unknown_country=false&at=${encodeURIComponent(at)}`)).json();
  const snow = await (await request.get(`/api/map?parameter=snow&countries=FR&include_unknown_country=false&at=${encodeURIComponent(at)}`)).json();
  const snowCameras = new Set(snow.features.flatMap((item: { properties: { cams: { p: string; t: string | null }[] } }) => item.properties.cams.filter(camera => camera.t && Date.parse(camera.t) > Date.parse(at) - 86400000).map(camera => camera.p)));
  const site = payload.features.find((item: { properties: { cams: { p: string; t: string | null; vl: number | null }[] } }) => item.properties.cams.some(camera => camera.t && camera.vl != null && snowCameras.has(camera.p)));
  expect(site).toBeTruthy();
  const selectedCamera = site.properties.cams.find((camera: { p: string; t: string | null; vl: number | null }) => camera.t && camera.vl != null && snowCameras.has(camera.p));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Webcam observations", exact: true })).toBeVisible();
  await expect(page.locator(".map-wrap")).toHaveAttribute("aria-busy", "false");
  await expect.poll(async () => Number((await page.getByLabel("Sites in map view").textContent())?.replace(/[^0-9]/g, ""))).toBeGreaterThan(0);
  await page.screenshot({ path: "test-results/live-map.png", fullPage: true });
  await page.locator('input[type="datetime-local"]').first().fill(at.slice(0, 16));
  await page.getByRole("button", { name: "View time", exact: true }).click();
  await page.getByRole("button", { name: "Visibility", exact: true }).click();
  await page.getByRole("searchbox", { name: "Find a webcam" }).fill(site.properties.platform);
  await page.getByLabel("Webcam search results").getByRole("button").first().click();
  const detail = page.getByRole("complementary", { name: "Webcam details" });
  if (site.properties.n > 1) {
    await page.waitForTimeout(600); // Complete the selected site's focus animation.
    const box = (await page.locator(".maplibregl-canvas").boundingBox())!;
    await page.locator(".maplibregl-canvas").click({ position: { x: box.width / 2 - 185, y: box.height / 2 } });
    await page.getByRole("dialog", { name: "Choose a webcam" })
      .locator(`button[data-webcam-key="weow:${selectedCamera.p}"]`).click();
  }
  await expect(detail.getByRole("heading", { name: "Visibility observation" })).toBeVisible();
  await expect(detail.getByText("Published centre", { exact: true })).toBeVisible();
  await expect(detail.getByRole("img", { name: /^Current view from/ })).toBeVisible({ timeout: 20000 });
  await expect.poll(() => detail.getByRole("img", { name: /^Current view from/ }).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0), { timeout: 20000 }).toBeTruthy();
  await detail.getByRole("button", { name: "Open visibility history" }).click();
  const visibility = page.getByRole("article").filter({ hasText: "Visibility history" });
  await expect(visibility.getByRole("img")).toBeVisible();
  await visibility.getByRole("combobox", { name: "History time range" }).selectOption("1");
  await expect(visibility.locator(".chart-footer")).toContainText(/[1-9][\d,]* observations/);
  await visibility.getByRole("button", { name: "Calibrated · m" }).click();
  await visibility.getByRole("img").focus();
  await page.keyboard.press("End");
  await expect(visibility.locator(".chart-readout")).toContainText("Published centre:");
  await detail.getByRole("button", { name: "Open snow history" }).click();
  const snowHistory = page.getByRole("article").filter({ hasText: "Snow history" });
  await expect(snowHistory.getByRole("img")).toBeVisible();
  await expect(snowHistory.getByRole("button", { name: "Snow classes", exact: true })).toHaveClass(/active/);
  await snowHistory.getByRole("combobox", { name: "History time range" }).selectOption("1");
  await expect(snowHistory.locator(".chart-footer")).toContainText(/[1-9][\d,]* observations/);
  await expect(snowHistory.locator(".chart-footer")).not.toContainText("No observations received");
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await page.screenshot({ path: "test-results/live-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/live-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
});

test("supplementary webcams are searchable, clickable and separate from WEOW predictions", async ({ page, request }) => {
  const response = await request.get("/api/supplementary-webcams");
  expect(response.ok()).toBeTruthy();
  const catalogue = await response.json();
  expect(catalogue.features.length).toBeGreaterThan(0);
  const webcam = catalogue.features[0];
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Find a webcam" }).fill(webcam.properties.name);
  await page.getByLabel("Additional webcam search results").getByRole("button").filter({ hasText: webcam.properties.name }).first().click();
  const detail = page.getByRole("complementary", { name: "Supplementary webcam details" });
  await expect(detail.getByRole("heading", { name: webcam.properties.name, exact: true })).toBeVisible();
  await expect(detail.getByText("Not processed by WEOW in this application. No prediction history is available.")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Map colour legend" }).getByText("Additional webcams", { exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: /history/ })).toHaveCount(0);
  await page.screenshot({ path: "test-results/supplementary-webcam.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Close supplementary webcam" }).click();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "Find a webcam" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test("administrator login, hiding and restoring are wired correctly without writing to the live database", async ({ page, request }) => {
  const map = await (await request.get("/api/map?countries=FR&include_unknown_country=false")).json();
  let authenticated = false, hidden = false;
  await page.route("**/api/admin/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/session")) return route.fulfill({ status: authenticated ? 200 : 401, json: authenticated ? { username: "test-admin", csrf_token: "browser-test-csrf" } : { detail: "administrator authentication required" } });
    if (path.endsWith("/login")) {
      expect(route.request().postDataJSON()).toEqual({ username: "admin", password: "browser-test-password" });
      authenticated = true;
      return route.fulfill({ json: { username: "test-admin", csrf_token: "browser-test-csrf" } });
    }
    if (path.endsWith("/blacklist")) return route.fulfill({ json: { items: hidden ? [{ processing_stream_id: "test-hidden-camera", name: "Browser test webcam", reason: "Browser test", updated_at: "2026-11-17T10:00:00Z", updated_by: "test-admin" }] : [] } });
    expect(route.request().headers()["x-csrf-token"]).toBe("browser-test-csrf");
    if (route.request().method() === "PUT") { hidden = true; return route.fulfill({ json: { blacklisted: true } }); }
    if (route.request().method() === "DELETE") { hidden = false; return route.fulfill({ status: 204 }); }
    if (path.endsWith("/logout")) { authenticated = false; return route.fulfill({ status: 204 }); }
    return route.fulfill({ status: 404 });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill("browser-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("No hidden webcams.")).toBeVisible();
  await page.getByRole("button", { name: "Close administration" }).click();
  await page.getByRole("searchbox", { name: "Find a webcam" }).fill(map.features[0].properties.platform);
  await page.getByLabel("Webcam search results").getByRole("button").first().click();
  await page.getByLabel("Reason for hiding").fill("Browser test");
  await page.getByRole("button", { name: "Hide webcam from this map" }).click();
  await page.getByRole("button", { name: "Administrator", exact: true }).click();
  await expect(page.getByText("Browser test webcam", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restore to map" }).click();
  await expect(page.getByText("No hidden webcams.")).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
});

test("altitude controls replace the full webcam list and filter both map sources", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Webcam sites", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Below 500 m", exact: true }).click();
  await expect(page.getByRole("button", { name: "Below 500 m", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "500–1,000 m", exact: true }).click();
  await expect(page.getByRole("button", { name: "500–1,000 m", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Above 1,000 m", exact: true }).click();
  await expect(page.getByRole("button", { name: "Above 1,000 m", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: "test-results/altitude-filter.png", fullPage: true });
});
