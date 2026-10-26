import { expect, test as base, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

// U18: agents are neutral (no service picker, no direct Workspace deploy) and
// teams are an open canvas – the view fills the tab like the Map, a thin tab
// bar (icon + name, + to add, × to delete) on top, limits chips in the canvas
// header, and a sidebar that leads with settings and Limits & domains: the
// team's fences, path domains, cost/turn limits and autonomy (B2 shapes).
// "Add to team" is a search box, never a list of every agent, and research
// loops are neither agent cards nor team members.

/** Path to e2e/fixture.sh whether the runner was started from web/ or the repo root. */
function fixtureScript(): string {
  const cwd = process.cwd();
  const p = path.join(cwd, "e2e", "fixture.sh");
  if (fs.existsSync(p)) return p;
  throw new Error("e2e/fixture.sh not found");
}

const test = base.extend({
  fx: [
    async ({ }, use, workerInfo) => {
      let port = // +40: every module's specs derive base+10+N and clean /tmp/kula-fixture-<port> –
      // a shared pool here collides with a concurrent module's run (its teardown
      // deletes our clone). A private offset keeps u18's fixtures out of that fight.
      Number(process.env.KULA_PW_PORT ?? 7431) + 40 + workerInfo.workerIndex;
      const taken = async (p: number) => {
        try { await fetch(`http://localhost:${p}/`, { signal: AbortSignal.timeout(300) }); return true; } catch { return false; }
      };
      for (let p = port + 1; p < port + 12 && (await taken(port)); p++) port = p;
      const logFile = `/tmp/kula-fx-w${workerInfo.workerIndex}.log`;
      const log = fs.openSync(logFile, "w");
      const proc = spawn("sh", [fixtureScript(), String(port)], {
        cwd: path.dirname(fixtureScript()) + "/..",
        stdio: ["ignore", log, log],
        env: { ...process.env, TMPDIR: "/tmp" },
      });
      const url = `http://localhost:${port}`;
      const deadline = Date.now() + 180_000;
      let up = false;
      while (Date.now() < deadline) {
        try { if ((await fetch(url)).ok) { up = true; break; } } catch { /* not up yet */ }
        await new Promise((f) => setTimeout(f, 300));
      }
      if (!up) {
        const out = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "(no log)";
        throw new Error(`fixture on port ${port} did not come up in 180s\nfixture log:\n${out}`);
      }
      const probe = await fetch(`${url}/api/agents`, { headers: { "x-kula-token": "test" } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const ours = probe && Array.isArray(probe.rules) && probe.rules.some((r: { reason?: string }) => r.reason === "release pipeline: signed packages");
      if (!ours) throw new Error(`something else is serving on fixture port ${port} – not this run's fixture\nfixture log:\n${fs.readFileSync(logFile, "utf8")}`);
      await use(url);
      proc.kill("SIGTERM");
      fs.closeSync(log);
      try {
        const repo = fs.readFileSync(`/tmp/kula-fixture-${port}.path`, "utf8").trim();
        fs.rmSync(repo, { recursive: true, force: true });
        fs.rmSync(`/tmp/kula-fixture-${port}.path`, { force: true });
      } catch { /* fixture may have died before writing the path file */ }
    },
    { scope: "worker", timeout: 240_000 },
  ],
});

test.use({ baseURL: ({ fx }, use) => use(fx) });

async function open(page: Page, hash = "agents/teams") {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
    try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto(`/#${hash}`);
  await page.waitForLoadState("networkidle").catch(() => {});
}

test.describe("teams: open canvas, thin tab bar, limits", () => {
  test("the canvas fills the view – no enclosing card – under a thin tab bar with + and ×", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop");
    await open(page);
    await expect(page.getByTestId("teams-view")).toBeVisible();
    // the view is not wrapped in a Card: no card head repeating a page title
    await expect(page.getByTestId("teams-view").locator(".card-head")).toHaveCount(0);
    // one tab per team, each led by its icon; + adds, × deletes the open team
    await expect(page.getByTestId("team-tab-ship")).toBeVisible();
    await expect(page.getByTestId("team-tab-add")).toBeVisible();
    await page.getByTestId("team-tab-ship").click();
    const del = page.getByTestId("team-tab-delete");
    await expect(del).toBeVisible();
    await expect(del).toHaveAttribute("aria-label", /ship/);
    // the canvas shows the team's seats with their orange marks
    const canvas = page.getByTestId("team-canvas");
    await expect(canvas).toBeVisible();
    await expect(canvas.locator(".tc-node").first()).toBeVisible();
  });

  test("× deletes the open team after a confirm; the next tab takes over", async ({ page, request }, info) => {
    test.skip(info.project.name !== "desktop");
    await open(page);
    const name = `u18-crew-${Date.now() % 100000}`;
    await page.getByTestId("team-tab-add").click();
    await page.getByTestId("team-add-name").fill(name);
    await page.getByTestId("team-add-name").press("Enter");
    const tab = page.getByTestId(`team-tab-${name}`);
    await expect(tab).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("team-tab-delete").click();
    await expect(tab).toHaveCount(0);
    await expect.poll(async () => (await (await request.get("/api/file?path=kula.toml", { headers: { "x-kula-token": "test" } })).json()).content)
      .not.toContain(`name = "${name}"`);
    // the canvas never goes blank: another team is showing
    await expect(page.getByTestId("team-canvas")).toBeVisible();
  });

  test("the canvas header shows cost, turn and autonomy chips; Deploy to Workspace is the team action", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop");
    await open(page);
    await page.getByTestId("team-tab-ship").click();
    // at least the autonomy chip is always there
    await expect(page.getByTestId("tc-limit-chip").first()).toBeVisible();
    await expect(page.locator(".tc-chip").filter({ hasText: /ask|act|full/ }).first()).toBeVisible();
    // deploying is a team action – the button says so, the agent card has none
    await expect(page.getByTestId("team-work")).toHaveText(/Deploy to Workspace/);
  });

  test("the sidebar leads with settings and Limits & domains: autonomy, limits, domains, fences, inherited", async ({ page, request }, info) => {
    test.skip(info.project.name !== "desktop");
    await open(page);
    await page.getByTestId("team-tab-ship").click();
    await page.getByTestId("team-side-toggle").click();
    const side = page.getByTestId("team-side");
    await expect(side).toBeVisible();
    // settings and limits come before the members
    const settings = side.locator(".tc-side-settings");
    const limits = side.getByTestId("tc-limits");
    const members = side.locator(".tc-side-members");
    await expect(settings).toBeVisible();
    await expect(limits).toBeVisible();
    await expect(members).toBeVisible();
    expect(await settings.boundingBox()!.then((b) => b!.y)).toBeLessThan(await members.boundingBox()!.then((b) => b!.y));
    expect(await limits.boundingBox()!.then((b) => b!.y)).toBeLessThan(await members.boundingBox()!.then((b) => b!.y));
    // autonomy is a three-way choice; cost and turn limits are number fields
    await expect(side.getByTestId("tc-autonomy-act")).toBeVisible();
    await side.getByTestId("tc-autonomy-act").click();
    await expect(side.getByLabel("Max cost")).toBeVisible();
    await expect(side.getByLabel("Max turns")).toBeVisible();
    // domains are chips; a fence can be added with a level and paths
    await expect(side.locator(".tc-limits").getByLabel("Domains")).toBeVisible();
    await side.getByRole("button", { name: "Add fence" }).click();
    await expect(side.getByTestId("tc-fence-0")).toBeVisible();
    await side.getByLabel("Fence 1 paths").fill("src/guard.rs");
    await expect.poll(async () => (await (await request.get("/api/file?path=kula.toml", { headers: { "x-kula-token": "test" } })).json()).content)
      .toContain("[[team.fences]]");
    // the repository's global fences still load, shown as inherited chips
    await expect(side.locator(".tc-inh-chip").first()).toContainText(/locked|review/);
    // cleaning up the fence keeps the saved team valid
    await side.getByRole("button", { name: "Remove fence 1" }).click();
    await expect(side.getByTestId("tc-fence-0")).toHaveCount(0);
  });

  test("add to team is a search box; research loops never appear; member rows are divs with sibling buttons", async ({ page, request }, info) => {
    test.skip(info.project.name !== "desktop");
    await open(page);
    await page.getByTestId("team-tab-ship").click();
    await page.getByTestId("team-side-toggle").click();
    const side = page.getByTestId("team-side");
    // the search box filters; the pool is exactly the repository's
    // non-research workflows – the same rule the Research tab uses
    const json = await (await request.get("/api/agents", { headers: { "x-kula-token": "test" } })).json();
    const pool = json.workflows.filter((w: { research?: { metric?: string } }) => !w.research?.metric).length;
    // the search box filters; autoresearch (a research loop) is never offered
    const search = side.getByTestId("tc-add-search");
    await expect(search).toBeVisible();
    await search.fill("doc");
    await expect(side.getByTestId("tc-agent-docs")).toBeVisible();
    await expect(side.getByTestId("tc-agent-explore")).toHaveCount(0);
    await search.fill("");
    await expect(side.locator(".tc-acard")).toHaveCount(pool);
    // add and remove through the search results
    const add = side.getByTestId("team-add-docs");
    await expect(add).toHaveAttribute("aria-pressed", "false");
    await add.click();
    await expect(side.getByTestId("team-add-docs")).toHaveAttribute("aria-pressed", "true");
    // member rows: a div with two sibling buttons – open, and remove
    const row = side.locator(".tc-mcard").first();
    await expect(row).toHaveClass(/tc-mcard/);
    await expect(row.locator(".tc-mrow-open")).toBeVisible();
    await expect(row.getByRole("button", { name: /Remove/ })).toBeVisible();
    expect(await row.locator("> button").count()).toBe(2); // open + remove, siblings
    // the seat's edit holds the service picker
    await row.locator(".tc-mrow-open").click();
    await expect(side.getByLabel("Service")).toBeVisible();
    await side.getByLabel("Service").selectOption("codex");
    await expect(side.getByLabel("Service")).toHaveValue("codex");
  });
});

test.describe("agents: neutral cards, lean panel", () => {
  test("research loops are not agent cards; the + card still adds; the panel has no service picker", async ({ page, request }, info) => {
    test.skip(info.project.name !== "desktop");
    await open(page, "agents");
    // the cards are exactly the repository's non-research workflows: research
    // loops live on their own tab (U19), never as agent cards
    const json = await (await request.get("/api/agents", { headers: { "x-kula-token": "test" } })).json();
    const agents = json.workflows.filter((w: { research?: { metric?: string } }) => !w.research?.metric).map((w: { name: string }) => w.name);
    await expect(page.locator(".ag-cards .ag-card")).toHaveCount(agents.length + 1); // + the add card
    await expect(page.locator(".ag-cards .card__fmt").filter({ hasText: "autoresearch" })).toHaveCount(0);
    // the + card opens the compact add form
    await page.getByTestId("ag-card-add").click();
    await expect(page.getByTestId("ag-add-form")).toBeVisible();
    await page.getByTestId("ag-add-form").getByRole("button", { name: "Cancel" }).click();
    // a card opens the panel: basics, collapsible sections, one primary action
    await page.locator("[data-testid^=ag-card-]:not([data-testid=ag-card-add])").first().locator(".card__t").click();
    const side = page.getByTestId("ag-side");
    await expect(side).toBeVisible();
    for (const id of ["steps", "skills", "autonomy", "fences"]) {
      await expect(side.getByTestId(`ag-sec-${id}`)).toBeVisible();
    }
    await expect(side.getByLabel("Service")).toHaveCount(0);
    await expect(side.getByRole("button", { name: "Use on Workspace" })).toHaveCount(0);
    const primary = side.getByRole("button", { name: /Save/ });
    await expect(primary).toHaveClass(/primary/);
    // sections collapse and reopen
    const stepsHead = side.getByTestId("ag-sec-steps").locator(".ag-sec-head");
    await stepsHead.click();
    await expect(side.getByTestId("ag-sec-steps").locator(".ag-sec-body")).toHaveCount(0);
    await stepsHead.click();
    await expect(side.getByTestId("ag-sec-steps").locator(".ag-sec-body")).toBeVisible();
  });
});

test.describe("teams on a phone", () => {
  test("@mobile the toolbar wraps, nothing scrolls sideways, zoom sits in a corner off the nodes", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "phone-only check");
    await open(page);
    await page.getByTestId("team-tab-ship").click();
    await expect(page.getByTestId("team-canvas")).toBeVisible();
    // no horizontal scroll on the page
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(scroll).toBeLessThanOrEqual(0);
    // the zoom cluster is in a corner, on its own ground, off the nodes
    const ctl = page.getByTestId("team-zoom-in");
    await expect(ctl).toBeVisible();
    const box = await ctl.boundingBox();
    const canvas = await page.getByTestId("team-canvas").boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(canvas!.y);
    expect(box!.x).toBeGreaterThanOrEqual(canvas!.x);
    // no zoom control intersects a member square
    const nodeBoxes = [];
    for (let i = 0; i < await page.locator(".tc-node").count(); i++) nodeBoxes.push(await page.locator(".tc-node").nth(i).boundingBox());
    for (const n of nodeBoxes.filter(Boolean)) {
      const across = box!.x < n.x + n.width && box!.x + box!.width > n.x;
      const down = box!.y < n.y + n.height && box!.y + box!.height > n.y;
      expect(across && down, "a zoom control overlaps a member square").toBe(false);
    }
  });
});
