import { expect, test, type Page } from "@playwright/test";
import { FIXTURE } from "../playwright.config";

// Fused-canvas acceptance tests – the contract in docs/design/fused-canvas.md
// §8. Every test here is test.fixme until the U module that owns it lands the
// behaviour (X1 is a docs + tests module: nothing below is expected to pass
// yet). X2 un-fixmes them in wave 3. Assert by name, never by fixture counts.

// Thresholds from the contract; keep the numbers in one place so a U module
// changing the design updates the contract and this table together.
const FAR_MID_SCALE = 0.55;   // contract §6 – caption stays readable below this
const DIM_NON_FENCED = 0.35;  // contract §8.5 – non-fenced blocks at focus
const MIN_PORT_PX = 12;       // contract §3 – visible ports, 12–16px
const MIN_TARGET_PX = 24;     // contract §3 – hit target at default zoom
const MAX_CROSSING_RATIO = 0.05; // PLAN B1 target
const AGENT_PORTS = ["Model", "Tools", "Fence", "Memory"] as const;
const LAYERS = ["Blocks", "Flows", "Chains", "Fences", "Agents", "Runs"] as const;
const VERBS = ["Run", "Open code", "Pin", "More"] as const;

async function opened(page: Page, hash = "map", base = "") {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
    try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto("about:blank");
  await page.goto(`${base}/#${hash}`);
  await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 30_000 });
}

// B3 (contract §8.1) – U1 owns node/edge styling.
test.fixme("luminance ladder holds: label > node border > resting edge, dark and light", async ({ page }) => {
  await opened(page, "map");
  const lum = (c: string) => {
    const m = c.match(/[\d.]+/g);
    if (!m) return null;
    if (c.startsWith("oklch")) return +m[0];
    const [r, g, b] = m.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const res = await page.evaluate(([lumSrc]) => {
    const lum = eval(lumSrc) as (c: string) => number | null;
    const edge = document.querySelector<SVGPathElement>(".react-flow__edge-path, [data-testid=canvas-edge] path");
    const node = document.querySelector<HTMLElement>("[data-testid=canvas-node]");
    const card = node?.querySelector<HTMLElement>("[class*=node]");
    const label = node && [...node.querySelectorAll<HTMLElement>("*")].find((e) => e.childNodes[0]?.nodeType === 3 && e.textContent?.trim());
    const es = edge ? getComputedStyle(edge) : null;
    return {
      edge: es && lum(es.stroke)! * +es.opacity,
      width: es ? parseFloat(es.strokeWidth) : 0,
      border: card ? lum(getComputedStyle(card).borderColor)! : null,
      label: label ? lum(getComputedStyle(label).color)! : null,
    };
  }, [lum.toString()]);
  expect(res.label).toBeGreaterThan(res.border!);
  expect(res.border!).toBeGreaterThan(res.edge!);
  expect(res.width).toBeGreaterThanOrEqual(1.5);
  expect(res.width).toBeLessThanOrEqual(2);
});

// B5 (contract §8.2) – U1 owns node anatomy.
test.fixme("ports are visible, sized 12-16px, and typed on agents and gates", async ({ page }) => {
  await opened(page, "map");
  const ports = page.locator('[data-testid^="port-"]');
  await expect(ports.first()).toBeVisible({ timeout: 10_000 });
  const box = await ports.first().boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(MIN_PORT_PX);
  expect(box!.width).toBeLessThanOrEqual(16);
  const agent = page.locator('[data-testid="canvas-node"][data-kind="agent"]').first();
  await expect(agent).toBeVisible();
  for (const kind of AGENT_PORTS) await expect(agent.locator(`[data-testid="port-${kind.toLowerCase()}"]`)).toBeVisible();
  const gate = page.locator('[data-testid="canvas-node"][data-kind="gate"]').first();
  await expect(gate).toBeVisible();
  for (const kind of ["pass", "fail"]) await expect(gate.locator(`[data-testid="port-${kind}"]`)).toBeVisible();
  // hit target: the port's interactive wrapper is >= 24px even if the dot is 14
  const target = await agent.locator('[data-testid="port-model"]').evaluate((el) => {
    const wrap = el.closest("[class*=hit], [class*=port]") ?? el;
    const r = wrap.getBoundingClientRect();
    return Math.max(r.width, r.height);
  });
  expect(target).toBeGreaterThanOrEqual(MIN_TARGET_PX);
});

// Semantic zoom (contract §8.3) – U1 owns node anatomy.
test.fixme("default zoom shows name, role and counts; resizing a block shows its function list", async ({ page }) => {
  await opened(page, "map");
  const block = page.locator('[data-testid="canvas-node"][data-kind="block"]').first();
  await expect(block).toBeVisible({ timeout: 10_000 });
  await expect(block.getByText(/role/i)).toBeVisible();
  await expect(block.getByText(/\d+ (files?|symbols?)/)).toBeVisible();
  // far threshold: at scale < 0.55 the caption is under the tile, not inside
  const scale = await page.evaluate(() => {
    const n = document.querySelector('[data-testid="canvas-node"]');
    return n ? new DOMMatrix(getComputedStyle(n).transform).a : 1;
  });
  if (scale < FAR_MID_SCALE) await expect(block.locator("[class*=caption]")).toBeVisible();
  // resize forces near level with the function list
  const handle = block.locator("[class*=resize], [data-testid=node-resize]").first();
  const before = await block.boundingBox();
  await handle.dragTo(page.locator("body"), { targetPosition: { x: (before?.x ?? 0) + 260, y: (before?.y ?? 0) + 300 } });
  await expect(block.locator("[class*=functions] li").first()).toBeVisible();
});

// B1 + B2 (contract §8.4) – engine layout + U1 edges.
test.fixme("crossings stay at or below 5% and no edge passes through a node", async ({ page }) => {
  test.setTimeout(60_000);
  await opened(page, "map");
  const bench = await page.evaluate(() => {
    const q = (s: string) => [...document.querySelectorAll(s)];
    const edges = q(".react-flow__edge-path, [data-testid=canvas-edge] path");
    const nodes = q('[data-testid="canvas-node"]');
    const segs = edges.map((p) => {
      const L = p.getTotalLength();
      const n = Math.max(4, Math.ceil(L / 25));
      const out: [number, number][] = [];
      for (let i = 0; i <= n; i++) { const pt = p.getPointAtLength((L * i) / n); out.push([pt.x, pt.y]); }
      return out;
    });
    const o = (p: number[], a: number[], b: number[]) => Math.sign((a[0] - p[0]) * (b[1] - p[1]) - (a[1] - p[1]) * (b[0] - p[0]));
    const x = (a: number[], b: number[], c: number[], d: number[]) => o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
    let crossings = 0;
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
      let hit = false;
      for (let s = 0; s < segs[i].length - 1 && !hit; s++) for (let t = 0; t < segs[j].length - 1; t++) if (x(segs[i][s], segs[i][s + 1], segs[j][t], segs[j][t + 1])) { hit = true; break; }
      if (hit) crossings++;
    }
    const pairs = (edges.length * (edges.length - 1)) / 2 || 1;
    const boxes = nodes.map((n) => n.getBoundingClientRect());
    let through = 0;
    edges.forEach((p) => {
      const L = p.getTotalLength();
      const m = p.getScreenCTM();
      if (!m) return;
      for (let i = 2; i < 18; i++) {
        const pt = p.getPointAtLength((L * i) / 20);
        const sx = pt.x * m.a + m.e, sy = pt.y * m.d + m.f;
        if (boxes.some((b) => sx > b.left + 4 && sx < b.right - 4 && sy > b.top + 4 && sy < b.bottom - 4)) { through++; break; }
      }
    });
    return { ratio: crossings / pairs, through, edges: edges.length };
  });
  expect(bench.ratio, `crossing ratio ${bench.ratio} over ${bench.edges} edges`).toBeLessThanOrEqual(MAX_CROSSING_RATIO);
  expect(bench.through).toBe(0);
});

// Focus dim (contract §8.5) – U3 owns actors on the terrain.
test.fixme("selecting an agent draws its fence hull and dims non-fenced blocks to 35%", async ({ page }) => {
  await opened(page, "map", FIXTURE);
  const agent = page.locator('[data-testid="canvas-node"][data-kind="agent"]').first();
  await expect(agent).toBeVisible({ timeout: 10_000 });
  await agent.click();
  await expect(page.locator('[data-testid="fence-hull"]')).toBeVisible();
  const opacities = await page.evaluate(() => [...document.querySelectorAll('[data-testid="canvas-node"][data-kind="block"]')].map((n) => +getComputedStyle(n).opacity));
  const fenced = opacities.filter((o) => o > DIM_NON_FENCED);
  expect(fenced.length, `${fenced.length} of ${opacities.length} blocks above ${DIM_NON_FENCED} – fenced blocks should be bright, the rest dim`).toBeGreaterThan(0);
  for (const o of opacities) expect(o === 1 || o <= DIM_NON_FENCED, `opacity ${o} is in the dead zone between fenced and dim`).toBeTruthy();
});

// Add flow (contract §8.6) – U2 owns the rail, U3 the port stubs.
test.fixme("rail + and output-port + open the inspector add form; no global add-block button", async ({ page }) => {
  await opened(page, "map");
  const rail = page.locator('[data-testid="map-rail-add"]');
  await expect(rail).toBeVisible();
  await rail.click();
  await expect(page.locator('[data-testid="map-inspector"] [data-testid="add-form"]')).toBeVisible();
  // output-port + stub opens the same form
  await page.keyboard.press("Escape");
  const stub = page.locator('[data-testid^="port-"] [data-testid="port-add"]').first();
  await expect(stub).toBeVisible();
  await stub.click();
  await expect(page.locator('[data-testid="map-inspector"] [data-testid="add-form"]')).toBeVisible();
  expect(await page.getByTestId("add-block-global").count()).toBe(0);
});

// Layers + segmented control (contract §8.7) – U2 owns the layer toggle.
test.fixme("one layer toggle with the six layers and defaults, plus the Map Runs Evals segmented control", async ({ page }) => {
  await opened(page, "map");
  const toggle = page.locator('[data-testid="map-layers"]');
  await expect(toggle).toBeVisible();
  for (const layer of LAYERS) await expect(toggle.getByText(layer, { exact: true })).toBeVisible();
  const on = await toggle.locator("[aria-pressed=true]").allTextContents();
  expect(on.sort()).toEqual(["Agents", "Blocks", "Runs"]);
  const seg = page.locator('[data-testid="workspace-modes"]');
  await expect(seg).toBeVisible();
  for (const mode of ["Map", "Runs", "Evals"]) await expect(seg.getByText(mode, { exact: true })).toBeVisible();
  await expect(seg.getByText("Map", { exact: true })).toHaveAttribute("aria-pressed", "true");
});

// Search behaviour (contract §8.8) – U2 owns search.
test.fixme("search moves the camera to the hit and never re-lays-out", async ({ page }) => {
  await opened(page, "map");
  const positions = async () => await page.evaluate(() => {
    const n = document.querySelector('[data-testid="canvas-node"]');
    return n ? n.getBoundingClientRect().toJSON() : null;
  });
  const before = await positions();
  const search = page.locator('[data-testid="map-rail-search"]');
  await expect(search).toBeVisible();
  await search.click();
  await page.locator('[data-testid="map-search-input"]').fill("server");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  const after = await positions();
  expect(after && before && (after.x !== before.x || after.y !== before.y), "camera should move to the search hit").toBe(true);
  // node size is unchanged: a re-layout resizes, a camera move does not
  if (before && after) {
    expect(Math.abs(after.width - before.width)).toBeLessThan(1);
    expect(Math.abs(after.height - before.height)).toBeLessThan(1);
  }
});

// B8 (contract §8.9) – U2 + engine own position persistence.
test.fixme("reloading with no code change moves no node (positions are persisted)", async ({ page }) => {
  await opened(page, "map");
  const grab = async () => await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[data-testid="canvas-node"]')];
    return ids.map((n) => {
      const r = n.getBoundingClientRect();
      return [n.getAttribute("data-node-id"), Math.round(r.x), Math.round(r.y)];
    });
  });
  const before = await grab();
  await page.reload();
  await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(1200);
  const after = await grab();
  const moved = after.filter(([id, x, y]) => {
    const b = before.find((p) => p[0] === id);
    return b && (Math.abs((b[1] as number) - (x as number)) > 1 || Math.abs((b[2] as number) - (y as number)) > 1);
  });
  expect(moved, `moved after reload: ${JSON.stringify(moved)}`).toEqual([]);
});

// Verbs + chrome removal (contract §8.10) – U1 owns the toolbar.
test.fixme("hover toolbar shows the contract verbs and the leftover chrome rows are gone", async ({ page }) => {
  await opened(page, "map");
  const node = page.locator('[data-testid="canvas-node"]').first();
  await node.hover();
  const toolbar = page.locator('[data-testid="node-toolbar"]');
  await expect(toolbar).toBeVisible();
  for (const verb of VERBS) await expect(toolbar.getByText(verb, { exact: true })).toBeVisible();
  const text = await page.locator("body").textContent() ?? "";
  expect(text).not.toContain("re-layout");
  expect(text).not.toContain("EXECUTES");
});

// Ask gate (contract §8.11) – U4 owns run supervision.
test.fixme("ask gate docks above the transport with three answers and keys 1/2/3, not a modal", async ({ page }) => {
  await opened(page, "map", FIXTURE);
  const transport = page.locator('[data-testid="run-transport"]');
  await expect(transport).toBeVisible({ timeout: 10_000 });
  // trigger an ask (the fixture's agent asks before writes outside tests)
  const run = page.locator('[data-testid="transport-run"]');
  if (await run.isVisible()) await run.click();
  const gate = page.locator('[data-testid="ask-gate"]');
  await expect(gate).toBeVisible({ timeout: 20_000 });
  const box = await gate.boundingBox();
  const tbox = await transport.boundingBox();
  expect(box && tbox && Math.abs(box.y + box.height - tbox.y) < 40, `ask gate at ${box?.y} is not docked above the transport at ${tbox?.y}`).toBe(true);
  for (const answer of ["Allow once", "Allow for run", "Deny"]) await expect(gate.getByText(answer, { exact: true })).toBeVisible();
  // keys 1/2/3 answer it; no modal overlay intercepts the map
  await page.keyboard.press("1");
  await expect(gate).toBeHidden();
  expect(await page.locator("[class*=modal], [class*=overlay][data-testid=modal]").count()).toBe(0);
});
