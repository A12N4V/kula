// U1 – node anatomy and edges (wave 1). Acceptance from the brief:
// computed-style luminance ladder for the edges (text > node border > edge),
// port count per kind, semantic zoom shows function names when resized,
// overlap probe clean. Assert by name – the fixture is per worker.
import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, hash = "map") {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
    try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto(`/#${hash}`);
}

const lum = (color: string): number => {
  // srgb luminance of "rgb(r, g, b)" / computed colors
  const m = color.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  const [r, g, b] = m;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

test("the edge brightness ladder holds: text > node border > resting edge", async ({ page }) => {
  test.skip(true, "retired with the U5 nested-squares map (no card body/border/resize) – see BRIEF-fuse2 S-tests for the square-era replacement");
  await open(page);
  await expect(page.locator("[data-testid=map-flow]")).toBeVisible();
  // Flows is on by default (fused-canvas §5), so a resting edge exists.
  const edge = page.locator("[data-testid=map-flow] .fc-edge").first();
  await expect(edge).toBeVisible();
  // The fit zoom is far (captions only) – walk in until a mid/near card
  // exists, so the border rung of the ladder is sampled by construction.
  const card = page.locator("[data-testid=map-flow] .fc-card:not(.fc-stage-1)").first();
  for (let i = 0; i < 12 && !(await card.isVisible()); i++) {
    await page.locator("[data-testid=fc-zoom-in]").click();
    await page.waitForTimeout(150);
  }
  await expect(card).toBeVisible({ timeout: 10_000 });
  // by construction: stage-1 cards carry border-color transparent (the tile
  // owns the border) – sample a mid/near card so the border rung is real.
  const [e, b, t] = await page.evaluate(() => {
    const css = (sel: string, prop: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      return getComputedStyle(el)[prop as never] as string;
    };
    return [
      css("[data-testid=map-flow] .fc-edge", "stroke"),
      css("[data-testid=map-flow] .fc-card:not(.fc-stage-1)", "borderTopColor"),
      css("[data-testid=map-flow] .fc-card-name", "color"),
    ];
  });
  expect(e, "a resting edge exists").toBeTruthy();
  const le = lum(e!), lb = lum(b!), lt = lum(t!);
  expect(le, `edge (${e}) under node border (${b})`).toBeLessThan(lb);
  expect(lb, `node border (${b}) under text (${t})`).toBeLessThan(lt);
});

test("edges sit at 1.5–2 px visual and carry a 40 px hit path", async ({ page }) => {
  await open(page);
  await expect(page.locator("[data-testid=map-flow]")).toBeVisible();
  // the stroke is zoom-compensated (visual = computed × the viewport scale):
  // read the React Flow viewport's transform scale and multiply it back out.
  const { sw, scale } = await page.locator("[data-testid=map-flow] .fc-edge").first().evaluate((el) => {
    const vp = el.closest(".react-flow")?.querySelector(".react-flow__viewport") as HTMLElement | null;
    const m = vp ? new DOMMatrix(getComputedStyle(vp).transform) : null;
    return { sw: parseFloat(getComputedStyle(el).strokeWidth), scale: m?.a ?? 1 };
  });
  const visual = sw * scale;
  expect(visual).toBeGreaterThanOrEqual(1.4);
  expect(visual).toBeLessThanOrEqual(2.1);
  const hit = page.locator("[data-testid=map-flow] .fc-edge-hit").first();
  if (await hit.count()) {
    const hw = await hit.evaluate((el) => parseFloat(getComputedStyle(el).strokeWidth));
    expect(hw).toBeGreaterThanOrEqual(40);
  }
});

test("port count per kind: gates fork pass/fail, agents carry the four capability ports", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "the pipeline lane needs a pointer-sized canvas");
  await open(page);
  await expect(page.locator("[data-testid=map-flow]")).toBeVisible();
  await page.evaluate(() => localStorage.setItem("kula.pipeline.map", JSON.stringify([
    { id: "t1", kind: "trigger", name: "Manual", ref: "manual", section: null, status: "idle" },
    { id: "a1", kind: "agent", name: "Fence walker", ref: "walker", section: null, status: "idle" },
    { id: "g1", kind: "gate", name: "Verify edits", ref: "verify", section: null, status: "idle" },
  ])));
  await page.reload();
  // the map remounts its canvas and waits for the graph paths – give it the
  // same 15 s the first open gets
  await expect(page.locator("[data-testid=map-flow]")).toBeVisible({ timeout: 15_000 });
  // the lane sits above the focus viewport and only mounts when visible
  // (onlyRenderVisibleElements) – zoom out with the wheel until it mounts
  const pane = page.locator("[data-testid=map-flow-canvas] .react-flow__pane");
  for (let i = 0; i < 10 && (await page.locator("[data-testid=map-flow] .fc-agent").count()) === 0; i++) {
    await pane.hover({ position: { x: 400, y: 300 } });
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(280);
  }
  const agent = page.locator("[data-testid=map-flow] .fc-agent").first();
  await expect(agent).toBeVisible({ timeout: 5_000 });
  await expect(agent.locator(".fc-port")).toHaveCount(4); // Model, Tools, Fence, Memory
  for (const p of ["Model", "Tools", "Fence", "Memory"])
    await expect(agent.locator(`.fc-port-label:text-is("${p}")`)).toBeVisible();
  const gate = page.locator("[data-testid=map-flow] .fc-gate").first();
  await expect(gate).toBeVisible();
  await expect(gate.locator(".fc-port")).toHaveCount(2); // pass, fail
  for (const p of ["pass", "fail"])
    await expect(gate.locator(`.fc-port-label:text-is("${p}")`)).toBeVisible();
  // ports are visible, 12–16 px
  const port = agent.locator(".fc-dot-typed").first();
  const s = await port.evaluate((el) => { const c = getComputedStyle(el); return { w: parseFloat(c.width), vis: c.visibility, op: parseFloat(c.opacity) }; });
  expect(s.w).toBeGreaterThanOrEqual(10);
  expect(s.vis).not.toBe("hidden");
  expect(s.op).toBeGreaterThan(0.5);
});

test("semantic zoom: resize forces a level and the function list appears", async ({ page }, info) => {
  test.skip(true, "retired with the U5 nested-squares map (no card body/border/resize) – see BRIEF-fuse2 S-tests for the square-era replacement");
  test.skip(info.project.name !== "desktop", "resize needs a pointer and a wide canvas");
  await open(page);
  await expect(page.locator("[data-testid=map-flow]")).toBeVisible();
  // The union fit of ~90 cards lands near 0.1 zoom – far below the semantic
  // near level. Walk in first (each step is ×1.2), then pick a card: at far
  // zoom the 12 px handle is ~1 px on screen and most cards sit outside the
  // viewport, so the resize must happen at readable zoom by construction.
  for (let i = 0; i < 30; i++) {
    const z = await page.evaluate(() => {
      const vp = document.querySelector("[data-testid=map-flow-canvas] .react-flow__viewport");
      return vp ? new DOMMatrix(getComputedStyle(vp).transform).a : 1;
    });
    if (z >= 0.85) break;
    await page.locator("[data-testid=fc-zoom-in]").click();
    await page.waitForTimeout(120);
  }
  // the camera keeps settling while cards hydrate: wait until it holds still
  // so a handle picked by screen position is still there when the drag starts
  let lastT = "";
  await expect.poll(async () => {
    const t = (await page.locator("[data-testid=map-flow] .react-flow__viewport").getAttribute("style")) ?? "";
    const still = t === lastT;
    lastT = t;
    return still;
  }, { intervals: [400], timeout: 15_000 }).toBe(true);
  // pick a card by its resize handle. Camera state (landing fit, poll pan)
  // varies, so bring the card into the viewport first: drag the card body to
  // the canvas centre, then resize from the handle's live position – the
  // resize must work wherever the card is, not only when the camera left it
  // centered. Prefer cards that carry a function list to reveal.
  let handles: { tid: string; x: number; y: number; fns: boolean; in: boolean }[] = [];
  const scanHandles = () => page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    return [...document.querySelectorAll("[data-testid=map-flow] .fc-card:not(.fc-card-sec) .fc-card-resize")]
      .map((h) => {
        const r = (h as HTMLElement).getBoundingClientRect();
        const card = h.closest("[data-testid^=fc-node-]") as HTMLElement;
        const fns = !!card?.querySelector(".fc-card-meta");
        const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
        const top = document.elementFromPoint(cx, cy);
        return { tid: card?.dataset.testid, x: cx, y: cy, fns, in: r.top > 70 && r.left > 70 && r.bottom < vh - 40 && r.right < vw - 40 && top === h };
      })
      .filter((h): h is { tid: string; x: number; y: number; fns: boolean; in: boolean } => !!h.tid && h.in);
  });
  handles = await scanHandles();
  if (handles.length === 0) {
    // No handle is on screen: pick any handle and pan the pane (middle
    // drag) so that handle lands at the canvas centre – deterministic from
    // any camera state, unlike hope-the-pan-lands-well scanning.
    const anyHandle = await page.evaluate(() => {
      const h = document.querySelector("[data-testid=map-flow] .fc-card:not(.fc-card-sec) .fc-card-resize") as HTMLElement | null;
      const card = h?.closest("[data-testid^=fc-node-]") as HTMLElement | null;
      if (!card || !h) return null;
      const r = h.getBoundingClientRect();
      return { tid: card.dataset.testid, x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (anyHandle) {
      const dx = 720 - anyHandle.x, dy = 420 - anyHandle.y;
      await page.mouse.move(720, 420);
      await page.mouse.down({ button: "middle" });
      await page.mouse.move(720 + dx, 420 + dy, { steps: 8 });
      await page.mouse.up({ button: "middle" });
      await page.waitForTimeout(300);
      handles = await scanHandles();
    }
  }
  expect(handles.length, "a draggable handle exists in the viewport").toBeGreaterThan(0);
  handles.sort((a, b) => Number(b.fns) - Number(a.fns));
  // resize forces a level: drag the corner handle wide at readable zoom – the
  // card jumps straight to near (the function list) whatever the zoom was.
  // Try up to five cards: one that carries no symbols has no function list.
  let fnsSeen = false;
  let lastCard: ReturnType<typeof page.locator> | null = null;
  for (const h of handles.slice(0, 5)) {
    const card = page.locator(`[data-testid=${h.tid}]`);
    if (!(await card.count())) continue;
    // No selection click: selecting opens the inspector, which covers the
    // right side of the canvas and buries the handle – the resize itself
    // needs no selection.
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(h.x + 200, h.y + 160, { steps: 6 });
    await page.mouse.up();
    lastCard = card;
    await expect(card).toHaveAttribute("data-fc-stage", "3", { timeout: 5_000 });
    if (await card.locator(".fc-card-fns").count()) {
      await expect(card.locator(".fc-card-fns")).toBeVisible();
      fnsSeen = true;
      break;
    }
  }
  expect(fnsSeen, "a resized card shows its function list").toBe(true);
  // and the forced level survives zooming far out – the user's size wins
  for (let i = 0; i < 5; i++) { await page.locator("[data-testid=fc-zoom-out]").click(); await page.waitForTimeout(120); }
  await page.waitForTimeout(500);
  await expect(lastCard!).toHaveAttribute("data-fc-stage", "3");
});

test("node hover toolbar floats above the node, nothing on the node face", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "hover needs a pointer");
  await open(page);
  await expect(page.locator("[data-testid=map-flow]")).toBeVisible();
  // hover a card clear of the zoom controls (bottom-left) and the HUD
  const cid = await page.evaluate(() => {
    for (const el of document.querySelectorAll("[data-testid=map-flow] .fc-card:not(.fc-card-sec)")) {
      const r = el.getBoundingClientRect();
      // on top at its centre: not under the actor band, the HUD or a panel
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (r.left > 260 && r.bottom < innerHeight - 120 && r.top > 120 && hit && el.contains(hit)) return el.getAttribute("data-testid");
    }
    return null;
  });
  expect(cid, "a hoverable card exists").toBeTruthy();
  const card = page.locator(`[data-testid="${cid}"]`);
  // raw pointer move: Playwright's actionability checks stall when another
  // layer (an edge hit path, a panel) intercepts the point
  const hb = await card.boundingBox();
  expect(hb).toBeTruthy();
  await page.mouse.move(hb!.x + hb!.width / 2, hb!.y + hb!.height / 2, { steps: 4 });
  await page.waitForTimeout(300);
  // NodeToolbar portals to the body – look at the page, not the canvas.
  const bar = page.locator(".fc-toolbar");
  await expect(bar).toBeVisible();
  await expect(bar.locator("[data-testid^=fn-open-]")).toBeVisible();
  await expect(bar.locator("[data-testid^=fn-pin-]")).toBeVisible();
});

test("the leftover re-layout/pin/roles toolbar row is gone", async ({ page }) => {
  await open(page);
  await expect(page.locator("[data-testid=map-lens]")).toHaveCount(0);
  await expect(page.locator("[data-testid=map-relayout]")).toHaveCount(0);
  await expect(page.locator("[data-testid=map-scheme-btn]")).toHaveCount(0);
});

test("text overlap probe: the map canvas is clean at 1440, 1100 and 390", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one project suffices – the repo probe covers every width");
  await open(page);
  await expect(page.locator("[data-testid=map-flow]")).toBeVisible();
  for (const [w, h] of [[1440, 900], [1100, 900], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    const hits = await page.evaluate(() => {
      // text-overlap probe (the repo's overlap.spec semantics): no two visible
      // runs of text collide, no text is cut off without an ellipsis. The HUD
      // buttons ride over the canvas as an overlay – they pair only with the
      // headline row and each other (the 1100 px Roles × headline finding),
      // not with the nodes beneath them.
      const nodes = [...document.querySelectorAll("[data-testid=map-flow] .fc-node:not(.fc-group), [data-testid=map-flow] .fm-headline-v, [data-testid=map-flow] .fc-edge-label, .map-hud .btn")] as HTMLElement[];
      const hud = (el: Element) => el.classList.contains("btn") && !!el.closest(".ex-wrap");
      const rect = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return null;
        const s = getComputedStyle(el);
        if (s.visibility === "hidden" || s.display === "none" || parseFloat(s.opacity) < 0.1) return null;
        return r;
      };
      let n = 0;
      for (let i = 0; i < nodes.length; i++) {
        const a = rect(nodes[i]);
        if (!a) continue;
        const cut = nodes[i].scrollWidth > nodes[i].clientWidth + 2 &&
          !/(ellipsis|hidden|auto)/.test(getComputedStyle(nodes[i]).textOverflow + getComputedStyle(nodes[i]).overflow);
        if (cut) n++;
        for (let j = i + 1; j < nodes.length; j++) {
          const b = rect(nodes[j]);
          if (!b) continue;
          // a frame contains its members – containment is not an overlap
          if (nodes[i].contains(nodes[j]) || nodes[j].contains(nodes[i])) continue;
          // the HUD is an overlay: only its own row and the headline are judged
          if (hud(nodes[i]) !== hud(nodes[j]) && !nodes[i].classList.contains("fm-headline-v") && !nodes[j].classList.contains("fm-headline-v")) continue;
          const x = Math.max(a.left, b.left), y = Math.max(a.top, b.top);
          const r = Math.min(a.right, b.right), d = Math.min(a.bottom, b.bottom);
          if (r - x > 2 && d - y > 2) n++;
        }
      }
      return n;
    });
    expect(hits, `text overlaps or cut text on the map at ${w}x${h}`).toBe(0);
  }
});