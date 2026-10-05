import { expect, test, type Page } from "@playwright/test";

// Skip the once-per-session opening so every test lands on the app itself.
async function open(page: Page, hash = "overview") {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
    try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto(`/#${hash}`);
}

const radius = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).borderTopLeftRadius);

test.describe("shell", () => {
  test("loads the overview for this repository", async ({ page }) => {
    await open(page);
    await expect(page.locator(".ov-title h1")).toHaveText(/kula/);
    await expect(page.locator(".kpi-strip")).toBeVisible();
  });

  test("top bar carries only navigation, search and settings", async ({ page }) => {
    await open(page);
    const bar = page.locator(".topbar");
    await expect(bar.getByText(/graph current|no graph/)).toHaveCount(0);
    await expect(bar.getByRole("button", { name: /Reindex/ })).toHaveCount(0);
    await expect(bar.getByRole("button", { name: "Keyboard shortcuts" })).toHaveCount(0);
    await expect(bar.getByRole("button", { name: "Settings" })).toBeVisible();
  });

  test("mark is the kula ring drawn with kula rings, everywhere", async ({ page, request }) => {
    await open(page);
    const mark = page.locator(".brand svg.logo");
    await expect(mark).toHaveAttribute("shape-rendering", "crispEdges");
    // One level in the top bar (a 7×7 ring and its centre: 17 cells)…
    expect((await mark.locator("path").getAttribute("d"))?.match(/M\d+ \d+h1v1h-1z/g)?.length).toBe(17);
    // …two levels in the tab icon: every cell is the ring again (17 × 17).
    const fav = await (await request.get("/favicon.svg")).text();
    expect(fav.match(/M\d+ \d+h1v1h-1z/g)?.length).toBe(17 * 17);
    expect(await page.locator("link[rel=icon]").getAttribute("href")).toBe("/favicon.svg");
  });

  test("simple icons: one round-capped stroke, and settings is a gear", async ({ page }) => {
    await open(page);
    for (const svg of await page.locator(".rail button svg").all()) {
      expect(await svg.getAttribute("stroke-linecap")).toBe("round");
      expect(await svg.getAttribute("stroke-width")).toBe("1.5");
    }
    const gear = page.locator(".topbar").getByRole("button", { name: "Settings" }).locator("svg");
    await expect(gear.locator("circle")).toHaveCount(1);
    expect(((await gear.locator("path").getAttribute("d")) ?? "").split("L").length).toBeGreaterThan(30); // eight teeth
    // No icon balloons to its container: every icon in the chrome stays at text size.
    const big = await page.evaluate(() => [...document.querySelectorAll(".topbar svg, .rail svg, .statusbar svg, .btn svg, .chip svg")]
      .filter((el) => el.getBoundingClientRect().height > 26).length);
    expect(big).toBe(0);
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
  test("one typeface: JetBrains Mono everywhere", async ({ page }) => {
    await open(page);
    for (const sel of ["body", ".ov-title h1", ".kpi-cell b", ".card-head h2", ".section-title, .kpi-label"]) {
      const ff = await page.locator(sel).first().evaluate((el) => getComputedStyle(el).fontFamily);
      expect(ff, sel).toMatch(/^"?JetBrains Mono/);
    }
    const faces = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].map((f) => f.family); });
    expect(faces.join(",")).not.toMatch(/Antonio|Cormorant|Geist/);
  });

  test("Homonin ground and accent", async ({ page }) => {
    await open(page);
    const v = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return { bg: s.getPropertyValue("--bg").trim(), accent: s.getPropertyValue("--accent").trim(), line: s.getPropertyValue("--line").trim() };
    });
    expect(v).toEqual({ bg: "#050505", accent: "#f97f3a", line: "#24201d" });
  });

  test("sharp: framed surfaces and controls have square corners", async ({ page }) => {
    await open(page);
    for (const sel of [".card", ".kpi-strip", ".btn", ".search-trigger", ".chip"]) expect(await radius(page, sel), sel).toBe("0px");
  });

  test("errors get a thin even border, not an accent bar", async ({ page }) => {
    await page.route("**/api/repo", (r) => r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "missing or bad session token" }) }));
    await open(page);
    const t = page.locator(".toast.err").first();
    await expect(t).toBeVisible();
    const b = await t.evaluate((el) => { const s = getComputedStyle(el); return [s.borderLeftWidth, s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderTopLeftRadius]; });
    expect(b).toEqual(["1px", "1px", "1px", "1px", "0px"]);
  });
});

test.describe("graph", () => {
  test("renders, and packages toggle onto the rim", async ({ page }) => {
    await open(page, "graph");
    await expect(page.locator(".graph-wrap canvas").first()).toBeVisible();
    const btn = page.getByRole("button", { name: /Packages/ });
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    await expect(btn).toContainText(/\d+/);
    await page.waitForTimeout(5000); // let the layout settle before the snapshot
    await page.screenshot({ path: "test-results/graph-packages.png" });
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("kula.settings.v1") ?? "{}").packages);
    expect(stored).toBe(true);
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

  test("inspector rows open source with the definition lit; locate still moves the graph", async ({ page }) => {
    await open(page, "graph");
    await page.keyboard.press("ControlOrMeta+k");
    await page.keyboard.type("parseHash");
    await page.locator(".palette").getByText("parseHash", { exact: true }).first().click();
    const row = page.locator(".inspector .sym:has(.kind-badge[title=\"function\"])").first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();
    const panel = page.locator(".code-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".cp-code > div.lit").first()).toBeVisible();
    await page.screenshot({ path: "test-results/code-panel.png" });
    const before = page.url();
    await row.hover();
    await row.locator(".sym-locate").click();
    await expect.poll(() => page.url()).not.toBe(before);
  });
});

test.describe("graph chrome", () => {
  test("one settings control, not two", async ({ page }) => {
    await open(page, "graph");
    await expect(page.getByRole("button", { name: /settings/i })).toHaveCount(1);
  });

  test("while the graph loads it is blocked by the recursive mark and a progress bar", async ({ page }) => {
    await page.route("**/api/graph*", async (r) => { await new Promise((f) => setTimeout(f, 5000)); await r.continue(); });
    await open(page, "graph");
    const gl = page.locator(".graph-loader");
    await expect(gl).toBeVisible();
    // It covers the whole graph area, opaque, and takes the pointer.
    const [box, wrap] = await Promise.all([gl.boundingBox(), page.locator(".graph-wrap").boundingBox()]);
    expect(box).toEqual(wrap);
    expect(await gl.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(5, 5, 5)");
    // The ASCII field animates: the zoom falls into the centre, frame after frame.
    const ascii = gl.locator(".ascii-mark");
    await expect.poll(() => ascii.evaluate((el) => el.textContent?.trim().length ?? 0)).toBeGreaterThan(100);
    // Counted in the page, so a slow test runner can't miss frames: three distinct ones within six seconds.
    const distinct = await ascii.evaluate((el) => new Promise<number>((done) => {
      const seen = new Set([el.textContent]);
      const mo = new MutationObserver(() => { seen.add(el.textContent); if (seen.size >= 3) { mo.disconnect(); done(seen.size); } });
      mo.observe(el, { childList: true, characterData: true, subtree: true });
      setTimeout(() => { mo.disconnect(); done(seen.size); }, 6000);
    }));
    expect(distinct).toBeGreaterThan(2);
    // Progress is a real number that only moves forward.
    const bar = page.getByRole("progressbar", { name: "Loading the graph" });
    const a = Number(await bar.getAttribute("aria-valuenow"));
    await page.screenshot({ path: "test-results/graph-loading.png" });
    await expect.poll(async () => ((await bar.count()) ? Number(await bar.getAttribute("aria-valuenow", { timeout: 1000 }).catch(() => "101")) : 101), { timeout: 10_000 }).toBeGreaterThan(a);
    await expect(gl).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator(".graph-wrap canvas").first()).toBeVisible();
  });

  test("under reduced motion the loader holds still", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/api/graph*", async (r) => { await new Promise((f) => setTimeout(f, 1200)); await r.continue(); });
    await open(page, "graph");
    const ascii = page.locator(".graph-loader .ascii-mark");
    await expect.poll(() => ascii.evaluate((el) => el.textContent?.trim().length ?? 0)).toBeGreaterThan(100);
    const a = await ascii.evaluate((el) => el.textContent);
    await page.waitForTimeout(500);
    expect(await ascii.evaluate((el) => el.textContent)).toBe(a);
  });
});

test.describe("agent checks, for people", () => {
  test("the inspector says what to know before editing a symbol", async ({ page }) => {
    await open(page, "graph");
    await page.keyboard.press("ControlOrMeta+k");
    await page.keyboard.type("parseHash");
    await page.locator(".palette").getByText("parseHash", { exact: true }).first().click();
    await page.getByRole("button", { name: "Pre-edit" }).click();
    const ac = page.locator(".inspector .ac");
    await expect(ac.locator(".risk")).toHaveText(/low|medium|high/);
    await expect(ac.locator(".ac-advice li").first()).toBeVisible();
    await expect(ac).not.toContainText("verify_edit"); // advice is phrased for people here
    // Rows come from structured refs: every one names a real path.
    for (const p of await ac.locator(".ac-ref .p").allTextContents()) expect(p).toMatch(/^[\w./-]+(:\d+)?$/);
  });

  test("verify reads the working tree against HEAD", async ({ request }) => {
    const v = await (await request.get("/api/agent/verify", { headers: { "x-kula-token": "test" } })).json();
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
    const g = await (await request.get("/api/graph?level=file", { headers: { "x-kula-token": "test" } })).json();
    const pk = g.nodes.filter((n: { kind: string }) => n.kind === "package");
    expect(pk.length).toBeGreaterThan(3);
    const ids = new Set(pk.map((n: { id: number }) => n.id));
    expect(g.edges.some((e: { dst: number; kind: string }) => ids.has(e.dst) && e.kind === "IMPORTS")).toBe(true);
  });
});

test.describe("animation", () => {
  test("the opening plays once and any key dismisses it", async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: true })); } catch { /* */ } });
    await page.goto("/#overview");
    const op = page.locator(".opening");
    await expect(op).toBeVisible();
    await expect(op.locator(".op-facts > div").first()).toBeVisible({ timeout: 3000 });
    await page.keyboard.press("Space");
    await expect(op).toHaveCount(0, { timeout: 3000 });
    await page.reload();
    await expect(page.locator(".ov-title h1")).toBeVisible();
    await expect(op).toHaveCount(0); // once per session
  });

  test("panels resize by their edge and remember it", async ({ page }) => {
    await open(page, "history");
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
  ["overview", ".ov-title h1"], ["graph", ".graph-wrap"], ["changes", ".list-head"], ["history", ".list-head"],
  ["branches", ".list-head"], ["issues", ".list-head"], ["notes", ".list-head"], ["console", ".console"],
  ["agents", ".page-head h1"], ["query", ".kq-text"],
];
for (const [view, sel] of VIEWS) {
  test(`@responsive ${view} fits without sideways scroll`, async ({ page }, info) => {
    await open(page, view);
    await expect(page.locator(sel).first()).toBeVisible();
    if (view === "graph") await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 15_000 });
    await page.waitForTimeout(300);
    const over = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(0);
    // Nothing important is pushed off the right edge.
    const clipped = await page.evaluate(() => [...document.querySelectorAll(".topbar button, .rail button, .kpi-cell, .card-head h2, .list-head h2, .hud button, .zoom button")]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 1; }).map((el) => el.textContent?.trim().slice(0, 30)));
    expect(clipped).toEqual([]);
    await page.screenshot({ path: `test-results/${info.project.name}-${view}.png` });
  });
}

test.describe("phone chrome", () => {
  test("@mobile logo and sidebar toggle on the left, search and settings on the right; the sidebar is a drawer", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "phones only");
    await open(page);
    const bar = page.locator(".topbar");
    for (const sel of [".crumb-repo", ".chip"]) await expect(bar.locator(sel)).toBeHidden();
    const x = async (sel: string) => (await bar.locator(sel).first().boundingBox())!.x;
    expect(await x(".brand")).toBeLessThan(await x(".rail-toggle"));
    expect(await x(".rail-toggle")).toBeLessThan(120);
    expect(await x(".search-trigger")).toBeGreaterThan(page.viewportSize()!.width - 100);
    const rail = page.locator("nav.rail");
    await expect(rail).toBeHidden();
    await page.getByRole("button", { name: "Show sidebar" }).click();
    await expect(rail).toBeVisible();
    await rail.getByRole("button", { name: "History" }).click();
    await expect(rail).toBeHidden();
    await expect(page.locator(".list-head").first()).toBeVisible();
  });
});

test.describe("console", () => {
  test("a terminal that runs kula: tabs to add and close, help, kula's own commands and git's", async ({ page }) => {
    await open(page, "console");
    const c = page.locator(".console");
    await expect(c.locator(".ch-title")).toHaveText("Console");
    await expect(c.locator(".ch-text p")).toHaveCount(0);
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

/** The agents fixture (e2e/fixture.sh): a disposable clone with guards, a task and memories. */
const FIXTURE = `http://localhost:${Number(process.env.KULA_PW_PORT ?? 7431) + 1}`;

/** Screen position of a graph node, once the layout has settled (automation-only handle, see GraphView). */
async function nodeAt(page: Page, pick: "hub" | "edge"): Promise<{ a: { x: number; y: number; id: string; label: string }; b: { x: number; y: number; id: string; label: string } }> {
  await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 20_000 });
  await page.waitForFunction(() => !!(window as any).__kula);
  await page.waitForTimeout(400);
  return page.evaluate((pick) => {
    const { sigma, graph } = (window as any).__kula;
    const box = sigma.getContainer().getBoundingClientRect();
    const real = (id: string) => !id.startsWith("__dir:") && graph.getNodeAttribute(id, "dir") !== "__pkg";
    const at = (id: string) => {
      const p = sigma.framedGraphToViewport(sigma.getNodeDisplayData(id));
      return { x: box.left + p.x, y: box.top + p.y, id, label: graph.getNodeAttribute(id, "label") };
    };
    // Two far-apart, directly connected symbols, both on screen.
    const inView = (id: string) => { const p = at(id); return p.x > box.left + 40 && p.x < box.right - 40 && p.y > box.top + 80 && p.y < box.bottom - 80; };
    const edges = graph.edges().map((e: string) => graph.extremities(e)).filter(([s, t]: string[]) => s !== t && real(s) && real(t) && inView(s) && inView(t));
    // Symbols, a short hop apart but not overlapping: still near each other after the camera zooms in.
    const d = (e: string[]) => { const p = at(e[0]), q = at(e[1]); return Math.hypot(p.x - q.x, p.y - q.y); };
    const sym = (id: string) => graph.getNodeAttribute(id, "node").kind !== "file";
    const pool = edges.filter((e: string[]) => sym(e[0]) && sym(e[1]) && d(e) > 25);
    pool.sort((e1: string[], e2: string[]) => (pick === "hub" ? d(e2) - d(e1) : d(e1) - d(e2)));
    const [s, t] = pool[0] ?? edges[0];
    return { a: at(s), b: at(t) };
  }, pick);
}

test.describe("graph interactions", () => {
  test("right-click a symbol for its actions; Escape closes them", async ({ page }) => {
    await open(page, "graph");
    const { a } = await nodeAt(page, "edge");
    await page.mouse.click(a.x, a.y, { button: "right" });
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.locator(".nm-head")).toContainText(a.label);
    for (const item of ["Inspect", "Impact", "Path from selection", "Copy location", "Copy RDF IRI"]) await expect(menu.getByRole("menuitem", { name: item })).toBeVisible();
    // It opens where the pointer is.
    const m = (await menu.boundingBox())!;
    expect(Math.abs(m.x - a.x)).toBeLessThan(260);
    expect(Math.abs(m.y - a.y)).toBeLessThan(320);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await page.mouse.click(a.x, a.y, { button: "right" });
    await menu.getByRole("menuitem", { name: "Impact" }).click();
    await expect(page.locator(".inspector .tabs .on")).toHaveText(/Impact/);
  });

  test("shift-click traces the shortest path from the selected symbol", async ({ page }) => {
    await open(page, "graph");
    const { a, b } = await nodeAt(page, "edge");
    await page.mouse.click(a.x, a.y);
    await expect(page.locator(".inspector h2")).toHaveText(a.label);
    // The camera flies to the selection: find the other end again once it lands.
    await page.waitForTimeout(900);
    const to = await page.evaluate((id) => {
      const { sigma } = (window as any).__kula;
      const box = sigma.getContainer().getBoundingClientRect();
      const p = sigma.framedGraphToViewport(sigma.getNodeDisplayData(id));
      return { x: box.left + p.x, y: box.top + p.y };
    }, b.id);
    await page.keyboard.down("Shift");
    await page.mouse.click(to.x, to.y);
    await page.keyboard.up("Shift");
    const chip = page.locator(".trace-chip");
    await expect(chip).toBeVisible();
    await expect(chip).toContainText("1 hop");
    await expect(chip.locator(".tc-step button")).toHaveText([a.label, b.label]);
    await page.screenshot({ path: "test-results/graph-path.png" });
    await page.keyboard.press("Escape");
    await expect(chip).toHaveCount(0);
  });
});

test.describe("query", () => {
  test("SPARQL over the graph: examples, results that open the map, errors, export", async ({ page }) => {
    await open(page, "query");
    await page.locator(".kq-ex").first().click();
    const rows = page.locator(".kq-table tbody tr");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(3);
    await expect(page.locator(".kq-bar").last()).toContainText(/rows · \d+ ms/);
    await page.screenshot({ path: "test-results/query.png" });
    // A name beside its path opens the symbol in the map.
    await rows.first().locator("td").first().locator("button").click();
    await expect(page).toHaveURL(/#graph\/\d+/);
    await page.getByRole("button", { name: "Query (SPARQL)" }).click();
    const q = page.getByRole("textbox", { name: "SPARQL query" });
    await q.fill("SELECT ?x WHERE { ?x kula:nope }}");
    await q.press("ControlOrMeta+Enter");
    await expect(page.locator(".kq-err")).toContainText("SPARQL");
    await q.fill("ASK { ?s a kula:Function }");
    await q.press("ControlOrMeta+Enter");
    await expect(page.locator(".kq-bool")).toHaveText("true");
    await page.locator(".kq .seg").getByRole("button", { name: "Vocabulary" }).click();
    await expect(page.locator(".kq-v").first()).toBeVisible();
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: "ttl", exact: true }).click();
    expect((await dl).suggestedFilename()).toBe("kula-graph.ttl");
  });
});

test.describe("agents", () => {
  test.use({ baseURL: FIXTURE });

  test("@responsive fences, the task and memories, as agents see them", async ({ page }, info) => {
    await open(page, "agents");
    await expect(page.locator(".page-head h1")).toHaveText("Agents");
    const fences = page.locator(".ag-fences");
    await expect(fences.locator(".ag-rule")).toHaveCount(3);
    await expect(fences.locator(".ag-rule .guard-tag.locked")).toHaveCount(2);
    await expect(fences.locator(".ag-rule .guard-tag.review")).toHaveCount(1);
    await expect(page.locator(".ag-task-title")).toHaveText("harden the MCP server");
    await expect(page.locator(".ag-task .tag")).toHaveText(["src/mcp.rs", "src/agent.rs"]);
    expect(await page.locator(".ag-mem").count()).toBeGreaterThanOrEqual(2);
    await page.screenshot({ path: `test-results/${info.project.name}-agents-full.png`, fullPage: true });
  });

  test("remember a fact from the inspector, see it on the Agents view, forget it", async ({ page }) => {
    const fact = `e2e fact ${Date.now()}`;
    await open(page, "graph");
    await page.keyboard.press("ControlOrMeta+k");
    await page.keyboard.type("context_pack");
    await page.locator(".palette").getByText("context_pack", { exact: true }).first().click();
    const insp = page.locator(".inspector");
    await expect(insp.locator("h2")).toHaveText("context_pack");
    await insp.getByRole("button", { name: /^Notes/ }).click();
    await insp.getByRole("radio", { name: "Agent memory" }).click();
    await insp.locator("textarea").fill(fact);
    await insp.getByRole("button", { name: "Remember" }).click();
    await expect(insp.locator(".note.mem").filter({ hasText: fact })).toBeVisible();
    await page.getByRole("button", { name: "Agents", exact: true }).click();
    const row = page.locator(".ag-mem").filter({ hasText: fact });
    await expect(row.locator(".tag")).toHaveText("fresh");
    await expect(row.locator(".ag-target")).toHaveText("src/agent.rs:context_pack");
    page.once("dialog", (d) => d.accept());
    await row.getByRole("button", { name: "Forget" }).click();
    await expect(row).toHaveCount(0);
  });

  test("the fences overlay lights locked code and the task's scope", async ({ page }) => {
    await open(page, "graph");
    await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 20_000 });
    await page.keyboard.press("f");
    const key = page.locator(".fence-key");
    await expect(key).toBeVisible();
    await expect(key.locator(".guard-tag.locked")).toBeVisible();
    await expect(key).toContainText("harden the MCP server");
    await expect(page.getByRole("button", { name: /Fences/ })).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({ path: "test-results/graph-fences.png" });
    await page.keyboard.press("f");
    await expect(key).toHaveCount(0);
  });

  test("a locked symbol says so in the inspector and before editing", async ({ page }) => {
    await open(page, "graph");
    await page.keyboard.press("ControlOrMeta+k");
    await page.keyboard.type("publish");
    await page.locator(".palette").getByText("publish", { exact: true }).first().click();
    const insp = page.locator(".inspector");
    await expect(insp.locator(".insp-guard.locked")).toContainText("atomic index swap");
    await insp.getByRole("button", { name: "Pre-edit" }).click();
    await expect(insp.locator(".ac-advice")).toContainText("Do not edit");
    await expect(insp.locator(".note.mem")).toContainText("Unlink, never truncate");
  });
});

test("the inspector's tabs all fit at its default width", async ({ page }) => {
  await open(page, "graph");
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("context_pack");
  await page.locator(".palette").getByText("context_pack", { exact: true }).first().click();
  const tabs = page.locator(".inspector .tabs");
  await expect(tabs.getByRole("button")).toHaveCount(6);
  expect(await tabs.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
});
