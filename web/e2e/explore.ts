import type { Page } from "@playwright/test";

/** The map's controls live in the Explorer (top-right toggle): open it if shut. */
export async function explore(page: Page) {
  const btn = page.locator("[data-testid=map-explorer-btn]");
  await btn.waitFor({ state: "visible", timeout: 30_000 });
  if ((await btn.getAttribute("aria-expanded")) !== "true") await btn.click();
}
