import type { Page } from "@playwright/test";

/** The map's controls live in the Explorer (top-right toggle) and, since X14,
    the layers and display options in Map settings (see mapSettings). */
export async function explore(page: Page) {
  const btn = page.locator("[data-testid=map-explorer-btn]");
  await btn.waitFor({ state: "visible", timeout: 30_000 });
  if ((await btn.getAttribute("aria-expanded")) !== "true") await btn.click();
}

/** X14: layers, tidy and display options sit in the Map settings popover. */
export async function mapSettings(page: Page) {
  const btn = page.locator("[data-testid=map-settings-btn]");
  if (!(await btn.count())) return;
  if ((await btn.getAttribute("aria-expanded")) !== "true") await btn.click();
}
