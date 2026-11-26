import { expect, test } from "@playwright/test";
import { LANGUAGES, LANGUAGE_STORAGE_KEY } from "../src/i18n/languages";
import { chartFixture } from "./fixtures/webcam";

test.use({ storageState: { cookies: [], origins: [] } });

test("France defaults to French and the language menu precedes Admin", async ({ page }) => {
  await chartFixture(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.locator(".language-menu select")).toHaveValue("fr");
  await expect(page.getByLabel("Scènes qualifiées uniquement")).toBeVisible();
  await expect(page.getByText("Couverture non différenciée", { exact: true })).toBeVisible();
  await expect(page.getByText("Couverture étendue", { exact: true })).toBeVisible();
  await expect(page.locator(".legend h2")).toHaveCount(0);
  const language = (await page.locator(".language-menu").boundingBox())!;
  const admin = (await page.locator(".topbar-right > button").boundingBox())!;
  expect(language.x + language.width).toBeLessThanOrEqual(admin.x);
  await expect(page.locator(".camera-name")).toHaveText("Chart camera");
  await page.locator(".history-actions button").first().click();
  await expect(page.locator(".chart-readout")).toContainText("timestamp sélectionné");
  await expect(page.locator(".dygraph-chart")).toBeVisible();
  await page.screenshot({ path: "test-results/language-fr-desktop.png", fullPage: true });
});

test("every language switches without API reloads, losing the popup or resetting chart zoom", async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const fixture = await chartFixture(page);
  await page.locator(".history-actions button").first().click();
  const chart = page.locator(".dygraph-chart");
  await expect(chart).toBeVisible();
  await chart.scrollIntoViewIfNeeded();
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.35, box.y + 55); await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + 55, { steps: 8 }); await page.mouse.up();
  const windowBefore = await chart.evaluate(element => [(element as HTMLElement).dataset.windowStart, (element as HTMLElement).dataset.windowEnd]);
  const canvas = await page.locator(".maplibregl-canvas").elementHandle();
  const apiRequests: string[] = [];
  page.on("request", request => { if (request.url().includes("/api/")) apiRequests.push(request.url()); });
  for (const language of LANGUAGES) {
    await page.locator(".language-menu select").selectOption(language.code);
    await expect(page.locator("html")).toHaveAttribute("lang", language.code === "cnr" ? "sr-ME" : language.code);
    await expect(page.locator(".language-menu select")).not.toBeDisabled();
    await expect(page.locator(".camera-name")).toHaveText("Chart camera");
    expect(await chart.evaluate(element => [(element as HTMLElement).dataset.windowStart, (element as HTMLElement).dataset.windowEnd])).toEqual(windowBefore);
    expect(await page.evaluate(canvas => document.querySelector(".maplibregl-canvas") === canvas, canvas)).toBe(true);
  }
  expect(apiRequests).toEqual([]);
  expect(fixture.requests()).toBe(1);
  await page.locator(".language-menu select").selectOption("de");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await page.reload();
  await expect(page.locator(".language-menu select")).toHaveValue("de");
  expect(await page.evaluate(key => localStorage.getItem(key), LANGUAGE_STORAGE_KEY)).toBe("de");
  expect(errors).toEqual([]);
});

test("mobile languages fit the header and the deployment can override the ROI default", async ({ page }) => {
  await chartFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const language of ["fr", "de", "fi", "el"]) {
    await page.locator(".language-menu select").selectOption(language);
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: "test-results/language-mobile.png", fullPage: true });
  await page.evaluate(key => localStorage.removeItem(key), LANGUAGE_STORAGE_KEY);
  await page.route("**/frontend-config.json", async route => {
    const configuration = await (await route.fetch()).json();
    await route.fulfill({ json: { ...configuration, language: "fi" } });
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "fi");
  await expect(page.locator(".language-menu select")).toHaveValue("fi");
});
