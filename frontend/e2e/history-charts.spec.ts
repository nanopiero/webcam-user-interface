import { expect, test, type Locator, type Page } from "@playwright/test";

import { chartFixture } from "./fixtures/webcam";

async function windowOf(chart: Locator) {
  return chart.evaluate(element => [Number((element as HTMLElement).dataset.windowStart), Number((element as HTMLElement).dataset.windowEnd)]);
}

async function dragZoom(page: Page, chart: Locator) {
  await chart.scrollIntoViewIfNeeded();
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.35, box.y + 55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + 55, { steps: 10 });
  await page.mouse.up();
}

async function hoverPaintedInterval(page: Page, chart: Locator, calibrated = false) {
  await chart.scrollIntoViewIfNeeded();
  const pixel = await chart.evaluate((element, calibrated) => {
    const canvas = element.querySelector("canvas")!, pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let x = 0; x < canvas.width; x++) {
      const hits: number[] = [];
      for (let y = 0; y < canvas.height; y++) {
        const offset = (y * canvas.width + x) * 4, [r, g, b] = pixels.slice(offset, offset + 3);
        if (calibrated ? r > g + 30 && g > b + 30 : b > r + 50 && g > r + 30) hits.push(y);
      }
      if (hits.length > 5) return { x: x * canvas.clientWidth / canvas.width,
        y: ((hits[0] + hits.at(-1)!) / 2) * canvas.clientHeight / canvas.height };
    }
    return null;
  }, calibrated);
  expect(pixel).not.toBeNull();
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + pixel!.x, box.y + pixel!.y);
}

test("Dygraphs snow classes, raw thresholds, zoom and map-time guide use published history without extra requests", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const fixture = await chartFixture(page);
  await page.getByRole("button", { name: "Open snow history" }).click();
  const history = page.getByRole("article").filter({ hasText: "Snow history" });
  const chart = history.getByRole("img");
  await expect(history.locator(".chart-footer")).toContainText("6 observations");
  await expect(chart.locator("canvas").first()).toBeVisible();
  await expect(chart.locator(".dygraph-y2label")).toHaveCount(0);
  await expect(history.locator(".chart-keys")).not.toContainText("snow threshold");
  await expect(chart.locator(".dygraph-rangesel-zoomhandle")).toHaveCount(0);
  await expect(history.getByRole("button", { name: /Zoom in|Zoom out/ })).toHaveCount(0);
  await expect(history.getByText(/Drag to zoom|Shift-drag to pan/)).toHaveCount(0);
  expect((await chart.boundingBox())!.height).toBeLessThan(180);
  const mapBox = (await page.locator(".map-wrap").boundingBox())!;
  const chartBox = (await chart.boundingBox())!;
  expect(mapBox.y).toBeGreaterThanOrEqual(0);
  expect(chartBox.y + chartBox.height).toBeLessThan(1000);
  await expect(history.locator(".chart-map-time")).toBeVisible();
  await chart.focus(); await page.keyboard.press("Home");
  await expect(history.locator(".chart-readout")).toContainText("Class: Undifferentiated snow");
  await page.keyboard.press("ArrowRight");
  await expect(history.locator(".chart-readout")).not.toContainText("snow threshold:");
  await page.keyboard.press("ArrowRight");
  await expect(history.locator(".chart-readout")).toContainText("Class: High snow cover");
  await page.screenshot({ path: "test-results/dygraphs-snow-classes.png", fullPage: true });
  const original = await windowOf(chart), span = original[1] - original[0];
  await dragZoom(page, chart);
  await expect.poll(async () => { const range = await windowOf(chart); return range[1] - range[0]; }).toBeLessThan(span * 0.8);
  await history.getByRole("button", { name: "Reset view", exact: true }).click();
  await expect.poll(async () => { const range = await windowOf(chart); return range[1] - range[0]; }).toBeGreaterThan(span * 0.99);
  // Move the map guide inside an already zoomed chart. Its zoom and loaded history stay intact.
  await dragZoom(page, chart);
  const zoomed = await windowOf(chart);
  const selected = new Date((zoomed[0] + zoomed[1]) / 2).toISOString().slice(0, 16);
  await page.getByLabel("Map time (UTC)").fill(selected);
  await page.getByRole("button", { name: "View time", exact: true }).click();
  await expect(history.locator(".chart-map-time")).toHaveAttribute("data-map-time", String(Date.parse(`${selected}Z`)));
  await expect(history.locator(".chart-map-time")).toBeVisible();
  expect(await windowOf(chart)).toEqual(zoomed);
  expect(fixture.requests()).toBe(1);
  await history.getByRole("button", { name: "Raw model interval" }).click();
  await chart.focus(); await page.keyboard.press("End");
  await expect(history.locator(".chart-readout")).toContainText("Lower snow threshold: 0");
  await expect(history.locator(".chart-readout")).toContainText("Interval: Not published");
  await expect(history.locator(".chart-note")).toContainText("Missing thresholds leave gaps");
  await page.screenshot({ path: "test-results/dygraphs-snow-raw.png", fullPage: true });
  expect(fixture.requests()).toBe(1);
  expect(errors).toEqual([]);
});

test("Dygraphs raw/calibrated visibility preserves exact centres, missing values and mobile zoom", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const fixture = await chartFixture(page);
  await page.getByRole("button", { name: "Open visibility history" }).click();
  const history = page.getByRole("article").filter({ hasText: "Visibility history" });
  const chart = history.getByRole("img");
  await expect(chart.locator("canvas").first()).toBeVisible();
  await hoverPaintedInterval(page, chart);
  await expect(page.getByRole("tooltip")).toContainText("Interval: -4 – -2");
  await expect(page.getByRole("tooltip").getByText(/^Interval:/)).toHaveText("Interval: -4 – -2");
  await chart.focus(); await page.keyboard.press("Home");
  await expect(history.locator(".chart-readout")).toContainText("Interval: -4 – -2");
  await history.getByRole("button", { name: "Calibrated · m" }).click();
  await hoverPaintedInterval(page, chart, true);
  await expect(page.getByRole("tooltip")).toContainText("Interval: 1,000 – 3,000 m");
  await expect(page.getByRole("tooltip")).toContainText("Published centre: 1,800 m");
  await chart.focus(); await page.keyboard.press("Home");
  await expect(history.locator(".chart-readout")).toContainText("Published centre: 1,800 m");
  await page.keyboard.press("ArrowRight");
  await expect(history.locator(".chart-readout")).toContainText("Interval: Not published");
  await page.keyboard.press("ArrowRight");
  await expect(history.locator(".chart-readout")).toContainText("Published centre: Not supplied");
  await page.keyboard.press("ArrowRight");
  await expect(history.locator(".chart-readout")).toContainText("20,000 – 90,000 m");
  await expect(history.locator(".chart-readout")).toContainText("Published centre: 45,000 m");
  await page.keyboard.press("End");
  await expect(history.locator(".chart-readout")).toContainText("Published centre: 0 m");
  await page.screenshot({ path: "test-results/dygraphs-visibility-calibrated.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await chart.scrollIntoViewIfNeeded();
  await dragZoom(page, chart);
  await expect(history.locator(".chart-map-time")).toBeHidden();
  await expect(history.locator(".chart-keys")).toContainText("outside visible range");
  await history.getByRole("button", { name: "Reset view", exact: true }).click();
  await expect(history.locator(".chart-map-time")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: "test-results/dygraphs-mobile.png", fullPage: true });
  expect(fixture.requests()).toBe(1);
  expect(errors).toEqual([]);
});

test("Earlier/Later retrieve preceding days and double-click restores the selected period and zoom", async ({ page }) => {
  const fixture = await chartFixture(page, false, true);
  await page.getByRole("button", { name: "Open snow history" }).click();
  const history = page.getByRole("article").filter({ hasText: "Snow history" });
  const chart = history.getByRole("img");
  await expect(history.getByRole("combobox", { name: "History time range" })).toHaveValue("7");
  await expect(history.locator(".chart-footer")).toContainText("7 observations");
  await expect(history.locator(".chart-readout")).toHaveText("The black vertical line marks the selected map date and time.");
  await expect(history.getByText(/Hover (an interval|a class dot)/)).toHaveCount(0);
  expect(Date.parse(fixture.requestedRanges[0].end) - Date.parse(fixture.requestedRanges[0].start)).toBe(7 * 86400000);
  await expect(history.getByLabel("From (UTC)")).toHaveCount(0);
  await history.getByRole("combobox", { name: "History time range" }).selectOption("1");
  await expect(history.locator(".chart-footer")).toContainText("6 observations");
  const original = fixture.requestedRanges.at(-1)!;
  await history.getByRole("button", { name: "Earlier period" }).click();
  await expect(history.locator(".chart-footer")).toContainText("1 observations");
  await history.getByRole("img").focus(); await page.keyboard.press("Home");
  await expect(history.locator(".chart-readout")).toContainText("Class: Intermediate snow cover");
  await dragZoom(page, chart);
  await expect.poll(async () => { const range = await windowOf(chart); return range[1] - range[0]; }).toBeLessThan(86400000);
  await chart.dblclick({ position: { x: 240, y: 55 } });
  await expect(history.locator(".chart-footer")).toContainText("6 observations");
  await expect.poll(() => windowOf(chart)).toEqual([Date.parse(original.start), Date.parse(original.end)]);
  expect(fixture.requestedRanges.at(-1)).toEqual(original);
  await expect(history.getByRole("combobox", { name: "History time range" })).toHaveValue("1");
  // A later move from a different earlier period is cancelled by the same gesture.
  await history.getByRole("button", { name: "Earlier period" }).click();
  await expect(history.locator(".chart-footer")).toContainText("1 observations");
  await history.getByRole("button", { name: "Earlier period" }).click();
  await expect(history.locator(".chart-footer")).toContainText("0 observations");
  await history.getByRole("button", { name: "Later period" }).click();
  await expect(history.locator(".chart-footer")).toContainText("1 observations");
  await chart.dblclick({ position: { x: 240, y: 55 } });
  await expect(history.locator(".chart-footer")).toContainText("6 observations");
  expect(fixture.requestedRanges.at(-1)).toEqual(original);
  await history.getByRole("button", { name: "Dates", exact: true }).click();
  await expect(history.getByLabel("From (UTC)")).toBeVisible();
  expect(fixture.requests()).toBe(8);
});

for (const parameter of ["snow", "visibility"]) {
  test(`${parameter} history opens through the present when the map is showing an earlier date`, async ({ page }) => {
    const fixture = await chartFixture(page, false, true);
    const mapDate = new Date(Date.parse(fixture.at) - 36 * 3600000).toISOString().slice(0, 16);
    await page.getByLabel("Map time (UTC)").fill(mapDate);
    await page.getByRole("button", { name: "View time", exact: true }).click();
    const beforeOpening = Date.now();
    await page.getByRole("button", { name: `Open ${parameter} history` }).click();
    const history = page.getByRole("article");
    const chart = history.getByRole("img");
    await expect(history.locator(".chart-footer")).toContainText(`${parameter === "snow" ? 7 : 6} observations`);
    const initial = fixture.requestedRanges[0];
    expect(Date.parse(initial.end)).toBeGreaterThanOrEqual(beforeOpening);
    expect(Date.parse(initial.end)).toBeLessThanOrEqual(Date.now());
    expect(Date.parse(initial.end) - Date.parse(initial.start)).toBe(7 * 86400000);
    await expect(history.locator(".chart-map-time")).toBeVisible();
    await expect(history.locator(".chart-map-time")).toHaveAttribute("data-map-time", String(Date.parse(`${mapDate}Z`)));
    const plotBox = (await chart.boundingBox())!, guideBox = (await history.locator(".chart-map-time").boundingBox())!;
    expect(plotBox.x + plotBox.width - guideBox.x).toBeGreaterThan(plotBox.width * 0.15);
    await chart.focus(); await page.keyboard.press("End");
    await expect(history.locator(".chart-readout strong")).toHaveText(`${fixture.stamps.at(-1)!.slice(0, 19).replace("T", " ")} UTC`);
    const beforePreset = Date.now();
    await history.getByRole("combobox", { name: "History time range" }).selectOption("1");
    await expect(history.locator(".chart-footer")).toContainText("6 observations");
    expect(Date.parse(fixture.requestedRanges.at(-1)!.end)).toBeGreaterThanOrEqual(beforePreset);
    expect(Date.parse(fixture.requestedRanges.at(-1)!.end) - Date.parse(fixture.requestedRanges.at(-1)!.start)).toBe(86400000);
  });
}

test("empty Dygraphs histories keep the map-time guide and zoom controls without inventing results", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await chartFixture(page, true);
  await page.getByRole("button", { name: "Open snow history" }).click();
  const history = page.getByRole("article").filter({ hasText: "Snow history" });
  await expect(history.locator(".chart-footer")).toContainText("0 observations");
  await expect(history.locator(".chart-keys")).not.toContainText("snow threshold");
  await expect(history.locator(".chart-map-time")).toBeVisible();
  await dragZoom(page, history.getByRole("img"));
  await history.getByRole("button", { name: "Reset view", exact: true }).click();
  await history.getByRole("button", { name: "Raw model interval" }).click();
  await expect(history.locator(".chart-keys")).toContainText("No thresholds published");
  await expect(history.getByRole("img").locator("canvas").first()).toBeVisible();
  expect(errors).toEqual([]);
});
