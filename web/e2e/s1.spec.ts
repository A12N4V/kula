import { expect, test, type Page } from "@playwright/test";

// Module S1, after H.4: the nine agents tabs are one hub. This guards the
// composition: palette, canvas and inspector render together, and the mode
// and map toggles are there. Read only: it runs against the repo's own
// server, so it never saves, drags or drops.

async function open(page: Page, hash = "overview") {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
    try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto(`/#${hash}`);
}

test.describe("s1 agent hub", () => {
  test("the hub composes palette, canvas and inspector", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop");
    await open(page);
    await page.locator(".rail").getByRole("button", { name: "Agents" }).click();
    await expect(page.locator(".page-head h1")).toHaveText("Agents");
    const palette = page.getByRole("complementary", { name: "Palette" });
    await expect(palette).toBeVisible();
    for (const g of ["agent", "template", "skill", "mcp", "memory"]) await expect(palette.locator(`.hub-pal-group[data-kind="${g}"]`)).toBeVisible();
    await expect(page.locator(".hub-canvas")).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Inspector" })).toBeVisible();
    const mode = page.getByRole("group", { name: "Mode" });
    for (const m of ["Build", "Live", "Runs"]) await expect(mode.getByRole("button", { name: m })).toBeVisible();
    await expect(page.getByRole("button", { name: "Flow map" })).toBeVisible();
    await expect(page.locator(".ag-tabs")).toHaveCount(0);
  });
});
