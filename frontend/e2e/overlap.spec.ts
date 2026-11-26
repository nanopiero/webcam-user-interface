import { expect, test, type Page } from "@playwright/test";

function camera(p: string, name: string, x = 2, expired = false) {
  return { p, name, x, y: 47, altitude: 100, country: "FR", qs: 2, u: false,
    cls: expired ? "white" : "snow.undifferentiated", w: expired ? "stale" : null,
    freshness: expired ? "expired" : "ageing", t: new Date().toISOString(), vl: null, vu: null, value: null };
}
function site(id: string, cams: ReturnType<typeof camera>[]) {
  return { type: "Feature", geometry: { type: "Point", coordinates: [cams[0].x, 47] },
    properties: { id, platform: id, name: cams[0].name, cams, n: cams.length, cls: cams[0].cls, u: false } };
}

async function prepare(page: Page, features: ReturnType<typeof site>[], additional = false) {
  let mapRequests = 0;
  const detailRequests: string[] = [];
  const cameras = features.flatMap(item => item.properties.cams);
  await page.route("**/frontend-config.json", async route => {
    const config = await (await route.fetch()).json();
    await route.fulfill({ json: { ...config, default_parameter: "snow",
      map: { ...config.map, center: [2, 47], zoom: 5.5 } } });
  });
  await page.route("**/api/map?*", route => {
    mapRequests++;
    return route.fulfill({ json: { type: "FeatureCollection", parameter: "snow", at: new Date().toISOString(),
      counts: { sites: features.length, cameras: cameras.length }, features } });
  });
  await page.route("**/api/supplementary-webcams", route => route.fulfill({ json: {
    type: "FeatureCollection", enabled: additional, counts: { csv_webcams: additional ? 1 : 0, visible: additional ? 1 : 0, now_near_database: 0 },
    features: additional ? [{ type: "Feature", geometry: { type: "Point", coordinates: [2, 47] },
      properties: { id: "south", name: "Additional camera", altitude: 100, source_layer_name: "Example" } }] : [],
  } }));
  await page.route("**/api/webcams/**", route => {
    const path = new URL(route.request().url()).pathname;
    detailRequests.push(path);
    const id = path.split("/")[3];
    const selected = cameras.find(item => item.p === id)!;
    const provider = { page_url: null, image_url: null, image_embeddable: false, available: false };
    return route.fulfill({ json: path.endsWith("/provider") ? provider : { processing_stream_id: id,
      source_stream_id: id, platform: id, platform_name: selected.name, name: selected.name,
      latitude: 47, longitude: selected.x, altitude: 100, country: "FR", provider_kind: null,
      tags: [], blacklisted: false, predictions: [], provider } });
  });
  await page.route("**/api/supplementary-webcams/**", route => {
    const path = new URL(route.request().url()).pathname;
    detailRequests.push(path);
    return route.fulfill({ json: path.endsWith("/provider") ? { page_url: null, media: [] } : {
      id: "south", name: "Additional camera", latitude: 47, longitude: 2, altitude: 100,
      altitude_source: null, source_layer_name: "Example", exported_at: null, links: [],
      description: "", metadata: {}, provider_url: null, source_map_url: null,
    } });
  });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && /layers\.|source.*sites/i.test(message.text())) errors.push(message.text()); });
  await page.goto("/");
  await expect(page.locator(".map-wrap")).toHaveAttribute("aria-busy", "false");
  await page.getByRole("checkbox", { name: "Auto · 30 s" }).uncheck();
  await expect(page.getByLabel("Sites in map view")).toHaveText(`${features.length + (additional ? 1 : 0)} sites in view`);
  const canvas = page.locator(".maplibregl-canvas");
  const box = (await canvas.boundingBox())!;
  return { canvas, centre: { x: box.width / 2, y: box.height / 2 }, errors, detailRequests, mapRequests: () => mapRequests };
}

test("whole markers cover lower outlines and a chooser opens the covered tiny webcam without zooming", async ({ page }) => {
  const sixPixels = 6 * 360 / (512 * 2 ** 5.5);
  const large = camera("large", "Large camera", 2 + sixPixels);
  const tiny = camera("tiny", "Tiny camera", 2, true);
  const state = await prepare(page, [site("z-large", [large]), site("a-tiny", [tiny])]);
  await page.waitForTimeout(200);
  const screenshot = await state.canvas.screenshot();
  const coveredOutline = await page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0);
    return [...context.getImageData(Math.round(canvas.width / 2 + 3), Math.round(canvas.height / 2), 1, 1).data].slice(0, 3);
  }, screenshot.toString("base64"));
  coveredOutline.forEach((value, index) => expect(Math.abs(value - [31, 111, 178][index])).toBeLessThan(25));
  await state.canvas.click({ position: state.centre });
  const chooser = page.getByRole("dialog", { name: "Overlapping webcams" });
  await expect(chooser.getByRole("button", { name: /Tiny camera/ })).toBeVisible();
  await expect(chooser.getByRole("button", { name: /Large camera/ })).toBeVisible();
  expect(state.detailRequests).toEqual([]);
  await page.screenshot({ path: "test-results/overlap-chooser.png", fullPage: true });
  await page.keyboard.press("Escape");
  await expect(chooser).toHaveCount(0);
  await state.canvas.click({ position: state.centre });
  await chooser.getByRole("button", { name: /Tiny camera/ }).click();
  await expect(page.locator(".camera-name")).toHaveText("Tiny camera");
  expect(state.detailRequests.every(path => path.includes("/tiny"))).toBeTruthy();
  await page.getByRole("button", { name: "Close webcam details" }).click();
  await page.getByRole("button", { name: "Reset view" }).click();
  await page.waitForTimeout(700);
  await state.canvas.click({ position: state.centre });
  await expect(chooser).toBeVisible();
  await page.getByRole("checkbox", { name: "Hide white markers", exact: true }).check();
  await expect(chooser).toHaveCount(0);
  await state.canvas.click({ position: state.centre });
  await expect(page.locator(".camera-name")).toHaveText("Large camera");
  await expect(chooser).toHaveCount(0);
  expect(state.mapRequests()).toBe(1);
  expect(state.errors).toEqual([]);
});

test("the overlap chooser includes additional dots and each grouped camera, opening the chosen provider", async ({ page }) => {
  const state = await prepare(page, [site("group", [camera("north", "North view"), camera("south", "South view")])], true);
  await state.canvas.click({ position: state.centre });
  const chooser = page.getByRole("dialog", { name: "Overlapping webcams" });
  await expect(chooser.getByRole("button", { name: /Additional camera/ })).toBeVisible();
  await expect(chooser.getByRole("button", { name: /^North view/ })).toBeVisible();
  await expect(chooser.getByRole("button", { name: /^South view/ })).toBeVisible();
  expect(state.detailRequests).toEqual([]);
  await chooser.getByRole("button", { name: /Additional camera/ }).click();
  await expect(page.getByRole("complementary", { name: "Supplementary webcam details" })).toBeVisible();
  expect(state.detailRequests.every(path => path.startsWith("/api/supplementary-webcams/"))).toBeTruthy();
  await page.getByRole("button", { name: "Close supplementary webcam" }).click();
  await page.getByRole("button", { name: "Reset view" }).click();
  await page.waitForTimeout(700);
  await state.canvas.click({ position: state.centre });
  await chooser.getByRole("button", { name: /^South view/ }).click();
  await expect(page.locator(".camera-name")).toHaveText("South view");
  await expect(page.getByRole("region", { name: "Cameras at selected site" }).getByRole("button", { name: "2. South view" })).toHaveAttribute("aria-pressed", "true");
  expect(state.mapRequests()).toBe(1);
  expect(state.errors).toEqual([]);
});
