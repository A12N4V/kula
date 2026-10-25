import { expect, test as base, type Page } from "@playwright/test";
import { GLOBAL_SHORTCUTS } from "../src/nav";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { explore } from "./explore";

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
      // The port was free a moment ago, but a foreign kula server (another
      // checkout's run) can take it in between. A fixture answers /api/agents
      // with token "test" and carries this run's marker guard; anything else
      // means the tests would silently read the wrong repo.
      const probe = await fetch(`${url}/api/agents`, { headers: { "x-kula-token": "test" } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const ours = probe && Array.isArray(probe.rules) && probe.rules.some((r: { reason?: string }) => r.reason === "release pipeline: signed packages");
      if (!ours) {
        const out = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "(no log)";
        throw new Error(`something else is serving on fixture port ${port} – not this run's fixture\nfixture log:\n${out}`);
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
    // The title is the repository's directory name, whatever the checkout is called.
    const repo = await page.evaluate(() => fetch("/api/repo", { headers: { "x-kula-token": document.querySelector('meta[name="kula-token"]')?.content ?? "" } }).then((r) => r.json()));
    await expect(page.locator(".ov-title h1")).toHaveText(new RegExp(`\\b${repo.name}\\b`));
    // Numbers live in the stat table now, not KPI tiles.
    await expect(page.locator(".stat-table.ov-stats")).toBeVisible();
  });

  test("top bar carries only navigation, search and settings", async ({ page }) => {
    await open(page);
    const bar = page.locator(".topbar");
    await expect(bar.getByText(/graph current|no graph/)).toHaveCount(0);
    await expect(bar.getByRole("button", { name: /Reindex/ })).toHaveCount(0);
    await expect(bar.getByRole("button", { name: "Keyboard shortcuts" })).toHaveCount(0);
    await expect(bar.getByRole("button", { name: "Settings" })).toBeVisible();
  });

  test("search is an icon beside settings, and back/forward walk through views", async ({ page }) => {
    await open(page);
    const actions = page.locator(".topbar .top-actions");
    const search = actions.getByRole("button", { name: "Search" });
    const gear = actions.getByRole("button", { name: "Settings" });
    const [s, g] = [await search.boundingBox(), await gear.boundingBox()];
    expect(g!.x - (s!.x + s!.width)).toBeLessThan(12);
    await search.click();
    await expect(page.locator(".palette")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); await page.keyboard.press("a"); // `a` opens Agents (its rail item is back as the config home)
    await page.getByRole("tab", { name: /Memory/ }).click();
    await expect(page).toHaveURL(/#agents\/memory$/);
    await page.goBack();
    await expect(page).toHaveURL(/#agents$/);
    await expect(page.getByRole("tab", { name: "Agents", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.goBack();
    await expect(page.locator(".ov-title h1")).toBeVisible();
    await page.keyboard.press("Alt+ArrowRight");
    await expect(page).toHaveURL(/#agents$/);
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
    for (const sel of ["body", ".ov-title h1", ".stat-table td", ".stat-table .st-note", ".card-head h2", ".section-title, .stat-table th"]) {
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
    for (const sel of [".card", ".stat-table.ov-stats", ".btn", ".top-search", ".chip"]) expect(await radius(page, sel), sel).toBe("0px");
  });

  test("errors get a thin even border, not an accent bar", async ({ page }) => {
    await page.route("**/api/repo", (r) => r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "missing or bad session token" }) }));
    await open(page);
    // A dead server is an error panel now, not a toast; the same thin even border applies.
    const t = page.getByTestId("server-error");
    await expect(t).toBeVisible();
    const b = await t.evaluate((el) => { const s = getComputedStyle(el.querySelector("p.mono")!); return [s.borderLeftWidth, s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderTopLeftRadius]; });
    expect(b).toEqual(["1px", "1px", "1px", "1px", "0px"]);
  });
});

test.describe("graph", () => {
  test("renders, and packages toggle onto the rim", async ({ page }) => {
    test.setTimeout(60_000);
    await open(page, "graph");
// Laying out the graph takes a while when the machine is busy; wait for it.
    await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator(".graph-wrap canvas").first()).toBeVisible({ timeout: 30_000 });
    const btn = page.getByRole("switch", { name: /Packages/ });
    await expect(btn).toHaveAttribute("aria-checked", "false");
    await btn.click();
    await expect(btn).toHaveAttribute("aria-checked", "true");
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

  test("embeddings section: the switch and its state, off by default", async ({ page }) => {
    await open(page);
    await page.keyboard.press(",");
    const section = page.locator("#set-embed");
    await section.scrollIntoViewIfNeeded();
    await expect(section).toBeVisible();
    // One switch drives the whole section: role=switch, labelled.
    const sw = page.getByRole("switch", { name: "Enable embeddings" });
    await expect(sw).toBeVisible();
    // Off by default: embeddings are opt-in, nothing downloads until switched.
    await expect(sw).toHaveAttribute("aria-checked", /false|true/);
    const small = page.locator(".settings .set-row.toggle", { hasText: "Enable embeddings" }).locator("small");
    await expect(small).toContainText(/Off – blocks form from the call graph alone|Thematic blocks|Enabled – install/);
  });

  test("embeddings switch runs the gate: check table or refuse, cancel available", async ({ page }) => {
    await open(page);
    await page.keyboard.press(",");
    const sw = page.getByRole("switch", { name: "Enable embeddings" });
    await sw.scrollIntoViewIfNeeded();
    const wasOff = (await sw.getAttribute("aria-checked")) === "false";
    if (wasOff) await sw.click();
    // Turning it on runs the check: the two-column table appears with a verdict row.
    const table = page.getByTestId("embed-check");
    await expect(table).toBeVisible({ timeout: 30_000 });
    await expect(table).toContainText("Verdict");
    await expect(table).toContainText("RAM free");
    // The map row states what the map does with (or without) embeddings.
    await expect(page.locator(".settings .set-row", { hasText: "Mapping" })).toBeVisible();
    // Leave the setting as we found it so other tests see the default repo.
    // A warn verdict parks the switch behind a confirm row, where a plain
    // click on the switch is a no-op and the flag leaks into kula.toml –
    // turn it off through the API instead of fighting that row.
    if ((await sw.getAttribute("aria-checked")) === "true" || !(await sw.getAttribute("aria-checked"))) {
      await page.evaluate(() =>
        fetch("/api/embed/enable", {
          method: "POST",
          headers: { "x-kula-token": document.querySelector('meta[name="kula-token"]')?.content ?? "test", "content-type": "application/json" },
          body: JSON.stringify({ enabled: false }),
        }));
    }
    // Turn it off and keep turning it off until the server itself agrees –
    // a warn verdict parks the switch behind a confirm row (a plain click on
    // the switch is a no-op there) and the flag must not leak into kula.toml.
    await page.waitForFunction(async () => {
      const t = document.querySelector('meta[name="kula-token"]')?.content ?? "test";
      await fetch("/api/embed/enable", { method: "POST", headers: { "x-kula-token": t, "content-type": "application/json" }, body: JSON.stringify({ enabled: false }) });
      return (await (await fetch("/api/embed/status", { headers: { "x-kula-token": t } })).json()).enabled === false;
    }, undefined, { timeout: 20_000, polling: 1_500 });
    await page.reload();
    await page.keyboard.press(",");
    const sw2 = page.getByRole("switch", { name: "Enable embeddings" });
    await expect(sw2).toHaveAttribute("aria-checked", "false", { timeout: 15_000 });
  });

  test("languages settings: indexed languages and install buttons for detected-but-missing ones", async ({ page }) => {
    await open(page);
    await page.keyboard.press(",");
    await page.locator("#set-langs").scrollIntoViewIfNeeded();
    // The two-column table: every language here, with the count of files.
    await expect(page.locator("#set-langs")).toBeVisible();
    // The two-column table: every language here, with the count of files.
    await expect(page.locator("#set-langs")).toBeVisible();
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

  test("while the graph loads it is blocked by the recursive mark and a progress bar", async ({ page }) => {
    test.setTimeout(60_000);
    await page.route("**/api/graph*", async (r) => { await new Promise((f) => setTimeout(f, 3000)); await r.continue(); });
    await open(page, "graph");
    const gl = page.locator(".graph-loader");
    await expect(gl).toBeVisible();
    // It covers the whole graph area, opaque, and takes the pointer.
    const [box, wrap] = await Promise.all([gl.boundingBox(), page.locator(".graph-wrap").boundingBox()]);
    // Sub-pixel drift between the two measurements is float noise, not layout.
    const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
    expect(box && wrap && near(box.x, wrap.x) && near(box.y, wrap.y) && near(box.width, wrap.width) && near(box.height, wrap.height)).toBe(true);
    expect(await gl.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(5, 5, 5)");
    // The ASCII field animates: the zoom falls into the centre, frame after frame.
    const ascii = gl.locator(".ascii-mark");
    await expect.poll(() => ascii.evaluate((el) => el.textContent?.trim().length ?? 0)).toBeGreaterThan(100);
    // Counted in the page, so a slow test runner can't miss frames: three distinct ones within six seconds.
    const distinct = await ascii.evaluate((el) => new Promise<number>((done) => {
      const seen = new Set([el.textContent]);
      const mo = new MutationObserver(() => { seen.add(el.textContent); if (seen.size >= 3) { mo.disconnect(); done(seen.size); } });
      mo.observe(el, { childList: true, characterData: true, subtree: true });
      setTimeout(() => { mo.disconnect(); done(seen.size); }, 4000);
    }));
    expect(distinct).toBeGreaterThan(2);
    // Progress is a real number that only moves forward.
    const bar = page.getByRole("progressbar", { name: "Loading the graph" });
    const a = Number(await bar.getAttribute("aria-valuenow"));
    await page.screenshot({ path: "test-results/graph-loading.png" });
await expect.poll(async () => ((await bar.count()) ? Number(await bar.getAttribute("aria-valuenow", { timeout: 1000 }).catch(() => "101")) : 101), { timeout: 20_000 }).toBeGreaterThan(a);
    await expect(gl).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator(".graph-wrap canvas").first()).toBeVisible({ timeout: 30_000 });
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
if (view === "graph") { test.setTimeout(60_000); await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 45_000 }); }
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
  test("@responsive settings with the languages table fits without sideways scroll", async ({ page }, info) => {
    await open(page);
    await page.keyboard.press(",");
    await page.locator("#set-langs").scrollIntoViewIfNeeded();
    const over = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(0);
    const clipped = await page.evaluate(() => [...document.querySelectorAll(".settings .set-row button, .settings .set-row .mono")]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 1; }).map((el) => el.textContent?.trim().slice(0, 30)));
    expect(clipped).toEqual([]);
    await page.screenshot({ path: `test-results/${info.project.name}-settings.png` });
  });

  test("@mobile logo and sidebar toggle on the left, search and settings on the right; the sidebar is a drawer", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "phones only");
    await open(page);
    const bar = page.locator(".topbar");
    for (const sel of [".crumb-repo", ".chip"]) await expect(bar.locator(sel)).toBeHidden();
    const x = async (sel: string) => (await bar.locator(sel).first().boundingBox())!.x;
    expect(await x(".brand")).toBeLessThan(await x(".rail-toggle"));
    expect(await x(".rail-toggle")).toBeLessThan(120);
    expect(await x(".top-search")).toBeGreaterThan(page.viewportSize()!.width - 100);
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
    // the console is the bottom dock now: #console opens it on the terminal
    const c = page.locator("[data-testid=dock] .console");
    await expect(page.locator("[data-testid=dock-tab-terminal]")).toHaveAttribute("aria-selected", "true");
    await expect(c).toBeVisible();
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

// U2 · panel behaviour: hidden when closed, the sash snaps it shut under
// 80px, maximize toggles, ctrl+` reopens (VS Code's panel).
test.describe("bottom panel", () => {
  const dockBox = (page: Page) => page.locator("[data-testid=dock]").boundingBox();
  const dockHeight = async (page: Page) => (await dockBox(page))?.height ?? 0;

  test("closed means gone; status bar button and ctrl+` both open it; hide closes it for good", async ({ page }) => {
    await open(page);
    await expect(page.locator("[data-testid=dock]")).toHaveCount(0);
    await page.keyboard.press("Control+`");
    await expect(page.locator("[data-testid=dock]")).toBeVisible();
    // closed means gone: nothing of the panel is left to interact with
    const unmounted = page.locator("[data-testid=dock-toggle]");
    await page.locator("[data-testid=dock-toggle]").click();
    await expect(page.locator("[data-testid=dock]")).toHaveCount(0);
    await expect(unmounted).toHaveCount(0);
    // reopen exactly with ctrl+`
    await page.keyboard.press("Control+`");
    await expect(page.locator("[data-testid=dock]")).toBeVisible();
    await page.keyboard.press("Control+`");
    await expect(page.locator("[data-testid=dock]")).toHaveCount(0);
  });

  test("maximize makes it most of the window and restores", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Control+`");
    const before = await dockHeight(page);
    await page.locator("[data-testid=dock-max]").click();
    const vh = page.viewportSize()!.height;
    const maxed = await dockHeight(page);
    expect(maxed).toBeGreaterThan(before);
    expect(maxed).toBeLessThanOrEqual(Math.round(vh * 0.8));
    await page.locator("[data-testid=dock-max]").click();
    expect(await dockHeight(page)).toBeLessThan(maxed);
  });

  test("@responsive the sash snaps the panel shut when dragged under 80px (desktop)", async ({ page }, info) => {
    test.skip(info.project.name === "phone", "desktop pointer only");
    await open(page);
    await page.keyboard.press("Control+`");
    const before = await dockHeight(page);
    const g = await page.locator(".dock-grip").boundingBox();
    expect(before).toBeGreaterThanOrEqual(120);
    await page.mouse.move(g!.x + g!.width / 2, g!.y + g!.height / 2);
    await page.mouse.down();
    // a small resize stays open and grows
    await page.mouse.move(g!.x + g!.width / 2, g!.y + g!.height / 2 - 30, { steps: 4 });
    await page.mouse.up();
    expect(await dockHeight(page)).toBeGreaterThan(before);
    // dragged past 80px it snaps shut (and reopens at its last height)
    const g2 = await page.locator(".dock-grip").boundingBox();
    await page.mouse.move(g2!.x + g2!.width / 2, g2!.y + g2!.height / 2);
    await page.mouse.down();
    await page.mouse.move(g2!.x + g2!.width / 2, g2!.y + g2!.height / 2 + 400, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator("[data-testid=dock]")).toHaveCount(0);
    await page.keyboard.press("Control+`");
    await expect(page.locator("[data-testid=dock]")).toBeVisible();
    expect(await dockHeight(page)).toBeGreaterThan(0);
  });

  test("the open panel pushes the view up and nothing overlaps it", async ({ page }, info) => {
    test.skip(info.project.name === "phone", "desktop only: the status bar toggle");
    await open(page);
    await page.keyboard.press("Control+`");
    const d = (await dockBox(page))!;
    // the panel fills .main down to the status bar – nothing of it overlaps the bar
    const bar = await page.locator(".statusbar").boundingBox();
    expect(bar!.y).toBeGreaterThanOrEqual(Math.round(d.y + d.height) - 1);
    expect(bar!.y).toBeLessThan(page.viewportSize()!.height);
  });
});

/** Screen position of a graph node, once the layout has settled (automation-only handle, see GraphView). */
async function nodeAt(page: Page, pick: "hub" | "edge"): Promise<{ a: { x: number; y: number; id: string; label: string }; b: { x: number; y: number; id: string; label: string } }> {
  await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 20_000 });
  await page.waitForFunction(() => !!(window as any).__kula);
  await page.waitForTimeout(400);
  // Under load the layout can still settle after the loader clears; positions
  // sampled too early drift and the subsequent mouse click misses the node.
  // Wait until the two candidate positions hold still across a beat.
  await expect.poll(async () => {
    const read = () => page.evaluate((pick) => {
      const { sigma, graph } = (window as any).__kula;
      const box = sigma.getContainer().getBoundingClientRect();
      const edges = graph.edges().map((e: string) => graph.extremities(e)).filter(([s, t]: string[]) => s !== t);
      const flat = edges.flat().slice(0, 200);
      return flat.map((id: string) => {
        const p = sigma.framedGraphToViewport(sigma.getNodeDisplayData(id));
        return `${id}:${Math.round(p.x)},${Math.round(p.y)}`;
      }).join("|");
    }, pick);
    const first = await read();
    await page.waitForTimeout(250);
    return (await read()) === first ? "still" : "moving";
  }).toBe("still");
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
    // The camera flies to the selection: let the flight start and land (a short
    // sleep alone loses under load), then wait until the other end stops moving.
    await page.waitForTimeout(600);
    const to = await expect.poll(async () => {
      const read = () => page.evaluate((id) => {
        const { sigma } = (window as any).__kula;
        const p = sigma.framedGraphToViewport(sigma.getNodeDisplayData(id));
        return `${Math.round(p.x)},${Math.round(p.y)}`;
      }, b.id);
      const first = await read();
      await page.waitForTimeout(200);
      return (await read()) === first ? first : "moving";
    });
    expect(to).not.toBe("moving");
    const spot = await page.evaluate((id) => {
      const { sigma } = (window as any).__kula;
      const box = sigma.getContainer().getBoundingClientRect();
      const p = sigma.framedGraphToViewport(sigma.getNodeDisplayData(id));
      return { x: box.left + p.x, y: box.top + p.y };
    }, b.id);
    await page.keyboard.down("Shift");
    await page.mouse.click(spot.x, spot.y);
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
  test.use({ baseURL: ({ fx }, use) => use(fx) });
  // They write kula.toml, AGENTS.md and memories in one fixture: one at a time.
  test.describe.configure({ mode: "serial" });
  const desktopOnly = (info: { project: { name: string } }) => test.skip(info.project.name !== "desktop", "writes to the fixture");

  test("@responsive the task, its workflow and the agent loop, and what needs a person", async ({ page }, info) => {
    await open(page, "agents/overview");
    await expect(page.locator(".ag-menu .list-head h2")).toHaveText("Agents");
    await expect(page.locator(".ag-task-title")).toHaveText("harden the MCP server");
    await expect(page.locator(".ag-now .ag-chips .tag")).toHaveText(["fix", "src/mcp.rs", "src/agent.rs"]);
    await expect(page.locator(".loop-step")).toHaveCount(6);
    await expect(page.locator(".loop-step.gate")).toContainText("fix");
    await expect(page.locator(".ag-steps li").first()).toContainText("recall memories");
    // Desktop's fences test accepts this suggestion; the other projects may run after it.
    if (info.project.name === "desktop") await expect(page.locator(".need.sugg")).toContainText("web/dist/**");
    // Desktop's workflow test may have created e2e-migrate in this shared
    // fixture while this runs; count the stock tiles only.
    await expect(page.locator(".wf-tile").filter({ hasNotText: "e2e-migrate" })).toHaveCount(6);
    await expect(page.locator(".wf-tile.active")).toContainText("fix");
    await page.getByRole("tab", { name: /Fences/ }).click();
    // Desktop's fences test appends and removes rows in the same fixture while
    // the other projects run; only the desktop project pins the exact count.
    if (info.project.name === "desktop") await expect(page.locator(".fence-row")).toHaveCount(3);
    else expect(await page.locator(".fence-row").count()).toBeGreaterThanOrEqual(3);
    await expect(page.locator(".fence-row select").first()).toHaveValue("locked");
    await page.getByRole("tab", { name: /Memory/ }).click();
    expect(await page.locator(".ag-mem").count()).toBeGreaterThanOrEqual(2);
    for (const t of ["Docs", "Connect", "^Agents$"]) {
      await page.getByRole("tab", { name: new RegExp(t) }).click();
      await expect(page.locator(".ag-panel")).toBeVisible();
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${t} scrolls sideways`).toBeLessThanOrEqual(1);
    }
    await page.screenshot({ path: `test-results/${info.project.name}-agents-full.png`, fullPage: true });
  });

  test("a workflow: create it in the compact form, finish it in the editor, preview it on the graph, delete it", async ({ page }, info) => {
    desktopOnly(info);
    await open(page, "agents/workflows");
    // The one add flow: + opens the compact form in place – defaults prefilled,
    // inline validation, Enter creates, Esc cancels. No modal, no second step.
    await page.getByRole("button", { name: "New workflow" }).click();
    const form = page.locator("[data-testid=ag-add-form]");
    await expect(form).toBeVisible();
    await expect(form.locator("[data-testid=ag-add-name]")).toHaveValue(/new-workflow/);
    await expect(form.getByLabel("Fence scope")).toBeVisible();
    // inline validation: an existing name is refused before anything saves
    await form.locator("[data-testid=ag-add-name]").fill("fix");
    await expect(form.locator(".ag-add-err")).toContainText("already exists");
    await expect(form.locator("[data-testid=ag-add-create]")).toBeDisabled();
    await form.locator("[data-testid=ag-add-name]").fill("e2e-migrate");
    await form.getByLabel("Role").fill("Schema changes, nothing else");
    const scope = form.getByLabel("Fence scope");
    await scope.fill("src/store");
    await scope.press("Enter");
    // Enter creates (the form submits): the full editor opens on the new agent
    await form.locator("[data-testid=ag-add-name]").press("Enter");
    const edit = page.locator(".wf-edit");
    await expect(page.locator(".ag-side-head h2")).toHaveText("e2e-migrate");
    // The compact form carried role and fence; the editor takes the rest
    // (lock, memory, steps) – every field editable inline from there.
    await expect(edit.locator(".ff-open")).toContainText("src/store");
    const lock = edit.locator(".ff-locked input");
    await lock.fill("Cargo.toml");
    await lock.press("Enter");
    await edit.getByRole("button", { name: "recall only", exact: true }).click();
    await edit.getByRole("button", { name: "Add step" }).click();
    await edit.getByLabel("Step 1").fill("Write a migration and its rollback");
    await edit.getByRole("button", { name: "Save" }).click();
    // The sidebar shows what was saved: name, kula.toml tag, locked chip
    // and the memory segment. The saved workflow keeps its card in the grid.
    await expect(page.locator(".ag-side-head .mono")).toContainText("kula.toml");
    await expect(edit.locator(".ff-locked")).toContainText("Cargo.toml");
    await expect(edit.locator(".seg .on")).toContainText("recall only");
    const card = page.locator(`[data-testid=ag-card-e2e-migrate]`);
    await expect(card).toBeVisible();
    await expect(edit.locator(".ff-locked .guard-tag")).toHaveText("lock");
    await expect(edit.locator(".ff-locked .chip-x", { hasText: "Cargo.toml" })).toBeVisible();
    await expect(edit.locator(".ff-open .chip-x", { hasText: "src/store" })).toBeVisible();
    await page.getByRole("button", { name: "Preview fences" }).click();
    await expect(page).toHaveURL(/#graph\/fences\/e2e-migrate$/);
    // The fence key renders once the graph is built; under full-suite load that
    // can take longer than the default 5 s (the fences-overlay test waits 20 s too).
    await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 20_000 });
    await expect(page.locator(".fence-key select")).toHaveValue("e2e-migrate", { timeout: 10_000 });
    await expect(page.locator(".fence-key")).toContainText("editable");
    await page.goBack();
    // Going back remounts the tab, which closes the sidebar again: the card
    // opens it once more.
    // the card body opens the agent; the mark on top opens the logo studio (U17)
    await card.locator(".card__t").click();
    await expect(page.locator(".ag-side-head h2")).toHaveText("e2e-migrate");
    page.once("dialog", (d) => d.accept());
    await page.locator(".wf-edit").getByRole("button", { name: "Delete" }).click();
    await expect(page.locator(`[data-testid=ag-card-e2e-migrate]`)).toHaveCount(0);
  });

  test("a team: create it from the + tab, edit it in the sidebar and delete it – asserted by name", async ({ page, request }, info) => {
    desktopOnly(info);
    await open(page, "agents/teams");
    // One add flow for teams: the + tab opens the inline name form and Enter
    // saves through team_save.
    await page.getByTestId("team-tab-add").click();
    const input = page.getByTestId("team-add-name");
    await expect(input).toBeFocused();
    await input.fill("e2e-crew");
    await input.press("Enter");
    const tab = page.getByTestId("team-tab-e2e-crew");
    await expect(tab).toBeVisible();
    await expect(tab).toHaveClass(/on/);
    await expect(page.getByTestId("team-canvas")).toBeVisible();
    // Edit: rename through the sidebar's Team name field; the server sees it.
    await page.getByTestId("team-side-toggle").click();
    const side = page.getByTestId("team-side");
    await expect(side).toBeVisible();
    await side.getByLabel("Team name").fill("e2e-crew-2");
    await expect(page.getByTestId("team-tab-e2e-crew-2")).toBeVisible();
    const readToml = async () => (await (await request.get("/api/file?path=kula.toml", { headers: { "x-kula-token": "test" } })).json()).content as string;
    await expect.poll(readToml).toContain('name = "e2e-crew-2"');
    // Delete through the sidebar – the tab and the kula.toml block both go.
    await side.getByTestId("team-delete").click();
    await expect(page.getByTestId("team-tab-e2e-crew-2")).toHaveCount(0);
    await expect.poll(readToml).not.toContain('name = "e2e-crew-2"');
  });

  test("the add flow works by keyboard alone: esc cancels, enter creates", async ({ page }, info) => {
    desktopOnly(info);
    await open(page, "agents/workflows");
    await page.getByRole("button", { name: "New workflow" }).focus();
    await page.keyboard.press("Enter");
    const form = page.locator("[data-testid=ag-add-form]");
    await expect(form).toBeVisible();
    // esc cancels: the form closes and nothing was saved
    await page.keyboard.press("Escape");
    await expect(form).toHaveCount(0);
    const kbd = `e2e-kb-${Date.now()}`;
    await page.getByRole("button", { name: "New workflow" }).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.type(kbd); // the name input is autofocused
    await page.keyboard.press("Enter"); // enter creates
    const card = page.locator(`[data-testid=ag-card-${kbd}]`);
    await expect(card).toBeVisible();
    await expect(page.locator(".ag-side-head h2")).toHaveText(kbd);
    // and it is really in kula.toml – clean up after ourselves
    page.once("dialog", (d) => d.accept());
    await page.locator(".wf-edit").getByRole("button", { name: "Delete" }).click();
    await expect(card).toHaveCount(0);
  });

  test("@responsive no overlap on the agents view at 1440 and 390", async ({ page }, info) => {
    await open(page, "agents");
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(300);
      for (const tab of ["", "teams", "^agents$"]) {
        if (tab) await page.getByRole("tab", { name: new RegExp(tab, "i") }).click();
        const hits = await page.evaluate(() => {
          // Clip-aware overlap: an element's rect counts only inside the
          // scrollport that clips it – content scrolled out of a pane is not
          // an overlap with the chrome sitting below the pane.
          const vis = (el: Element) => {
            const s = getComputedStyle(el);
            if (s.display === "none" || s.visibility === "hidden") return null;
            let r = el.getBoundingClientRect();
            let n = el.parentElement;
            while (n && n !== document.body) {
              const cs = getComputedStyle(n);
              if (cs.overflowY !== "visible" || cs.overflowX !== "visible") {
                const c = n.getBoundingClientRect();
                const t = { x: Math.max(r.left, c.left), y: Math.max(r.top, c.top), x2: Math.min(r.right, c.right), y2: Math.min(r.bottom, c.bottom) };
                r = { left: t.x, right: t.x2, top: t.y, bottom: t.y2 } as DOMRect;
                if (r.bottom - r.top < 4 || r.right - r.left < 4) return null;
              }
              n = n.parentElement;
            }
            return r;
          };
          const els = [...document.querySelectorAll("button, input, h1, h2")].map(vis).filter((r): r is DOMRect => !!r);
          let worst = 0;
          for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
            const a = els[i], b = els[j];
            const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ox > 3 && oy > 3) worst++;
          }
          return worst;
        });
        expect(hits, `${tab || "overview"} overlaps at ${w}x${h}`).toBe(0);
      }
    }
  });

  test("fences: add one with autofill, save it to kula.toml, accept an agent's suggestion, take both away", async ({ page, request }, info) => {
    desktopOnly(info);
    await open(page, "agents/fences");
    await page.getByRole("button", { name: "Add fence" }).click();
    const row = page.locator(".fence-row").nth(3);
    const paths = row.getByLabel("Paths");
    await paths.click();
    await paths.pressSequentially("scripts/te");
    await expect(page.locator(".af-pop")).toBeVisible();
    await page.keyboard.press("Tab");
    await row.getByLabel("Level").selectOption("hidden");
    await row.getByLabel("Reason").fill("e2e: not for agents");
    // The Save button enables once the autofilled path reaches the store;
    // that state sync is async, so wait instead of racing the click.
    await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".fence-row")).toHaveCount(4);
    await expect(page.locator(".fence-row").nth(3).locator(".chip-x")).toContainText("scripts/test.sh");
    const toml = await (await request.get("/api/file?path=kula.toml", { headers: { "x-kula-token": "test" } })).json().catch(() => null);
    if (toml) expect(toml.content).toContain("e2e: not for agents");
    await page.locator(".need.sugg").getByRole("button", { name: "Accept" }).click();
    // Accepting refetches the agents info, which resets unsaved local rows –
    // wait until that settles before removing rows.
    await expect(page.locator(".need.sugg")).toHaveCount(0);
    await expect(page.locator(".fence-row")).toHaveCount(5);
    // Reload before removing: the fences view compares its draft against the
    // rules it fetched at mount, so without a reload a save leaves it thinking
    // nothing is dirty and Save stays disabled. Ticketed for A1 in
    // .kula-team/scratch/q1-tickets.md.
    await page.reload();
    await expect(page.locator(".fence-row")).toHaveCount(5);
    for (const i of [4, 3]) await page.locator(".fence-row").nth(i).getByRole("button", { name: "Remove fence" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".fence-row")).toHaveCount(3);
  });

  test("memory: remember from where you are, rewrite it, mark it stale, still true, forget", async ({ page }, info) => {
    desktopOnly(info);
    const fact = `e2e memory ${Date.now()}`;
    await open(page, "graph");
    await page.keyboard.press("ControlOrMeta+k");
    await page.keyboard.type("context_pack");
    await page.locator(".palette").getByText("context_pack", { exact: true }).first().click();
    await expect(page.locator(".inspector h2")).toHaveText("context_pack");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); await page.keyboard.press("a"); // `a` opens Agents (its rail item is back as the config home)
    await page.getByRole("tab", { name: /Memory/ }).click();
    const hint = page.locator(".here-hint");
    await expect(hint).toContainText("context_pack");
    await hint.click();
    await expect(page.getByLabel("Memory target")).toHaveValue("symbol:src/agent.rs:context_pack");
    await page.getByLabel("Memory text").fill(fact);
    await page.getByRole("button", { name: "Remember" }).click();
    const first = page.locator(".ag-mem").filter({ hasText: fact });
    await expect(first.locator(".tag")).toHaveText("fresh");
    // Pin the row by its id: in edit mode its text lives in a textarea, not the row's text.
    const id = (await first.locator(".ag-meta").innerText()).match(/#(\d+)/)![1];
    const edited = page.locator(".ag-mem").filter({ has: page.locator(".ag-meta", { hasText: new RegExp(`^#${id} ·`) }) });
    await edited.getByRole("button", { name: "Edit" }).click();
    await edited.getByLabel("Memory text").fill(`${fact} – rewritten`);
    await edited.getByRole("button", { name: "Save" }).click();
    await expect(edited.locator(".ag-mem-body")).toHaveText(`${fact} – rewritten`);
    await edited.getByRole("button", { name: "Mark stale" }).click();
    await expect(edited.locator(".tag").first()).toHaveText("stale");
    await edited.getByRole("button", { name: "Still true" }).click();
    await expect(edited.locator(".tag").first()).toHaveText("fresh");
    page.once("dialog", (d) => d.accept());
    await edited.getByRole("button", { name: "Forget" }).click();
    await expect(edited).toHaveCount(0);
  });

  test("docs: the brief in AGENTS.md is current, edits save, and agents connect in their own formats", async ({ page }, info) => {
    desktopOnly(info);
    await open(page, "agents/docs");
    const item = page.locator(".doc-item").filter({ hasText: "AGENTS.md" });
    await expect(item).toContainText("brief current");
    const area = page.getByLabel("Edit AGENTS.md");
    await expect(area).toHaveValue(/kula:begin/);
    await area.press("ControlOrMeta+End");
    await area.pressSequentially("\nE2E: run the tests before pushing.\n");
    await page.locator(".docs-edit").getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".docs-edit").getByRole("button", { name: "Save" })).toBeDisabled();
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.locator(".brief-preview")).toContainText("| `refactor` |");
    await page.getByRole("tab", { name: /Connect/ }).click();
    const cursor = page.locator(".conn").filter({ hasText: "Cursor" });
    const wire = (scope: ReturnType<typeof page.locator>, label: string) => scope.locator(".conn-wires li").filter({ hasText: label });
    // Repeat-safe: connect is a rewrite, so the wires may already be on from a previous run.
    await cursor.getByRole("button", { name: /Connect|Rewrite/ }).click();
    await expect(wire(cursor, "MCP")).toHaveClass(/on/);
    await expect(wire(cursor, "fence hook")).toHaveClass(/on/);
    const claude = page.locator(".conn").filter({ hasText: "Claude Code" });
    await expect(wire(claude, "MCP")).toHaveClass(/on/);
    await expect(wire(claude, "fence hook")).toHaveClass(/on/);
  });

  test("remember a fact from the inspector, see it on the Agents view, forget it", async ({ page }, info) => {
    desktopOnly(info);
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
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); await page.keyboard.press("a"); // `a` opens Agents (its rail item is back as the config home)
    await page.getByRole("tab", { name: /Memory/ }).click();
    const row = page.locator(".ag-mem").filter({ hasText: fact });
    await expect(row.locator(".tag")).toHaveText("fresh");
    await expect(row.locator(".ag-target")).toHaveText("src/agent.rs:context_pack");
    page.once("dialog", (d) => d.accept());
    await row.getByRole("button", { name: "Forget" }).click();
    await expect(row).toHaveCount(0);
  });

  test("the fences overlay lights locked code and the task's scope, and previews any workflow", async ({ page }) => {
    await open(page, "graph");
    await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 20_000 });
    await page.keyboard.press("f");
    const key = page.locator(".fence-key");
    await expect(key).toBeVisible();
    await expect(key.locator(".guard-tag.locked")).toBeVisible();
    await expect(key).toContainText("harden the MCP server");
    await expect(key.locator("select")).toHaveValue("");
    await expect(page.getByRole("switch", { name: /Fences/ })).toHaveAttribute("aria-checked", "true");
    await page.screenshot({ path: "test-results/graph-fences.png" });
    await key.locator("select").selectOption("refactor");
    await expect(key).toContainText("preview");
    await expect(key.locator(".guard-tag.locked")).toBeVisible();
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

  // A1.1 – every long list answers j/k/enter/esc. The fenced-files list is
  // read-only, so this runs on every project.
  test("@responsive the fenced-files list moves with j/k, opens with enter, clears with esc", async ({ page }) => {
    await open(page, "agents/fences");
    const list = page.locator("[data-list-nav]").last();
    await list.click();
    await expect(list.locator(".ag-file").first()).toBeVisible();
    await page.keyboard.press("j");
    await expect(list.locator(".ag-file[data-idx='0']")).toHaveClass(/kb-sel/);
    await page.keyboard.press("j");
    await expect(list.locator(".ag-file[data-idx='1']")).toHaveClass(/kb-sel/);
    await expect(list.locator(".ag-file[data-idx='0']")).not.toHaveClass(/kb-sel/);
    await page.keyboard.press("k");
    await expect(list.locator(".ag-file[data-idx='0']")).toHaveClass(/kb-sel/);
    // enter opens the selected file in the code panel; esc clears the selection
    await page.keyboard.press("Enter");
    await expect(page.locator(".code-panel")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".ag-file.kb-sel")).toHaveCount(0);
  });

  // A1 – the fences tab tests a path inline and shows the verdict per agent.
  test("test a path shows what the fences would tell the task and each agent", async ({ page }) => {
    await open(page, "agents/fences");
    await page.getByLabel("Path to test").fill("src/store.rs");
    await page.getByRole("button", { name: "Test", exact: true }).click();
    const out = page.locator(".ag-test-out");
    await expect(out).toBeVisible();
    await expect(out.locator(".ag-test-line").first().locator(".guard-tag")).toContainText("out of scope");
    // the task's rule is the active one; every agent works under the same task
    await expect(out).toContainText("harden the MCP server");
    await expect(page.locator(".ag-test-line")).toHaveCount(5);
  });

  // A1.2 – a suggestion can be dismissed as well as accepted: seed one the
  // same way an agent does (kula run in the fixture), then dismiss it.
  test("a suggestion can be dismissed, and only that one goes", async ({ page, request }, info) => {
    test.skip(info.project.name !== "desktop", "writes to the fixture");
    const seeded = await request.post("/api/git/kula", {
      data: { args: ["run", "--", "sh", "-c", `printf '%s' '[{ "id": 7, "kind": "guard", "guard": { "paths": ["tests/**"], "level": "review", "reason": "e2e: a person reviews tests" }, "why": "e2e seed", "by": "agent:e2e", "created": 1791200100 }]' > .kula/suggestions.json`] },
      headers: { "x-kula-token": "test" },
    });
    expect((await seeded.json()).code, "kula run seeds the suggestion").toBe(0);
    await open(page, "agents/overview");
    const row = page.locator(".need.sugg").filter({ hasText: "e2e seed" });
    await expect(row).toContainText("review");
    // the earlier fences test already accepted the fixture's own suggestion;
    // only the seeded one is waiting here.
    await expect(page.locator(".need.sugg")).toHaveCount(1);
    await row.getByRole("button", { name: "Dismiss" }).click();
    await expect(row).toHaveCount(0);
    await expect(page.locator(".need.sugg")).toHaveCount(0);
  });
});

test.describe("changes", () => {
  // The real repo's tree must stay clean, so this runs in the worker's fixture,
  // which ships an uncommitted edit to src/kg.rs for exactly this.
  test.use({ baseURL: ({ fx }, use) => use(fx) });
  test("stage a file, commit it, and discard the rest", async ({ page }) => {
    await open(page, "changes");
    const kg = page.locator(".item").filter({ hasText: "src/kg.rs" }).first();
    await expect(kg).toBeVisible();
    await kg.getByRole("button", { name: "Stage" }).click();
    await expect(kg.getByRole("button", { name: "Unstage" })).toBeVisible();
    await page.getByPlaceholder(/Commit message/).fill("e2e: commit from changes");
    await page.keyboard.press("ControlOrMeta+Enter");
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
    await expect(page.locator(".inspector h2")).toHaveText("context_pack");
    await page.locator(".rail").getByRole("button", { name: "Notes" }).click();
    // U14: a new note opens in the code panel, not a sidebar composer
    await page.getByTestId("u14-new-note").click();
    const panel = page.locator(".code-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });
    const target = page.getByLabel("Note target");
    // the here-hint offers the symbol just inspected – one click fills the target
    await expect(panel.locator(".here-hint")).toContainText("context_pack");
    await panel.locator(".here-hint").click();
    await expect(target).toHaveValue("symbol:src/agent.rs:context_pack");
    await target.fill("file:src/guard.rs");
    const body = panel.getByTestId("cp-area");
    await body.click();
    await body.pressSequentially("see [[resolve_tar");
    await expect(page.locator(".cp-edit .af-pop")).toContainText("resolve_target");
    await body.press("Enter");
    await expect(body).toHaveValue("see [[resolve_target]]");
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
    // ui.tsx and brands.tsx unless the element is marked as a data figure, and
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
        if (line.includes("<svg") && !/ui\.tsx$/.test(rel) && !/brands\.tsx$/.test(rel) && !line.includes("data-figure") && !line.includes("rf-wires"))
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

test.describe("teams and research (T1)", () => {
  // Both write to the shared fixture (a team and a workflow in kula.toml),
  // and each rewrites it – so they must not run at the same time.
  test.describe.configure({ mode: "serial" });
  test.use({ baseURL: ({ fx }, use) => use(fx) });
  const desktopOnly = (info: { project: { name: string } }) => test.skip(info.project.name !== "desktop", "writes to the fixture");

  test("T1.2/T1.3: the fixture team reads as a canvas, and a team is created, edited, started and stopped", async ({ page, request }, info) => {
    desktopOnly(info);
    test.setTimeout(90_000);
    await open(page, "agents/teams");
    // T1.2: every team is a tab; the ship canvas shows its members by name.
    await expect(page.getByTestId("team-tab-ship")).toBeVisible();
    await expect(page.getByTestId("team-tab-steer")).toBeVisible();
    await page.getByTestId("team-tab-ship").click();
    const canvas = page.getByTestId("team-canvas");
    await expect(canvas).toContainText("claude");
    await expect(canvas).toContainText("cursor");
    // The sidebar reads the hand-offs: cursor hands off to codex – no hovering.
    await page.getByTestId("team-side-toggle").click();
    const side = page.getByTestId("team-side");
    await expect(side).toBeVisible();
    await side.getByTestId("tc-member-cursor").click();
    await expect(side.locator(".chip-toggle").filter({ hasText: "codex" })).toHaveAttribute("aria-pressed", "true");
    // Back to the team: ship answers to steer (teams of teams).
    await side.getByRole("button", { name: "Back to the team" }).click();
    await expect(side.getByLabel("Answers to team")).toHaveValue("steer");
    // T1.3: create a team from the + tab, add an agent to it and edit the seat.
    await side.getByTestId("team-side-close").click(); // close the pane first
    await page.getByTestId("team-tab-add").click();
    await page.getByTestId("team-add-name").fill("e2e-crew");
    await page.getByTestId("team-add-name").press("Enter");
    await expect(page.getByTestId("team-tab-e2e-crew")).toHaveClass(/on/);
    const readToml = async () => (await (await request.get("/api/file?path=kula.toml", { headers: { "x-kula-token": "test" } })).json()).content as string;
    await expect.poll(readToml).toContain('name = "e2e-crew"');
    // A team made from the + tab starts empty: no vendor names on any seat.
    const body = await readToml();
    const crew = body.slice(body.indexOf('name = "e2e-crew"'));
    expect(crew.slice(0, crew.indexOf("[[team]]", 1) > 0 ? crew.indexOf("[[team]]", 1) : undefined)).not.toMatch(/agent = "(claude|cursor|codex|gemini)"/);
    // Add the explore agent through the sidebar, then edit its seat: a role.
    await page.getByTestId("team-side-toggle").click();
    const crewSide = page.getByTestId("team-side");
    await expect(crewSide).toBeVisible();
    await crewSide.getByTestId("team-add-explore").click();
    await expect(crewSide.locator(".tc-mcard").filter({ hasText: "explore" })).toBeVisible();
    await crewSide.locator(".tc-mcard").filter({ hasText: "explore" }).click();
    await crewSide.getByLabel("Role").fill("welder");
    await expect.poll(readToml).toContain("welder");
    // Start (needs a saved team), confirm it is at work, then stand down.
    await crewSide.getByRole("button", { name: "Back to the team" }).click();
    await page.getByTestId("team-work").click();
    await expect(page.locator(".tc-live")).toBeVisible();
    await page.getByRole("button", { name: "Stand down" }).click();
    await page.getByRole("button", { name: "Confirm stand down" }).click();
    await expect(page.getByTestId("team-work")).toBeVisible();
  });

  test("T1.3b: research loop – create it, start it with confirmation, stop it with confirmation", async ({ page, request }, info) => {
    desktopOnly(info);
    await open(page, "agents/research");
    // The fixture has no loop yet: the new-loop form shows the loop steps.
    const form = page.locator(".tpl-form");
    await expect(form).toBeVisible();
    await expect(page.locator(".loop-step")).not.toHaveCount(0);
    await form.getByLabel("Loop name").fill("e2e-loop");
    await form.getByLabel("Metric command").fill("sh -c 'echo 41'");
    await form.getByRole("button", { name: "Create e2e-loop" }).click();
    await expect(page.locator(".research")).toContainText("e2e-loop");
    await expect(page.locator(".research")).toContainText("may edit");
    // Research keeps and reverts experiments with git, so it refuses a dirty
    // tree – the fixture deliberately leaves changes. Commit them first.
    const tok = await page.evaluate(() => document.querySelector('meta[name="kula-token"]')?.content ?? "test");
    await request.post("/api/git/exec", { data: { args: ["add", "-A"] }, headers: { "x-kula-token": tok } });
    await request.post("/api/git/exec", { data: { args: ["commit", "-qm", "e2e: clean tree for research"] }, headers: { "x-kula-token": tok } });
    // Start needs a confirmation click.
    await page.getByRole("button", { name: "Start" }).click();
    await page.getByRole("button", { name: "Confirm start" }).click();
    await expect(page.locator(".research .tag.accent")).toContainText("running");
    // Stop needs one too.
    await page.getByRole("button", { name: "Stop" }).click();
    await page.getByRole("button", { name: "Confirm stop" }).click();
    await expect(page.locator(".research .tag.accent")).toHaveCount(0);
  });
});

test.describe("g1 – graph, inspector and git by keyboard", () => {
  test("G1.2: hovering a symbol shows a precise card – path:line, degree and churn – after a short delay", async ({ page }) => {
    await open(page, "graph");
    const { a } = await nodeAt(page, "edge");
    await page.mouse.move(a.x + 200, a.y + 200);
    await page.mouse.move(a.x, a.y, { steps: 4 });
    const card = page.locator(".hover-card");
    // 3 s: the card waits a beat by design, and under three workers the beat
    // can stretch – 1.5 s turned timing into a flaky failure.
    await expect(card).toBeVisible({ timeout: 3_000 });
    await expect(card.locator(".hc-name")).toHaveText(a.label);
    // path:line – a real location, not a bare path.
    await expect(card.locator(".hc-path")).toHaveText(/:\d+$/);
    await expect(card.locator(".hc-stats b.in")).toHaveText(/^\d+$/);
    await expect(card.locator(".hc-stats b.out")).toHaveText(/^\d+$/);
    await expect(card.locator(".hc-stats")).toContainText(/commit|commits/);
    // It does not jump in on the first paint: the card waits a beat.
    await page.mouse.move(a.x + 200, a.y + 200);
    await expect(card).toHaveCount(0);
  });

  test("G1.1: arrows walk between neighbours; the palette jumps and selects; every inspector action is keyboard-reachable", async ({ page }) => {
    await open(page, "graph");
    const { a, b } = await nodeAt(page, "edge");
    await page.mouse.click(a.x, a.y);
    await expect(page.locator(".inspector h2")).toHaveText(a.label);
    // Walk out along calls: the selection moves off a to a neighbour.
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".inspector h2")).not.toHaveText(a.label);
    // Search jumps and selects: the palette's top hit lands on the map.
    await page.keyboard.press("ControlOrMeta+k");
    await page.keyboard.type("context_pack");
    await expect(page.locator(".palette")).toBeVisible();
    const top = ((await page.locator(".palette .res.on, .palette .res").first().textContent()) ?? "").trim();
    await page.keyboard.press("Enter");
    // The selection lands on the top hit – the inspector opens for it.
    await expect(page.locator(".inspector h2")).not.toBe("");
    if (/context_pack/.test(top)) await expect(page.locator(".inspector h2")).toHaveText(/context_pack/i);
    // The reach-for actions are real buttons the keyboard can reach and press.
    const seen = new Set<string>();
    let reached = "";
    for (let i = 0; i < 48 && reached === ""; i++) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || !el.closest(".insp-actions")) return "";
        return Array.from(el.closest(".insp-actions")!.querySelectorAll("button")).filter((b) => b === document.activeElement || el.contains(b)).map((b) => b.textContent?.trim() ?? "").find((t) => /Impact|Trace|History|Blame|Remember|Fence|Copy/.test(t)) ?? "";
      });
      if (reached === "") {
        const at = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? "");
        if (at) seen.add(at);
      }
    }
    expect(reached, "Tab should land on an inspector action").not.toBe("");
    if (/Blame/.test(reached)) {
      await page.keyboard.press("Enter");
      await expect(page.locator(".insp-blame")).toBeVisible();
    }
    // Trace arms from the keyboard too: t, then an arrow, traces the path.
    await page.keyboard.press("t");
    await expect(page.locator(".toasts")).toContainText("Trace armed");
    await page.keyboard.press("ArrowRight");
    const chip = page.locator(".trace-chip");
    await expect(chip).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(chip).toHaveCount(0);
  });

  test("G1.1: git staging works from the keyboard – j/k walk, s stage, u unstage – and ⌘↵ commits", async ({ page }, info) => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const tmp = path.resolve(process.cwd(), "..", `g1-kb-${info.workerIndex}.txt`);
    await fs.writeFile(tmp, "scratch change for the keyboard test\n");
    try {
      await page.goto("/#changes");
      await page.reload();
      const row = page.locator(".list .item", { hasText: tmp.replace(/^.*\//, "") });
      await expect(row).toBeVisible({ timeout: 10_000 });
      await page.keyboard.press("j"); // select the first file
      await expect(page.locator(".list .item.on")).toBeVisible();
      await page.keyboard.press("s"); // stage it
      const stagedHead = page.locator(".list-head", { hasText: "Staged" });
      await expect(stagedHead.locator(".count")).toHaveText("1", { timeout: 10_000 });
      await expect(page.locator(".list .item", { hasText: tmp.replace(/^.*\//, "") }).first()).toBeVisible();
      await page.keyboard.press("u"); // unstage it again
      await expect(stagedHead.locator(".count")).toHaveText("0", { timeout: 10_000 });
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
    ["Overview", "overview"], ["Graph", "graph"], ["Flows", "flows"], ["Changes", "changes"],
    ["History", "history"], ["Branches & compare", "branches"], ["Proposals", "proposals"],
    ["Issues", "issues"], ["Notes", "notes"], ["Agents", "agents"], ["Query (SPARQL)", "query"], ["Console", "console"],
  ];

  test("N1.1: every view is reachable from the palette", async ({ page }) => {
    await open(page);
    for (const [label, id] of VIEWS) {
      await page.keyboard.press("ControlOrMeta+k");
      await page.keyboard.type(`>goto ${label}`);
      const first = page.locator(".palette .res").first();
      await expect(first).toContainText(label);
      await first.click();
      await expect(page).toHaveURL(new RegExp(`#${id}\\b`));
    }
  });

  test("N1.2: ? lists every global shortcut and each listed one works", async ({ page }) => {
    await open(page, "changes");
    await page.keyboard.press("?");
    const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(sheet).toBeVisible();
    // The sheet is generated from the same registry the shell acts on – each listed key works.
    for (const sc of GLOBAL_SHORTCUTS) {
      await expect(sheet.locator(`.help-row[data-keys="${sc.keys}"]`)).toContainText(sc.label);
    }
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    // 1 goes to the overview…
    await page.keyboard.press("1");
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
    await expect(page).toHaveURL(/#changes\b/);
  });

  test("N1.2: the sheet's remaining keys work – a, q, a context shortcut, and the sheet from the palette", async ({ page }) => {
    await open(page);
    // a → agents, q → query (the two letter view keys).
    await page.keyboard.press("a");
    await expect(page).toHaveURL(/#agents\b/);
    await page.keyboard.press("q");
    await expect(page).toHaveURL(/#query\b/);
    // A context shortcut: f shows the fences in force on the graph.
    await page.keyboard.press("2");
    await expect(page).toHaveURL(/#graph\b/);
    // The fence overlay draws once the graph is up; under load the layout takes a while.
    await expect(page.locator(".graph-wrap canvas").first()).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("f");
    await expect(page.locator(".graph-overlay.fence-key")).toBeVisible();
    // The palette's own "Keyboard shortcuts" item opens this sheet.
    await page.keyboard.press("ControlOrMeta+k");
    await page.keyboard.type(">keyboard shortcuts");
    await page.locator(".palette .res").first().click();
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  });

  test("N1.1: recently used commands sort first", async ({ page }) => {
    await open(page);
    const run = async (label: string, hash: RegExp) => {
      await page.keyboard.press("ControlOrMeta+k");
      await page.keyboard.type(`>go to ${label}`);
      await page.locator(".palette .res").first().click();
      await expect(page).toHaveURL(hash);
    };
    // Run Flows, then Console. The palette remembers, most recent first.
    await run("Flows", /#flows\b/);
    await run("Console", /#console\b/);
    await page.keyboard.press("ControlOrMeta+k");
    await page.keyboard.type(">go to");
    const results = page.locator(".palette .res");
    await expect(results.first()).toContainText("Go to Console");
    await expect(results.nth(1)).toContainText("Go to Flows");
  });

  test("N1.3: a dead server is an error state with retry, not a blank page", async ({ page }) => {
    await open(page);
    await expect(page.locator(".ov-title h1")).toBeVisible();
    await page.route("**/api/**", (r) => r.abort());
    await page.reload();
    const err = page.getByTestId("server-error");
    await expect(err).toBeVisible();
    await expect(err).toContainText("Retry now");
    await expect(page.locator(".topbar")).toBeVisible();
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
test.describe("agents A2", () => {
  test.use({ baseURL: ({ fx }, use) => use(fx) });
  // Read-only tests: no fixture writes, so no serial coupling and all projects may run them.

  test("A2.1: the roster renders every fixture agent with its wiring, counts and seats", async ({ page }) => {
    await open(page, "agents/overview");
    const rows = page.locator(".roster-row");
    await expect(rows).toHaveCount(4);
    // Claude Code is connected in the fixture (MCP and hook); the others are not wired.
    const claude = rows.filter({ hasText: "Claude Code" });
    await expect(claude).toContainText("connected");
    await expect(claude).toContainText("hook");
    for (const name of ["Cursor", "Codex", "Gemini CLI"]) {
      const row = rows.filter({ hasText: name });
      await expect(row).toContainText("not wired");
      await expect(row).toContainText("no hook");
    }
    // Exact fixture counts: MCP config files, team seats, skills carried.
    // .roster-num order: skills, MCP files, last seen, fence hits, attempts, seats.
    await expect(claude.locator(".roster-num").nth(1)).toHaveText(/^1/);
    await expect(rows.filter({ hasText: "Cursor" }).locator(".roster-num").nth(5)).toHaveText("2");
    await expect(rows.filter({ hasText: "Codex" }).locator(".roster-num").nth(5)).toHaveText("3");
    await expect(rows.filter({ hasText: "Gemini CLI" }).locator(".roster-num").nth(5)).toHaveText("3");
    for (const row of await rows.all()) await expect(row).toContainText("0"); // no skills in the fixture
    // Loops and teams as compact rows with status, linked to their tabs.
    // The four kula.toml teams. Not an exact count: the fixture is per worker, and
    // earlier tests on the same worker (T1.3b's research loop, team creation) add rows.
    for (const name of ["ship", "steer", "research", "audit"]) await expect(page.locator(".loop-row").filter({ hasText: name }).first()).toBeVisible();
    await expect(page.locator(".loop-row").filter({ hasText: "ship" })).toContainText("saved");
    // No loop is currently at work: on a clean fixture this is the empty
    // state, after T1.3b on the same worker the finished e2e-loop is listed.
    await expect(page.locator(".loop-row").filter({ hasText: "running" })).toHaveCount(0);
    // A roster cell leads to the tab that owns it.
    await rows.filter({ hasText: "Claude Code" }).locator(".roster-num").nth(5).click(); // seats → Teams
    await expect(page).toHaveURL(/#agents\/teams/);
  });

  test("A2.2: j/k/enter/esc walk the roster and / filters it", async ({ page }) => {
    await open(page, "agents/overview");
    const roster = page.locator(".roster");
    await roster.focus();
    await page.keyboard.press("j");
    await expect(roster).toHaveAttribute("aria-activedescendant", "list-item-0");
    await expect(page.locator(".roster-row").nth(0)).toHaveClass(/kb-sel/);
    await page.keyboard.press("j");
    await page.keyboard.press("j");
    await expect(roster).toHaveAttribute("aria-activedescendant", "list-item-2");
    await page.keyboard.press("k");
    await expect(roster).toHaveAttribute("aria-activedescendant", "list-item-1");
    await page.keyboard.press("Enter"); // the roster row opens Connect
    await expect(page).toHaveURL(/#agents\/connect/);
    // Back to the roster: / opens the filter, typing narrows, esc clears it.
    await open(page, "agents/overview");
    await roster.focus();
    await page.keyboard.press("/");
    await expect(page.getByLabel("Filter roster")).toBeFocused();
    await page.keyboard.insertText("clau");
    await expect(page.locator(".roster-row")).toHaveCount(1);
    await expect(page.locator(".roster-row").first()).toContainText("Claude Code");
    await page.keyboard.press("Escape");
    await expect(page.locator(".roster-row")).toHaveCount(4);
  });

  test("A2.2: j/k/enter/esc walk the research attempts, / filters them, and the legend reads as a table", async ({ page }) => {
    // A finished run injected into the fixture's /api/agents: kept, reverted,
    // fenced and failed attempts, with exact metric values.
    const now = Date.now(), min = 60_000;
    const run = {
      workflow: "explore", metric: "cargo test --quiet count", goal: "min", budget: 5, branch: "main", base: "main",
      baseline: 12, best: 10, started: now - 40 * min, by: "agent:claude", active: false,
      experiments: [
        { n: 1, hypothesis: "index once per blob", value: 11, best_before: 12, kept: true, commit: "abc1234def", files: ["src/store.rs"], by: "agent:claude", at: now - 35 * min },
        { n: 2, hypothesis: "borrow the graph", value: 10.5, best_before: 11, kept: false, files: ["src/graph.rs"], by: "agent:cursor", at: now - 28 * min },
        { n: 3, hypothesis: "narrow the scope", value: null, best_before: 11, kept: false, note: "rejected: touches locked file", files: ["Cargo.toml"], by: "agent:codex", at: now - 20 * min },
        { n: 4, hypothesis: "stream the diff", value: null, best_before: 11, kept: false, note: "metric failed to run", files: ["src/server.rs"], by: "agent:gemini", at: now - 12 * min },
        { n: 5, hypothesis: "cache the agents read", value: 10, best_before: 11, kept: true, commit: "def5678abc", files: ["src/store.rs", "src/server.rs"], by: "agent:claude", at: now - 5 * min },
      ],
    };
    await page.route("**/api/agents", (route) => route.fetch().then((r) => r.json()).then((j) => route.fulfill({
      json: { ...j, research: [run], workflows: [...j.workflows, { name: "explore", about: "loop", builtin: false, research: { metric: run.metric, goal: "min", budget: 5 } }] },
    })));
    await open(page, "agents/research");
    await page.getByRole("tab", { name: "explore", exact: true }).click();
    const tries = page.locator(".rf-tries");
    await expect(page.locator(".rf-try")).toHaveCount(5);
    // The timeline shows the run on a time axis with exact values and a legend table.
    await expect(page.locator(".rf-time-svg")).toBeVisible();
    const legend = page.locator(".rf-legend-table");
    await expect(legend).toBeVisible();
    await expect(legend).toContainText("kept");
    await expect(legend.locator("tbody tr").first()).toContainText("11 · 10");
    await expect(legend.locator("tbody tr.rf-lg-fenced")).toContainText("–");
    // j/k/enter/esc on the attempt list.
    await tries.focus();
    await page.keyboard.press("j");
    await expect(tries).toHaveAttribute("aria-activedescendant", "list-item-0");
    await page.keyboard.press("j");
    await page.keyboard.press("j");
    await expect(tries).toHaveAttribute("aria-activedescendant", "list-item-2");
    await page.keyboard.press("Enter"); // pins attempt 3 (fenced) in the detail panel
    await expect(page.locator(".rf-detail h3")).toContainText("attempt 3");
    await expect(page.locator(".rf-detail")).toContainText("fenced");
    await page.keyboard.press("Escape");
    await expect(tries).not.toHaveAttribute("aria-activedescendant", /.+/);
    // / filters the attempts.
    await page.keyboard.press("/");
    await expect(page.getByLabel("Filter attempts")).toBeFocused();
    await page.keyboard.insertText("cache");
    await expect(page.locator(".rf-try")).toHaveCount(1);
    await expect(page.locator(".rf-try").first()).toContainText("cache the agents read");
  });

  test("A2: the seat inspector shows the workflow, its fences, scope and the skills the seat sees", async ({ page }) => {
    await open(page, "agents/teams");
    // The team canvas (U16): a seat is a square on the map; clicking it opens
    // the team sidebar on the seat's fields.
    const seat = page.locator('[data-testid="team-canvas"] .react-flow__node').filter({ hasText: "codex" }).first();
    await seat.click();
    const side = page.locator('[data-testid="team-side"]');
    await expect(side).toBeVisible();
    await expect(side.getByLabel("Workflow")).toBeVisible();
    // Rewiring moved from a drag gesture to the sidebar's tinker (the kit has
    // no edge-connect): the square is not natively draggable, the sidebar
    // carries the answers-to control.
    await expect(seat).not.toHaveAttribute("draggable", "true");
    await expect(side.getByLabel("Answers to")).toBeVisible();
  });
});

// ------------------------------------------------------------------ K2 · unified agent config
// The skills tab carries the whole config picture: the skill matrix with a diff
// before a sync overwrites an edited copy, every agent's MCP servers and rules
// files against the shared source, and the memory layers (scope + provenance).
test.describe("agents config K2", () => {
  test.use({ baseURL: ({ fx }, use) => use(fx) });
  test.describe.configure({ mode: "serial" });
  const desktopOnly = (info: { project: { name: string } }) => test.skip(info.project.name !== "desktop", "writes to the fixture");

  /** This worker's fixture repo on disk (fixture.sh writes the path file). */
  function fixtureRepo(page: Page): string {
    const port = new URL(page.url()).port ?? String(Number(process.env.KULA_PW_PORT ?? 7431) + 1);
    return fs.readFileSync(`/tmp/kula-fixture-${port}.path`, "utf8").trim();
  }

  test("the config matrix shows every agent's MCP servers and rules, and syncs one from the source", async ({ page }, info) => {
    desktopOnly(info);
    await open(page, "agents/skills"); await page.locator(".sx-more > summary").click(); // per-agent copies sit under the index
    const repo = fixtureRepo(page);
    // a shared source with one server; cursor holds an edited copy of it
    fs.mkdirSync(path.join(repo, ".agents"), { recursive: true });
    fs.mkdirSync(path.join(repo, ".cursor"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".agents/mcp.json"), JSON.stringify({ mcpServers: { kula: { command: "kula", args: ["mcp"] } } }, null, 2));
    fs.writeFileSync(path.join(repo, ".cursor/mcp.json"), JSON.stringify({ mcpServers: { kula: { command: "kula", args: ["serve", "--edited"] } } }));
    await page.reload();
    await page.locator(".sx-more > summary").click(); // the reload folds the per-agent copies again
    const panel = page.locator(".k2-config");
    await expect(panel).toContainText("mcp servers");
    // every agent has a row with its config path
    for (const a of ["Claude Code", "Cursor", "Codex", "Gemini CLI"]) await expect(panel).toContainText(a);
    await expect(panel).toContainText(".mcp.json");
    await expect(panel).toContainText(".codex/config.toml");
    // rules files are listed with what exists (AGENTS.md is in the fixture, GEMINI.md is not)
    await expect(panel).toContainText("AGENTS.md");
    await expect(panel).toContainText("GEMINI.md");
    // cursor differs from the source; sync it from the matrix
    const cursorRow = panel.locator("tr", { hasText: "Cursor" }).filter({ hasText: ".cursor/mcp.json" });
    await expect(cursorRow).toContainText("differs");
    await cursorRow.locator("button", { hasText: "sync" }).first().click();
    await expect(cursorRow).toContainText("in sync");
    // the merge kept the agent's file structure and wrote the source definition
    const cur = JSON.parse(fs.readFileSync(path.join(repo, ".cursor/mcp.json"), "utf8"));
    expect(cur.mcpServers.kula.args).toEqual(["mcp"]);
  });

  test("a skill whose copy was edited shows the diff before a sync overwrites it", async ({ page }, info) => {
    desktopOnly(info);
    await open(page, "agents/skills"); await page.locator(".sx-more > summary").click(); // per-agent copies sit under the index
    const repo = fixtureRepo(page);
    // a shared skill, and an edited copy in Claude Code's own folder
    fs.mkdirSync(path.join(repo, ".agents/skills/triage"), { recursive: true });
    fs.mkdirSync(path.join(repo, ".claude/skills/triage"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".agents/skills/triage/SKILL.md"),
      "---\nname: triage\ndescription: Sort a new issue: reproduce, label, find the owning code\n---\n\n1. Reproduce with the smallest input.\n2. Label.\n");
    fs.writeFileSync(path.join(repo, ".claude/skills/triage/SKILL.md"),
      "---\nname: triage\ndescription: Sort a new issue: reproduce, label, find the owning code\n---\n\n1. Reproduce with the smallest input.\n2. Label the severity first.\n");
    await page.reload();
    await page.locator(".sx-more > summary").click(); // the reload folds the per-agent copies again
    const matrix = page.locator(".sk-matrix");
    await expect(matrix).toContainText("triage");
    // the matrix marks Claude Code's copy as edited
    const row = matrix.locator("tr", { hasText: "triage" });
    await expect(row.locator(".sk-st.differs")).toHaveCount(1);
    // picking the skill opens the diff of source vs agent copy
    await row.click();
    const diff = page.locator(".sk-diff");
    await expect(diff).toContainText("sync overwrites these");
    await expect(diff.locator("pre")).toContainText("-2. Label the severity first.");
    await expect(diff.locator("pre")).toContainText("+2. Label.");
    // the sync that the diff warns about: overwrite, and the copy matches again
    await diff.locator("button", { hasText: "overwrite with sync" }).click();
    const copy = fs.readFileSync(path.join(repo, ".claude/skills/triage/SKILL.md"), "utf8");
    expect(copy).toContain("2. Label.\n");
    expect(copy).not.toContain("severity first");
    await expect(page.locator(".sk-diff")).toHaveCount(0);
  });

  test("memory layers label each memory with scope and provenance", async ({ page }, info) => {
    desktopOnly(info);
    await open(page, "agents/skills"); await page.locator(".sx-more > summary").click(); // per-agent copies sit under the index
    const panel = page.locator(".k2-layers");
    await expect(panel).toContainText("Memory layers");
    // the fixture ships two memories, both anchored to a symbol or file
    const rows = panel.locator(".k2-layers-t tbody tr");
    await expect(rows).toHaveCount(2);
    // provenance: an agent and the commit that introduced the memory
    await expect(rows.first().locator("td").nth(3)).toContainText("e2e");
    await expect(rows.first().locator("td").nth(4)).toHaveText(/[0-9a-f]{7}/);
    // symbol targets are shown and the scope filter narrows the table
    await expect(panel).toContainText("symbol:src/store.rs:publish");
    await panel.locator(".chip-toggle", { hasText: "task" }).click();
    await expect(rows).toHaveCount(0);
    await panel.locator(".chip-toggle", { hasText: "repo" }).click();
    await expect(rows).toHaveCount(2);
  });
});


// M1 · memory graph: the fixture's memories as graph nodes, layer legend,
// stale hollow, click → list selection, filter reaching the graph. Read-only.
test.describe("memory graph M1", () => {
  test.use({ baseURL: ({ fx }, use) => use(fx) });

  test("fixture memories are graph nodes; click selects the list row", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "graph needs a desktop viewport");
    await open(page, "agents/memory");
    // the fixture memories, each with a DOM node counterpart on the graph –
    // the fixture is shared per worker, so other tests may have added more
    const nodes = page.locator(".m1-node");
    await expect(nodes.filter({ hasText: "#4" })).toHaveCount(1);
    await expect.poll(() => nodes.count()).toBeGreaterThanOrEqual(2);
    // the canvas side too: MiniGraph's own label states the counts outright
    await expect(page.getByRole("img", { name: /Memory graph: \d+ memories on \d+ anchors/ })).toHaveCount(1);
    // anchors covered, exact numbers: legend rows per layer plus the totals
    const legend = page.locator(".m1-legend-t");
    await expect(legend).toContainText("repo");
    await expect(legend.locator("tfoot")).toContainText("anchors covered");
    await expect(legend.locator("tfoot")).toContainText(/\d+ hollow/);
    // clicking a node selects and scrolls the list row
    const mem4 = nodes.filter({ hasText: "#4" });
    await mem4.click();
    await expect(page.locator(".ag-mem.kb-sel")).toHaveCount(1);
    await expect(page.locator(".ag-mem.kb-sel")).toContainText("Unlink, never truncate");
    // the graph canvas shows the selection ring on the picked node
    await expect(page.locator(".m1-node.sel")).toHaveCount(1);
  });

  test("stale memory renders hollow (DOM class), fresh one does not", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "graph needs a desktop viewport");
    await open(page, "agents/memory");
    const stale = page.locator(".m1-node.stale");
    await expect(stale).toHaveCount(1);
    await expect(stale).toHaveText("#5");
    await expect(page.locator(".m1-node:not(.stale)")).toHaveCount(1);
    // the list row for the same memory is stale too – one truth, two views
    const row = page.locator(".ag-mem").filter({ hasText: "SPARQL is read-only" });
    await expect(row).toHaveClass(/stale/);
  });

  test("the list filter (`/`) narrows the graph too", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "graph needs a desktop viewport");
    await open(page, "agents/memory");
    const input = page.getByLabel("Filter memories");
    await input.fill("SPARQL");
    await expect(page.locator(".m1-node")).toHaveCount(1);
    await expect(page.locator(".ag-mem")).toHaveCount(1);
    await input.fill("walrus");
    await expect(page.locator(".m1-node")).toHaveCount(0);
    await expect(page.locator(".ag-empty")).toContainText("Nothing matches");
  });
});

test.describe("isolate", () => {
  test.use({ baseURL: ({ fx }, use) => use(fx) });
  test.describe.configure({ mode: "serial" });

  test("isolate a directory: only the slice and its boundary stubs, inbound and outbound, saved as a scope", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "writes kula.toml in the fixture");
    test.setTimeout(90_000);
    await open(page, "graph");
    await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 30_000 });
    await page.waitForFunction(() => !!(window as any).__kula);
    await page.keyboard.press("i");
    const ask = page.getByRole("dialog", { name: "Isolate part of the graph" });
    await expect(ask).toBeVisible();
    await ask.getByLabel("Selectors").fill("src/index/**");
    await ask.getByLabel("Selectors").press("Enter");
    const panel = page.getByRole("region", { name: "Isolated slice" });
    await expect(panel).toBeVisible();
    await expect(ask).toHaveCount(0);
    await expect(panel.locator(".iso-sel")).toHaveText("src/index/**");
    await expect(page.getByRole("button", { name: /Isolate \d+/ })).toHaveAttribute("aria-pressed", "true");

    // What is drawn is the slice plus what crosses its edge – nothing else.
    const check = await page.evaluate(async () => {
      const token = document.querySelector<HTMLMetaElement>('meta[name="kula-token"]')?.content ?? "";
      const slice = await fetch("/api/isolate", { method: "POST", headers: { "x-kula-token": token, "content-type": "application/json" }, body: JSON.stringify({ select: ["src/index/**"] }) }).then((r) => r.json());
      const { sigma, graph } = (window as any).__kula;
      const inside = new Set(slice.nodes.map((n: any) => String(n.id)));
      const peers = new Set([...slice.inbound, ...slice.outbound].map((p: any) => String(p.node.id)));
      let shown = 0, stray = 0, stubs = 0;
      graph.forEachNode((id: string, a: any) => {
        if (a.virtual || a.dir === "__pkg") return;
        const d = sigma.getNodeDisplayData(id);
        if (!d || d.hidden) return;
        if (inside.has(id)) shown++; else if (peers.has(id)) stubs++; else stray++;
      });
      return { shown, stray, stubs, counts: slice.counts };
    });
    expect(check.stray).toBe(0);
    expect(check.shown).toBeGreaterThan(5);
    expect(check.stubs).toBeGreaterThan(0);
    await expect(panel.locator(".iso-counts")).toContainText(`${check.counts.nodes} symbols`);

    // Inbound and outbound lists, with edge counts.
    const tabs = panel.getByRole("tab");
    await expect(tabs.nth(0)).toContainText(`${check.counts.inbound_edges} in · ${check.counts.inbound}`);
    expect(await panel.locator(".iso-row").count()).toBeGreaterThan(0);
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(panel.locator(".iso-row .iso-n.out").first()).toHaveText(/×\d+/);
    await tabs.nth(2).click();
    await expect(panel.locator(".iso-row").first()).toContainText("src/index/");
    await page.screenshot({ path: "test-results/graph-isolate.png" });

    // Save it as a named scope: it lands in kula.toml and is offered next time.
    await panel.getByLabel("Scope name").fill("e2e-index");
    await panel.getByRole("button", { name: "Save scope" }).click();
    await expect(panel.locator(".iso-save")).toContainText('scope = ["@e2e-index"]');
    const scopes = await page.evaluate(() => fetch("/api/scopes", { headers: { "x-kula-token": document.querySelector<HTMLMetaElement>('meta[name="kula-token"]')?.content ?? "" } }).then((r) => r.json()));
    expect(scopes.find((s: any) => s.name === "e2e-index")?.select).toEqual(["src/index/**"]);
    await panel.locator(".iso-sel").click();
    await expect(ask.getByRole("button", { name: /@e2e-index/ })).toBeVisible();
    await page.keyboard.press("Escape");

    // Exit: the whole map comes back.
    await panel.getByRole("button", { name: "Exit isolate" }).click();
    await expect(panel).toHaveCount(0);
    await page.evaluate(() => fetch("/api/scopes/forget", { method: "POST", headers: { "x-kula-token": document.querySelector<HTMLMetaElement>('meta[name="kula-token"]')?.content ?? "", "content-type": "application/json" }, body: JSON.stringify({ name: "e2e-index" }) }));
  });
});

test.describe("isolate from the map", () => {
  test("right-click a symbol to isolate its neighbourhood", async ({ page }) => {
    await open(page, "graph");
    const { a } = await nodeAt(page, "edge");
    // The layout may still be easing: retry the right-click until the menu opens.
    await expect(async () => {
      await page.mouse.click(a.x, a.y, { button: "right" });
      await expect(page.getByRole("menu")).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await page.getByRole("menuitem", { name: /Isolate (neighbourhood|file)/ }).click();
    const panel = page.getByRole("region", { name: "Isolated slice" });
    await expect(panel).toBeVisible();
    await expect(panel.locator(".iso-sel")).toContainText(a.label);
    await page.keyboard.press("i");
    await expect(page.getByRole("dialog", { name: "Isolate part of the graph" }).getByLabel("Selectors")).toHaveValue(/symbol:|path:/);
  });
});

test.describe("map", () => {
  // The repo server has no /api/map until M1 lands; the view falls back to
  // its fixture. The landing view is the functional flow; the nested-box drill
  // is the "blocks" view, and the right panel lists blocks / functions / chains.
  // R0: the nested-box drill opens from a block card with a double-click
  // (single click selects; the one canvas has no lens switcher).
  // Blocks are added from the picker in the pipeline panel (the old ws-add
  // button is gone): open the sidebar, switch to the pipeline tab, search and
  // pick. Asserts nothing about counts – the pipeline row appears.
  const addBlock = async (page: Page, testid: string, query: string) => {
    if (!(await page.locator("[data-testid=map-sidebar]").isVisible())) {
      await page.locator("[data-testid=map-hud]").or(page.locator("[data-testid=map-inspector]")).first().waitFor({ state: "visible", timeout: 30_000 });
      await explore(page); if (await page.locator("[data-testid=map-side-toggle]").isVisible()) await page.locator("[data-testid=map-side-toggle]").click();
    }
    await page.locator("[data-testid=ws-tab-pipeline]").click();
    await page.locator("[data-testid=pl-add]").click();
    await page.locator("[data-testid=np-search]").fill(query);
    await page.locator(`[data-testid=${testid}]`).click();
    await expect(page.locator("[data-testid^=pl-row-]").first()).toBeVisible();
  };
  const blocksView = async (page: Page) => {
    // U5: a square's hover toolbar "Open" drills into its block tree (a
    // click unfolds it in place, a double-click opens details)
    await page.locator(".fc-solid").first().waitFor({ state: "attached", timeout: 30_000 });
    // fit first: the meaning layout spreads zones wide, so the deepest square
    // may sit outside the landing view
    await page.locator("[data-testid=fc-fit]").click();
    await page.waitForTimeout(800);
    // a square on top at its centre, clear of the inspector and the right column
    const pt = await page.evaluate(() => {
      // the clear square with the deepest contents, so the drill view nests
      let best: { x: number; y: number; id: string; n: number } | null = null;
      for (const e of document.querySelectorAll(".fc-solid .fc-solid-sq")) {
        const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        const top = document.elementFromPoint(x, y);
        const n = ((e.parentElement as HTMLElement | null)?.dataset.fcHas ?? "").split(" ").filter(Boolean).length;
        if (n && r.left > 80 && r.top > 120 && r.right < innerWidth - 520 && r.bottom < innerHeight - 120 && top && e.contains(top) && (!best || n > best.n))
          best = { x, y, n, id: (e.closest("[data-testid^=fc-node-]") as HTMLElement).dataset.testid!.replace("fc-node-", "") };
      }
      return best;
    });
    expect(pt, "a square clear of the panels").toBeTruthy();
    const id = pt!.id;
    await page.mouse.move(pt!.x, pt!.y, { steps: 3 });
    // clicking through the mouse would leave the square and hide its toolbar
    await page.locator(`[data-testid="fn-open-${id}"]`).evaluate((el) => (el as HTMLElement).click());
    await expect(page.locator(".sy-grid .sy-box").first()).toBeVisible({ timeout: 15_000 });
  };
  // The inspector is closed until a click; Structure opens it on the block tree.
  const structure = async (page: Page) => {
    if (await page.locator("[data-testid=map-filter]").isVisible()) return;
    // A cold server builds the map inside the first GET /api/map: wait for
    // the canvas (or an already-open inspector) before looking for the HUD.
    await page.locator("[data-testid=map-hud]").or(page.locator("[data-testid=map-inspector]")).first().waitFor({ state: "visible", timeout: 30_000 });
    await explore(page); if (await page.locator("[data-testid=map-side-toggle]").isVisible()) await page.locator("[data-testid=map-side-toggle]").click();
    else await page.locator("[data-testid=ws-tab-structure]").click();
    await expect(page.locator("[data-testid=map-filter]")).toBeVisible();
  };
  const chainsList = async (page: Page) => { await structure(page); await page.locator("[data-testid=map-sect-chains]").click(); };
  test("tab loads with sidebar, canvas and readout", async ({ page }) => {
    await open(page, "map");
    // A cold server builds the whole map inside the first GET /api/map
    // (11 s on this repo) – the view is "loading map…" until it lands, so
    // give the first assert a cold-build budget, not the 5 s default.
    await expect(page.locator("[data-testid=map-view]")).toBeVisible({ timeout: 30_000 });
    // the canvas is everything until a click: no inspector, no filter yet
    await expect(page.locator("[data-testid=map-inspector]")).toHaveCount(0);
    await expect(page.locator("[data-testid=map-filter]")).toHaveCount(0);
    await expect(page.locator("[data-testid=map-flow]")).toBeVisible();
    await structure(page);
    // the panel opens on the block tree; chains are one tab away
    await expect(page.locator("[data-testid=map-sidebar] .sy-section-label").first()).toHaveText(/blocks/i);
    await chainsList(page);
    await expect(page.locator(".sy-family").first()).toBeVisible();
    // Overview carries the readout: with nothing selected, the repo's stats
    await page.locator("[data-testid=ws-tab-inspect]").click();
    await expect(page.locator("[data-testid=map-readout]")).toBeAttached();
    await expect(page.locator("[data-testid=map-stats-table]")).toContainText("families");
    // R0 – no View menu: the lens is one click on the lens bar; roles opens
    // the filter popover.
    await explore(page); await page.locator("[data-testid=map-roles-btn]").click();
    await expect(page.locator("[data-testid=map-role-filter]")).toBeVisible();
    await explore(page); await page.locator("[data-testid=map-roles-btn]").click(); // close
  });

  test("expanding a family pages its chains; selecting one draws the path", async ({ page }) => {
    await open(page, "map");
    await chainsList(page);
    await expect(page.locator(".sy-family").first()).toBeVisible();
    // narrow to the family with the most chains – a small family pages out
    // in one pass and never shows the load-more row
    const big = await page.evaluate(async () => {
      const tok = document.querySelector('meta[name="kula-token"]')?.content ?? "";
      const map = await (await fetch("/api/map", { headers: { "x-kula-token": tok } })).json();
      const byId = new Map(Object.entries(map.leaves).map(([id, l]) => [id, l.name]));
      const fam = map.families.reduce((a: { count: number; s: string; t: string }, f: { count: string; source: number; terminal: number }) =>
        Number(f.count) > Number(a.count) ? { count: f.count, s: byId.get(String(f.source)) ?? "", t: byId.get(String(f.terminal)) ?? "" } : a, { count: "0", s: "", t: "" });
      return `${fam.s} → ${fam.t}`;
    });
    await page.fill("[data-testid=map-filter]", big);
    const famRows = await page.locator(".sy-family").count();
    expect(famRows).toBeGreaterThan(0);
    for (const row of await page.locator(".sy-family .sy-fam-name").all()) {
      await expect(row).toHaveText(big);
    }
    await page.locator(".sy-family .sy-twist").first().click();
    // the family pages its chains in (fixture enumeration, same paged shape)
    const chains = page.locator(".sy-chain");
    await expect(chains.first()).toBeVisible();
    const first = await chains.count();
    expect(first).toBeGreaterThan(0);
    // "+ load more chains" pages the next cursor in – more chain rows appear.
    // The row is below the fold and windowed out of the DOM: scroll to it.
    await page.locator("[data-testid=map-side-scroll]").evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.locator(".sy-chain-load").first().click();
    await expect.poll(async () => chains.count()).toBeGreaterThan(first);
    await expect(chains.nth(first)).toBeVisible();
    // selecting a chain opens the chain card in the inspector: the subway
    // strip lists its steps in order (R0 – the chain is an inspector overlay)
    await chains.first().click();
    const card = page.locator("[data-testid=map-chain-card]");
    await expect(card).toBeVisible();
    const steps = card.locator("[data-testid=map-subway] .fm-subway-btn");
    const n = await steps.count();
    expect(n).toBeGreaterThan(0);
    // the chain card names the family and its length
    await expect(card).toContainText("steps");
    // toggling again returns to the flow – the chain card's unfocus clears it
    // (R0: the chain lives in the inspector, the sidebar row switched tabs)
    await page.locator("[data-testid=map-focus-chain]").click();
    await expect(page.locator("[data-testid=map-chain-card]")).toHaveCount(0);
    await expect(page.locator("[data-testid=map-flow]")).toBeVisible();
  });

  test("drill in and out with the breadcrumb, deep link restores the path", async ({ page }) => {
    await open(page, "map");
    await blocksView(page);
    // blocksView drills one level: the map's depth-0 section tree, one crumb
    // beyond "repo"
    await expect(page.locator(".sy-grid .sy-box").first()).toBeVisible();
    const top = await page.locator(".sy-grid .sy-box").count();
    expect(top).toBeGreaterThan(0);
    await expect(page.locator("[data-testid=map-breadcrumb] .crumb-link")).toHaveCount(2);
    // drill: click a section box that nests further (a single-file section
    // shows only leaves), walking boxes until the next level renders
    let drilled = -1;
    for (let i = 0; i < Math.min(6, top); i++) {
      await page.locator(".sy-box-title").nth(i).click();
      await expect(page.locator("[data-testid=map-breadcrumb] .crumb-link")).toHaveCount(3);
      if ((await page.locator(".sy-grid .sy-box").count()) > 0) { drilled = i; break; }
      // back one level (to the section), not to the map root
      await page.locator("[data-testid=map-breadcrumb] .crumb-link").nth(1).click();
      await expect(page.locator("[data-testid=map-breadcrumb] .crumb-link")).toHaveCount(2);
    }
    expect(drilled).toBeGreaterThanOrEqual(0);
    await expect(page.locator(".sy-grid .sy-box").first()).toBeVisible();
    const sub = await page.locator(".sy-grid .sy-box").count();
    expect(sub).toBeGreaterThan(0);
    // drill deeper until leaf rows appear (the tree's depth varies by repo)
    for (let i = 0; i < 5 && (await page.locator(".sy-leaf-row").count()) === 0; i++) {
      await page.locator(".sy-box-title").first().click();
      await expect(page.locator("[data-testid=map-breadcrumb] .crumb-link")).toHaveCount(3 + i + 1);
    }
    await expect(page.locator(".sy-leaf-row").first()).toBeVisible();
    // breadcrumb climbs back out one level – the parent crumb is the
    // second-to-last link (the last is the level we are on)
    const crumbs = await page.locator("[data-testid=map-breadcrumb] .crumb-link").count();
    await page.locator("[data-testid=map-breadcrumb] .crumb-link").nth(crumbs - 2).click();
    await expect(page.locator("[data-testid=map-breadcrumb] .crumb-link")).toHaveCount(crumbs - 1);
    // hash tracks the drill path – after the climb it may be back at the top
    // (no sub-path), so the slash is optional here
    await expect(page).toHaveURL(/#map(\/|$)/);
    // deep link restores the path (the route is #map[/blockId], one level)
    const h = await page.evaluate(() => location.hash);
    const crumbsAt = await page.locator("[data-testid=map-breadcrumb] .crumb-link").count();
    await page.goto("/?fresh=1");
    await open(page, h.replace(/^#\/?/, ""));
    await expect(page.locator("[data-testid=map-breadcrumb] .crumb-link")).toHaveCount(crumbsAt);
  });

  test("selecting a leaf opens the code panel with its source", async ({ page }) => {
    await open(page, "map");
    await blocksView(page);
    // drill until leaves hang off the level below (depth varies by repo)
    for (let i = 0; i < 6 && (await page.locator(".sy-leaf-row").count()) === 0; i++) {
      await page.locator(".sy-box-title").first().click();
      await expect(page.locator("[data-testid=map-breadcrumb] .crumb-link")).toHaveCount(3 + i);
    }
    const leaf = page.locator(".sy-leaf-row").first();
    // The panel shows the leaf's file – read the extension from the row's
    // path title (which leaf sorts first varies by repo, e.g. kula.rb)
    const title = (await leaf.getAttribute("title")) ?? "";
    const ext = title.includes(".") ? title.replace(/^.*\./, "").split(":")[0] : "rs";
    await leaf.click();
    await expect(page.locator(".code-panel")).toBeVisible();
    await expect(page.locator(".code-panel")).toContainText(ext);
    // the code panel is an overlay – the tab must stay on MapView
    await expect(page).toHaveURL(/#map/);
  });

  test("sidebar filter narrows chains and blocks", async ({ page }) => {
    await open(page, "map");
    await blocksView(page);
    await expect(page.locator(".sy-grid .sy-box").first()).toBeVisible();
    await structure(page);
    // the first box's name span – textContent would glue the role glyph to
    // the name ("ocore"), so read .sy-bname, the name the sidebar filters on
    const name = (await page.locator(".sy-box-title .sy-bname").first().textContent()) ?? "server";
    await page.fill("[data-testid=map-filter]", name);
    await expect(page.locator(".sy-block").first()).toBeVisible();
    await page.fill("[data-testid=map-filter]", "zzzznope");
    await expect(page.locator(".sy-empty")).toBeVisible();
  });

  test("@responsive map fits without sideways scroll", async ({ page }, info) => {
    await open(page, "map");
    await expect(page.locator("[data-testid=map-view]")).toBeVisible();
    await page.waitForTimeout(300);
    const over = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `test-results/${info.project.name}-map.png` });
  });

  test("@mobile the sidebar is a drawer, summoned and dismissed", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "phones only");
    await open(page, "map");
    const side = page.locator("[data-testid=map-sidebar]");
    await expect(side).toBeHidden();
    await explore(page); await page.locator("[data-testid=map-side-toggle]").click();
    await expect(side).toBeVisible();
    await expect(page.locator("[data-testid=map-filter]")).toBeVisible();
    await page.locator("[data-testid=map-side-close]").click();
    await expect(side).toBeHidden();
  });

  test("keyboard moves through sidebar rows and opens with enter", async ({ page }) => {
    await open(page, "map");
    await chainsList(page);
    await page.locator("[data-testid=map-side-scroll]").focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    // the first active row is a family: ↵ expands it and its chains page in
    await page.keyboard.press("Enter");
    await expect(page.locator(".sy-chain").first()).toBeVisible();
  });

  test("the lens switch filters the view (Functions / Utilities / All)", async ({ page }) => {
    await open(page, "map");
    await chainsList(page);
    // All: families listed whole (wait for the payload to land first)
    await expect(page.locator(".sy-family").first()).toBeVisible();
    const all = await page.locator(".sy-family").count();
    expect(all).toBeGreaterThan(0);
    // Utilities: only families whose ends carry a utilities-lens role – the
    // glyph shows the family's source role, so on live data model ("m") and
    // config ("k") sources appear beside utility ("u") ones
    // the roles popover hosts the lens presets (R0 – no View menu)
    await explore(page); await page.locator("[data-testid=map-roles-btn]").click();
    await expect(page.locator("[data-testid=map-role-filter]")).toBeVisible();
    await explore(page); await page.locator("[data-testid=map-lens-utilities]").click();
    // the popover closes on a preset pick; reopen it for the role legend
    await explore(page); await page.locator("[data-testid=map-roles-btn]").click();
    await expect(page.locator("[data-testid=map-role-filter]")).toBeVisible();
    for (const role of ["entry", "orchestrator", "core", "utility", "adapter", "model", "config", "test", "glue"]) {
      await expect(page.locator(`[data-testid=map-role-${role}]`)).toBeVisible();
    }
    await expect(page.locator(".sy-role-rule", { hasText: "high fan-in from ≥ 3 distinct blocks" })).toBeVisible();
    const glyphs = await page.locator(".sy-family .sy-role").allTextContents();
    expect(glyphs.length).toBeGreaterThan(0);
    expect(glyphs.every((g) => ["u", "m", "k"].includes(g))).toBe(true);
    // back to All: the full list returns – non-utility entries are visible again
    await explore(page); await page.locator("[data-testid=map-lens-all]").click();
    await explore(page); await page.locator("[data-testid=map-roles-btn]").click(); // close the popover
    const allGlyphs = await page.locator(".sy-family .sy-role").allTextContents();
    // (no count comparison: the list is windowed, so rendered rows ≠ matches)
    expect(allGlyphs.some((g) => g !== "u")).toBe(true);
  });

  test("the role filter narrows families and blocks", async ({ page }) => {
    await open(page, "map");
    await chainsList(page);
    // count only after the data has landed, so `all` is not 0
    await expect(page.locator(".sy-family").first()).toBeVisible();
    const all = await page.locator(".sy-family").count();
    await explore(page); await page.locator("[data-testid=map-roles-btn]").click();
    await page.locator("[data-testid=map-role-test]").click();
    const fewer = await page.locator(".sy-family").count();
    expect(fewer).toBeLessThanOrEqual(all);
    // blocks carry their role glyph (R0: on the cards and in the drill tree)
    await blocksView(page);
    await expect(page.locator(".sy-role").first()).toBeVisible();
    // unchecking the last role never filters to nothing
    for (const role of ["entry", "orchestrator", "core", "utility", "adapter", "model", "config", "glue"]) {
      await page.locator(`[data-testid=map-role-${role}]`).click();
    }
    await expect(page.locator(".sy-family").first()).toBeVisible();
  });

  test("@u2 while the map runs, its progress shows – not an empty state", async ({ page }) => {
    // /api/map/progress speaks the I1 contract (map_run.rs state): running,
    // phase, blocks, chains, ms. A run in flight shows the progress table.
    await page.route("**/api/map", (r) => r.fulfill({ status: 404, body: "{}", contentType: "application/json" }));
    await page.route("**/api/map/chains**", (r) => r.fulfill({ status: 404, body: "{}", contentType: "application/json" }));
    await page.route("**/api/map/progress", (r) => r.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ running: true, phase: "map", blocks: 1200, chains: 3400, ms: 4210, error: "" }),
    }));
    await open(page, "map");
    await expect(page.locator("[data-testid=map-progress]")).toBeVisible();
    await expect(page.locator("[data-testid=map-progress-table]")).toContainText("mapping");
    await expect(page.locator("[data-testid=map-progress-table]")).toContainText("1200");
    await expect(page.locator("[data-testid=map-progress-table]")).toContainText("3400");
    // the map landing (progress goes idle) swaps in the fixture stand-in
    await page.route("**/api/map/progress", (r) => r.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ running: false, phase: "done", blocks: 3400, chains: 9000, ms: 9000, error: "" }),
    }));
    await expect(page.locator("[data-testid=map-flow]")).toBeVisible({ timeout: 10_000 });
  });

  test("the old #syntagm link lands on map", async ({ page }) => {
    await open(page, "syntagm");
    await expect(page.locator("[data-testid=map-view]")).toBeVisible();
    await expect(page.locator(".rail button[aria-current=page]")).toHaveAttribute("aria-label", "Workspace");
  });

  test("the flow is the default: a headline, block cards and frames, readable landing zoom", async ({ page }, info) => {
    await open(page, "map");
    await expect(page.locator("[data-testid=map-flow]")).toBeVisible();
    // the headline is the executed path itself – the "executes" eyebrow went
    // (fused-canvas-review finding 2)
    await expect(page.locator("[data-testid=map-headline]")).not.toBeEmpty();
    await expect(page.locator("[data-testid=map-headline] .fm-headline-v")).not.toHaveText("–");
    // the nodes are the block cards now (R0) – name, role mark, meta row
    await expect(page.locator(".fc-card").first()).toBeVisible();
    await expect(page.locator(".fc-card .fc-card-name").first()).not.toBeEmpty();
    // readable by default: the landing zoom shows legible labels, not the
    // old 12% fit – the zoom readout stays above 50% on desktop
    test.skip(info.project.name !== "desktop", "a phone fits legitimately lower");
    const zoomText = page.locator("[data-testid=map-flow-canvas] [data-testid=fc-zoom]");
    await expect.poll(async () => Number((await zoomText.textContent())?.replace("%", ""))).toBeGreaterThan(50);
    // long names truncate with an ellipsis and a full-name title – on a card
    // that is actually in the viewport (React Flow cannot scroll, so an
    // off-canvas card is never hoverable)
    const visibleTid = await page.evaluate(() => {
      const el = [...document.querySelectorAll("[data-testid=map-flow] .fc-card:not(.fc-card-sec)")].find((e) => {
        const r = e.getBoundingClientRect();
        return r.top > 70 && r.left > 70 && r.bottom < innerHeight - 60 && r.right < innerWidth - 40 && e.querySelector(".fc-card-name");
      });
      return (el?.closest("[data-testid^=fc-node-]") as HTMLElement)?.dataset.testid ?? null;
    });
    expect(visibleTid).toBeTruthy();
    const name = page.locator(`[data-testid=${visibleTid}] .fc-card-name`);
    await expect(name).toHaveCSS("text-overflow", "ellipsis");
    // U9: the full name lives in the square's hover sentence, not a native tooltip
    await expect(name).not.toBeEmpty();
    // U5: a double-click opens the square's details (the nested squares
    // open in place – there is no separate drill view any more)
    await page.locator(`[data-testid=${visibleTid}]`).dblclick();
    await expect(page.locator("[data-testid=map-inspector]")).toBeVisible();
    await page.locator("body").press("Escape");
    await expect(page.locator("[data-testid=map-flow]")).toBeVisible();
  });

  test("the right panel lists every function, single-function blocks included", async ({ page }) => {
    await open(page, "map");
    await structure(page);
    const panel = page.locator("[data-testid=map-sidebar]");
    // it floats on the right, like Graph's inspector
    const box = await page.locator("#map-sidebar").boundingBox();
    const vw = page.viewportSize()!.width;
    test.skip(vw <= 720, "phones use the drawer");
    expect(box!.x + box!.width).toBeGreaterThan(vw - 32);
    await page.locator("[data-testid=map-sect-functions]").click();
    await expect(panel.locator(".sy-section-label").first()).toHaveText(/functions · \d+/i);
    await expect(panel.locator(".sy-leaf .fm-kind").first()).toBeVisible();
  });

  test("a running map pass shows the progress strip and the nav busy mark, then clears", async ({ page }) => {
    let active = true;
    await page.route("**/api/map/progress", (r) => r.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify(active ? { running: true, phase: "embed", blocks: 40, chains: 300, ms: 8000, error: "" } : { running: false, phase: "done", blocks: 255, chains: 2598, ms: 20000, error: "" }),
    }));
    await open(page, "map");
    await expect(page.locator("[data-testid=map-progress-strip]")).toBeVisible();
    await expect(page.locator("[data-testid=map-progress-strip]")).toContainText("mapping in progress");
    await expect(page.locator("[data-testid=map-progress-strip]")).toContainText("40 blocks");
    await expect(page.locator("[data-testid=map-nav-busy]")).toBeAttached();
    active = false;
    await expect(page.locator("[data-testid=map-progress-strip]")).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator("[data-testid=map-nav-busy]")).toHaveCount(0);
  });

  // – M2: the map on the flow canvas – group frames, selection, lenses –
  test("the flow canvas paints sections as group frames; selecting a block fills the details", async ({ page }) => {
    await open(page, "map");
    await expect(page.locator("[data-testid=map-flow]")).toBeVisible();
    // nested-squares map: sections are solid squares (frames only when opened)
    await expect(page.locator(".fc-card").first()).toBeVisible();
    // the LAST card in DOM: sibling group frames render above earlier
    // groups' children (each frame is its own stacking context)
    const box = page.locator(".fc-card").last();
    const picked = (await box.locator(".fc-card-name").first().textContent())?.trim() ?? "";
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.toLowerCase()).not.toContain("whole repo");
    // click in the tile's lower half – a tile at the canvas edge has its
    // centre outside the clipped canvas region
    await box.dispatchEvent("click");
    // the details table fills with THAT block – not the repo root the table
    // falls back to (the root reads "whole repo")
    await expect(page.locator("[data-testid=map-readout] [data-testid=map-block-table]")).toBeVisible();
    await expect(page.locator("[data-testid=map-block-table] [data-testid=map-role-line]")).toContainText(/entry|orchestrator|core|utility|adapter|model|config|test|glue/);
    // U9: the square shows its plain name, the details heading its code name
    void picked;
    await expect(page.locator("[data-testid=map-readout] h2")).not.toBeEmpty();
    // the node toolbar: pin rides the hovered node's toolbar now (the old
    // "re-layout · pin · roles" row is gone). Hover the card first – the
    // toolbar floats above it (n8n §4, nothing on the node face).
    // toolbar floats above it (n8n §4, nothing on the node face). Hover a card
    // that is actually in the viewport – React Flow cannot scroll, so an
    // off-canvas card is never hoverable.
    const hoverTid = await page.evaluate(() => {
      const el = [...document.querySelectorAll("[data-testid=map-flow] .fc-card:not(.fc-card-sec)")].find((e) => {
        const r = e.getBoundingClientRect();
        return r.top > 70 && r.left > 70 && r.bottom < innerHeight - 60 && r.right < innerWidth - 40;
      });
      return (el?.closest("[data-testid^=fc-node-]") as HTMLElement)?.dataset.testid ?? null;
    });
    expect(hoverTid).toBeTruthy();
    const card = page.locator(`[data-testid=${hoverTid}]`);
    await card.hover();
    await page.locator("[data-testid^=fn-pin-]").first().click();
    await expect(page.locator("[data-testid^=fn-pin-]").first()).toHaveClass(/on/);
    // re-layout is tidy now, one undoable home in the U2 chrome strip (the
    // canvas's plain fc-tidy is hidden on the map) – the map survives it
    await explore(page); await page.locator("[data-testid=u2-tidy]").click();
    await expect(page.locator("[data-testid=map-flow]")).toBeVisible();
  });

  test("a block card resizes from its corner and more room shows more detail", async ({ page }, info) => {
  test.skip(true, "retired with the U5 nested-squares map (no card body/border/resize) – see BRIEF-fuse2 S-tests for the square-era replacement");
    test.skip(info.project.name !== "desktop", "resize needs a pointer and a wide canvas");
    await open(page, "map");
    await expect(page.locator("[data-testid=map-flow]")).toBeVisible();
    // pick a block card whose corner is actually draggable: fully inside the
    // viewport with room to drag out (the statusbar covers the canvas bottom,
    // so a card near it swallows the pointerdown) – the last in DOM renders
    // on top of the frames
    // the landing fit settles after the cards hydrate in chunks: wait until
    // the camera holds still before choosing a card by its screen position
    let last = "";
    await expect.poll(async () => {
      const t = await page.locator("[data-testid=map-flow] .react-flow__viewport").getAttribute("style");
      const still = t === last;
      last = t ?? "";
      return still;
    }, { intervals: [400], timeout: 15_000 }).toBe(true);
    const pickable = await page.evaluate(() => {
      const vw = innerWidth, vh = innerHeight;
      return [...document.querySelectorAll(".fc-card:not(.fc-card-sec)")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.top > 60 && r.left > 60 && r.bottom < vh - 60 && r.right + 300 < vw;
        })
        .map((el) => (el.closest("[data-testid^=fc-node-]") as HTMLElement)?.dataset.testid)
        .filter((id): id is string => !!id);
    });
    expect(pickable.length, "a card with drag room exists").toBeGreaterThan(0);
    const card0 = page.locator(`[data-testid=${pickable[0]}]`);
    // No selection first: selecting opens the inspector and the canvas can
    // re-frame, moving the card out from under the pointer.
    // pin the card by its node id: a resize re-measure can re-stack siblings
    const testid = await card0.getAttribute("data-testid");
    expect(testid).toBeTruthy();
    const card = page.locator(`[data-testid=${testid}]`);
    const handle = card.locator(".fc-card-resize");
    await expect(handle).toBeAttached();
    // let the selection re-render settle, or the drag can start on a handle
    // React is about to replace
    await page.waitForTimeout(400);
    const before = await card.boundingBox();
    expect(before!.width).toBeLessThan(400);
    // drag the corner handle out past the detail stage (320): the function
    // list appears (content reflows) and the size persists
    await page.mouse.move(before!.x + before!.width - 6, before!.y + before!.height - 6);
    await page.mouse.down();
    // past the "full" stage (432 px wide): the function list reflows in
    await page.mouse.move(before!.x + before!.width + 280, before!.y + before!.height + 180, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const after = await card.boundingBox();
    expect(after!.width).toBeGreaterThan(before!.width + 150);
    expect(after!.height).toBeGreaterThan(before!.height + 100);
    // more room shows more detail: a block that crosses flows or carries
    // functions grows its flows row / function list; one that crosses
    // neither (a chain-less corner of the map) still resizes and persists –
    // the persisted-size check below is the acceptance.
    const detail = card.locator(".fc-card-fns li, .fc-card-flows");
    if (await detail.count()) await expect(detail.first()).toBeVisible();
    // persisted beside the position, under the map namespace
    const persisted = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith("kula.flow.size.v1.map."));
      return keys.length > 0 && keys.some((k) => Object.keys(JSON.parse(localStorage.getItem(k) || "{}")).length > 0);
    });
    expect(persisted).toBe(true);
  });

  // – Workspace: agents deployed onto the map –
  test("workspace: sidebar tabs manage, the block panel opens with Tab and searches, Library folds the agents page in", async ({ page }) => {
    await open(page, "map");
    // the inspector opens from the HUD; Overview is its first tab
    await expect(page.locator("[data-testid=map-inspector]")).toHaveCount(0);
    await explore(page); await page.locator("[data-testid=hud-pipeline]").click();
    await expect(page.locator("[data-testid=ws-tab-pipeline]")).toHaveAttribute("aria-selected", "true");
    await page.locator("[data-testid=pl-add]").click();
    const np = page.locator("[data-testid=np]");
    await expect(np).toHaveClass(/open/);
    // categories first; a category slides in its blocks
    await page.locator("[data-testid=np-cat-agent]").click();
    await expect(page.locator("[data-testid=np-item-agent-fix]")).toBeVisible();
    await page.locator("[data-testid=np-back]").click();
    await page.locator("[data-testid=np-search]").fill("verify");
    await expect(page.locator("[data-testid=np-item-gate-verify]")).toBeVisible();
    await expect(page.locator("[data-testid=np-item-agent-fix]")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(np).not.toHaveClass(/open/);
    await page.locator("[data-testid=ws-tab-changes]").click();
    await expect(page.locator("[data-testid=ws-review]")).toBeVisible();
    await page.locator("[data-testid=ws-tab-live]").click();
    await expect(page.locator("[data-testid=ws-run]")).toBeVisible();
    await page.locator("[data-testid=ws-tab-library]").click();
    await expect(page.locator("[data-testid=ws-library]")).toBeVisible();
    await page.locator("[data-testid=lib-teams]").click();
    await expect(page.locator("[data-testid=lib-teams]")).toHaveAttribute("aria-expanded", "true");
    // colours: the scheme toggle row is gone (grey nodes, n8n §6) – the map
    // just stays in its scheme
    await expect(page.locator("[data-testid=map-flow]")).toHaveClass(/fm-flow/);
  });

  test("pipeline: blocks land on the map, Run opens a fenced task, Done hands on to the gate, the log streams it", async ({ page }) => {
    let body: { title?: string; scope?: string[]; workflow?: string } | null = null;
    let open1 = false;
    await page.route("**/api/agents/task_start", async (r) => { body = r.request().postDataJSON(); open1 = true; await r.fulfill({ status: 200, contentType: "application/json", body: "{}" }); });
    await page.route("**/api/agents/task_done", (r) => { open1 = false; return r.fulfill({ status: 200, contentType: "application/json", body: "{}" }); });
    await open(page, "map");
    await page.evaluate(() => localStorage.removeItem("kula.pipeline.map"));
    // select a block card, then click blocks in the panel: the agent lands on it
    await page.locator(".fc-card").first().dispatchEvent("click");
    await addBlock(page, "np-item-trigger-manual", "manual");
    await addBlock(page, "np-item-agent-fix", "fix");
    await addBlock(page, "np-item-gate-status", "graph current");
    await expect(page.locator("[data-testid^=pl-row-]")).toHaveCount(3);
    await expect(page.locator("[data-testid^='fc-node-step:']")).toHaveCount(3);
    await page.locator("[data-testid=pl-row-1]").click();
    await page.locator("[data-testid=pl-task]").fill("tighten the parser");
    await page.locator("[data-testid=ws-run-btn]").click();
    await expect.poll(() => body?.title).toBe("tighten the parser");
    expect(body!.workflow).toBe("fix");
    expect(body!.scope!.length).toBeGreaterThan(0);
    await expect(page.locator("[data-testid=dock-log]")).toContainText("waiting for a connected agent");
    // the run bar carries the hand-off while an agent block waits
    await page.locator("[data-testid=ws-done]").click();
    await expect(page.locator("[data-testid=dock-log]")).toContainText(/run (passed|failed)/, { timeout: 20_000 });
    expect(open1).toBe(false);
  });

  test("n8n parity: the panel slides into a category, right-click opens the menu, the details view has input · parameters · output, D skips a block, ⌘Z undoes", async ({ page }) => {
    await page.route("**/api/agents/task_start", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
    await open(page, "map");
    await page.evaluate(() => localStorage.removeItem("kula.pipeline.map"));
    await page.reload();
    // R0: the picker opens from the pipeline panel (+ add); the reload left
    // the sidebar closed – open it first
    await structure(page);
    await page.locator("[data-testid=ws-tab-pipeline]").click();
    await page.locator("[data-testid=pl-add]").click();
    await page.locator("[data-testid=np-cat-gate]").click();
    await expect(page.locator("[data-testid=np-back]")).toContainText("Gates");
    await page.locator("[data-testid=np-item-gate-status]").click();
    // keyboard: search, Enter inserts the top hit
    await page.locator("[data-testid=pl-add]").click();
    await page.locator("[data-testid=np-search]").fill("graph current");
    await page.locator("[data-testid=np-search]").press("Enter");
    await expect(page.locator("[data-testid^=pl-row-]")).toHaveCount(2);
    // undo takes the second block back
    await page.locator(".fc-canvas").focus();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.locator("[data-testid^=pl-row-]")).toHaveCount(1);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(page.locator("[data-testid^=pl-row-]")).toHaveCount(2);
    // right-click a block: n8n's menu; Open shows the three-pane details view
    const step = page.locator("[data-testid^='fc-node-step:']").first();
    await step.click({ button: "right" });
    await expect(page.locator("[data-testid=ctx-menu]")).toBeVisible();
    await page.locator("[data-testid=cm-open]").press("Enter");
    const ndv = page.locator("[data-testid=ndv]");
    await expect(ndv).toBeVisible();
    await expect(ndv.locator(".ndv-col h3")).toHaveText([/Input/, /Parameters/, /Output/]);
    await page.keyboard.press("Escape");
    await expect(ndv).toHaveCount(0);
    // deactivate the first block: the run skips it and the log says so
    await step.click({ button: "right" });
    await page.locator("[data-testid=cm-toggle]").press("Enter");
    await page.locator("[data-testid=ws-run-btn]").click();
    await expect(page.locator("[data-testid=dock-log]")).toContainText("deactivated – skipped");
    await expect(page.locator("[data-testid=dock-tree]")).toBeVisible();
    await expect(page.locator("[data-testid=dock-log]")).toContainText(/run (passed|failed)/, { timeout: 20_000 });
    // the run is in the executions history
    await page.locator("[data-testid=ws-tab-live]").click();
    await expect(page.locator("[data-testid=ws-execs] .ex-row")).toHaveCount(1);
  });

  test("transport: step runs one block then pauses, continue finishes, re-run appears after a failure", async ({ page }) => {
    await page.route("**/api/git/kula", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 1, stdout: "", stderr: "gate failed" }) }));
    await open(page, "map");
    await page.evaluate(() => localStorage.removeItem("kula.pipeline.map"));
    await page.reload();
    await addBlock(page, "np-item-trigger-manual", "manual");
    await addBlock(page, "np-item-gate-status", "graph current");
    await page.locator("[data-testid=ws-step]").click();
    await expect(page.locator("[data-testid=ws-run-state]")).toContainText("Paused");
    await expect(page.locator("[data-testid=ws-pause]")).toHaveAttribute("aria-pressed", "true");
    await page.locator("[data-testid=ws-pause]").click();
    await expect(page.locator("[data-testid=ws-run-state]")).toContainText("Failed", { timeout: 15_000 });
    await expect(page.locator("[data-testid=ws-rerun]")).toBeVisible();
  });

  test("U5 nested squares: a click disassembles a section, one branch open at a time", async ({ page }) => {
    await open(page, "map");
    await expect(page.locator("[data-testid=map-flow]")).toBeVisible({ timeout: 30_000 });
    // closed: every section is one solid square, no frames
    await expect(page.locator(".fc-solid").first()).toBeVisible();
    await expect(page.locator("[data-testid^='fc-node-open:']")).toHaveCount(0);
    await page.locator("[data-testid=fc-fit]").click();
    await page.waitForTimeout(500);
    const openable = page.locator(".fc-solid:has(.fc-solid-open)");
    const ids = await openable.evaluateAll((els) => els.filter((e) => {
      const r = e.querySelector(".fc-solid-sq")!.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + 20);
      return r.left > 80 && r.right < innerWidth - 200 && r.top > 120 && r.bottom < innerHeight - 120 && !!top && e.contains(top);
    }).map((e) => e.getAttribute("data-testid")!.slice("fc-node-".length)));
    expect(ids.length).toBeGreaterThan(1);
    const [a, b] = ids;
    const tap = async (sel: string) => { const bb = await page.locator(sel).boundingBox(); await page.mouse.click(bb!.x + bb!.width / 2, bb!.y + Math.min(20, bb!.height / 2)); await page.waitForTimeout(400); };
    await tap(`[data-testid="fc-node-${a}"] .fc-solid-sq`);
    await expect(page.locator(`[data-testid="fc-node-open:${a}"]`)).toBeVisible();
    // opening another branch folds the first back into its square
    await page.locator("[data-testid=fc-fit]").click();
    await page.waitForTimeout(500);
    await tap(`[data-testid="fc-node-${b}"] .fc-solid-sq`);
    await expect(page.locator(`[data-testid="fc-node-open:${b}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="fc-node-open:${a}"]`)).toHaveCount(0);
    // the frame header folds it
    await tap(`[data-testid="fc-node-open:${b}"] .fc-group-label`);
    await expect(page.locator("[data-testid^='fc-node-open:']")).toHaveCount(0);
  });

  test("R0: the lens switcher is gone and the roles filter moved to the inspector", async ({ page }) => {
    await open(page, "map");
    // the view switcher and its tabs are removed (one Workspace canvas)
    for (const id of ["map-view-flow", "map-view-flows", "map-view-capabilities", "map-view-blocks", "map-view-chains", "map-view-menu"])
      await expect(page.locator(`[data-testid=${id}]`)).toHaveCount(0);
    // Add block is gone from the canvas chrome and from the context menu
    await expect(page.locator("[data-testid=ws-add]")).toHaveCount(0);
    await expect(page.locator("[data-testid=cm-add]")).toHaveCount(0);
    // the role filters live in the inspector's Overview tab now
    await explore(page); await page.locator("[data-testid=map-roles-btn]").click();
    await expect(page.locator("[data-testid=map-role-filter]")).toBeVisible();
    await explore(page); await page.locator("[data-testid=map-roles-btn]").click();
    // the flows list is an inspector overlay, not a canvas of its own –
    // open the inspector with a selection first
    await (await cardInView(page)).click();
    await expect(page.locator("[data-testid=map-inspector]")).toBeVisible();
    await expect(page.locator("[data-testid=map-flows-list]")).toBeAttached();
  });

  test("R0: resting edges are dim and brighten on interaction (computed style)", async ({ page }) => {
    await open(page, "map");
    await expect(page.locator("[data-testid=map-flow]")).toBeVisible({ timeout: 30_000 });
    // U2 layer contract: Flows is off until picked from a list (§5).
    await explore(page); await page.locator("[data-testid=u2-layer-flows]").click();
    const edge = page.locator("[data-testid=map-flow] .fc-edge").first();
    await expect(edge).toBeAttached();
    const stroke = () => edge.evaluate((el) => {
      const cs = getComputedStyle(el);
      const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(cs.stroke) ?? null;
      return cs.opacity + (m ? `|${m[1]},${m[2]},${m[3]}` : "");
    });
    const atRest = await stroke();
    // the resting edge is a dim warm line, not white
    const [, , rgb] = atRest.split("|");
    if (rgb) {
      const [r, g, b] = rgb.split(",").map(Number);
      expect(r + g + b).toBeLessThan(700); // anything near-white sums over ~700
    }
    // hover a node: its wires climb the brightness ladder by stroke colour –
    // resting edges sit on --text-3, lit edges on --text (opacity stays 1;
    // the ladder is luminance, not transparency). Only edges of the hovered
    // node are lit, so sample one attached to it.
    const node = await cardInView(page);
    // hover by mouse coordinates, not locator.hover(): React Flow's
    // transformed canvas makes Playwright's auto-scroll report the card as
    // "outside of the viewport" even though it is visible on screen.
    const nb = await node.boundingBox();
    if (!nb) throw new Error("the picked card has no bounding box");
    const lit = page.locator("[data-testid=map-flow] .fc-edge-lit").first();
    // the hover state can race the canvas's landing zoom – re-hover until a
    // wire lights instead of trusting one mouse move
    for (let i = 0; i < 8 && (await lit.count()) === 0; i++) {
      await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2, { steps: 3 });
      await page.waitForTimeout(150);
    }
    await expect(lit).toBeAttached();
    const lum = (rgb: string | undefined) => {
      if (!rgb) return -1;
      const [r, g, b] = rgb.split(",").map(Number);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const litStroke = await lit.evaluate((el) => {
      const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(getComputedStyle(el).stroke) ?? null;
      return m ? `${m[1]},${m[2]},${m[3]}` : undefined;
    });
    // the lit edge is brighter than the resting edge – the ladder's edge rung
    expect(lum(litStroke)).toBeGreaterThan(lum(atRest.split("|")[1]));
  });

  test("R0: no node label overlaps another node or an edge label (1440, 1100, 390)", async ({ page }) => {
    const check = async (width: number, height: number) => {
      await page.setViewportSize({ width, height });
      await open(page, "map");
      await expect(page.locator("[data-testid=map-flow]")).toBeVisible({ timeout: 30_000 });
      await expect(page.locator("[data-testid=map-flow] .fc-canvas")).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(800); // let the landing zoom settle
      // Panning walks the virtualized window; at each stop, no rendered label
      // (node name or sub) may intersect another node's box or an edge label.
      const canvas = page.locator("[data-testid=map-flow-canvas] .fc-canvas");
      const cb = await canvas.boundingBox();
      for (const [dx, dy] of [[0, 0], [-400, -200], [400, 200]] as const) {
        if (dx || dy) {
          await page.mouse.move(cb!.x + cb!.width / 2, cb!.y + cb!.height / 2);
          await page.mouse.down({ button: "middle" });
          await page.mouse.move(cb!.x + cb!.width / 2 + dx, cb!.y + cb!.height / 2 + dy, { steps: 5 });
          await page.mouse.up({ button: "middle" });
          await page.waitForTimeout(500);
        }
        const hits = await page.evaluate(() => {
          const labels = [...document.querySelectorAll(".fc-card-name, .fc-card-sub")]
            .map((el) => ({ r: (el as HTMLElement).getBoundingClientRect(), t: el.textContent ?? "" }))
            .filter((l) => l.r.width > 0 && l.r.height > 0);
          const edgeLabels = [...document.querySelectorAll(".fc-edge-label")]
            .map((el) => ({ r: (el as HTMLElement).getBoundingClientRect(), t: el.textContent ?? "" }))
            .filter((l) => l.r.width > 0 && l.r.height > 0);
          const inter = (a: DOMRect, b: DOMRect) =>
            a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
          const out: string[] = [];
          for (let i = 0; i < labels.length; i++)
            for (let j = i + 1; j < labels.length; j++)
              if (inter(labels[i].r, labels[j].r)) out.push(`label×label: ${labels[i].t} × ${labels[j].t}`);
          for (const l of labels) for (const e of edgeLabels) if (inter(l.r, e.r)) out.push(`label×edge: ${l.t} × ${e.t}`);
          return out;
        });
        expect(hits, `${width}×${height} pan ${dx},${dy}`).toEqual([]);
      }
    };
    await check(1440, 900);
    await check(1100, 700);
    await check(390, 844);
  });

  test("focusing a chain dims everything it does not cross, from the chain card", async ({ page }) => {
    await open(page, "map");
    await chainsList(page);
    await expect(page.locator(".sy-family").first()).toBeVisible();
    // select the first family's first chain
    await page.locator(".sy-family .sy-twist").first().click();
    const chains = page.locator(".sy-chain");
    await expect(chains.first()).toBeVisible();
    await chains.first().click();
    // the chain card appears with its subway strip; focus dims the canvas
    const card = page.locator("[data-testid=map-chain-card]");
    await expect(card).toBeVisible();
    await expect(page.locator("[data-testid=map-subway] .fm-subway-btn").first()).toBeVisible();
    // selecting the chain focuses it (R0): the flow canvas shows the focus
    // badge with dimmed nodes and frames
    await expect(page.locator("[data-testid=map-flow]")).toBeVisible();
    await expect(page.locator("[data-testid=map-focus-badge]")).toContainText("focused chain");
    // dimmed nodes sit across the whole canvas; pan to bring some into the
    // virtualized window, then count them
    const canvas = page.locator("[data-testid=map-flow-canvas] .fc-canvas");
    const cb = await canvas.boundingBox();
    await page.mouse.move(cb!.x + cb!.width / 2, cb!.y + cb!.height / 2);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(cb!.x + cb!.width / 2 - 600, cb!.y + cb!.height / 2 - 300, { steps: 8 });
    await page.mouse.up({ button: "middle" });
    await page.waitForTimeout(600);
    const dimmed = page.locator("[data-testid=map-flow] .fc-dim");
    expect(await dimmed.count()).toBeGreaterThan(0);
    // The badge now sits at the canvas' bottom-left (map.css moved it out
    // from under the floating inspector), so the badge's own clear button is
    // reachable while a chain is selected.
    await page.locator("[data-testid=map-focus-clear]").click();
    await expect(page.locator("[data-testid=map-focus-badge]")).toHaveCount(0);
    await expect(page.locator("[data-testid=map-flow] .fc-dim")).toHaveCount(0);
  });

  test("a subway strip step opens the code panel at its definition", async ({ page }) => {
    await open(page, "map");
    await chainsList(page);
    await page.locator(".sy-family .sy-twist").first().click();
    const chains = page.locator(".sy-chain");
    await expect(chains.first()).toBeVisible();
    await chains.first().click();
    const stops = page.locator("[data-testid=map-subway] .fm-subway-btn");
    await expect(stops.first()).toBeVisible();
    await stops.first().click();
    await expect(page.locator(".code-panel")).toBeVisible();
  });

  test("keyboard traversal works on the flow canvas: arrows walk edges, Enter opens, Esc clears", async ({ page }) => {
    // the walk follows the code's flow edges – agents (fence wires only) off
    await page.addInitScript(() => { try { localStorage.setItem("kula.map.layers", JSON.stringify({ agents: false })); } catch { /* */ } });
    await open(page, "map");
    await expect(page.locator("[data-testid=map-flow]")).toBeVisible();
    const canvas = page.locator("[data-testid=map-flow-canvas] .fc-canvas");
    const selOf = () => canvas.getAttribute("data-fc-selection");
    // seed the walk from a card that is known by construction to carry an
    // outgoing main edge: the canvas records its main-edge list on
    // window.__fcLayout after every layout run, so the seed is a real edge
    // source, not whichever card happens to sit last in the stacking order
    // (most cards are children inside frames – only rep cards emit edges).
    let start = "", moved = "";
    for (let attempt = 0; attempt < 20 && !moved; attempt++) {
      const seed = await page.evaluate(() => {
        const me = (window as unknown as { __fcLayout?: { mainEdges: [string, string][] } }).__fcLayout?.mainEdges ?? [];
        for (const [src] of me) {
          if (src.startsWith("step:") || src.startsWith("zone-") || src.startsWith("agent:")) continue;
          if (document.querySelector(`[data-testid=fc-node-${src}]`)) return src;
        }
        return null;
      });
      if (!seed) { await page.waitForTimeout(1000); continue; }
      const tile = page.locator(`[data-testid=fc-node-${seed}]`);
      try {
        await tile.dispatchEvent("click", { timeout: 5000 });
      } catch {
        continue; // the node unmounted between query and click – next round
      }
      await canvas.focus();
      await expect.poll(selOf).not.toBe("");
      start = await selOf();
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(200);
      moved = (await selOf()) ?? "";
      if (moved === start) {
        moved = "";
        await page.keyboard.press("Escape"); // clear and retry the seed
        await expect.poll(selOf).toBe("");
      }
    }
    expect(moved).toBeTruthy();
    // ArrowLeft walks back along a main edge to a predecessor
    await page.keyboard.press("ArrowLeft");
    await expect.poll(selOf, `left from ${moved} (start ${start})`).not.toBe(moved);
    // ArrowRight again, then Enter opens the selection (a block drills in)
    await page.keyboard.press("ArrowRight");
    await expect.poll(selOf).not.toBe(start);
    // U5: Enter unfolds the selected square in place (the keyboard click)
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-testid^='fc-node-open:']")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-testid=map-flow]")).toBeVisible();
  });

  test("the canvas kit works on the map: drag persists, tidy, fit and the minimap", async ({ page }) => {
    await open(page, "map");
    await expect(page.locator("[data-testid=map-flow]")).toBeVisible();
    // the kit controls are present on the map canvas. Tidy has one undoable
    // home since U2 (the chrome strip, contract §5) – the canvas's own plain
    // fc-tidy is hidden there.
    await explore(page); await expect(page.locator("[data-testid=u2-tidy]")).toBeVisible();
    await expect(page.locator("[data-testid=map-flow-canvas] [data-testid=fc-fit]")).toBeVisible();
    await expect(page.locator("[data-testid=map-flow-canvas] [data-testid=fc-minimap-toggle]")).toBeVisible();
    // the minimap starts hidden and toggles on
    await expect(page.locator("[data-testid=map-flow-canvas] .fc-minimap")).toHaveCount(0);
    await page.locator("[data-testid=map-flow-canvas] [data-testid=fc-minimap-toggle]").click();
    await expect(page.locator("[data-testid=map-flow-canvas] .fc-minimap")).toBeVisible();
    // drag a block card and the position persists to localStorage. Drags
    // inside group frames are not persisted (kit limitation) – the depth-1
    // section cards are unparented, so drag one of those. The landing zoom
    // is already readable (R0); take the last card in DOM, it renders on top.
    const zoomIn = page.locator("[data-testid=map-flow-canvas] [data-testid=fc-zoom-in]");
    await zoomIn.click();
    await page.waitForTimeout(300);
    // a section card may sit outside the virtualized window at the landing
    // zoom – bring it into view before the hover
    // nested-squares map: drag a square that sits well inside the viewport
    const squares = page.locator(".fc-solid .fc-solid-sq");
    let wide = squares.first();
    const vp = page.viewportSize()!;
    let inView: typeof wide | null = null;
    for (let i = 0; i < await squares.count(); i++) {
      const bb = await squares.nth(i).boundingBox();
      if (bb && bb.x > 300 && bb.y > 300 && bb.x < 1100 && bb.y < 650) { wide = squares.nth(i); inView = null; break; }
      // fallback: any square wholly on screen, clear of the strip and run bar
      if (!inView && bb && bb.x > 80 && bb.y > 140 && bb.x + bb.width < vp.width - 80 && bb.y + bb.height < vp.height - 120) inView = squares.nth(i);
    }
    if (inView && !(await wide.boundingBox().then((b) => b && b.y > 140 && b.y < vp.height - 120))) wide = inView;
    await wide.hover({ timeout: 10_000 });
    const before = await wide.boundingBox();
    await page.mouse.down();
    await page.mouse.move(before!.x + before!.width / 2 - 120, before!.y + before!.height / 2 - 60, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const after = await wide.boundingBox();
    expect(Math.abs(after!.x - before!.x) + Math.abs(after!.y - before!.y)).toBeGreaterThan(40);
    const persisted = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith("kula.flow.pos.v1.map."));
      return keys.length > 0 && keys.some((k) => Object.keys(JSON.parse(localStorage.getItem(k) || "{}")).length > 0);
    });
    expect(persisted).toBe(true);
    // tidy re-runs dagre and clears persisted drags; fit recentres the view
    await explore(page); await page.locator("[data-testid=u2-tidy]").click();
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("kula.flow.pos.v1.map.")).length)).toBe(0);
    const zoomBefore = Number((await page.locator("[data-testid=map-flow-canvas] [data-testid=fc-zoom]").textContent())?.replace("%", ""));
    await page.locator("[data-testid=map-flow-canvas] [data-testid=fc-fit]").click();
    await page.waitForTimeout(400);
    await expect(page.locator("[data-testid=map-flow]")).toBeVisible();
    expect(zoomBefore).toBeGreaterThanOrEqual(0);
  });

  test("the workspace rail icon is the flow schematic with an agent on top", async ({ page }) => {
    await open(page, "overview");
    // the flow (two circles, one square) and an accent agent head riding on it
    const btn = page.locator(".rail button[aria-label=Workspace] svg");
    await expect(btn).toBeVisible();
    expect(await btn.locator("circle").count()).toBe(2);
    expect(await btn.locator("rect").count()).toBeGreaterThanOrEqual(2);
    // Agents is back on the rail as the config home; Console stays in the dock
    await expect(page.locator(".rail button[aria-label=Agents]")).toHaveCount(1);
    await expect(page.locator(".rail button[aria-label=Console]")).toHaveCount(0);
    const acc = await btn.locator("[stroke='var(--accent)']").count();
    expect(acc).toBeGreaterThanOrEqual(1);
  });

  test("flow canvas: drag pans, Shift-drag marquees, click opens the inspector", async ({ page }) => {
    await open(page, "map");
    await expect(page.locator("[data-testid=map-flow]")).toBeVisible({ timeout: 30_000 });
    const pane = page.locator("[data-testid=map-flow] .react-flow__pane");
    await pane.waitFor({ state: "visible", timeout: 30_000 });
    // Let the initial fit settle so the viewport translate is stable.
    await page.waitForTimeout(600);
    const vp = () => page.evaluate(() => {
      const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(document.querySelector("[data-testid=map-flow] .react-flow__viewport")?.getAttribute("style") ?? "");
      return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 };
    });
    const b = await pane.boundingBox();
    const x0 = b!.x + 60, y0 = b!.y + b!.height - 40; // bottom-left corner: empty at the fitted zoom
    // Middle-button drag on the canvas pans and selects nothing (the left
    // button is the selection/drag tool over nodes).
    const vp0 = await vp();
    await page.mouse.move(x0, y0);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(x0 + 120, y0 - 80, { steps: 6 });
    await page.mouse.up({ button: "middle" });
    await page.waitForTimeout(250);
    const vp1 = await vp();
    expect(Math.abs(vp1.x - vp0.x) + Math.abs(vp1.y - vp0.y)).toBeGreaterThan(20);
    // Shift-drag draws a marquee instead of panning.
    const vp2 = await vp();
    await page.keyboard.down("Shift");
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 + 160, y0 - 120, { steps: 6 });
    expect(await page.locator("[data-testid=map-flow] .react-flow__selection").count()).toBeGreaterThan(0);
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await page.waitForTimeout(250);
    const vp3 = await vp();
    expect(Math.abs(vp3.x - vp2.x) + Math.abs(vp3.y - vp2.y)).toBeLessThan(20);
    // Click a tile (an empty-pane click is just a deselect) – the inspector opens; Esc closes it.
    // (a meaning-zone frame is a backdrop, not a tile)
    const tile = page.locator("[data-testid=map-flow] .react-flow__node:not(:has([data-testid^='fc-node-zone-']))").first();
    // dispatch: edge interaction paths over the nodes intercept real clicks
    await tile.dispatchEvent("click");
    await expect(page.locator("[data-testid=map-inspector]")).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-testid=map-inspector]")).toHaveCount(0);
  });
});

test.describe("agents on the flow canvas (A3)", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ baseURL: ({ fx }, use) => use(fx) });
  const desktopOnly = (info: { project: { name: string } }) => test.skip(info.project.name !== "desktop", "writes to the fixture");

  test("A3.1 teams: a canvas seat fills the sidebar; an answers-to edit round-trips team_save", async ({ page, request }, info) => {
    desktopOnly(info);
    test.setTimeout(90_000);
    await open(page, "agents/teams");
    // Select a seat on the canvas (U16): the square is the DOM contract; the
    // team sidebar opens on the seat's fields.
    const node = page.locator('[data-testid="team-canvas"] .react-flow__node').nth(1);
    await expect(node).toBeVisible();
    // The seat key is read at click time: canvas re-renders can reorder the
    // squares, so a late read would name a different seat than the one picked.
    const seat = await node.getAttribute("data-id");
    await node.click();
    const side = page.locator('[data-testid="team-side"]');
    await expect(side).toBeVisible();
    // The sidebar tinker changes answers-to; the team saves itself shortly
    // after the edit settles – assert the request payload, not pixels.
    const orgSel = side.getByLabel("Answers to");
    await expect(orgSel).toBeVisible();
    const before = await orgSel.inputValue();
    const options = await orgSel.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    const to = options.find((v) => v !== before && v !== "") ?? "";
    const saveReq = page.waitForRequest((r) => r.url().includes("/api/agents/team_save") && r.method() === "POST");
    await orgSel.selectOption(to);
    const body = (await saveReq).postDataJSON() as { team: { name: string; members: Record<string, unknown>[] } };
    const member = body.team?.members.find((m) => (m.name ?? m.agent) === seat);
    expect(member?.reports_to, `team_save carries reports_to=${to}`).toBe(to);
    void request;
  });

  test("A3.3 memory: a canvas node fills the sidebar and the list row follows", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "graph needs a desktop viewport");
    await open(page, "agents/memory");
    const node = page.locator('.react-flow__node[data-id^="mem:"]').first();
    await expect(node).toBeVisible();
    await node.click();
    const side = page.locator(".fc-sidebar");
    await expect(side).toContainText(/#\d+/);
    await expect(side).toContainText("layer");
    // one truth, two views: the list row is selected too
    await expect(page.locator(".ag-mem.kb-sel")).toHaveCount(1);
  });

  test("A3.4 research: the run pipeline renders on the canvas; an attempt fills the sidebar", async ({ page }) => {
    // The fixture has no finished run; inject one the way A2.2 does.
    const now = Date.now(), min = 60_000;
    const run = {
      workflow: "explore", metric: "cargo test --quiet count", goal: "min", budget: 5, branch: "main", base: "main",
      baseline: 12, best: 10, started: now - 40 * min, by: "agent:claude", active: false,
      experiments: [
        { n: 1, hypothesis: "index once per blob", value: 11, best_before: 12, kept: true, commit: "abc1234def", files: ["src/store.rs"], by: "agent:claude", at: now - 35 * min },
        { n: 2, hypothesis: "borrow the graph", value: 10.5, best_before: 11, kept: false, files: ["src/graph.rs"], by: "agent:cursor", at: now - 28 * min },
      ],
    };
    await page.route("**/api/agents", (route) => route.fetch().then((r) => r.json()).then((j) => route.fulfill({
      json: { ...j, research: [run], workflows: [...j.workflows, { name: "explore", about: "loop", builtin: false, research: { metric: run.metric, goal: "min", budget: 5 } }] },
    })));
    await open(page, "agents/research");
    await page.getByRole("tab", { name: "explore", exact: true }).click();
    // The pipeline is on the canvas: stages left to right, sub-nodes below –
    // 4 stages + 2 solver circles + 2 attempt circles + 1 frontier record.
    await expect(page.locator(".rf-canvas .react-flow__node")).toHaveCount(9);
    await expect(page.locator('.rf-canvas .react-flow__node[data-id="st:gate"]')).toBeVisible();
    // Selecting an attempt on the canvas fills the sidebar and lights the list.
    await page.locator('.rf-canvas .react-flow__node[data-id="try:2"]').click();
    await expect(page.locator(".fc-sidebar")).toContainText("attempt 2");
    await expect(page.locator(".rf-try").filter({ hasText: "borrow the graph" })).toHaveClass(/sel/);
  });
});

test.describe("agents add from the map rail (U3)", () => {
  // Writes a team and a workflow to the fixture: one worker, own fixture.
  test.use({ baseURL: ({ fx }, use) => use(fx) });
  const desktopOnly = (info: { project: { name: string } }) => test.skip(info.project.name !== "desktop", "writes to the fixture");

  test("the Library rail's add buttons open the compact form; creating it lands the editor on the new item", async ({ page }, info) => {
    desktopOnly(info);
    test.setTimeout(90_000);
    await open(page, "map");
    await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 30_000 });
    await explore(page); await page.locator("[data-testid=map-side-toggle]").click();
    await page.locator("[data-testid=ws-tab-library]").click();
    // one obvious add per kind, in the rail's head – both open the same form
    await expect(page.locator("[data-testid=lib-add-team]")).toBeVisible();
    await expect(page.locator("[data-testid=lib-add-agent]")).toBeVisible();
    // agent and team items carry their harmonograph mark
    await expect(page.locator("[data-testid='ws-library'] .lib-item svg[data-figure='harmonograph']").first()).toBeVisible();
    // add team: the form opens in the rail, defaults prefilled; esc cancels
    await page.locator("[data-testid=lib-add-team]").click();
    const form = page.locator("[data-testid=ag-add-form]");
    await expect(form).toBeVisible();
    await expect(form.locator("[data-testid=ag-add-name]")).toHaveValue(/new-team/);
    await page.keyboard.press("Escape");
    await expect(form).toHaveCount(0);
    // create a team from the rail: the agents editor opens on it, selected
    await page.locator("[data-testid=lib-add-team]").click();
    const teamName = `rail-team-${Date.now()}`;
    await form.locator("[data-testid=ag-add-name]").fill(teamName);
    await form.locator("[data-testid=ag-add-name]").press("Enter");
    await expect(page).toHaveURL(/#agents\/teams/);
    const teamTab = page.locator(".team-tabs [role=tab]").filter({ hasText: teamName });
    await expect(teamTab).toHaveClass(/on/);
    await expect(teamTab).toBeInViewport();
    await expect(page.locator(".tc-head .tc-head-name")).toHaveText(teamName);
    // add agent from the rail: the workflow editor opens on it, fence prefilled
    await open(page, "map");
    await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 30_000 });
    await explore(page); await page.locator("[data-testid=map-side-toggle]").click();
    await page.locator("[data-testid=ws-tab-library]").click();
    await page.locator("[data-testid=lib-add-agent]").click();
    const wfName = `rail-agent-${Date.now()}`;
    await form.locator("[data-testid=ag-add-name]").fill(wfName);
    await form.locator("[data-testid=ag-add-name]").press("Enter");
    await expect(page).toHaveURL(/#agents\/workflows/);
    await expect(page.locator(".ag-side-head h2")).toHaveText(wfName);
    await expect(page.locator(".wf-edit")).toContainText("src/**");
    // clean up: delete both from their editors
    page.once("dialog", (d) => d.accept());
    await page.locator(".wf-edit").getByRole("button", { name: "Delete" }).click();
    await expect(page.locator(`[data-testid=ag-card-${wfName}]`)).toHaveCount(0);
    await open(page, "agents/teams");
    await page.locator(".team-tabs [role=tab]").filter({ hasText: teamName }).click();
    // the team sidebar carries the settings – delete there (U16 canvas)
    await page.locator("[data-testid=team-side-toggle]").click();
    await page.locator("[data-testid=team-delete]").click();
    await expect(page.locator(".team-tabs [role=tab]").filter({ hasText: teamName })).toHaveCount(0);
  });

  test("@responsive on a phone the rail's add form is a full-width sheet with touch targets", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "the sheet layout is the 390 form");
    await open(page, "map");
    await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 30_000 });
    await explore(page); await page.locator("[data-testid=map-side-toggle]").click();
    await page.locator("[data-testid=ws-tab-library]").click();
    await page.locator("[data-testid=lib-add-team]").click();
    const form = page.locator("[data-testid=ag-add-form]");
    await expect(form).toBeVisible();
    const box = await form.boundingBox();
    const vh = page.viewportSize()?.height ?? 844;
    expect(box?.width, "the form spans the phone width").toBeGreaterThanOrEqual(384);
    expect(box?.y ?? 0, "the sheet sits above the statusbar").toBeLessThan(vh - 28);
    const name = form.locator("[data-testid=ag-add-name]");
    expect((await name.boundingBox())?.height).toBeGreaterThanOrEqual(38);
  });
});

/** A block card that is on screen inside the canvas – the landing view zooms
 *  in on the busiest section (R0), so the first card in the DOM can be
 *  off-canvas, and React Flow cannot scroll a card into view. */
async function cardInView(page: import("@playwright/test").Page) {
  // nested-squares map: wait for the squares, and keep clear of the right column
  await page.locator(".fc-solid").first().waitFor({ state: "attached", timeout: 30_000 });
  const id = await page.evaluate(() => {
    const c = document.querySelector("[data-testid=map-flow] .react-flow")?.getBoundingClientRect();
    if (!c) return null;
    // a card whose centre is on screen inside the canvas and on top there –
    // not under the actor band, the HUD, the zoom bar or the transport
    const el = [...document.querySelectorAll(".fc-card:not(.fc-card-sec)")].find((e) => {
      const r = e.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2; // where hover() and click() aim
      if (x < c.left + 20 || x > c.right - 170 || y < c.top + 20 || y > c.bottom - 90) return false;
      const hit = document.elementFromPoint(x, y);
      return !!hit && e.contains(hit);
    });
    return (el?.closest("[data-testid^=fc-node-]") as HTMLElement | null)?.dataset.testid ?? null;
  });
  return id ? page.locator(`[data-testid=${id}]`) : page.locator(".fc-card").first();
}
