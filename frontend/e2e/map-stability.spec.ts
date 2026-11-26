import { expect, test } from "@playwright/test";
import { LANGUAGES } from "../src/i18n/languages";
import { chartFixture } from "./fixtures/webcam";

for (const width of [1280, 800, 390]) {
  test(`parameter and language changes preserve the map view and layout at ${width}px`, async ({ page }) => {
    test.setTimeout(90000);
    await chartFixture(page);
    await expect(page.locator(".map-wrap")).toHaveAttribute("aria-busy", "false");
    await page.setViewportSize({ width, height: 1000 });
    const canvas = page.locator(".maplibregl-canvas");
    // Move away from the selected site's automatic focus before reloading its data.
    await canvas.press("ArrowRight");
    await page.waitForTimeout(700);
    const frame = async () => canvas.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return [rect.x, rect.y, rect.width, rect.height];
    });
    const view = async () => page.locator(".map").getAttribute("data-view");
    const initialFrame = await frame(), initialView = await view();
    expect(initialView).toBeTruthy();
    for (const parameter of [1, 0]) {
      await page.locator(".parameter-switch button").nth(parameter).click();
      await expect(page.locator(".refresh-controls button")).not.toBeDisabled();
      await expect(page.locator(".camera-name")).toHaveText("Chart camera");
      await page.waitForTimeout(500);
      expect(await frame()).toEqual(initialFrame);
      expect(await view()).toBe(initialView);
    }
    for (const language of LANGUAGES) {
      await page.locator(".language-menu select").selectOption(language.code);
      await expect(page.locator(".language-menu select")).not.toBeDisabled();
      await page.waitForTimeout(35);
      expect(await frame(), language.code).toEqual(initialFrame);
      expect(await view(), language.code).toBe(initialView);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), language.code).toBe(true);
    }
    await page.screenshot({ path: `test-results/stable-map-${width}.png`, fullPage: true });
  });
}
