// M0 proof: the Map view loads, the variant toggle changes the URL, the
// inspector opens on a stub pick, and the test drawer records one result to
// localStorage. Plus the model unit checks (no Vitest in this repo, so they
// run in the page against the pure builder).

import { expect, test } from "@playwright/test";

test("map view loads with header and canvas", async ({ page }) => {
  await page.goto("/#map");
  await expect(page.getByTestId("map-view")).toBeVisible();
  await expect(page.getByTestId("variant-a")).toBeVisible();
  await expect(page.getByTestId("map-canvas")).toBeVisible();
  await expect(page.getByTestId("overlay-fences")).toBeVisible();
  // the model built from the repo's own flowmap
  const stations = await page.evaluate(() => (window as any).__kulaMap?.model?.stations?.length ?? 0);
  expect(stations).toBeGreaterThan(0);
});

test("variant toggle changes the URL and is remembered", async ({ page }) => {
  await page.goto("/#map");
  await page.getByTestId("variant-b").click();
  await expect(page).toHaveURL(/#map\/b/);
  await page.reload();
  await expect(page.getByTestId("variant-b")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("variant-a").click();
  await expect(page).toHaveURL(/#map\/a/);
});

test("inspector opens on a stub pick", async ({ page }) => {
  await page.goto("/#map");
  // wait for the model and the fitted view, then click a real station on the canvas
  await page.waitForFunction(() => {
    const k = (window as any).__kulaMap;
    const c = document.querySelector('[data-testid="map-canvas"]');
    return !!(k?.layout?.stations?.length && c && k?.view?.scale && k.view.w === c.clientWidth && c.clientWidth > 0);
  });
  const at = await page.evaluate(() => {
    const k = (window as any).__kulaMap;
    const s = k.layout.stations[0];
    const v = k.view;
    return { x: s.x * v.scale + v.ox, y: s.y * v.scale + v.oy, name: k.model.stations.find((t: any) => t.id === s.id).name };
  });
  await page.getByTestId("map-canvas").click({ position: { x: at.x, y: at.y } });
  const ins = page.getByTestId("map-inspector");
  await expect(ins).toBeVisible();
  await expect(ins).toContainText(at.name);
  await page.getByTestId("inspector-close").click();
  await expect(ins).not.toBeVisible();
});

test("find on map flies to a station and opens the inspector", async ({ page }) => {
  await page.goto("/#map");
  await page.waitForFunction(() => ((window as any).__kulaMap?.model?.stations?.length ?? 0) > 0);
  const name = await page.evaluate(() => (window as any).__kulaMap.model.stations[0].name);
  await page.getByTestId("map-find").fill(name.slice(0, 6));
  await page.getByTestId("map-find-list").getByRole("button").first().click();
  await expect(page.getByTestId("map-inspector")).toBeVisible();
  await expect(page).toHaveURL(/#map\/a\/s\//);
});

test("test drawer records one result to localStorage", async ({ page }) => {
  await page.goto("/#map");
  await page.evaluate(() => localStorage.removeItem("kula.map.ab"));
  await page.getByTestId("map-test-toggle").click();
  await expect(page.getByTestId("ab-drawer")).toBeVisible();
  await expect(page.getByTestId("ab-task")).toBeVisible();
  // answer task 1 correctly through the map: find its flow and pick it
  const label = await page.evaluate(() => {
    const m = (window as any).__kulaMap.model;
    const routed = m.flows.filter((f: any) => f.route);
    return (routed[0] ?? m.flows[0]).label;
  });
  await page.getByTestId("map-find").fill(label.slice(0, 6));
  await page.getByTestId("map-find-list").getByRole("button").first().click();
  await expect(page.getByTestId("ab-rate")).toBeVisible();
  await page.getByTestId("ab-rate-clarity-4").click();
  await page.getByTestId("ab-rate-speed-4").click();
  await page.getByTestId("ab-rate-look-4").click();
  await page.getByTestId("ab-note").fill("spec");
  await page.getByTestId("ab-next").click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("kula.map.ab") ?? "[]"));
  expect(stored.length).toBe(1);
  expect(stored[0].variant).toMatch(/^[abc]$/);
  expect(typeof stored[0].ms).toBe("number");
  expect(stored[0].ratings.clarity).toBe(4);
});

test("model: dedup, degree, layer, determinism (in page)", async ({ page }) => {
  await page.goto("/#map");
  await page.waitForFunction(() => (window as any).__kulaMap?.build);
  const r = await page.evaluate(async () => {
    const { build } = (window as any).__kulaMap;
    const [fm, graph] = await Promise.all([
      fetch("/api/flowmap", { headers: { "x-kula-token": document.querySelector<HTMLMetaElement>('meta[name="kula-token"]')?.content ?? "dev" } }).then((x) => x.json()),
      fetch("/api/graph", { headers: { "x-kula-token": document.querySelector<HTMLMetaElement>('meta[name="kula-token"]')?.content ?? "dev" } }).then((x) => x.json()),
    ]);
    const a = build(fm, graph);
    const b = build(fm, graph);
    const json = (m: any) => JSON.stringify({ d: m.domains, f: m.flows, s: m.stations, i: m.interchanges.map((x: any) => x.id) });
    // dedup: stations ≤ total step occurrences
    const totalSteps = fm.flows.reduce((n: number, f: any) => n + f.steps.length, 0);
    const degreeOk = a.stations.every((s: any) => s.degree === s.flows.length && s.degree >= 1);
    const interchanges = a.interchanges.every((s: any) => s.degree >= 2);
    const entryLayered = a.flows.every((f: any) => f.steps[0]?.layer === "test" || f.steps[0]?.layer === "entry");
    const layersKnown = a.stations.every((s: any) => ["entry", "handler", "logic", "data", "io", "test"].includes(s.layer));
    return {
      deterministic: json(a) === json(b),
      dedup: a.stations.length <= totalSteps,
      hasInterchange: a.interchanges.length > 0,
      degreeOk,
      interchanges,
      entryLayered,
      layersKnown,
    };
  });
  expect(r.deterministic).toBe(true);
  expect(r.dedup).toBe(true);
  expect(r.hasInterchange).toBe(true);
  expect(r.degreeOk).toBe(true);
  expect(r.interchanges).toBe(true);
  expect(r.entryLayered).toBe(true);
  expect(r.layersKnown).toBe(true);
});

// The model on the fixture repo (sh e2e/fixture.sh): same checks as above but
// against a different, disposable repo, so the builder is proven repo-shape
// independent. The fixture is spawned like ui.spec.ts does, on a free port.
test("model: the builder holds on the fixture repo too", async ({ page }) => {
  test.setTimeout(240_000);
  const path = await import("node:path");
  const fs = await import("node:fs");
  const { spawn } = await import("node:child_process");
  let script = "";
  for (const cwd of [process.cwd(), path.resolve(process.cwd(), "..")]) {
    const p = path.join(cwd, "e2e", "fixture.sh");
    if (fs.existsSync(p)) { script = p; break; }
  }
  test.skip(!script, "e2e/fixture.sh not found");
  let port = Number(process.env.KULA_PW_PORT ?? 7431) + 20;
  const taken = async (p: number) => {
    try { await fetch(`http://localhost:${p}/`, { signal: AbortSignal.timeout(300) }); return true; } catch { return false; }
  };
  for (let p = port; p < port + 12 && (await taken(port)); p++) port = p + 1;
  const logFile = `/tmp/kula-fx-m0-${port}.log`;
  const log = fs.openSync(logFile, "w");
  const proc = spawn("sh", [script, String(port)], {
    cwd: path.dirname(script) + "/..",
    stdio: ["ignore", log, log],
    env: { ...process.env, TMPDIR: "/tmp" },
  });
  const url = `http://localhost:${port}`;
  let up = false;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) { up = true; break; } } catch { /* not up yet */ }
    await new Promise((f) => setTimeout(f, 300));
  }
  try {
    if (!up) throw new Error(`fixture did not come up:\n${fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : ""}`);
    // Fetch on the Node side: the page runs on another port, and the fixture
    // server sends no CORS headers, so an in-page fetch would be refused.
    const tok = { "x-kula-token": "test" };
    const fm = await (await fetch(`${url}/api/flowmap`, { headers: tok })).json();
    const graph = await (await fetch(`${url}/api/graph`, { headers: tok })).json();
    await page.goto("/#map");
    await page.waitForFunction(() => !!((window as any).__kulaMap?.build));
    const r = await page.evaluate(({ fm, graph }) => {
      const { build } = (window as any).__kulaMap;
      const a = build(fm, graph);
      const b = build(fm, graph);
      const json = (m: any) => JSON.stringify({ d: m.domains, f: m.flows, s: m.stations, i: m.interchanges.map((x: any) => x.id) });
      const totalSteps = fm.flows.reduce((n: number, f: any) => n + f.steps.length, 0);
      return {
        deterministic: json(a) === json(b),
        dedup: a.stations.length <= totalSteps,
        degreeOk: a.stations.every((s: any) => s.degree === s.flows.length && s.degree >= 1),
        interchanges: a.interchanges.every((s: any) => s.degree >= 2) && a.interchanges.length > 0,
        entryLayered: a.flows.every((f: any) => f.steps[0]?.layer === "test" || f.steps[0]?.layer === "entry"),
        layersKnown: a.stations.every((s: any) => ["entry", "handler", "logic", "data", "io", "test"].includes(s.layer)),
      };
    }, { fm, graph });
    expect(r.deterministic).toBe(true);
    expect(r.dedup).toBe(true);
    expect(r.degreeOk).toBe(true);
    expect(r.interchanges).toBe(true);
    expect(r.entryLayered).toBe(true);
    expect(r.layersKnown).toBe(true);
  } finally {
    proc.kill("SIGTERM");
    fs.closeSync(log);
    try {
      const repo = fs.readFileSync(`/tmp/kula-fixture-${port}.path`, "utf8").trim();
      fs.rmSync(repo, { recursive: true, force: true });
      fs.rmSync(`/tmp/kula-fixture-${port}.path`, { force: true });
    } catch { /* fixture may have died before writing the path file */ }
  }
});
