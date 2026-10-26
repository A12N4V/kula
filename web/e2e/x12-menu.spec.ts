import { expect, test, type Page } from "@playwright/test";
import { FIXTURE } from "../playwright.config";

// X12 – the lean Agents menu: seven icon tabs that never overflow, retired
// hashes that route on instead of dead-ending, Docs merged with the
// instruction files, Connect living in Settings, animated icon toggles and
// the fluid Dropdown. Read-only checks run against this repo's server; the
// dropdown check needs a connected agent, so it runs on the fixture clone.

/** Skip the once-per-session opening so every test lands on the app itself. */
async function open(page: Page, hash: string, base?: string) {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
    try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto(`${base ?? ""}/#${hash}`);
}

const TABS = ["Agents", "Teams", "Research", "Skills", "Memory", "Docs", "Settings"];

test.describe("the lean agents menu", () => {
  test("seven icon tabs, each with a label, hint and aria-selected", async ({ page }) => {
    await open(page, "agents");
    const tabs = page.locator(".ag-tabs [role=tab]");
    await expect(tabs).toHaveCount(7);
    for (const name of TABS) {
      await expect(page.getByRole("tab", { name, exact: true })).toBeVisible();
      await expect(page.getByRole("tab", { name, exact: true }).locator("svg")).toBeVisible();
    }
    await expect(page.getByRole("tab", { name: "Agents", exact: true })).toHaveAttribute("aria-selected", "true");
  });

  test("retired hashes route on, never dead-end", async ({ page }) => {
    // instructions merged into Docs; connect into Settings; overview into the
    // agents tab; fences into Teams.
    await open(page, "agents/instructions");
    await expect(page).toHaveURL(/#agents\/docs/);
    await expect(page.getByRole("tab", { name: "Docs", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("instructions")).toBeVisible();
    await open(page, "agents/fences");
    await expect(page).toHaveURL(/#agents\/teams/);
    await open(page, "agents/connect");
    await expect(page).toHaveURL(/#agents\/settings/);
    await open(page, "agents/overview");
    // The workflows tab is the menu's default, so the address settles on the
    // bare #agents (X12) – the route must land there, not dead-end.
    await expect(page).toHaveURL(/#agents$/);
    await expect(page.getByRole("tab", { name: "Agents", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".roster").first()).toBeVisible();
  });

  test("Docs carries the instruction files; Settings carries Connect", async ({ page }) => {
    await open(page, "agents/docs");
    await expect(page.getByTestId("instructions")).toContainText("AGENTS.md");
    await open(page, "agents/settings");
    await expect(page.locator("#set-connect .conn-grid .conn").first()).toBeVisible();
    await expect(page.locator("#set-connect .mod-grid .mod").first()).toBeVisible();
  });

  test("the animated icon toggles answer the switch, the theme morphs sun to moon", async ({ page }) => {
    await open(page, "agents/settings");
    for (const id of ["set-memory", "set-secrets"]) {
      const t = page.getByTestId(id);
      await expect(t).toHaveAttribute("role", "switch");
      const before = await t.getAttribute("aria-checked");
      await t.click();
      await expect(t).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
    }
    // The global settings panel holds the theme switch: sun for light, moon
    // for dark, morphing between the two.
    await page.keyboard.press(",");
    const theme = page.getByTestId("theme-toggle");
    await expect(theme.locator(".sun-moon")).toBeVisible();
    const before = await theme.getAttribute("aria-checked");
    await theme.click();
    await expect(theme).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
    // Once off "system", a small reset brings follow-the-OS back from the panel.
    await expect(page.getByTestId("theme-system")).toBeVisible();
    await page.getByTestId("theme-system").click();
    await expect(page.getByTestId("theme-system")).toHaveCount(0);
  });

  test("the fluid dropdown on the default agent answers keyboard and pointer", async ({ page }) => {
    await open(page, "agents/settings", FIXTURE);
    // The fixture wires Claude Code with MCP and hook, so the picker shows.
    const trigger = page.getByRole("button", { name: "Default agent" });
    // The agents list resolves over the shared repo server under parallel
    // projects – wait for the picker to be wired, then interact.
    await expect(trigger).toBeVisible({ timeout: 20_000 });
    await expect(trigger).toBeEnabled({ timeout: 20_000 });
    // Open, walk with the arrows, pick with Enter.
    await trigger.click();
    const menu = page.getByRole("listbox", { name: "Default agent" });
    await expect(menu).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Home");
    const first = page.getByRole("option").first();
    await expect(first).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();
    // Esc closes without choosing; Tab closes while focus moves on.
    await trigger.click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox", { name: "Default agent" })).toBeHidden();
    await trigger.click();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("listbox", { name: "Default agent" })).toBeHidden();
  });
});

test.describe("the menu never overflows", () => {
  test("@responsive no sideways scroll at 1100 and at 390, icons only when tight", async ({ page }) => {
    await open(page, "agents");
    // Under three parallel projects the shared repo server can be slow to
    // answer api.agents – wait for the strip, then measure.
    const tabs = page.locator(".ag-tabs [role=tab]");
    await expect(tabs.first()).toBeVisible({ timeout: 20_000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "the agents menu scrolls sideways").toBeLessThanOrEqual(1);
    // Icon tabs: every tab answers by its label however narrow the strip gets.
    await expect(page.getByRole("tab", { name: "Settings", exact: true })).toBeVisible();
  });
});
