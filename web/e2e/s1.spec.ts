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
  test("the nine agents tabs all render after the split", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop");
    await open(page);
    await page.locator(".rail").getByRole("button", { name: "Agents" }).click();
    await expect(page.locator(".page-head h1")).toHaveText("Agents");
    const tabs = page.locator(".ag-tabs [role=tab]");
    await expect(tabs).toHaveCount(9);
    for (const name of ["Overview", "Workflows", "Research", "Teams", "Skills", "Fences", "Memory", "Docs", "Connect"]) {
      await expect(tabs.filter({ hasText: name })).toBeVisible();
    }
  });

  test("workflows, memory and connect tabs compose their parts", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop");
    await open(page, "agents");
    await page.locator(".ag-tabs [role=tab]", { hasText: "Workflows" }).click();
    await expect(page.locator(".wf-tabs")).toBeVisible();
    await expect(page.locator(".wf-tabs [role=tab]").first()).toBeVisible();
    await expect(page.locator(".wf-edit")).toBeVisible();
    await page.locator(".ag-tabs [role=tab]", { hasText: "Memory" }).click();
    await expect(page.locator(".ag-remember")).toBeVisible();
    await page.locator(".ag-tabs [role=tab]", { hasText: "Connect" }).click();
    await expect(page.locator(".conn-grid .conn").first()).toBeVisible();
    await expect(page.locator(".mod-grid .mod").first()).toBeVisible();
  });
});
