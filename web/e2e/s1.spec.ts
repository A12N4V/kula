import { expect, test, type Page } from "@playwright/test";

// Module S1: the agents monolith is split into agents/ tabs composed by a thin
// Agents.tsx. This guards the composition: every tab still renders, with its
// own controls, after the split. Runs on the repo server's desktop project;
// the other widths are covered by ui.spec.ts.

async function open(page: Page, hash = "overview") {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
    try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto(`/#${hash}`);
}

test.describe("s1 agents split", () => {
  test("the agents menu lists every section: configure first, then activity", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop");
    await open(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); await page.keyboard.press("a"); // `a` opens Agents (its rail item is back as the config home)
    await expect(page.locator(".ag-menu .list-head h2")).toHaveText("Agents");
    const tabs = page.locator(".ag-tabs [role=tab]");
    await expect(tabs).toHaveCount(11);
    for (const name of ["Agents", "Teams", "Skills", "Instructions", "Fences", "Connect", "Settings", "Overview", "Research", "Memory", "Docs"]) {
      await expect(page.getByRole("tab", { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("tab", { name: "Agents", exact: true })).toHaveAttribute("aria-selected", "true");
  });

  test("workflows, memory and connect tabs compose their parts", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop");
    await open(page, "agents");
    await page.getByRole("tab", { name: "Agents", exact: true }).click();
    await expect(page.locator(".wf-tabs")).toBeVisible();
    await expect(page.locator(".wf-list [role=tab]").first()).toBeVisible();
    await expect(page.locator(".wf-edit")).toBeVisible();
    await page.getByRole("tab", { name: "Memory", exact: true }).click();
    await expect(page.locator(".ag-remember")).toBeVisible();
    await page.locator(".ag-tabs [role=tab]", { hasText: "Connect" }).click();
    await expect(page.locator(".conn-grid .conn").first()).toBeVisible();
    await expect(page.locator(".mod-grid .mod").first()).toBeVisible();
  });
});
