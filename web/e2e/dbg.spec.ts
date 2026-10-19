import { test as base, expect } from "@playwright/test";
const test = base;
test("dbg dock", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 844 });
  await page.addInitScript(() => { sessionStorage.setItem("kula.opened", "1"); localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); });
  await page.goto("/#graph");
  await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 30_000 });
  await page.getByTestId("sb-dock").click();
  await page.waitForTimeout(500);
  const n = await page.locator("[data-testid=dock]").count();
  console.log("dock count:", n);
  const vis = await page.getByTestId("sb-dock").isVisible();
  console.log("sb-dock visible:", vis);
});
