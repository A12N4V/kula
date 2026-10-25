import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/** The repo the test server indexes (playwright runs `kula -C ..` from web/). */
const REPO = path.resolve(process.cwd(), "..");

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
    // a portfolio, not a graph: the agents are cards; the editor opens in the
    // sidebar when a card is clicked
    await expect(page.locator("[data-testid^=ag-card-]").first()).toBeVisible();
    await expect(page.locator(".wf-graph")).toHaveCount(0);
    await page.locator("[data-testid^=ag-card-]").first().locator(".card__t").click();
    await expect(page.locator(".wf-edit")).toBeVisible();
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
    // the paste importer lives behind the X10 disclosure – open it first
    await page.getByTestId("set-import-more").locator("summary").click();
    await page.getByTestId("set-skill-text").fill(`---\nname: ${name}\ndescription: Imported by the e2e suite\n---\n1. Do the thing.`);
    await expect(page.locator(".set-import")).toContainText(name);
    await page.getByTestId("set-skill-import").click();
    await expect(page.getByTestId("set-skill-text")).toHaveValue("");
    // the skills index lists it where Codex reads it, as a repo skill for every agent
    await page.getByRole("tab", { name: "Skills", exact: true }).click();
    await page.getByTestId("sx-q").fill(name);
    const row = page.getByTestId(`sx-row-${name}`);
    await expect(row).toContainText("Imported by the e2e suite");
    await row.click();
    await expect(page.locator(".sx-detail")).toContainText(`.agents/skills/${name}/SKILL.md`);
    await expect(page.locator(".sx-detail")).toContainText("Every agent");
    // the server runs on this repo: take the skill and any agent copies back out
    for (const d of [".agents/skills", ".claude/skills", ".gemini/skills"]) fs.rmSync(path.join(REPO, d, name), { recursive: true, force: true });
    fs.rmSync(path.join(REPO, ".cursor/rules", `${name}.mdc`), { force: true });
  });

  test("instructions list the files each agent reads first", async ({ page }) => {
    await open(page, "agents/instructions");
    // the repo's root AGENTS.md is what Codex reads before anything else
    await expect(page.getByTestId("instructions")).toContainText("AGENTS.md");
  });
});
