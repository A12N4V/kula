import { expect, test as base, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

/** Path to e2e/fixture.sh whether the runner was started from web/ or the repo root. */
function fixtureScript(): string {
  for (const cwd of [process.cwd(), path.resolve(process.cwd(), "..")]) {
    const p = path.join(cwd, "e2e", "fixture.sh");
    if (fs.existsSync(p)) return p;
  }
  throw new Error("e2e/fixture.sh not found");
}

/** The agents tests write to their fixture (kula.toml, memories, docs), so every
 * worker gets its own: no two workers, projects or repeats ever share one. */
const test = base.extend({
  fx: [
    async ({ }, use, workerInfo) => {
      // KULA_PW_PORT + 10 + workerIndex collides when another checkout's dev
      // server already owns that port: any 200 would pass the wait loop and
      // the tests would read a foreign repo. Scan for a port where nothing
      // answers before spawning the fixture on it.
      let port = Number(process.env.KULA_PW_PORT ?? 7431) + 10 + workerInfo.workerIndex;
      const taken = async (p: number) => {
        try { await fetch(`http://localhost:${p}/`, { signal: AbortSignal.timeout(300) }); return true; } catch { return false; }
      };
      for (let p = port + 1; p < port + 12 && (await taken(port)); p++) port = p;
      // TMPDIR=/tmp: mktemp in /var/folders is denied in this worktree, so the
      // fixture repo must live somewhere we can actually write. The log is kept
      // and printed on failure – a fixture that dies silently is unfixable.
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
      await use(url);
      proc.kill("SIGTERM");
      fs.closeSync(log);
      // Remove this worker's fixture repo (the path file is written by fixture.sh).
      try {
        const repo = fs.readFileSync(`/tmp/kula-fixture-${port}.path`, "utf8").trim();
        fs.rmSync(repo, { recursive: true, force: true });
        fs.rmSync(`/tmp/kula-fixture-${port}.path`, { force: true });
      } catch { /* fixture may have died before writing the path file */ }
    },
    { scope: "worker", timeout: 240_000 },
  ],
});

// Skip the once-per-session opening so every test lands on the app itself.
// The map specs drive the force map, so it is the layout unless a test asks for the canvas.
async function open(page: Page, hash = "overview", layout: "symbol" | "canvas" = "symbol") {
  await page.addInitScript((layout) => {
    try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
    try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
    try { if (!localStorage.getItem("kula.graph.layout")) localStorage.setItem("kula.graph.layout", layout); } catch { /* */ }
  }, layout);
  await page.goto(`/#${hash}`);
}

const radius = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).borderTopLeftRadius);

test.describe("shell", () => {
  test("loads the overview for this repository", async ({ page }) => {
    await open(page);
    // The title is the repository's directory name, whatever the checkout is called.
    const repo = await page.evaluate(() => fetch("/api/repo", { headers: { "x-kula-token": document.querySelector('meta[name="kula-token"]')?.content ?? "" } }).then((r) => r.json()));
    await expect(page.locator(".ov-title h1")).toHaveText(new RegExp(`\\b${repo.name}\\b`));
    // Numbers live in the stat table now, not KPI tiles.
    await expect(page.locator(".stat-table.ov-stats")).toBeVisible();
  });

  test("one header row: the destination, its modes, the view's tools and search", async ({ page }) => {
    await open(page);
    const bar = page.locator(".k-head");
    await expect(bar.getByText(/graph current|no graph/i)).toHaveCount(0);
    await expect(bar.getByRole("button", { name: /Reindex/ })).toHaveCount(0);
    await expect(bar.getByRole("button", { name: "Search" })).toBeVisible();
    await expect(page.locator(".k-nav").getByRole("button", { name: "Settings" })).toBeVisible();
    const h = await bar.boundingBox();
    expect(h!.height).toBe(44);
  });

  test("search opens the palette, and back/forward walk through destinations", async ({ page }) => {
    await open(page);
    await page.locator(".k-head").getByRole("button", { name: "Search" }).click();
    await expect(page.locator(".palette")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.locator(".k-nav").getByRole("button", { name: "Agents" }).click();
    await expect(page).toHaveURL(/#agents$/);
    await expect(page.locator(".k-head .k-hub-tools")).toBeVisible();
    await page.goBack();
    await expect(page.locator(".ov-title h1")).toBeVisible();
    await page.keyboard.press("Alt+ArrowRight");
    await expect(page).toHaveURL(/#agents$/);
  });

  test("mark is the kula ring drawn with kula rings, everywhere", async ({ page, request }) => {
    await open(page);
    const mark = page.locator(".k-logo svg.logo");
    await expect(mark).toHaveAttribute("shape-rendering", "crispEdges");
    // One level in the nav (a 7×7 ring and its centre: 17 cells)…
    expect((await mark.locator("path").getAttribute("d"))?.match(/M\d+ \d+h1v1h-1z/g)?.length).toBe(17);
    // …two levels in the tab icon: every cell is the ring again (17 × 17).
    const fav = await (await request.get("/favicon.svg")).text();
    expect(fav.match(/M\d+ \d+h1v1h-1z/g)?.length).toBe(17 * 17);
    expect(await page.locator("link[rel=icon]").getAttribute("href")).toBe("/favicon.svg");
  });

  test("simple icons: one round-capped stroke, and settings is a gear", async ({ page }) => {
    await open(page);
    for (const svg of await page.locator(".k-nav .k-dest svg").all()) {
      expect(await svg.getAttribute("stroke-linecap")).toBe("round");
      expect(await svg.getAttribute("stroke-width")).toBe("1.5");
    }
    const gear = page.locator(".k-nav").getByRole("button", { name: "Settings" }).locator("svg");
    await expect(gear.locator("circle")).toHaveCount(1);
    expect(((await gear.locator("path").getAttribute("d")) ?? "").split("L").length).toBeGreaterThan(30); // eight teeth
    // No icon balloons to its container: every icon in the chrome stays at text size.
    const big = await page.evaluate(() => [...document.querySelectorAll(".k-head svg, .k-nav .btn svg, .statusbar svg, .btn svg, .chip svg")]
      .filter((el) => el.getBoundingClientRect().height > 26).length);
    expect(big).toBe(0);
  });

  test("a project file opens in place and Back returns to the view", async ({ page }) => {
    await open(page, "graph");
    if (!(await page.locator(".pt-row").first().isVisible())) await page.keyboard.press("Alt+1");
    const row = page.locator(".pt-row.file").first();
    const name = ((await row.getAttribute("title")) ?? "").split("/").pop()!;
    await row.dblclick();
    await expect(page.getByTestId("file-editor")).toBeVisible();
    await expect(page.locator(".k-head .k-title h1")).toHaveText(name);
    await page.locator(".k-head").getByRole("button", { name: "Back" }).click();
    await expect(page.getByTestId("file-editor")).toHaveCount(0);
    await expect(page).toHaveURL(/#graph\b/);
  });

  test("⌘K opens the palette and it can reindex", async ({ page }) => {
    await open(page);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.locator(".palette")).toBeVisible();
    await page.keyboard.type("reindex");
    await expect(page.locator(".palette").getByText(/Reindex/i).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".palette")).toHaveCount(0);
  });
});

test.describe("design language", () => {
  test("type by role: Jost for the interface, JetBrains Mono for data", async ({ page }) => {
    await open(page);
    const ff = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).fontFamily);
    for (const sel of ["body", ".btn", ".k-search"]) expect(await ff(sel), sel).toMatch(/^"?Jost/);
    for (const sel of [".stat-table td"]) expect(await ff(sel), sel).toMatch(/^"?JetBrains Mono/);
    for (const sel of [".card-head h2", ".k-title h1"]) expect(await ff(sel), sel).toMatch(/^"?Cormorant/);
    const faces = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].map((f) => f.family); });
    expect(faces.join(",")).not.toMatch(/Antonio|Geist|Simulacra/);
  });

  test("Homonin ground and accent", async ({ page }) => {
    await open(page);
    const v = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return { bg: s.getPropertyValue("--bg").trim(), accent: s.getPropertyValue("--accent").trim(), line: s.getPropertyValue("--line").trim() };
    });
    expect(v).toEqual({ bg: "#000", accent: "#f97f3a", line: "#24201d" });
  });

  test("flat: framed surfaces 6, controls 4, and nothing is frosted", async ({ page }) => {
    await open(page);
    for (const sel of [".card", ".stat-table.ov-stats"]) expect(await radius(page, sel), sel).toBe("6px");
    for (const sel of [".btn", ".k-search", ".chip"]) expect(await radius(page, sel), sel).toBe("4px");
    for (const sel of [".k-head", ".card"]) {
      const bf = await page.locator(sel).first().evaluate((el) => { const s = getComputedStyle(el); return s.backdropFilter || (s as any).webkitBackdropFilter; });
      expect(bf, sel).not.toMatch(/blur/);
    }
  });

  test("errors get a thin even border, not an accent bar", async ({ page }) => {
    await page.route("**/api/repo", (r) => r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "missing or bad session token" }) }));
    await open(page);
    // A dead server is an error panel now, not a toast; the same thin even border applies.
    const t = page.getByTestId("server-error");
    await expect(t).toBeVisible();
    const b = await t.evaluate((el) => { const s = getComputedStyle(el.querySelector("p.mono")!); return [s.borderLeftWidth, s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderTopLeftRadius]; });
    expect(b).toEqual(["1px", "1px", "1px", "1px", "4px"]);
  });
});

test.describe("overview + code panel", () => {
  test("coupling: one functional figure – directories × directories, loops marked", async ({ page }) => {
    await open(page);
    const c = page.locator(".coupling");
    await expect(c.locator(".cpl-row").first()).toBeVisible();
    const k = await c.locator(".cpl-row").count();
    await expect(c.locator(".cpl-cell")).toHaveCount(k * k);
    await expect(c.locator(".cpl-loops")).toHaveText(/\d+ loops?/);
    await c.locator(".cpl-cell").nth(1).hover();
    await expect(c.locator(".cpl-read")).toContainText("→");
    // No decorative motion on the dashboard: nothing on it animates forever.
    const infinite = await page.evaluate(() => document.getAnimations().filter((a) => (a.effect?.getTiming().iterations ?? 1) === Infinity && (a.effect as KeyframeEffect)?.target?.closest?.(".overview")).length);
    expect(infinite).toBe(0);
    await page.screenshot({ path: "test-results/overview.png", fullPage: true });
  });

  test("a hotspot opens its file in the code panel", async ({ page }) => {
    await open(page);
    await page.locator(".hot-row:not(.hot-headrow)").first().click();
    const panel = page.locator(".code-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".cp-code > div").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  });
});

test.describe("graph chrome", () => {
  test("one settings control, not two", async ({ page }) => {
    await open(page, "graph");
    await expect(page.getByRole("button", { name: /settings/i })).toHaveCount(1);
  });

  test("languages settings: indexed languages and install buttons for detected-but-missing ones", async ({ page }) => {
    await open(page);
    await page.keyboard.press(",");
    await page.locator("[data-section=langs]").click();
    await page.getByTestId("settings-langs").scrollIntoViewIfNeeded();
    // The two-column table: every language here, with the count of files.
    await expect(page.getByTestId("settings-langs")).toBeVisible();
    // The two-column table: every language here, with the count of files.
    await expect(page.getByTestId("settings-langs")).toBeVisible();
    const indexed = page.locator(".settings .set-row", { hasText: "Indexed" });
    await expect(indexed).toBeVisible({ timeout: 20_000 });
    // This checkout contains files in languages without packs installed, so at
    // least one row offers an Install button naming the pack it would fetch.
    const install = page.locator(".settings .set-row").filter({ has: page.getByRole("button", { name: "Install" }) });
    const n = await install.count();
    expect(n, "detected-but-missing languages offer Install buttons").toBeGreaterThan(0);
    const hint = await install.first().textContent().catch(() => "");
    expect(hint ?? "").toMatch(/language pack/);
    // The hint text uses spaced en dashes, never an em dash.
    const body = await page.locator(".settings").textContent();
    expect(body).not.toContain("—");
  });
});

test.describe("agent checks, for people", () => {
  test("verify reads the working tree against HEAD", async ({ request }) => {
    // The session token is whatever the server stamps into the page, not a constant.
    const html = await (await request.get("/")).text();
    const tok = /kula-token" content="([^"]*)"/.exec(html)?.[1] ?? "";
    const v = await (await request.get("/api/agent/verify", { headers: { "x-kula-token": tok } })).json();
    expect(typeof v.ok).toBe("boolean");
    expect(v.summary).toHaveProperty("modified");
    for (const k of ["changed_refs", "dangling_refs", "recheck_refs"]) expect(Array.isArray(v[k]), k).toBe(true);
    for (const r of v.changed_refs) expect(r).toMatchObject({ name: expect.any(String), path: expect.any(String), line: expect.any(Number) });
  });
});

test.describe("api", () => {
  test("refuses requests without the session token", async ({ request }) => {
    const r = await request.get("/api/repo");
    expect(r.status()).toBe(401);
  });

  test("graph export includes package nodes wired by IMPORTS", async ({ request }) => {
    const html = await (await request.get("/")).text();
    const tok = /kula-token" content="([^"]*)"/.exec(html)?.[1] ?? "";
    const g = await (await request.get("/api/graph?level=file", { headers: { "x-kula-token": tok } })).json();
    const pk = g.nodes.filter((n: { kind: string }) => n.kind === "package");
    expect(pk.length).toBeGreaterThan(3);
    const ids = new Set(pk.map((n: { id: number }) => n.id));
    expect(g.edges.some((e: { dst: number; kind: string }) => ids.has(e.dst) && e.kind === "IMPORTS")).toBe(true);
  });
});

test.describe("animation", () => {
  test("panels resize by their edge and remember it", async ({ page }) => {
    await open(page, "notes");
    const list = page.locator(".split > .list");
    const grip = page.locator(".split > .grip");
    const w0 = (await list.boundingBox())!.width;
    const g = (await grip.boundingBox())!;
    await page.mouse.move(g.x + g.width / 2, g.y + 200);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2 + 120, g.y + 200, { steps: 6 });
    await page.mouse.up();
    expect((await list.boundingBox())!.width).toBeGreaterThan(w0 + 100);
    await page.reload();
    expect((await list.boundingBox())!.width).toBeGreaterThan(w0 + 100);
    await grip.dblclick();
    expect(Math.abs((await list.boundingBox())!.width - w0)).toBeLessThan(2);
  });

  test("settings slides in and Escape closes it", async ({ page }) => {
    await open(page);
    await page.keyboard.press(",");
    const s = page.getByRole("dialog", { name: "Settings" });
    await expect(s).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(s).toHaveCount(0);
  });
});

// Every view at every size: nothing scrolls sideways and the view's own content shows.
const VIEWS: [string, string][] = [
  ["overview", ".ov-title h1"], ["graph", ".graph-wrap"], ["git", "[data-testid=w-tree]"],
  ["issues", "[data-testid=issue-desk]"], ["notes", ".list-head"], ["console", ".k-drawer .console"],
  ["agents", ".k-hub-tools"], ["query", ".kq-text"], ["flows", ".qv-head"], ["impact", ".qv-head"], ["slice", ".qv-head"],
];
for (const [view, sel] of VIEWS) {
  test(`@responsive ${view} fits without sideways scroll`, async ({ page }, info) => {
    await open(page, view);
    await expect(page.locator(sel).first()).toBeVisible();
if (view === "graph") { test.setTimeout(60_000); await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 45_000 }); }
    await page.waitForTimeout(300);
    const over = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(0);
    // Nothing important is pushed off the right edge.
    const clipped = await page.evaluate(() => [...document.querySelectorAll(".k-head button, .k-nav button, .kpi-cell, .card-head h2, .list-head h2, .graph-head button, .zoom button")]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 1; }).map((el) => el.textContent?.trim().slice(0, 30)));
    expect(clipped).toEqual([]);
    await page.screenshot({ path: `test-results/${info.project.name}-${view}.png` });
  });
}

test.describe("phone chrome", () => {
  test("@responsive settings with the languages table fits without sideways scroll", async ({ page }, info) => {
    await open(page);
    await page.keyboard.press(",");
    await page.locator("[data-section=langs]").click();
    await page.getByTestId("settings-langs").scrollIntoViewIfNeeded();
    const over = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(0);
    const clipped = await page.evaluate(() => [...document.querySelectorAll(".settings .set-row button, .settings .set-row .mono")]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 1; }).map((el) => el.textContent?.trim().slice(0, 30)));
    expect(clipped).toEqual([]);
    await page.screenshot({ path: `test-results/${info.project.name}-settings.png` });
  });
});

test.describe("console", () => {
  test("a terminal that runs kula: tabs to add and close, help, kula's own commands and git's", async ({ page }) => {
    await open(page, "console");
    const c = page.locator(".console");
    await expect(page.locator(".k-drawer.open .k-drawer-head")).toContainText("Console");
    const input = page.getByRole("textbox", { name: "kula command" });
    await input.fill("help");
    await input.press("Enter");
    await expect(c.locator(".entry pre").last()).toContainText("Work with AI agents");
    await input.fill("log --oneline -1");
    await input.press("Enter");
    await expect(c.locator(".entry .cmd").last()).toContainText("kula log --oneline -1");
    await expect(c.locator(".entry pre").last()).toHaveText(/^[0-9a-f]{7,} /);
    await page.getByRole("button", { name: "New terminal" }).click();
    await expect(page.locator(".term-tab")).toHaveCount(2);
    await expect(c.locator(".entry")).toHaveCount(0);
    await page.getByRole("button", { name: "Close terminal 2" }).click();
    await expect(page.locator(".term-tab")).toHaveCount(1);
    await expect(c.locator(".entry")).toHaveCount(2);
  });
});

test.describe("query", () => {
  test("SPARQL over the graph: examples, results that open the map, errors, export", async ({ page }) => {
    await open(page, "query");
    await page.locator(".kq-ex").first().click();
    const rows = page.locator(".kq-table tbody tr");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(3);
    await expect(page.getByTestId("w-results")).toContainText(/rows in \d+ ms/);
    await page.screenshot({ path: "test-results/query.png" });
    // A name beside its path opens the symbol in the map.
    await rows.first().locator("td").first().locator("button").click();
    await expect(page).toHaveURL(/#graph\/\d+/);
    await page.goBack();
    await expect(page).toHaveURL(/#query\b/);
    const q = page.getByRole("textbox", { name: "SPARQL query" });
    await q.fill("SELECT ?x WHERE { ?x kula:nope }}");
    await q.press("ControlOrMeta+Enter");
    await expect(page.locator(".kq-err")).toContainText("SPARQL");
    await q.fill("ASK { ?s a kula:Function }");
    await q.press("ControlOrMeta+Enter");
    await expect(page.locator(".kq-bool")).toHaveText("true");
    await page.getByTestId("query-side").getByRole("radio", { name: "Vocabulary" }).click();
    await expect(page.locator(".kq-v").first()).toBeVisible();
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: "ttl", exact: true }).click();
    expect((await dl).suggestedFilename()).toBe("kula-graph.ttl");
  });
  test("flows and slice: pick, read, no page scroll", async ({ page }) => {
    await open(page, "flows");
    const flows = page.getByTestId("w-flows");
    await expect(flows.locator(".qv-flow").first()).toBeVisible({ timeout: 20_000 });
    await flows.locator(".qv-flow").first().click();
    await expect(page.getByTestId("w-steps").locator(".qv-step").first()).toBeVisible();
    await expect(page.getByTestId("flows-side")).toContainText("Steps");
    expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight)).toBe(true);
    await page.screenshot({ path: "test-results/query-flows.png" });

    // Slice lives in the palette, beside the Code modes.
    await page.keyboard.press("ControlOrMeta+k");
    await page.keyboard.type(">Open Slice");
    await page.locator(".palette .res").first().click();
    await expect(page).toHaveURL(/#slice\b/);
    const sel = page.getByRole("textbox", { name: "Slice selectors" });
    await sel.fill("src/graph/**");
    await sel.press("Enter");
    await expect(page.getByTestId("w-slice")).toContainText(/\d+ nodes/);
    await expect(page.getByTestId("w-inbound")).toBeVisible();
    await expect(page.getByTestId("slice-side")).toContainText("Crossings");
    await page.screenshot({ path: "test-results/query-slice.png" });
  });
});

// H.4 – the agent hub: one canvas of teams and seats, a palette to place
// things from and an inspector for whatever is picked. These write kula.toml
// in this worker's fixture only, and put it back afterwards.
test.describe("agent hub (H.4)", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ baseURL: ({ fx }, use) => use(fx) });
  const desktopOnly = (info: { project: { name: string } }) => test.skip(info.project.name !== "desktop", "writes to the fixture");
  const tomlOf = (fx: string) => path.join(fs.readFileSync(`/tmp/kula-fixture-${new URL(fx).port}.path`, "utf8").trim(), "kula.toml");
  let tomlBefore = "";
  // a skill and an MCP server to place, seeded into the fixture and removed after
  const seeds = (fx: string) => {
    const root = path.dirname(tomlOf(fx));
    return { skill: path.join(root, ".agents/skills/e2e-review"), mcp: path.join(root, ".agents/mcp.json") };
  };
  let mcpBefore: string | null = null;
  test.beforeAll(async ({ fx }) => {
    tomlBefore = fs.readFileSync(tomlOf(fx), "utf8");
    const s = seeds(fx);
    fs.mkdirSync(s.skill, { recursive: true });
    fs.writeFileSync(path.join(s.skill, "SKILL.md"), "---\nname: e2e-review\ndescription: review a diff\n---\nRead the diff.\n");
    mcpBefore = fs.existsSync(s.mcp) ? fs.readFileSync(s.mcp, "utf8") : null;
    if (mcpBefore === null) fs.writeFileSync(s.mcp, JSON.stringify({ mcpServers: { "e2e-docs": { command: "true" } } }));
  });
  test.afterAll(async ({ fx }) => {
    if (tomlBefore) fs.writeFileSync(tomlOf(fx), tomlBefore);
    const s = seeds(fx);
    fs.rmSync(s.skill, { recursive: true, force: true });
    if (mcpBefore === null) fs.rmSync(s.mcp, { force: true });
  });

  test("H.4: palette, canvas and inspector; every fixture team is a frame; no page scroll at 1440×900", async ({ page }, info) => {
    desktopOnly(info);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, "agents");
    await expect(page.locator(".k-head")).toBeVisible();
    // the canvas fills the pane; the palette and inspector only float up when asked
    const cv = await page.locator(".hub-canvas, .hub-body > .react-flow").first().boundingBox();
    const body = await page.locator(".hub-body").boundingBox();
    expect(Math.abs(cv!.width - body!.width) + Math.abs(cv!.height - body!.height)).toBeLessThan(2);
    await expect(page.getByRole("complementary", { name: "Palette" })).toHaveCount(0);
    for (const t of ["steer", "ship", "audit", "research"]) await expect(page.locator(`.hub-team[data-team="${t}"]`)).toBeVisible();
    await expect(page.locator(".hub-seat").first()).toBeVisible();
    // the hub fills the window: neither the page nor the view scrolls
    const fits = await page.evaluate(() => {
      const hub = document.querySelector(".page.hub") as HTMLElement;
      const doc = document.scrollingElement as HTMLElement;
      return { hub: hub.scrollHeight - hub.clientHeight, doc: doc.scrollHeight - doc.clientHeight, x: doc.scrollWidth - doc.clientWidth };
    });
    expect(fits).toEqual({ hub: 0, doc: 0, x: 0 });
    // an agent's suggestion waits in the overview until a person decides
    await page.locator(".k-head").getByRole("button", { name: /^Overview/ }).click();
    await expect(page.getByRole("region", { name: "Suggested" })).toContainText("generated by the web build");
    await page.screenshot({ path: "test-results/hub-build.png", scale: "css" });
  });

  test("H.4: place a seat from the palette, colour and tag it, attach a skill and an MCP, fence it, save to kula.toml", async ({ page, request }, info) => {
    desktopOnly(info);
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, "agents");
    await page.getByRole("button", { name: "Add node" }).click();
    const palette = page.getByRole("complementary", { name: "Palette" });
    const insp = page.getByRole("complementary", { name: "Inspector" });
    // nothing picked: an agent from the palette starts a new team with a lead
    await palette.locator(".hub-pal-item.agent").first().click();
    await expect(page.locator(".hub-dirty")).toHaveText("unsaved");
    const seat = page.locator('.hub-seat[data-seat="team1-lead"]');
    await expect(seat).toBeVisible();
    await seat.click();
    await expect(insp.getByLabel("Seat name")).toHaveValue("team1-lead");
    // colour and a category tag
    await insp.getByRole("radio", { name: "Colour #b5835a" }).click();
    await expect(seat).toHaveAttribute("style", /--seat:\s*#b5835a/);
    await insp.getByLabel("Tags").fill("e2e,");
    // a skill and an MCP server: from the palette onto the picked seat
    const skill = palette.locator(".hub-pal-item.skill").first();
    const mcp = palette.locator(".hub-pal-item.mcp").first();
    const skillName = await skill.getAttribute("title");
    const mcpName = await mcp.getAttribute("title");
    await skill.click();
    await mcp.click();
    await expect(seat.locator(".hub-tile-n")).toHaveText("2");
    // a fence on the seat
    await insp.getByLabel("Lock").fill("src/store.rs,");
    await expect(seat.locator(".hub-tile-fence")).toBeVisible();
    // review the diff, then save: only the fixture's kula.toml changes
    const changes = page.getByRole("region", { name: "Changes" });
    await changes.getByRole("button", { name: "Review" }).click();
    await expect(changes.getByLabel("Diff")).toContainText("team1-lead");
    await changes.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator(".hub-dirty")).toHaveCount(0);
    const toml = (await (await request.get("/api/file?path=kula.toml", { headers: { "x-kula-token": "test" } })).json()).content as string;
    expect(toml).toContain('name = "team1"');
    expect(toml).toContain("#b5835a");
    expect(toml).toContain('"e2e"');
    expect(toml).toContain(`"${skillName}"`);
    expect(toml).toContain(`"${mcpName}"`);
    expect(toml).toContain('"src/store.rs"');
    // what was in the file survives the save
    for (const line of tomlBefore.split("\n").filter((l) => l.startsWith("[[guard]]") || l.startsWith("path ")).slice(0, 4)) expect(toml).toContain(line);
  });

  test("H.4: the flow map draws domain lanes behind the teams", async ({ page }, info) => {
    desktopOnly(info);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, "agents");
    await page.getByRole("button", { name: "Flow map" }).click();
    await expect(page.locator(".hub-lane").first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: "test-results/hub-map.png", scale: "css" });
  });

  test("H.4: an agent's suggestion is accepted into kula.toml from the hub", async ({ page, request }, info) => {
    desktopOnly(info);
    await open(page, "agents");
    await page.locator(".k-head").getByRole("button", { name: /^Overview/ }).click();
    const sugg = page.getByRole("region", { name: "Suggested" });
    await sugg.locator(".hub-sugg").filter({ hasText: "generated by the web build" }).getByRole("button", { name: "Accept" }).click();
    await expect(sugg).toHaveCount(0);
    const toml = (await (await request.get("/api/file?path=kula.toml", { headers: { "x-kula-token": "test" } })).json()).content as string;
    expect(toml).toContain("web/dist/**");
  });

  test("H.9: the overview holds the task at hand: read it, finish it, start one", async ({ page, fx }, info) => {
    desktopOnly(info);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, "agents");
    await page.locator(".k-head").getByRole("button", { name: /^Overview/ }).click();
    // the fixture seeds a task; keep its file and put it back after
    const task = path.join(path.dirname(tomlOf(fx)), ".kula/task.json");
    const taskBefore = fs.existsSync(task) ? fs.readFileSync(task, "utf8") : null;
    try {
      const insp = page.getByRole("complementary", { name: "Inspector" });
      const seeded = insp.getByRole("region", { name: "Now" });
      await expect(seeded).toContainText("harden the MCP server");
      await expect(seeded.getByRole("list", { name: "Agent loop" }).locator("li")).toHaveCount(6);
      await seeded.getByRole("button", { name: "Finish task" }).click();
      const form = insp.getByRole("form", { name: "Start a task" });
      await form.getByLabel("Task title").fill("e2e tidy the parser");
      await form.getByRole("button", { name: "Start task" }).click();
      const now = insp.getByRole("region", { name: "Now" });
      await expect(now).toContainText("e2e tidy the parser");
      const loop = now.getByRole("list", { name: "Agent loop" });
      await expect(loop.locator("li")).toHaveCount(6);
      await expect(loop.locator("li.gate")).toContainText("edit");
      await insp.screenshot({ path: "test-results/hub-task.png" });
      await now.getByRole("button", { name: "Finish task" }).click();
      await expect(insp.getByRole("form", { name: "Start a task" })).toBeVisible();
    } finally {
      if (taskBefore === null) fs.rmSync(task, { force: true });
      else fs.writeFileSync(task, taskBefore);
    }
  });
});

test.describe("agent hub runs (H.6)", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ baseURL: ({ fx }, use) => use(fx) });
  const desktopOnly = (info: { project: { name: string } }) => test.skip(info.project.name !== "desktop", "writes to the fixture");
  const kulaOf = (fx: string) => path.join(fs.readFileSync(`/tmp/kula-fixture-${new URL(fx).port}.path`, "utf8").trim(), ".kula");
  const usage = (i: number, o: number, c: number) => ({ tokens_in: i, tokens_out: o, cost_usd: c, turns: 3, duration_ms: 0 });
  const seat = (slice: string, name: string, verdict: string, score: number, extra = {}) => ({
    slice, seat: name, agent: "claude", usage: usage(1200, 300, 0.04), duration_ms: 42_000, files: 1, added: 12, removed: 3,
    refusals: verdict === "passed" ? 0 : 1, attempts: verdict === "passed" ? 1 : 2, verdict, tests: verdict === "passed", score, ...extra,
  });
  const run = (id: string, started: number, score: number, seats: object[], state: string) => ({
    schema: 1, id, plan: `plan-${id}`, team: "e2e-team", goal: `Goal of ${id}`, trigger: "manual", started, ended: started + 95_000,
    base: "a".repeat(40), head: "b".repeat(40), state, seats, handoffs: [], usage: usage(2400, 600, 0.08), score,
    weights: { gate: 40, tests: 20, refusals: 15, retries: 10, cost: 10, duration: 5 },
  });
  let evBefore: string | null = null;
  const files: string[] = [];
  test.beforeAll(async ({ fx }) => {
    const k = kulaOf(fx);
    fs.mkdirSync(path.join(k, "runs"), { recursive: true });
    const t = Date.now() - 3_600_000;
    const recs = [
      run("e2e-run-1", t, 52, [seat("s1", "lead", "rejected", 30), seat("s2", "tester", "passed", 74, { paths: ["src/lib.rs"], commit: "c".repeat(40) })], "partial"),
      run("e2e-run-2", t + 600_000, 91, [seat("s1", "lead", "passed", 92, { paths: ["src/main.rs"], commit: "d".repeat(40) })], "passed"),
    ];
    for (const r of recs) {
      const f = path.join(k, "runs", `${r.id}.json`);
      fs.writeFileSync(f, JSON.stringify(r));
      files.push(f);
    }
    // one run still going: events with a run id and no run_end
    const ev = path.join(k, "events.jsonl");
    evBefore = fs.existsSync(ev) ? fs.readFileSync(ev, "utf8") : null;
    const now = Date.now();
    const lines = [
      { seq: 0, ts: now - 5000, kind: "slice", plan: "plan-live", slice: "s1", verdict: "passed", run: "e2e-live", team: "e2e-team" },
      { seq: 0, ts: now - 2000, kind: "attempt", plan: "plan-live", slice: "s2", run: "e2e-live", team: "e2e-team", usage: usage(500, 100, 0.01) },
    ].map((e) => JSON.stringify(e)).join("\n") + "\n";
    fs.writeFileSync(ev, (evBefore ?? "") + lines);
  });
  test.afterAll(async ({ fx }) => {
    for (const f of files) fs.rmSync(f, { force: true });
    const ev = path.join(kulaOf(fx), "events.jsonl");
    if (evBefore === null) fs.rmSync(ev, { force: true });
    else fs.writeFileSync(ev, evBefore);
  });

  test("H.6: the runs board lists runs, opens a synopsis and changelog, and shows trends", async ({ page }, info) => {
    desktopOnly(info);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, "agents");
    await page.getByRole("radio", { name: "Runs" }).click();
    const board = page.getByLabel("Runs", { exact: true });
    await expect(board.locator(".runs-row")).toHaveCount(2, { timeout: 10_000 });
    // newest first, and the newest is opened
    await expect(board.locator(".runs-row").first()).toContainText("Goal of e2e-run-2");
    await expect(page.getByLabel("Run detail")).toContainText("e2e-run-2");
    await expect(page.getByLabel("Synopsis")).not.toBeEmpty();
    await expect(page.getByRole("img", { name: "Score over time" })).toBeVisible();
    // the run still going is pinned
    await expect(page.getByLabel("Run e2e-live is running")).toContainText("1 of 2 slices passed");
    // the older run: two seats, a rejected one, and its kept change in the changelog
    await board.locator('.runs-row[data-run="e2e-run-1"]').click();
    const detail = page.getByLabel("Run detail");
    await expect(detail.locator("tbody tr")).toHaveCount(2);
    await expect(detail.locator('tr[data-slice="s1"]')).toContainText("rejected");
    await expect(detail.locator(".runs-cl")).toContainText("src/lib.rs");
    await expect(detail.locator(".runs-cl")).toContainText("ccccccc");
    // trends by seat, then by team
    const trends = page.getByRole("region", { name: "Trends" });
    await expect(trends.locator('li[data-key="lead"]')).toBeVisible();
    await trends.getByRole("button", { name: "Teams" }).click();
    await expect(trends.locator('li[data-key="e2e-team"]')).toContainText("2 runs");
    await expect(page.getByLabel("Score weights")).toContainText("gate");
    // the canvas tools are gone in Runs
    await expect(page.getByRole("button", { name: "Flow map" })).toHaveCount(0);
    expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight)).toBe(true);
    await page.screenshot({ path: "test-results/hub-runs.png", scale: "css" });
    // Replay opens Live on that run
    await detail.getByRole("button", { name: "Replay" }).click();
    await expect(page.getByRole("radio", { name: "Live" })).toHaveAttribute("aria-checked", "true");
  });
});

// H.7 – autoresearch in the hub: a research seat on the canvas shows its
// metric and budget, the inspector charts the experiments, and the run sits in
// the ledger with the same synopsis and history as any team run.
test.describe("agent hub research (H.7)", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ baseURL: ({ fx }, use) => use(fx) });
  const desktopOnly = (info: { project: { name: string } }) => test.skip(info.project.name !== "desktop", "writes to the fixture");
  const rootOf = (fx: string) => fs.readFileSync(`/tmp/kula-fixture-${new URL(fx).port}.path`, "utf8").trim();
  const started = Math.floor(Date.now() / 1000) - 1800;
  const exps = [
    { n: 1, hypothesis: "cache the parsed config", value: 9, best_before: 10, kept: true, commit: "e".repeat(40), files: ["src/lib.rs"], by: "agent:claude", at: started + 300 },
    { n: 2, hypothesis: "inline the hot loop", value: null, best_before: 9, kept: false, files: ["src/guard.rs"], by: "agent:claude", at: started + 600, note: "rejected and reverted: touched fenced src/guard.rs" },
    { n: 3, hypothesis: "skip the second scan", value: 8, best_before: 9, kept: true, commit: "f".repeat(40), files: ["src/lib.rs"], by: "agent:claude", at: started + 900 },
  ];
  const state = { workflow: "e2e-speed", metric: "speed", goal: "min", budget: 12, branch: "research/e2e-speed", base: "a".repeat(40), baseline: 10, best: 8, best_commit: "f".repeat(40), started, by: "user:e2e", active: false, experiments: exps };
  const usage = { tokens_in: 0, tokens_out: 0, cost_usd: 0, turns: 0, duration_ms: 0 };
  const seat = (e: typeof exps[number], verdict: string, best: number) => ({ slice: `#${e.n}`, agent: "claude", usage, duration_ms: 300_000, files: 1, added: e.kept ? 4 : 0, removed: e.kept ? 1 : 0, refusals: verdict === "rejected" ? 1 : 0, attempts: 1, verdict, tests: null, score: verdict === "passed" ? 88 : 40, paths: e.kept ? e.files : [], commit: e.commit, note: e.hypothesis, _best: best });
  const seats = [seat(exps[0], "passed", 9), seat(exps[1], "rejected", 9), seat(exps[2], "passed", 8)].map(({ _best, ...s }) => s);
  const ledger = {
    schema: 1, id: `research-${started}`, plan: "e2e-speed", team: "e2e-lab", goal: "e2e-speed research, lower speed", trigger: "research",
    started: started * 1000, ended: (started + 900) * 1000, base: "a".repeat(40), head: "f".repeat(40), state: "passed", seats, handoffs: [], usage, score: 72,
    weights: { gate: 40, tests: 20, refusals: 15, retries: 10, cost: 10, duration: 5 },
    research: { workflow: "e2e-speed", metric: "speed", goal: "min", budget: 12, branch: "research/e2e-speed", baseline: 10, best: 8, gain: 0.2,
      points: [{ n: 1, value: 9, best: 9, verdict: "kept" }, { n: 2, value: null, best: 9, verdict: "rejected" }, { n: 3, value: 8, best: 8, verdict: "kept" }] },
  };
  const toml = `
[[workflow]]
name = "e2e-speed"
scope = ["src/**"]
[workflow.research]
metric = "speed"
goal = "min"
budget = 12
timeout = 30

[[team]]
name = "e2e-lab"
category = "research"
members = [
  { name = "lab-lead", agent = "claude", workflow = "e2e-speed", role = "lead" },
]
`;
  let tomlBefore = "";
  const files: string[] = [];
  test.beforeAll(async ({ fx }) => {
    const root = rootOf(fx);
    tomlBefore = fs.readFileSync(path.join(root, "kula.toml"), "utf8");
    fs.writeFileSync(path.join(root, "kula.toml"), tomlBefore + toml);
    for (const [dir, name, body] of [["research", "e2e-speed.json", state], ["runs", `${ledger.id}.json`, ledger]] as const) {
      const d = path.join(root, ".kula", dir);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, name), JSON.stringify(body));
      files.push(path.join(d, name));
    }
  });
  test.afterAll(async ({ fx }) => {
    for (const f of files) fs.rmSync(f, { force: true });
    if (tomlBefore) fs.writeFileSync(path.join(rootOf(fx), "kula.toml"), tomlBefore);
  });

  test("H.7: a research seat shows its loop, the inspector charts experiments, Runs reads it from the ledger", async ({ page }, info) => {
    desktopOnly(info);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, "agents");
    // the research node: metric, budget used, timeout and best
    const node = page.locator('.hub-seat.research[data-seat="lab-lead"]');
    await expect(node).toBeVisible({ timeout: 10_000 });
    await expect(node).toContainText("speed");
    await expect(node).toContainText("speed 8");
    // the inspector holds budget used and charts each experiment, kept, rejected and kept
    await node.click();
    await expect(page.getByRole("complementary", { name: "Inspector" })).toContainText("3/12 used");
    const chart = page.getByRole("complementary", { name: "Inspector" }).getByLabel("speed over 3 experiments");
    await expect(chart).toBeVisible();
    await expect(chart.locator("circle.kept")).toHaveCount(2);
    await expect(chart.locator("line.none")).toHaveCount(1);
    await expect(chart).toContainText("base 10");
    await expect(chart).toContainText("best 8");
    // Runs: the research run, its synopsis, chart and hypotheses
    await page.getByRole("radio", { name: "Runs" }).click();
    const row = page.locator(`.runs-row[data-run="${ledger.id}"]`);
    await expect(row).toContainText("e2e-speed research, lower speed", { timeout: 10_000 });
    await row.click();
    const detail = page.getByLabel("Run detail");
    await expect(page.getByLabel("Synopsis")).toContainText("2 of 3 experiments kept");
    await expect(detail.getByRole("heading", { name: "Experiments" })).toBeVisible();
    await expect(detail.getByLabel("speed over 3 experiments").locator("circle")).toHaveCount(2);
    await expect(detail.locator('tr[data-slice="#2"]')).toContainText("rejected");
    await expect(detail.locator('tr[data-slice="#3"]')).toContainText("skip the second scan");
    await expect(detail.locator(".runs-cl")).toContainText("src/lib.rs");
    await page.getByRole("region", { name: "Trends" }).getByRole("button", { name: "Teams" }).click();
    await expect(page.locator('.runs-trend-list li[data-key="e2e-lab"]')).toBeVisible();
    expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight)).toBe(true);
    await page.screenshot({ path: "test-results/hub-research.png", scale: "css" });
    await detail.locator(".runs-research").screenshot({ path: "test-results/hub-research-chart.png" });
  });
});

// H.8 – deploy and schedules: Deploy runs a saved team on a goal with its
// flows preselected and a budget, the run paints in Live and lands in Runs;
// a [[schedule]] shows its next fire and pauses from the card.
test.describe("agent hub deploy (H.8)", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ baseURL: ({ fx }, use) => use(fx) });
  const desktopOnly = (info: { project: { name: string } }) => test.skip(info.project.name !== "desktop", "writes to the fixture");
  const rootOf = (fx: string) => fs.readFileSync(`/tmp/kula-fixture-${new URL(fx).port}.path`, "utf8").trim();
  const fake = [process.cwd(), path.join(process.cwd(), "..")].map((d) => path.join(d, "tests", "fixtures", "fake-agent.sh")).find((p) => fs.existsSync(p))!;
  const toml = `
[agents.commands]
fake-agent = ["${fake}", "{prompt}"]

[[team]]
name = "e2e-ship"
category = "deploy"
test = "true"
members = [
  { name = "shipper", agent = "fake-agent", scope = ["src/**"], budget = 200000, max_parallel = 1 },
]

[[schedule]]
name = "nightly"
team = "e2e-ship"
goal = "tidy the docs"
cron = "0 3 * * *"
budget = 1
`;
  let tomlBefore = "";
  let runsBefore = new Set<string>();
  const runsDir = (fx: string) => path.join(rootOf(fx), ".kula", "runs");
  test.beforeAll(async ({ fx }) => {
    const root = rootOf(fx);
    tomlBefore = fs.readFileSync(path.join(root, "kula.toml"), "utf8");
    fs.writeFileSync(path.join(root, "kula.toml"), tomlBefore + toml);
    runsBefore = new Set(fs.existsSync(runsDir(fx)) ? fs.readdirSync(runsDir(fx)) : []);
  });
  test.afterAll(async ({ fx }) => {
    if (tomlBefore) fs.writeFileSync(path.join(rootOf(fx), "kula.toml"), tomlBefore);
    fs.rmSync(path.join(rootOf(fx), ".kula", "schedules.json"), { force: true });
    if (fs.existsSync(runsDir(fx))) for (const f of fs.readdirSync(runsDir(fx))) if (!runsBefore.has(f)) fs.rmSync(path.join(runsDir(fx), f), { force: true, recursive: true });
  });

  test("H.8: deploy a team on its flows, watch it in Live, find it in Runs, pause its schedule", async ({ page, fx }, info) => {
    desktopOnly(info);
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, "agents");
    const deploy = page.locator(".k-head").getByRole("button", { name: "Deploy" });
    await expect(deploy).toBeDisabled();
    await page.locator('.hub-team[data-team="e2e-ship"] .hub-team-head').click();
    await expect(deploy).toBeEnabled();
    await deploy.click();
    const dlg = page.getByRole("dialog", { name: "Deploy e2e-ship" });
    await expect(dlg).toBeVisible();
    // flows under the seat's scope come preselected
    const flows = dlg.getByRole("group", { name: "Target flows" });
    await expect(flows).toBeVisible({ timeout: 20_000 });
    expect(await flows.locator('button[aria-pressed="true"]').count()).toBeGreaterThan(0);
    await dlg.getByLabel("Budget").fill("abc");
    await dlg.getByLabel("Goal").fill("tighten the error copy");
    await expect(dlg.getByRole("button", { name: "Deploy", exact: true })).toBeDisabled();
    await dlg.getByLabel("Budget").fill("0.50");
    await expect(dlg.getByRole("button", { name: "Deploy", exact: true })).toBeEnabled();
    await page.screenshot({ path: "test-results/hub-deploy.png", scale: "css" });
    await dlg.getByRole("button", { name: "Deploy", exact: true }).click();
    await expect(dlg).toBeHidden({ timeout: 10_000 });
    await expect(page.getByRole("radio", { name: "Live" })).toHaveAttribute("aria-checked", "true");
    // the ledger gets the run, tagged manual, and Runs lists it
    const ledgers = () => (fs.existsSync(runsDir(fx)) ? fs.readdirSync(runsDir(fx)).filter((f) => f.endsWith(".json") && !runsBefore.has(f)) : []);
    await expect.poll(() => ledgers().length, { timeout: 30_000 }).toBeGreaterThan(0);
    const fresh = ledgers()[0];
    const rec = JSON.parse(fs.readFileSync(path.join(runsDir(fx), fresh), "utf8"));
    expect(rec.team).toBe("e2e-ship");
    expect(rec.trigger).toBe("manual");
    expect(rec.goal).toBe("tighten the error copy");
    await page.getByRole("radio", { name: "Runs" }).click();
    await expect(page.locator(`.runs-row[data-run="${rec.id}"]`)).toContainText("tighten the error copy", { timeout: 10_000 });
    // the schedule: next fire, then pause from the card
    const card = page.getByRole("region", { name: "Schedules" });
    const row = card.locator('li[data-schedule="nightly"]');
    await expect(row).toContainText("0 3 * * *");
    await expect(row.locator(".hub-sched-next")).toContainText("next");
    await row.getByLabel("Run nightly").uncheck();
    await expect(row).toHaveClass(/paused/);
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(rootOf(fx), ".kula", "schedules.json"), "utf8")).schedules?.nightly?.paused ?? null).toBeTruthy();
    expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight)).toBe(true);
    await page.screenshot({ path: "test-results/hub-schedules.png", scale: "css" });
  });
});

test.describe("git board", () => {
  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    test(`fills ${w}x${h} with every widget and no page scroll`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await open(page, "git");
      await expect(page.getByTestId("w-tree")).toBeVisible();
      await expect(page.getByTestId("w-det")).toBeVisible();
      const panels = page.getByRole("toolbar", { name: "Panels" });
      for (const [m, a] of [["History", "hist"], ["Branches", "br"], ["Sync", "sync"], ["Stashes", "stash"], ["Issues", "iss"], ["Review", "rev"]]) {
        const b = panels.getByRole("button", { name: new RegExp(`^${m}`) });
        if ((await b.getAttribute("aria-pressed")) !== "true") await b.click();
        await expect(page.getByTestId(`w-${a}`)).toBeVisible();
      }
      const over = await page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight);
      expect(over).toBeLessThanOrEqual(0);
    });
  }
  test("old git routes land on the board", async ({ page }) => {
    for (const h of ["changes", "history", "branches"]) {
      await page.goto(`/#${h}`);
      await expect(page).toHaveURL(/#git\b/);
    }
  });
});

test.describe("changes", () => {
  // The real repo's tree must stay clean, so this runs in the worker's fixture,
  // which ships an uncommitted edit to src/kg.rs for exactly this.
  test.use({ baseURL: ({ fx }, use) => use(fx) });
  test("stage a file, commit it, and discard the rest", async ({ page }) => {
    await open(page, "git");
    const tree = page.getByTestId("w-tree");
    const kg = tree.locator(".w-row").filter({ hasText: "kg.rs" }).first();
    await expect(kg).toBeVisible();
    await kg.hover();
    await kg.getByRole("button", { name: "Stage", exact: true }).click();
    await expect(tree.locator(".w-sec").first()).toContainText("Staged 1");
    await page.getByLabel("Commit message").fill("e2e: commit from changes");
    await page.getByLabel("Commit message").press("ControlOrMeta+Enter");
    await expect(page.locator(".toast").first()).toContainText("Committed");
    const log = await (await page.request.get("/api/git/log?limit=1", { headers: { "x-kula-token": "test" } })).json();
    expect(log[0].subject).toBe("e2e: commit from changes");
  });
});

test.describe("notes autofill", () => {
  test("near a file, the target fills itself and [[ links autocomplete", async ({ page }) => {
    await open(page, "overview");
    await page.keyboard.press("ControlOrMeta+k");
    await page.keyboard.type("context_pack");
    await page.locator(".palette").getByText("context_pack", { exact: true }).first().click();
    await page.evaluate(() => { location.hash = "#notes"; });
    const target = page.getByLabel("Note target");
    await target.fill("");
    await target.focus();
    const pop = page.locator(".af-pop");
    await expect(pop.locator(".af-grp").first()).toBeVisible();
    await expect(pop).toContainText("You are here");
    await expect(pop).toContainText("context_pack");
    await pop.locator(".af-opt").filter({ hasText: "context_pack" }).first().click();
    await expect(target).toHaveValue("symbol:src/agent.rs:context_pack");
    await target.fill("file:src/gua");
    await expect(page.locator(".af-ghost")).toContainText("rd.rs");
    await target.press("Tab");
    await expect(target).toHaveValue("file:src/guard.rs");
    const body = page.getByLabel("Note text");
    await body.click();
    await body.pressSequentially("see [[resolve_tar");
    await expect(page.locator(".af-area .af-pop")).toContainText("resolve_target");
    await body.press("Enter");
    await expect(body).toHaveValue("see [[resolve_target]]");
  });
});

test.describe("design system", () => {
  test("D1.1: every svg in the app is a set member, a brand mark or a data figure", async ({ page }) => {
    await open(page);
    const stray = await page.evaluate(() => {
      const out: string[] = [];
      for (const svg of Array.from(document.querySelectorAll("svg"))) {
        const cls = svg.getAttribute("class") ?? "";
        const ok = ["ico", "logo", "lane-svg", "run-chart", "cp-ring", "rf-wires"].some((c) => cls.split(" ").includes(c))
          || !!svg.closest("[data-figure], .kind-badge, a.conn-brand, a.mod-mark");
        if (!ok) out.push(`${cls || "<none>"} in ${svg.ownerDocument.title}`);
      }
      return out;
    });
    expect(stray).toEqual([]);
    // The rendered page is not enough – sweep the sources too: no <svg> outside
    // ui.tsx, brands.tsx and graph/icons.tsx unless the element is marked as a data figure, and
    // no unicode glyph standing in for an icon.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(process.cwd(), "src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(tsx?|css)$/.test(e.name)) files.push(p);
      }
    };
    walk(root);
    const svgBad: string[] = [];
    const glyphBad: string[] = [];
    const banned = /[\u2700-\u27BF\u25A0-\u25FF\u2B00-\u2BFF\u203A\u25C6\u2022]/; // › ✓ ● ▶ ▤ ◯ ◆ …
    for (const f of files) {
      const rel = path.relative(root, f);
      for (const [i, line] of fs.readFileSync(f, "utf8").split("\n").entries()) {
        if (line.includes("<svg") && !/ui\.tsx$/.test(rel) && !/brands\.tsx$/.test(rel) && !/graph\/icons\.tsx$/.test(rel) && !line.includes("data-figure") && !line.includes("rf-wires"))
          svgBad.push(`${rel}:${i + 1}`);
        // Text-label glyphs (colors.ts, ui.tsx kind letters, keyboard notation,
        // canvas map labels) are exempt; DOM icon glyphs are not.
        const exempt = /colors\.ts$|ui\.tsx$|Research\.tsx$|graphfx\.ts$/.test(rel)
          || line.includes("GLYPH") || line.includes("markPath");
        if (!exempt && banned.test(line)) glyphBad.push(`${rel}:${i + 1}: ${line.trim().slice(0, 60)}`);
      }
    }
    expect(svgBad, svgBad.join("\n")).toEqual([]);
    expect(glyphBad, glyphBad.join("\n")).toEqual([]);
  });

  test("D1.2: no hover rule uses a shadow, glow or scale", async ({ page }) => {
    await open(page);
    const bad = await page.evaluate(() => {
      const out: string[] = [];
      const walk = (rules: CSSRuleList) => {
        for (const r of Array.from(rules)) {
          const rule = r as CSSStyleRule;
          if (rule.type === CSSRule.STYLE_RULE && rule.selectorText && /:hover/.test(rule.selectorText)) {
            const st = rule.style;
            const shadowy = (v: string) => v !== "" && v !== "none";
            const scaled = st.transform && /scale\(/.test(st.transform);
            if (shadowy(st.boxShadow) || shadowy(st.filter) || shadowy(st.textShadow) || scaled)
              out.push(`${rule.selectorText} :: ${st.boxShadow || st.filter || st.textShadow || st.transform}`);
          }
          if ("cssRules" in (r as CSSMediaRule)) walk((r as CSSMediaRule).cssRules);
        }
      };
      for (const sheet of Array.from(document.styleSheets)) {
        try { walk(sheet.cssRules); } catch { /* cross-origin */ }
      }
      return out;
    });
    expect(bad, bad.join("\n")).toEqual([]);
  });

  test("D1.3: keyboard focus is always visible", async ({ page }) => {
    await open(page);
    let withFocus = 0;
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      const ok = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return false;
        const s = getComputedStyle(el);
        return s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
      });
      if (ok) withFocus++;
    }
    expect(withFocus).toBeGreaterThan(8);
  });
});

test.describe("g1 – git by keyboard", () => {
  test("G1.1: git staging works from the keyboard – j/k walk, s stage, u unstage – and ⌘↵ commits", async ({ page }, info) => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const tmp = path.resolve(process.cwd(), "..", `g1-kb-${info.workerIndex}.txt`);
    await fs.writeFile(tmp, "scratch change for the keyboard test\n");
    try {
      await page.goto("/#git");
      await page.reload();
      const name = tmp.replace(/^.*\//, "");
      const tree = page.getByTestId("w-tree");
      const row = tree.locator(".w-row", { hasText: name });
      await expect(row).toBeVisible({ timeout: 10_000 });
      await page.keyboard.press("j"); // j/k walk the files
      await expect(tree.locator(".w-row.on")).toHaveCount(1);
      await row.click(); // then pick ours
      await expect(tree.locator(".w-row.on")).toContainText(name);
      const stagedHead = tree.locator(".w-sec").first();
      const base = Number(/Staged\s*(\d+)/.exec(await stagedHead.textContent() ?? "")?.[1] ?? 0); // the repo may already have staged work
      await page.keyboard.press("s"); // stage it
      await expect(stagedHead).toContainText(`Staged ${base + 1}`, { timeout: 10_000 });
      await expect(tree.locator(".w-row.on")).toContainText(name);
      await page.keyboard.press("u"); // unstage it again
      await expect(stagedHead).toContainText(`Staged ${base}`, { timeout: 10_000 });
      // ⌘↵ is the commit key: with no message it must do nothing at all.
      const before = await page.evaluate(() => fetch("/api/log?limit=1").then((r) => r.json()).catch(() => null));
      await page.keyboard.press("ControlOrMeta+Enter");
      await page.waitForTimeout(600);
      const after = await page.evaluate(() => fetch("/api/log?limit=1").then((r) => r.json()).catch(() => null));
      expect(JSON.stringify(after)).toEqual(JSON.stringify(before));
    } finally {
      await fs.unlink(tmp).catch(() => {});
    }
  });
});

test.describe("N1 · shell: palette, shortcuts, states", () => {
  const VIEWS: [string, string][] = [
    ["Go to Home", "overview"], ["Go to Agents", "agents"], ["Go to Code", "map"], ["Go to Changes", "git"], ["Go to Review", "proposals"],
    ["Open Graph", "graph"], ["Open Flows", "flows"], ["Open Issues", "issues"], ["Open Notes", "notes"], ["Open Query", "query"], ["Open Slice", "slice"], ["Open Console", "console"],
  ];

  test("N1.1: every view is reachable from the palette", async ({ page }) => {
    await open(page);
    for (const [label, id] of VIEWS) {
      await page.keyboard.press("ControlOrMeta+k");
      await page.keyboard.type(`>${label}`);
      const first = page.locator(".palette .res").first();
      await expect(first).toContainText(label);
      await first.click();
      if (id === "console") await expect(page.locator(".k-drawer.open .console")).toBeVisible();
      else await expect(page).toHaveURL(new RegExp(`#${id}\\b`));
    }
  });

  test("N1.2: ? opens Settings on Keybindings, listing every action, and each listed one works", async ({ page }) => {
    await open(page, "git");
    await page.keyboard.press("?");
    const sheet = page.getByTestId("settings-keys");
    await expect(sheet).toBeVisible();
    // The list is generated from the same registry the shell acts on.
    const ACTIONS = [["palette", "Command palette"], ["back", "Go back"], ["forward", "Go forward"], ["project", "Toggle Project tree"], ["right", "Toggle option panel"], ["settings", "Open settings"], ["keys", "Open keybindings"], ["console", "Console"], ["agents", "Agents"], ["query", "Query"], ["extensions", "Extensions"]];
    for (const [id, label] of ACTIONS) await expect(sheet.locator(`.key-row[data-action="${id}"]`)).toContainText(label);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    // 1 goes home…
    await page.keyboard.press("Digit1");
    await expect(page).toHaveURL(/#overview\b/);
    // ⌘K opens the palette, Escape closes it…
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.locator(".palette")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".palette")).toHaveCount(0);
    // , opens settings, Escape closes it…
    await page.keyboard.press(",");
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Settings" })).toHaveCount(0);
    // ? reopens this sheet, Escape closes it…
    await page.keyboard.press("?");
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    // …and ⌥← walks back through the views.
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(page).toHaveURL(/#git\b/);
  });

  test("N1.2: the sheet's remaining keys work – a, q, a context shortcut, and the sheet from the palette", async ({ page }) => {
    await open(page);
    // a → agents, q → query (the two letter view keys).
    await page.keyboard.press("a");
    await expect(page).toHaveURL(/#agents\b/);
    await page.keyboard.press("q");
    await expect(page).toHaveURL(/#query\b/);
    // Query sits under Code, whose toggle switches modes and 3 remembers the last one.
    await expect(page.locator(".k-nav [data-dest=code]")).toHaveAttribute("aria-current", "page");
    await page.getByRole("radio", { name: "Flows" }).click();
    await expect(page).toHaveURL(/#flows\b/);
    await page.keyboard.press("Digit1");
    await page.keyboard.press("Digit3");
    await expect(page).toHaveURL(/#flows\b/);
    await page.getByRole("radio", { name: "Graph" }).click();
    await expect(page.locator("main canvas.ct-canvas")).toBeVisible({ timeout: 30_000 });
    // The palette's own "Keybindings" item opens Settings on that section.
    await page.keyboard.press("ControlOrMeta+k");
    await page.keyboard.type(">keybindings");
    await page.locator(".palette .res").first().click();
    await expect(page.getByTestId("settings-keys")).toBeVisible();
  });

  test("N1.1: recently used commands sort first", async ({ page }) => {
    await open(page);
    const run = async (label: string, hash: RegExp) => {
      await page.keyboard.press("ControlOrMeta+k");
      await page.keyboard.type(`>go to ${label}`);
      await page.locator(".palette .res").first().click();
      await expect(page).toHaveURL(hash);
    };
    // Go to Review, then Agents. The palette remembers, most recent first.
    await run("Review", /#proposals\b/);
    await run("Agents", /#agents\b/);
    await page.keyboard.press("ControlOrMeta+k");
    await page.keyboard.type(">go to");
    const results = page.locator(".palette .res");
    await expect(results.first()).toContainText("Go to Agents");
    await expect(results.nth(1)).toContainText("Go to Review");
  });

  test("N1.3: a dead server is an error state with retry, not a blank page", async ({ page }) => {
    await open(page);
    await expect(page.locator(".ov-title h1")).toBeVisible();
    await page.route("**/api/**", (r) => r.abort());
    await page.reload();
    const err = page.getByTestId("server-error");
    await expect(err).toBeVisible();
    await expect(err).toContainText("Retry now");
    await expect(page.locator(".k-head")).toBeVisible();
    // Retrying while it is still down keeps the message up…
    await page.getByRole("button", { name: "Retry now" }).click();
    await expect(err).toBeVisible();
    // …and a recovered server comes back with the same button.
    await page.unroute("**/api/**");
    await page.getByRole("button", { name: "Retry now" }).click();
    await expect(page.locator(".ov-title h1")).toBeVisible();
    // A poll failure after data has loaded is a slim banner: the view stays mounted.
    await page.route("**/api/**", (r) => r.abort());
    await page.waitForTimeout(5_200);
    const note = page.getByTestId("server-note");
    await expect(note).toBeVisible();
    await expect(page.locator(".ov-title h1")).toBeVisible();
    await page.unroute("**/api/**");
    // The next poll recovers and the banner clears by itself; the view never remounted.
    await expect(note).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator(".ov-title h1")).toBeVisible();
  });
});
// ========================================================= A2: one picture of the whole setup – roster, keyboard, timeline, seat facts
test.describe("five destinations", () => {
  test("Home, Agents, Code, Changes, Review on 1 to 5, old hashes land, console is a drawer", async ({ page }) => {
    await open(page, "overview");
    const names = await page.locator(".k-nav .k-dest").evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label")));
    expect(names).toEqual(["Home", "Agents", "Code", "Changes", "Review"]);
    await page.keyboard.press("Digit5");
    await expect(page).toHaveURL(/#proposals\b/);
    await page.keyboard.press("Digit3");
    await expect(page).toHaveURL(/#map\b/);
    await page.goto("/#issues");
    await expect(page.locator(".k-nav [data-dest=review]")).toHaveAttribute("aria-current", "page");
    await page.goto("/#history");
    await expect(page.locator(".k-nav [data-dest=changes]")).toHaveAttribute("aria-current", "page");
    await page.goto("/#extensions");
    await expect(page.locator(".k-nav [data-dest=agents]")).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Control+Backquote");
    await expect(page.locator(".k-drawer.open .console")).toBeVisible();
    await page.keyboard.press("Control+Backquote");
    await expect(page.locator(".k-drawer.open")).toHaveCount(0);
  });
});

test.describe("code canvas", () => {
  test("nested boxes: pick from the project tree, link counts, names with where, go to, layout toggle", async ({ page }) => {
    test.setTimeout(60_000);
    await open(page, "graph", "canvas");
    const stage = page.locator(".ct-stage canvas");
    await expect(stage).toBeVisible({ timeout: 30_000 });
    // The canvas's panel opens as a sheet from the options row.
    await page.getByRole("toolbar", { name: "Panels" }).getByRole("button", { name: /^Selected/ }).click();
    const side = page.getByRole("complementary", { name: "Selected" });
    await expect(side.locator(".ct-sub")).toHaveText("Nothing picked");

    // Picking a file in the shell's Project tree picks it on the canvas, no tree of its own.
    const tree = page.getByRole("complementary", { name: "Project" });
    if (!(await tree.isVisible())) await page.locator(".k-tools").getByRole("button", { name: "Project", exact: true }).click();
    await tree.getByRole("textbox", { name: "Filter files" }).fill("server.rs");
    await tree.getByRole("button", { name: /^(src\/)?server\.rs$/ }).first().click();
    await expect(side.locator(".ct-sub")).toHaveText("src/server.rs");
    await expect(page).toHaveURL(/#graph\/\d+/);
    const out = side.getByRole("button", { name: "Calls out" });
    await expect(out.locator(".ct-num")).not.toHaveText("0");

    // A name shows where it is defined and who uses it.
    const row = side.locator(".ct-name-row").first();
    const name = (await row.locator(".ct-name-txt").innerText()).trim();
    await row.click();
    await expect(side.locator("b").first()).toHaveText(name);
    await expect(side.locator(".ct-where .ct-def")).toContainText("src/server.rs:");

    // A link kind can be switched off; its slider goes with it.
    await out.click();
    await expect(out).toHaveAttribute("aria-pressed", "false");
    await expect(side.getByRole("slider", { name: "Calls out strength" })).toHaveCount(0);
    await out.click();
    await expect(side.getByRole("slider", { name: "Calls out strength" })).toBeVisible();

    // Cmd+K jumps by name.
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.locator(".palette")).toBeVisible();
    await page.keyboard.type("config.rs");
    await expect(page.locator(".palette").getByText(/config\.rs/).first()).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(side.locator(".ct-sub")).toContainText("config.rs");

    // Escape clears the pick and closes the sheet.
    await page.keyboard.press("Escape");
    await expect(side).toHaveCount(0);
    await page.getByRole("toolbar", { name: "Panels" }).getByRole("button", { name: /^Selected/ }).click();
    await expect(side.locator(".ct-sub")).toHaveText("Nothing picked");

    // The canvas is the only layout: no toggle to the force map.
    await expect(page.getByRole("group", { name: "Layout" })).toHaveCount(0);
    await page.screenshot({ path: "test-results/canvas.png" });
  });
});

test.describe("Issue desk", () => {
  test("open, triage, comment and close an issue; templates come from settings", async ({ page }) => {
    await open(page, "issues");
    const desk = page.getByTestId("issue-desk");
    // Settings live in the Settings dialog: starter templates, then save.
    await page.keyboard.press(",");
    await page.locator("[data-section=issues]").click();
    const set = page.getByTestId("issue-settings");
    await set.getByRole("button", { name: "Labels", exact: true }).click();
    const names = await set.getByLabel("Label name").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    if (!names.includes("desk-e2e")) {
      await set.getByRole("button", { name: "Label", exact: true }).click();
      await set.getByLabel("Label name").last().fill("desk-e2e");
    }
    await set.getByRole("button", { name: "Templates", exact: true }).click();
    if (await set.getByRole("button", { name: "Add bug, feature and task" }).count()) await set.getByRole("button", { name: "Add bug, feature and task" }).click();
    const saveBtn = set.getByRole("button", { name: "Save settings" });
    if (await saveBtn.isEnabled()) await saveBtn.click();
    await expect(saveBtn).toBeDisabled();
    await page.keyboard.press("Escape");
    const tool = page.getByRole("toolbar", { name: "Panels" }).getByRole("button", { name: /^Issues/ });
    if ((await tool.getAttribute("aria-pressed")) !== "true") await tool.click();
    const side = page.getByTestId("issue-filters");
    // New from the Bug template: title prefix, labels and priority carry over.
    await side.getByRole("button", { name: "New issue", exact: true }).click();
    await page.getByTestId("issue-templates").getByRole("button", { name: /^Bug/ }).click();
    const title = `bug: desk ${Date.now()}`;
    await desk.getByLabel("Title").fill(title);
    await desk.getByRole("button", { name: "Open issue" }).click();
    const row = desk.locator(".id-row", { hasText: title });
    await expect(row).toBeVisible();
    await expect(row.locator(".id-prio")).toHaveText("high");
    // Detail: add a label, comment, then close as not planned.
    const pane = desk.locator(".id-pane");
    await pane.locator(".id-f", { hasText: "Labels" }).locator("input").fill("desk-e2e");
    await pane.locator(".id-f", { hasText: "Labels" }).locator("input").press("Enter");
    await expect(row.locator(".id-label", { hasText: "desk-e2e" })).toBeVisible();
    await pane.getByLabel("Comment", { exact: true }).fill("seen it");
    await pane.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(pane.locator(".id-comment", { hasText: "seen it" })).toBeVisible();
    await pane.getByLabel("Close reason").selectOption("not_planned");
    await pane.getByRole("button", { name: "Close", exact: true }).click();
    await expect(row).toHaveCount(0);
    await tool.click();
    await side.getByRole("button", { name: /^Closed/ }).click();
    await expect(desk.locator(".id-row", { hasText: title })).toBeVisible();
    await expect(pane.locator(".tag", { hasText: "not planned" })).toBeVisible();
  });

  test("Overview carries the desk", async ({ page }) => {
    await open(page, "overview");
    await expect(page.getByTestId("ov-issues").getByTestId("issue-desk")).toBeVisible();
  });
});
