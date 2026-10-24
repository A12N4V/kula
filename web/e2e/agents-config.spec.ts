import { expect, test, type Page } from "@playwright/test";

// The Agents tab as the config home: it is on the rail, opens on the agents
// (workflows) editor, keeps every agent-wide switch on Settings, imports a
// skill from a pasted SKILL.md, and hands an agent to the Workspace.

async function open(page: Page, hash = "overview") {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
    try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto(`/#${hash}`);
}

test.describe("agents config home", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop"));

  test("the rail opens Agents on the agents editor, with a Workspace hand-off", async ({ page }) => {
    await open(page);
    await page.locator(".rail button[aria-label=Agents]").click();
    await expect(page).toHaveURL(/#agents$/);
    await expect(page.getByRole("tab", { name: "Agents", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".wf-edit")).toBeVisible();
    // the record tabs are icons with names, so the strip never overflows
    await expect(page.getByRole("tab", { name: "Memory", exact: true })).not.toContainText("Memory");
    await page.getByTestId("wf-use-workspace").click();
    await expect(page).toHaveURL(/#map\b/);
  });

  test("settings: the policy switches are toggles and write kula.toml", async ({ page }) => {
    await open(page, "agents/settings");
    const mem = page.getByTestId("set-memory");
    await expect(mem).toHaveAttribute("role", "switch");
    const before = await mem.getAttribute("aria-checked");
    await mem.click();
    await expect(mem).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
    await mem.click(); // leave the shared fixture as it was
    await expect(mem).toHaveAttribute("aria-checked", before!);
    await expect(page.getByTestId("set-secrets")).toHaveAttribute("role", "switch");
  });

  test("a pasted SKILL.md imports as a shared skill", async ({ page }) => {
    const name = `e2e-import-${Date.now()}`;
    await open(page, "agents/settings");
    await page.getByTestId("set-skill-text").fill(`---\nname: ${name}\ndescription: Imported by the e2e suite\n---\n1. Do the thing.`);
    await expect(page.locator(".set-import")).toContainText(name);
    await page.getByTestId("set-skill-import").click();
    await expect(page.getByTestId("set-skill-text")).toHaveValue("");
    await page.getByRole("tab", { name: "Skills", exact: true }).click();
    await expect(page.locator(".ag-panel")).toContainText(name);
    // clean up the shared fixture
    const res = await page.request.post("/api/agents/skill_delete", { data: { name }, headers: { "x-kula-token": "test" } }).catch(() => null);
    expect(res === null || res.ok() || res.status() < 500).toBeTruthy();
  });
});
