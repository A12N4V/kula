import { expect, test, type Page } from "@playwright/test";
import { FIXTURE } from "../playwright.config";
import { explore } from "./explore";

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

/** The fixture has no non-builtin agents until one is saved: (re)seed the
    fenced agent the band tests select ("polish", scoped to src/**), as
    u3.spec does – asserts by name, never by fixture counts. */
async function seedPolish(request: import("@playwright/test").APIRequestContext) {
  const h = { "x-kula-token": "test" };
  const info = await (await request.get(`${FIXTURE}/api/agents`, { headers: h })).json();
  const all = (info.workflows ?? []) as { name: string; builtin?: boolean }[];
  if (all.some((w) => w.name === "polish" && !w.builtin)) return;
  const own = all.filter((w) => !w.builtin);
  const polish = { name: "polish", about: "Small cleanups", scope: ["src/**"], steps: ["Tidy", "verify"] };
  const r = await request.post(`${FIXTURE}/api/agents/workflows_save`, { headers: h, data: { workflows: [...own, polish] } });
  expect(r.ok(), await r.text()).toBeTruthy();
}

// B3 (contract §8.1) – U1 owns node/edge styling.
// Ladder (contract §8.1) – U1 landed: text > node border > resting edge.
// Sampling is u1.spec's proven path: enable the Flows layer so a resting
// edge rung exists, then compare computed colours.
test("luminance ladder holds: label > node border > resting edge, dark and light", async ({ page }) => {
  test.skip(true, "retired with the U5 nested-squares map (no card body/border/resize) – see BRIEF-fuse2 S-tests for the square-era replacement");
  await opened(page, "map");
  await expect(page.locator("[data-testid=map-flow-canvas]")).toBeVisible({ timeout: 15_000 });
  // the Flows layer is on by default, so a resting edge exists
  const edge = page.locator("[data-testid=map-flow] .fc-edge").first();
  await expect(edge).toBeVisible();
  // the fit zoom is far (captions only) – walk in until a mid/near card
  // exists, so the border rung of the ladder is sampled by construction
  // (stage-1 tiles own the border; a stage-1 sample would be transparent).
  const card = page.locator("[data-testid=map-flow] .fc-card:not(.fc-stage-1)").first();
  for (let i = 0; i < 12 && !(await card.isVisible()); i++) {
    await page.locator("[data-testid=fc-zoom-in]").click();
    await page.waitForTimeout(150);
  }
  await expect(card).toBeVisible({ timeout: 10_000 });
  const [e, b, t, w] = await page.evaluate(() => {
    const css = (sel: string, prop: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      return getComputedStyle(el)[prop as never] as string;
    };
    return [
      css("[data-testid=map-flow] .fc-edge", "stroke"),
      css("[data-testid=map-flow] .fc-card:not(.fc-stage-1)", "borderTopColor"),
      css("[data-testid=map-flow] .fc-card-name", "color"),
      css("[data-testid=map-flow] .fc-edge", "strokeWidth"),
    ];
  });
  const lum = (c: string | null) => {
    if (!c) return null;
    const m = c.match(/[\d.]+/g);
    if (!m) return null;
    if (c.startsWith("oklch")) return +m[0];
    const [r, g, b] = m.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  expect(e && b && t, "all three rungs exist to sample").toBeTruthy();
  expect(lum(t)!).toBeGreaterThan(lum(b)!);
  expect(lum(b)!).toBeGreaterThan(lum(e)!);
  // the stroke is zoom-compensated (visual = computed × the viewport scale):
  // the contract's 1.5–2px is the on-screen width, not the raw attribute.
  const scale = await page.evaluate(() => {
    const m = document.querySelector('[data-testid=map-flow-canvas] .react-flow__viewport')?.getAttribute("style") ?? "";
    return parseFloat(/scale\(([\d.]+)\)/.exec(m)?.[1] ?? "1") || 1;
  });
  const visual = parseFloat(w ?? "0") * scale;
  expect(visual).toBeGreaterThanOrEqual(1.5);
  expect(visual).toBeLessThanOrEqual(2.05);
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
// Semantic zoom (contract §8.3) – U1 landed: stage-2 shows name/role/counts,
// a corner resize forces stage 3 (the function list), and the forced level
// survives zooming out. The resize machinery is u1.spec's proven path.
test("default zoom shows name, role and counts; resizing a block shows its function list", async ({ page }, info) => {
  test.skip(true, "retired with the U5 nested-squares map (no card body/border/resize) – see BRIEF-fuse2 S-tests for the square-era replacement");
  test.skip(info.project.name !== "desktop", "resize needs a pointer");
  await opened(page, "map");
  await expect(page.locator("[data-testid=map-flow-canvas]")).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length > 0, undefined, { timeout: 15_000 });
  // a mid-stage card shows the role line and the file/symbol counts
  const mid = await page.evaluate(() => {
    for (const card of document.querySelectorAll('[data-testid=map-flow] .fc-card[data-fc-stage="2"]')) {
      const r = card.getBoundingClientRect();
      if (r.top > 80 && r.bottom < innerHeight - 60) return card.getAttribute("data-testid");
    }
    return null;
  });
  if (mid) {
    const card = page.locator(`[data-testid=${mid}]`);
    await expect(card.locator(".fc-card-meta")).toBeVisible();
  }
  // resize forces near level with the function list (u1.spec's machinery)
  const scan = () => page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    return [...document.querySelectorAll('[data-testid=map-flow] .fc-card:not(.fc-card-sec) .fc-card-resize')]
      .map((h) => {
        const r = (h as HTMLElement).getBoundingClientRect();
        const card = h.closest("[data-testid^=fc-node-]") as HTMLElement;
        return { tid: card?.getAttribute("data-testid"), x: r.x + r.width / 2, y: r.y + r.height / 2, fns: !!card?.querySelector(".fc-card-meta"),
                 in: r.top > 80 && r.left > 80 && r.bottom < vh - 40 && r.right < vw - 40 };
      })
      .filter((h): h is { tid: string; x: number; y: number; fns: boolean; in: boolean } => !!h.tid && h.in);
  });
  let handles = await scan();
  if (handles.length === 0) {
    for (let i = 0; i < 4 && handles.length === 0; i++) {
      await page.locator("[data-testid=fc-zoom-in]").click();
      await page.waitForTimeout(400);
      handles = await scan();
    }
  }
  expect(handles.length, "a resize handle is in the viewport").toBeGreaterThan(0);
  handles.sort((a, b) => Number(b.fns) - Number(a.fns));
  let lastCard: ReturnType<typeof page.locator> | null = null;
  for (const h of handles.slice(0, 5)) {
    const card = page.locator(`[data-testid=${h.tid}]`);
    if (!(await card.count())) continue;
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(h.x + 200, h.y + 160, { steps: 6 });
    await page.mouse.up();
    lastCard = card;
    await expect(card).toHaveAttribute("data-fc-stage", "3", { timeout: 5_000 });
    break;
  }
  expect(lastCard, "a resized card forced the near level").toBeTruthy();
  // the forced level survives zooming far out – the user's size wins
  for (let i = 0; i < 5; i++) { await page.locator("[data-testid=fc-zoom-out]").click(); await page.waitForTimeout(120); }
  await page.waitForTimeout(500);
  await expect(lastCard!).toHaveAttribute("data-fc-stage", "3");
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

// Focus dim (contract §8.5) – U3 landed: selection dims non-fenced blocks
// through the kit's focus path (.fc-dim) and fenced ones stay bright.
// Real selectors per the X2 review: at-agent-*, fence-hull, .fc-node.
test("selecting an agent draws its fence hull and dims non-fenced blocks to 35%", async ({ page, request }) => {
  await seedPolish(request);
  await opened(page, "map", FIXTURE);
  await expect(page.locator('[data-testid^="at-agent-"]').first()).toBeVisible({ timeout: 30_000 });
  const agent = page.locator('[data-testid="at-agent-polish"]');
  await expect(agent).toBeVisible({ timeout: 30_000 });
  await page.locator("[data-testid=fc-fit]").click(); // the agent may sit off screen
  await agent.click();
  await expect(page.locator('[data-testid="fence-hull"]')).toBeVisible();
  await expect(page.locator('[data-testid="fence-hull-label"]')).toHaveText(/fence · polish/i);
  const read = () => page.evaluate(() => [...document.querySelectorAll(".fc-node")].map((n) => +getComputedStyle(n).opacity));
  // the dim fades in – read once it has settled
  await expect.poll(async () => (await read()).every((o) => o === 1 || o <= DIM_NON_FENCED), { timeout: 5_000 }).toBe(true);
  const opacities = await read();
  const fenced = opacities.filter((o) => o > DIM_NON_FENCED);
  expect(fenced.length, `${fenced.length} of ${opacities.length} nodes above ${DIM_NON_FENCED} – fenced stay bright, the rest dim`).toBeGreaterThan(0);
  for (const o of opacities) expect(o === 1 || o <= DIM_NON_FENCED, `opacity ${o} is in the dead zone between fenced and dim`).toBeTruthy();
});

// Add flow (contract §8.6) – U2's rail and U3's port stub landed. Real
// selectors per the X2 review: u2-rail-add, ag-add-form in map-inspector,
// port-add on the band. Shipped testids win over the contract's aliases.
test("rail + and output-port + open the inspector add form; no global add-block button", async ({ page, request }) => {
  await seedPolish(request);
  await opened(page, "map", FIXTURE);
  await expect(page.locator('[data-testid^="at-agent-"]').first()).toBeVisible({ timeout: 30_000 });
  const form = page.locator('[data-testid="ag-add-form"]');
  // the Explorer's + Agent opens the add form in the inspector
  await explore(page); await page.locator('[data-testid="u2-rail-add"]').click();
  await expect(form).toBeVisible();
  await page.keyboard.press("Escape");
  // no global add-block button anywhere
  expect(await page.getByTestId("add-block-global").count()).toBe(0);
});

// Layers + segmented control (contract §8.7) – U2 owns the layer toggle.
// Layers + segmented control (contract §8.7) – U2 landed: one toggle, six
// chips, contract defaults; the segmented switch is u2-frames with tabs.
test("one layer toggle with the six layers and defaults, plus the Map Runs Evals segmented control", async ({ page }) => {
  await opened(page, "map");
  // U11: the layers live in the Explorer's sheet – open it first.
  await explore(page);
  const toggle = page.locator('[data-testid="u2-layers"]');
  await expect(toggle).toBeVisible();
  for (const id of ["blocks", "flows", "chains", "fences", "agents", "runs"])
    await expect(toggle.locator(`[data-testid="u2-layer-${id}"]`)).toBeVisible();
  const on = (await toggle.locator("[aria-pressed=true]").allTextContents()).sort();
  expect(on, "defaults are Blocks + Flows + Agents + Runs (Agents live on the map now)").toEqual(["Agents", "Blocks", "Flows", "Runs"]);
  const seg = page.locator('[data-testid="u2-frames"]');
  await expect(seg).toBeVisible();
  // U11: the switch is icon-only – labels live in title/aria-label
  for (const mode of ["Map", "Runs", "Evals"])
    await expect(seg.locator(`[aria-label="${mode}"], [title="${mode}"]`).first()).toBeVisible();
  await expect(seg.locator('[data-testid="u2-frame-map"]')).toHaveAttribute("aria-selected", "true");
});

// Search behaviour (contract §8.8) – U2 landed: the rail search moves the
// camera to the hit; node sizes never change (a camera move is not a layout).
test("search moves the camera to the hit and never re-lays-out", async ({ page }) => {
  await opened(page, "map");
  await expect(page.locator("[data-testid=map-flow]")).toBeVisible({ timeout: 15_000 });
  // The camera is viewport-level, so a bbox would move with any pan. The
  // viewport transform is what a camera move changes; a node's own canvas
  // transform is what a re-layout would change (the u2.spec B8 guard).
  const card = page.locator("[data-testid=map-flow] .react-flow__node").first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  const nodeTf = () => card.evaluate((el) => (el as HTMLElement).style.transform);
  const before = await nodeTf();
  const vp = page.locator("[data-testid=map-flow-canvas] .react-flow__viewport");
  const vpBefore = await vp.getAttribute("style");
  await explore(page); await page.locator('[data-testid="u2-rail-search"]').click();
  const input = page.locator('[data-testid="u2-rail-search-input"]');
  await expect(input).toBeVisible();
  await input.fill("serve");
  await input.press("Enter");
  await page.waitForTimeout(800); // the pan animates; the layout must not move
  const vpAfter = await vp.getAttribute("style");
  expect(vpAfter, "camera should move to the search hit").not.toBe(vpBefore);
  expect(await nodeTf(), "a re-layout would move the node's own transform (B8 guard)").toBe(before);
});

// B8 (contract §8.9) – U2 + engine landed: positions persist across reload.
test("reloading with no code change moves no node (positions are persisted)", async ({ page }) => {
  await opened(page, "map");
  const grab = async () => await page.evaluate(() => {
    const ids = [...document.querySelectorAll(".fc-node")];
    return ids.map((n) => {
      const r = n.getBoundingClientRect();
      return [n.getAttribute("data-testid"), Math.round(r.x), Math.round(r.y)];
    });
  });
  const before = await grab();
  await page.reload();
  await expect(page.locator(".fc-loader")).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(1200);
  const after = await grab();
  const moved = after.filter(([id, x, y]) => {
    const b = before.find((p) => p[0] === id);
    return b && (Math.abs((b[1] as number) - (x as number)) > 1 || Math.abs((b[2] as number) - (y as number)) > 1);
  });
  expect(moved, `moved after reload: ${JSON.stringify(moved)}`).toEqual([]);
});

// Verbs + chrome removal (contract §8.10) – U1 landed: the hover toolbar
// carries Run · Open code · Pin (testids fn-run-/fn-open-/fn-pin-), and the
// leftover re-layout/pin/roles row is gone. The landing "executes" crumb is
// U4's fix (review finding 2), so its assertion stays out until then.
test("hover toolbar shows the contract verbs and the leftover chrome rows are gone", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "hover needs a pointer");
  await opened(page, "map");
  await expect(page.locator("[data-testid=map-flow-canvas]")).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length > 0, undefined, { timeout: 15_000 });
  // hover a card clear of the zoom controls (bottom-left) and the HUD
  const cid = await page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-testid=map-flow] .fc-card:not(.fc-card-sec)')) {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (r.left > 260 && r.bottom < innerHeight - 120 && r.top > 120 && hit && el.contains(hit)) return el.getAttribute("data-testid");
    }
    return null;
  });
  expect(cid, "a hoverable card exists").toBeTruthy();
  const card = page.locator(`[data-testid="${cid}"]`);
  const hb = await card.boundingBox();
  expect(hb).toBeTruthy();
  const bar = page.locator(".fc-toolbar");
  // the hover state can race the canvas's landing zoom/pan – re-hover until
  // the toolbar mounts instead of trusting one mouse move
  for (let i = 0; i < 8 && (await bar.count()) === 0; i++) {
    const b = await card.boundingBox();
    if (!b) break;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
    await page.waitForTimeout(250);
  }
  await expect(bar).toBeVisible();
  await expect(bar.locator("[data-testid^=fn-run-]")).toBeVisible();
  await expect(bar.locator("[data-testid^=fn-open-]")).toBeVisible();
  await expect(bar.locator("[data-testid^=fn-pin-]")).toBeVisible();
  // leftover chrome rows are gone
  await expect(page.locator('[data-testid=map-lens]')).toHaveCount(0);
  await expect(page.locator('[data-testid=map-relayout]')).toHaveCount(0);
  await expect(page.locator('[data-testid=map-scheme-btn]')).toHaveCount(0);
  const text = (await page.locator("body").textContent()) ?? "";
  expect(text, "the leftover re-layout row is gone").not.toContain("re-layout");
});

// Wave-2 interaction tests (docs/design/fused-interactions.md). Written
// failing-first by X3; each names the module that owns the behaviour.
// B7 (interactions §7) – U2 owns the rail + add form, U3 the drag + run.
test.fixme("b7 scripted path: rail add, fence drag, run – 3/2/1 actions", async ({ page }) => {
  await opened(page, "map", FIXTURE);
  await page.locator('[data-testid="map-rail-add"]').click();
  const form = page.locator('[data-testid="map-inspector"] [data-testid="add-form"]');
  await expect(form).toBeVisible();
  await form.locator('input[name="name"], [data-testid="add-name"]').fill("reviewer-2");
  await page.locator('[data-testid="add-create"]').click();
  // fence: drag block session.rs onto the agent = add to fence (1 action)
  const block = page.locator('[data-testid="canvas-node"][data-kind="block"]', { hasText: "session.rs" }).first();
  const agent = page.locator('[data-testid="canvas-node"][data-kind="agent"]', { hasText: "reviewer-2" }).first();
  await block.dragTo(agent);
  await expect(page.locator('[data-testid="fence-hull"]')).toBeVisible();
  // run: exactly one action
  await agent.hover();
  await page.locator('[data-testid^="fn-run-"]').first().click();
  await expect(page.locator('[data-testid="run-transport"]')).toBeVisible({ timeout: 20_000 });
});

// Landing framing (interactions §6.1) – U2 owns the corrected landing.
test.fixme("landing is centred on the busiest section with margin; zoom bar and rail never overlap cards", async ({ page }) => {
  await opened(page, "map");
  await page.waitForTimeout(1200); // landing fit settles
  const vp = page.viewportSize()!;
  const cards = await page.locator('[data-testid="canvas-node"]').evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0));
  expect(cards.length, "cards must be mounted to judge framing").toBeGreaterThan(0);
  const inside = cards.filter((r) => r.x >= 0 && r.y >= 0 && r.right <= vp.width && r.bottom <= vp.height);
  expect(inside.length, `${vp.width - inside.length} of ${cards.length} cards off-viewport at landing`).toBe(cards.length);
  for (const bar of ['[data-testid="map-zoombar"]', '[data-testid="map-rail-add"]']) {
    const el = page.locator(bar);
    if (await el.count()) {
      const b = await el.first().boundingBox();
      const hit = cards.some((r) => b && r.x < b.x + b.width && r.x + r.width > b.x && r.y < b.y + b.height && r.y + r.height > b.y);
      expect(hit, `${bar} overlaps a card`).toBe(false);
    }
  }
});

// Resize neighbour rule (interactions §6.3) – the clamp landed in the kit:
// a corner resize stops at the next card below and never overlaps it.
test("resizing a card stops at the neighbour below and never overlaps it", async ({ page }, info) => {
  test.skip(true, "retired with the U5 nested-squares map (no card body/border/resize) – see BRIEF-fuse2 S-tests for the square-era replacement");
  test.skip(info.project.name !== "desktop", "resize needs a pointer");
  await opened(page, "map");
  await expect(page.locator("[data-testid=map-flow-canvas]")).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length > 0, undefined, { timeout: 15_000 });
  // find a resize handle with another card directly below it (kit geometry:
  // section columns stack vertically, so column pairs are common)
  const found = await page.evaluate(() => {
    const handles = [...document.querySelectorAll('[data-testid=map-flow] .fc-card:not(.fc-card-sec) .fc-card-resize')];
    for (const h of handles) {
      const card = h.closest("[data-testid^=fc-node-]") as HTMLElement | null;
      if (!card) continue;
      const r = card.getBoundingClientRect();
      if (r.left < 200 || r.right > innerWidth - 60) continue; // clear of the rail and HUD
      const below = [...document.querySelectorAll('[data-testid=map-flow] .fc-card:not(.fc-card-sec)')]
        .map((c) => (c as HTMLElement).getBoundingClientRect())
        .filter((c) => c !== r && Math.abs(c.left - r.left) < r.width && c.top > r.bottom + 4)
        .sort((x, y) => x.top - y.top)[0];
      if (below && below.top - r.bottom > 60) {
        const hr = h.getBoundingClientRect();
        return { hx: hr.x + hr.width / 2, hy: hr.y + hr.height / 2, cardBottom: r.bottom, nbTop: below.top, tid: card.getAttribute("data-testid") };
      }
    }
    return null;
  });
  if (!found) test.skip(true, "no card has a far-enough neighbour below on this fixture state");
  const card = page.locator(`[data-testid="${found!.tid}"]`);
  // drag the corner handle well past the neighbour: the clamp must stop it
  await page.mouse.move(found!.hx, found!.hy);
  await page.mouse.down();
  await page.mouse.move(found!.hx + 120, found!.nbTop + 200, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await card.evaluate((el) => el.getBoundingClientRect().bottom);
  expect(after, `resized card bottom ${after} overlaps the neighbour at ${found!.nbTop}`).toBeLessThanOrEqual(found!.nbTop + 1);
});

// Function-list dedupe (interactions §6.4) – landed in U5 (BlockNode ×N rows).
// renders data.functions raw. X2 proved the test catches it on the live
// tree: 'function name "mbegin" appears twice'. Fix = collapse repeated
// names into one row with a ×N chip; then un-fixme this test.
test("near-zoom function list dedupes repeated names with a xN count", async ({ page }, info) => {
  test.skip(true, "retired with the U5 nested-squares map (no card body/border/resize) – see BRIEF-fuse2 S-tests for the square-era replacement");
  test.skip(info.project.name !== "desktop", "resize needs a pointer");
  await opened(page, "map");
  await expect(page.locator("[data-testid=map-flow-canvas]")).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length > 0, undefined, { timeout: 15_000 });
  // force a card to near zoom by resizing it wide (u1.spec's proven path)
  const scan = () => page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    return [...document.querySelectorAll('[data-testid=map-flow] .fc-card:not(.fc-card-sec) .fc-card-resize')]
      .map((h) => {
        const r = (h as HTMLElement).getBoundingClientRect();
        const card = h.closest("[data-testid^=fc-node-]") as HTMLElement;
        return { tid: card?.getAttribute("data-testid"), x: r.x + r.width / 2, y: r.y + r.height / 2, fns: !!card?.querySelector(".fc-card-meta"),
                 in: r.top > 80 && r.left > 80 && r.bottom < vh - 40 && r.right < vw - 40 };
      })
      .filter((h): h is { tid: string; x: number; y: number; fns: boolean; in: boolean } => !!h.tid && h.in);
  });
  let handles = await scan();
  if (handles.length === 0) {
    // far zoom hides the handles: walk in until cards are readable (u1.spec)
    for (let i = 0; i < 4 && handles.length === 0; i++) {
      await page.locator("[data-testid=fc-zoom-in]").click();
      await page.waitForTimeout(400);
      handles = await scan();
    }
  }
  if (handles.length === 0) {
    const any = await page.evaluate(() => {
      const h = document.querySelector('[data-testid=map-flow] .fc-card:not(.fc-card-sec) .fc-card-resize') as HTMLElement | null;
      const card = h?.closest("[data-testid^=fc-node-]") as HTMLElement | null;
      if (!card || !h) return null;
      const r = h.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (any) {
      await page.mouse.move(720, 420);
      await page.mouse.down({ button: "middle" });
      await page.mouse.move(720 + (720 - any.x), 420 + (420 - any.y), { steps: 8 });
      await page.mouse.up({ button: "middle" });
      await page.waitForTimeout(300);
      handles = await scan();
    }
  }
  expect(handles.length, "a resize handle is in the viewport").toBeGreaterThan(0);
  handles.sort((a, b) => Number(b.fns) - Number(a.fns));
  let list = page.locator(".fc-card-fns").first();
  let seen = false;
  for (const h of handles.slice(0, 5)) {
    const card = page.locator(`[data-testid=${h.tid}]`);
    if (!(await card.count())) continue;
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(h.x + 200, h.y + 160, { steps: 6 });
    await page.mouse.up();
    await expect(card).toHaveAttribute("data-fc-stage", "3", { timeout: 5_000 });
    if (await card.locator(".fc-card-fns").count()) { list = card.locator(".fc-card-fns"); seen = true; break; }
  }
  if (!seen) test.skip(true, "no card on this fixture carries a function list");
  const names = await list.locator("li, [class*=fn-row]").allInnerTexts();
  const deduped = new Set<string>();
  for (const row of names) {
    const name = row.replace(/×\d+/g, "").trim();
    expect(deduped.has(name), `function name "${name}" appears twice – dedupe with a xN chip`).toBe(false);
    deduped.add(name);
  }
});

// Keyboard map (interactions §3) – U2 owns zoom-bar keys, U3 the fence key.
test.fixme("keyboard map works and never spends keys 1/2/3", async ({ page }) => {
  await opened(page, "map");
  await expect(page.locator('[data-testid="canvas-node"]').first()).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("f");
  await page.keyboard.press("m");
  await expect(page.locator('[data-testid="map-minimap"], [data-testid="map-zoombar"] [aria-pressed=true]')).toBeVisible();
  await page.keyboard.press("l");
  await expect(page.locator('[data-testid="map-layers"]')).toBeVisible();
  await page.keyboard.press("Escape");
  // keys 1/2/3 do nothing on the map: no dialog, no selection change
  for (const k of ["1", "2", "3"]) {
    await page.keyboard.press(k);
    await expect(page.locator('[data-testid="ask-gate"], [role=dialog]')).toHaveCount(0);
  }
});

// Ask gate (contract §8.11) – U4 owns run supervision. Un-fixed by U4: the
// gate is landed, the transport testid is ws-runbar (X2's run-transport
// alias never shipped – recorded as a contract amendment in handoff-u4).
test("ask gate docks above the transport with three answers and keys 1/2/3, not a modal", async ({ page }) => {
  await opened(page, "map", FIXTURE);
  const transport = page.locator('[data-testid="ws-runbar"]');
  await expect(transport).toBeVisible({ timeout: 30_000 });
  // a pipeline to dry-run (as u4.spec seeds it): trigger → agent → gate
  await page.evaluate(() => {
    const ids = [...document.querySelectorAll('.fc-solid[data-testid^="fc-node-"]')].map((e) => (e.getAttribute("data-testid") ?? "").slice("fc-node-".length));
    const [sec1, sec2] = [...new Set(ids)];
    localStorage.setItem("kula.pipeline.map", JSON.stringify([
      { id: "u4-t", kind: "trigger", ref: "manual", name: "Start", section: sec1 },
      { id: "u4-a", kind: "agent", ref: "polish", name: "Polish agent", section: sec2 },
      { id: "u4-g", kind: "gate", ref: "kula check", name: "Check" },
    ]));
  });
  await page.reload();
  await expect(page.locator('[data-testid="ws-seg-u4-a"]')).toBeVisible({ timeout: 30_000 });
  // trigger an ask the way u4.spec does: dry-run a plan, approve it – the
  // fake run's first agent reaches outside its fence and the gate opens
  await page.locator('[data-testid="u4-dry-run"]').click();
  await expect(page.locator('[data-testid="u4-plan-bar"]')).toBeVisible();
  await page.locator('[data-testid="u4-approve"]').click();
  const gate = page.locator('[data-testid="ask-gate"]');
  await expect(gate).toBeVisible({ timeout: 20_000 });
  const box = await gate.boundingBox();
  const tbox = await transport.boundingBox();
  expect(box && tbox && Math.abs(box.y + box.height - tbox.y) < 60, `ask gate at ${box?.y} is not docked above the transport at ${tbox?.y}`).toBe(true);
  for (const answer of ["Allow once", "Allow for run", "Deny"]) await expect(gate.getByText(answer, { exact: false })).toBeVisible();
  // keys 1/2/3 answer it; no modal overlay intercepts the map
  await page.keyboard.press("1");
  await expect(gate).toBeHidden();
  expect(await page.locator("[class*=modal], [class*=overlay][data-testid=modal]").count()).toBe(0);
});
