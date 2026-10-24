// X10 · Skills: local + GitHub search, and memory import. One search box with
// a two-way switch (This machine = the index; GitHub = skill_search, shown
// debounced), a GitHub row opening a preview pane that fetches raw text only
// on open, Import through skill_import (row says "installed", index
// refreshes), the Settings paste importer behind a disclosure, and the
// TencentDB Agent Memory banner in Memory with import + mcp adopt. All
// network is mocked with page.route – a test never hits GitHub.
import { expect, test, type Page, type Route } from "@playwright/test";
import { FIXTURE } from "../playwright.config";
import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";

test.use({ baseURL: FIXTURE });

test.describe.configure({ mode: "serial" });

/** Skip the first-run overlay, then land on a hash route. */
async function opened(page: Page, hash: string) {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto("about:blank");
  await page.goto(`/#${hash}`);
  await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 30_000 });
}

const HIT = { name: "code-review", repo: "anthropics/skills", path: "skills/code-review/SKILL.md", url: "https://github.com/anthropics/skills/blob/HEAD/skills/code-review/SKILL.md", source: "curated" as const };
const HIT2 = { name: "issue-triage", repo: "acme/skills", path: "triage/SKILL.md", url: "https://github.com/acme/skills/blob/HEAD/triage/SKILL.md", source: "search" as const };
const SKILL_MD = "---\nname: code-review\ndescription: Review a change before it merges\n---\n1. Read the diff.\n";
const importedRow = { name: "code-review", description: "Review a change before it merges", agent: "shared" as const, scope: "repo" as const, kind: "skill" as const, path: ".agents/skills/code-review/SKILL.md", meta: {}, body: "1. Read the diff." };

test("GitHub search: debounced hits, curated badge, preview pane, import", async ({ page }) => {
  let indexReads = 0;
  const queries: string[] = [];
  await page.route("**/api/agent/skill_search*", (r: Route) => {
    queries.push(new URL(r.request().url()).searchParams.get("q") ?? "");
    r.fulfill({ json: { hits: [HIT, HIT2] } });
  });
  await page.route("**/api/agent/skill_index", (r: Route) => {
    indexReads += 1;
    r.fulfill({ json: { skills: indexReads > 1 ? [importedRow] : [], instructions: [], searched: [".agents/skills"] } });
  });
  await page.route("**/api/agent/skill_import", (r: Route) => r.fulfill({ json: { name: "code-review", written: ".agents/skills/code-review" } }));
  await page.route("https://raw.githubusercontent.com/**", (r: Route) => r.fulfill({ body: SKILL_MD }));

  await opened(page, "agents/skills");
  await page.getByTestId("sx-mode-github").click();
  await expect(page.getByTestId("sx-github")).toBeVisible();
  // nothing requested until there is a term
  expect(queries).toEqual([]);

  // one debounce window for rapid typing – only the last query goes out
  await page.getByTestId("sx-q").pressSequentially("cod", { delay: 40 });
  await page.getByTestId("sx-q").fill("code review");
  await expect(page.getByTestId("sx-gh-code-review")).toBeVisible({ timeout: 5_000 });
  expect(queries).toEqual(["code review"]);

  // repo, curated badge, and a link that is a real anchor
  await expect(page.getByTestId("sx-gh-code-review").locator(".sx-desc")).toHaveText(/anthropics\/skills/);
  await expect(page.getByTestId("sx-gh-code-review").locator(".tag.accent")).toHaveText("curated");
  await expect(page.getByTestId("sx-gh-code-review").locator('a[href*="github.com"]')).toBeAttached();
  await expect(page.getByTestId("sx-gh-issue-triage")).toBeVisible();

  // the preview fetches the row's url only on open, and Import installs
  const fetches: string[] = [];
  page.on("request", (r) => { if (r.url().includes("raw.githubusercontent.com")) fetches.push(r.url()); });
  await page.getByTestId("sx-gh-code-review").click();
  const pane = page.getByTestId("sx-hit-pane");
  await expect(pane).toBeVisible();
  await expect(pane.locator(".sx-pane-body")).toContainText("Read the diff");
  // the preview reads the raw host – the github.com page is blocked cross-origin
  expect(fetches).toEqual([`https://raw.githubusercontent.com/${HIT.repo}/HEAD/${HIT.path}`]);

  await page.getByTestId("sx-import").click();
  await expect(page.getByTestId("sx-gh-code-review").getByTestId("sx-installed")).toHaveText("installed");
  await expect(pane).toHaveCount(0); // the pane closes after a successful import

  // the local index refreshed with the imported skill
  await page.getByTestId("sx-mode-local").click();
  await page.getByTestId("sx-q").fill(""); // the GitHub term would filter it out
  await expect(page.getByTestId("sx-row-code-review")).toBeVisible();
  expect(indexReads).toBeGreaterThan(1);
});

test("Local mode is unchanged: the index rows and Where we looked still work", async ({ page }) => {
  await page.route("**/api/agent/skill_index", (r: Route) => r.fulfill({
    json: { skills: [{ ...importedRow, body: "steps" }], instructions: [], searched: [".agents/skills", "~/.claude/skills"] },
  }));
  await opened(page, "agents/skills");
  await expect(page.getByTestId("skill-index")).toBeVisible();
  await expect(page.getByTestId("sx-mode-local")).toBeVisible();
  await expect(page.getByTestId("sx-mode-github")).toBeVisible();
  await page.getByTestId("sx-row-code-review").click();
  await expect(page.locator(".sx-detail")).toBeVisible();
  // masked behind a disclosure, present when opened
  const where = page.locator("details.sx-where");
  await expect(where.locator("summary")).toContainText("Where we looked");
  await where.locator("summary").click();
  await expect(where.locator("li")).toHaveCount(2);
});

test("Settings: the paste importer is a disclosure pointing at Skills", async ({ page }) => {
  await opened(page, "agents/settings");
  const more = page.getByTestId("set-import-more");
  await expect(more).toBeVisible();
  await expect(more).toHaveJSProperty("open", false); // masked by default
  await expect(page.getByTestId("set-skill-text")).toBeHidden();
  await expect(more.locator("summary")).toContainText("or search GitHub in Skills");

  await more.locator("summary").click();
  await expect(page.getByTestId("set-skill-text")).toBeVisible();
  await expect(page.getByTestId("set-import-github")).toBeVisible();

  // the pointer jumps to the Skills tab, GitHub side
  await page.getByTestId("set-import-github").click();
  await expect(page).toHaveURL(/agents\/skills/);
  await expect(page.getByTestId("sx-github")).toBeVisible();
});

// The memory test reads a real store: a fixture `.memory/memories.json` in
// the served repo, created here and removed again – nothing real is touched.
const FIXTURE_DIR = `/tmp/kula-fixture-${new URL(FIXTURE).port}.path`;
const store = () => `${readFileSync(FIXTURE_DIR, "utf8").trim()}/.memory`;
const MEM = JSON.stringify([
  { id: "m1", type: "constraint", category: "scope", content: "No service endpoint.", source_agent: "team" },
  { id: "m2", type: "decision", category: "api", content: "Pagination is cursor based.", source_agent: "team" },
  { id: "m3", type: "fact", category: "build", content: "WAL files are unlinked, never truncated.", source_agent: "team" },
], null, 2);

test("TencentDB memory: banner from a real store, import toast, MCP adopt", async ({ page }) => {
  test.skip(!existsSync(FIXTURE_DIR), "the fixture clone is not running");
  mkdirSync(store(), { recursive: true });
  writeFileSync(`${store()}/memories.json`, MEM);
  mkdirSync(`${store()}/wiki`, { recursive: true });
  writeFileSync(`${store()}/wiki/api.md`, "# Cursor pagination\nUse tokens.\n");
  const root = readFileSync(FIXTURE_DIR, "utf8").trim();
  const mcp = `${root}/.mcp.json`;
  // Only write .mcp.json when absent, and remember it so afterAll removes
  // exactly the file this spec created – nothing pre-existing is touched.
  const mcpWritten = !existsSync(mcp);
  if (mcpWritten) { writeFileSync(mcp, JSON.stringify({ mcpServers: { "tencentdb-memory": {} } })); mcpWrittenFlag = true; }

  let adoptBody: { name?: string } | null = null;
  await page.route("**/api/agent/memory_import", (r: Route) => r.fulfill({ json: { added: 3, skipped: 1 } }));
  await page.route("**/api/agents/mcp_adopt", (r: Route) => {
    adoptBody = r.request().postDataJSON() as { name?: string };
    r.fulfill({ json: { written: ["claude", "codex"] } });
  });
  await opened(page, "agents/memory");

  const banner = page.getByTestId("mem-tencent");
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expect(banner).toContainText("TencentDB Agent Memory in AGENTS");
  await expect(banner).toContainText("3 memories"); // 3 atomic memories
  await expect(banner).toContainText("1 wiki page");

  await page.getByTestId("mem-import").click();
  await expect(page.getByTestId("mem-import-done")).toHaveText("added 3 · skipped 1");
  await expect(page.locator(".toast")).toContainText(/added.*skipped/);

  await page.getByTestId("mem-adopt").click();
  await expect(page.locator(".toast").filter({ hasText: "adopted by every agent" })).toBeVisible();
  // the payload is B1's contract: the server key, under `name`
  expect(adoptBody).toEqual({ name: "tencentdb-memory" });
});

test("TencentDB memory: no store, no banner", async ({ page }) => {
  test.skip(!existsSync(FIXTURE_DIR), "the fixture clone is not running");
  const dir = store();
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  await opened(page, "agents/memory");
  await expect(page.getByTestId("skill-index")).toHaveCount(0);
  await expect(page.getByTestId("mem-tencent")).toHaveCount(0);
});

test.afterAll(() => {
  // clean up the fixture store whatever happened, and the .mcp.json this
  // spec wrote – the exact file it created, never a pre-existing one
  try { rmSync(store(), { recursive: true, force: true }); } catch { /* gone already */ }
  if (mcpWrittenFlag) { try { rmSync(`${readFileSync(FIXTURE_DIR, "utf8").trim()}/.mcp.json`); } catch { /* gone already */ }
    mcpWrittenFlag = false; }
});
// set inside the memory test; module scope so afterAll can see it
let mcpWrittenFlag = false;
