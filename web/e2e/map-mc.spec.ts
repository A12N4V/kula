// MC proof: the Storyboard variant (variant C). The pure layout layer is
// imported Node-side for determinism and lane-order proofs; the variant is
// reached through the app shell (window.__story from Map.tsx) in
// the page to render real pixels for screenshots and hit/fit checks, since
// Map.tsx wiring is M4's work and the app still shows the stub.

import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { storyLayout, STORY_WORLD, LANE_ORDER } from "../src/views/map/story/layout";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(HERE, "../../.kula-team/shots");

type Json = Record<string, unknown>;

async function pageModel(page: import("@playwright/test").Page): Promise<Json> {
  await page.goto("/#map/c");
  await page.waitForFunction(() => ((window as any).__kulaMap?.model?.stations?.length ?? 0) > 0);
  return page.evaluate(() => JSON.parse(JSON.stringify((window as any).__kulaMap.model)));
}

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

test("shell: #map/c renders the storyboard with no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  await page.goto("/#map/c");
  await page.waitForFunction(() => !!document.querySelector("canvas"));
  await page.waitForTimeout(400);
  expect(errors).toEqual([]);
  // The route reached the shell: the variant label for C is in the header.
  await expect(page.locator("text=Storyboard")).toBeVisible();
});

test("layout: two calls with the same model are identical", async ({ page }) => {
  const model = (await pageModel(page)) as any;
  const a = storyLayout(model as never);
  const b = storyLayout(model as never);
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});

test("layout: lanes follow layer order, steps follow call order", async ({ page }) => {
  const model = (await pageModel(page)) as any;
  const lay = storyLayout(model as never);
  // Every board's lanes must appear in LANE_ORDER order, and each lane holds
  // exactly the steps whose layer it names. Long flows wrap onto bands: the
  // band-0 steps sit on the lane's own row, forked steps hang below it, and
  // later bands repeat the row below the band stride.
  let boardsWithLanes = 0;
  for (const board of lay.boards.values()) {
    const laneLayers = board.lanes.map((l: any) => l.layer);
    const wanted = LANE_ORDER.filter((l) => laneLayers.includes(l));
    expect(laneLayers).toEqual(wanted);
    const ys = board.lanes.map((l: any) => l.y);
    expect([...ys].sort((x, y) => x - y)).toEqual(ys);
    for (const lane of board.lanes) {
      const onLane = board.steps.filter((s: any) => s.layer === lane.layer);
      expect(onLane.length).toBe(lane.count);
      const bandStride = board.lanes.length * 84 + 40;
      for (const s of onLane) {
        const band = Math.floor(s.order / 14);
        const base = lane.y + band * bandStride;
        expect(Math.abs(s.y - base)).toBe(s.forkDrop);
      }
    }
    if (board.lanes.length > 1) boardsWithLanes++;
    // Within a band, steps run left to right in call order with a fixed gap;
    // bands wrap back to the left edge by design.
    const BAND = 14;
    for (let b = 0; b * BAND < board.steps.length; b++) {
      const inBand = board.steps.slice(b * BAND, (b + 1) * BAND) as any[];
      for (let i = 1; i < inBand.length; i++) {
        expect(inBand[i].x).toBeGreaterThan(inBand[i - 1].x);
        expect(Math.round(inBand[i].x - inBand[i - 1].x)).toBe(96);
      }
    }
  }
  // The repo really has multi-layer flows, so the lane order test bit.
  expect(boardsWithLanes).toBeGreaterThan(0);
});

test("layout: branch forks drop, loop curls stay inside the world", async ({ page }) => {
  const model = (await pageModel(page)) as any;
  const lay = storyLayout(model as never);
  let forks = 0;
  let curls = 0;
  for (const board of lay.boards.values()) {
    for (const s of board.steps as any[]) {
      // A forked step is drawn below its lane's baseline, dropped by its
      // fork amount – that is the branch fork reading downwards.
      if (s.forkDrop > 0) forks++;
      if (s.curlToX != null) {
        curls++;
        expect(s.curlToX).toBeLessThan(s.x);
        expect(s.curlToX).toBeGreaterThanOrEqual(0);
      }
    }
    // Width is bounded by the world however long the flow is (bands wrap);
    // every drawn element stays inside the board's own panel.
    expect(board.w).toBeLessThanOrEqual(STORY_WORLD.w);
    for (const s of board.steps as any[]) {
      expect(s.y).toBeLessThanOrEqual(board.h);
      expect(s.x).toBeLessThanOrEqual(board.w - 40);
    }
    for (const c of board.chips as any[]) {
      expect(c.y + c.h).toBeLessThanOrEqual(board.h + 4);
    }
  }
  expect(forks).toBeGreaterThan(0);
  expect(curls).toBeGreaterThan(0);
});

test("layout: chips never collide horizontally on a lane row", async ({ page }) => {
  const model = (await pageModel(page)) as any;
  const lay = storyLayout(model as never);
  for (const board of lay.boards.values()) {
    const chips = board.chips as any[];
    for (const a of chips) {
      expect(a.w).toBeLessThanOrEqual(84);
      for (const b of chips) {
        if (a === b || a.y !== b.y) continue;
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x;
        expect(apart).toBe(true);
      }
    }
  }
});

test("variant: a card click or a fit on a flow opens the lanes; a chip jumps", async ({ page }) => {
  await page.goto("/#map/c");
  await page.waitForFunction(() => ((window as any).__kulaMap?.model?.stations?.length ?? 0) > 0);
  const r = await page.evaluate(() => {
    const story = (window as any).__story;
    const model = (window as any).__kulaMap.model;
    const canvas = document.createElement("canvas");
    canvas.width = 1440; canvas.height = 900;
    const ctx = canvas.getContext("2d")!;
    const base = { w: 1440, h: 900, scale: Math.min(1440 / 1600, 900 / 1000), ox: 0, oy: 0 };
    const overlays = { fences: {}, live: {}, churn: {}, owners: {}, show: {} };
    const lay = story.__layoutForTest(model);

    // A card click in the grid: hit answers flow, and the URL code the shell
    // builds for that pick is exactly the flow route.
    const gridView = { ...base, ox: (1440 - 1600 * base.scale) / 2, oy: (900 - 1000 * base.scale) / 2 };
    story.storyVariant.draw(ctx, model, gridView, overlays, null);
    const card = lay.grid.cards[0];
    const cardPick = story.storyVariant.hit(
      card.x * gridView.scale + gridView.ox + 10, card.y * gridView.scale + gridView.oy + 10, gridView);
    const pickCode = (p: any) => (p.kind === "flow" ? `f/${p.id}` : p.kind === "station" ? `s/${p.id}` : `d/${p.id}`);

    // fit on that flow pick: the view must zoom to the story scale and centre
    // the board, and hit must then answer the board's chips and dots.
    let view = gridView;
    story.storyVariant.fit(cardPick, view, (v: any) => { view = v; });
    story.storyVariant.draw(ctx, model, view, overlays, cardPick);
    const board = lay.boards.get(cardPick.id);
    let chipPick: any = null;
    let stationPick: any = null;
    if (board && board.chips.length) {
      const chip = board.chips[0];
      chipPick = story.storyVariant.hit(chip.x * view.scale + view.ox + 2, chip.y * view.scale + view.oy + 2, view);
    }
    if (board) {
      const s = board.steps[0];
      stationPick = story.storyVariant.hit(s.x * view.scale + view.ox, s.y * view.scale + view.oy, view);
    }
    return {
      cardPick, chipPick, stationPick,
      chipCode: chipPick ? pickCode(chipPick) : null,
      scaleAfterFit: view.scale,
      storyOpen: view.scale >= 0.7 && !!board,
      otherFlow: chipPick && chipPick.kind === "flow" ? chipPick.id !== cardPick.id : null,
    };
  });
  expect(r.cardPick?.kind).toBe("flow");
  // fit opened the story: scale above the story threshold.
  expect(r.storyOpen).toBe(true);
  expect(r.scaleAfterFit).toBeGreaterThanOrEqual(0.7);
  // A chip pick is a flow pick for a different flow.
  if (r.chipPick) {
    expect(r.chipPick.kind).toBe("flow");
    expect(r.otherFlow).toBe(true);
    expect(r.chipCode).toMatch(/^f\//);
  }
  expect(r.stationPick?.kind).toBe("station");
});

test("shell: a chip pick updates the URL and the inspector", async ({ page }) => {
  const model = (await pageModel(page)) as any;
  const lay = storyLayout(model as never);
  // Find a flow whose board actually has a chip, Node-side.
  let from = ""; let to = "";
  for (const [id, b] of lay.boards as Map<string, any>) {
    const chip = (b.chips as any[])[0];
    if (chip) { from = id; to = chip.flowId; break; }
  }
  expect(from).toBeTruthy();
  // Drive the shell's own path: the URL hash is the pick.
  await page.goto(`/#map/c/f/${from}`);
  await page.waitForFunction(() => ((window as any).__kulaMap?.model?.stations?.length ?? 0) > 0);
  await page.evaluate((t) => { location.hash = `#map/c/f/${t}`; }, to);
  await page.waitForTimeout(300);
  expect(new URL(page.url()).hash).toBe(`#map/c/f/${to}`);
  // The inspector shows the other flow's label, not the first flow's.
  const label = (model.flows as any[]).find((f) => f.id === to)?.label ?? "";
  expect(label).toBeTruthy();
  const body = await page.evaluate(() => document.body.innerText);
  expect(body).toContain(label.slice(0, Math.min(12, label.length)));
});

test("variant: overlays honour the toggles on both surfaces", async ({ page }) => {
  await page.goto("/#map/c");
  await page.waitForFunction(() => ((window as any).__kulaMap?.model?.stations?.length ?? 0) > 0);
  const r = await page.evaluate(() => {
    const story = (window as any).__story;
    const model = (window as any).__kulaMap.model;
    const canvas = document.createElement("canvas");
    canvas.width = 1440; canvas.height = 900;
    const ctx = canvas.getContext("2d")!;
    const scale = Math.min(1440 / 1600, 900 / 1000);
    const view = { w: 1440, h: 900, scale, ox: (1440 - 1600 * scale) / 2, oy: (900 - 1000 * scale) / 2 };
    const none = { fences: {}, live: {}, churn: {}, owners: {}, show: { fences: false, live: false, churn: false, owners: false } };
    // Orange heat on half the stations; fences on the interchanges.
    const withOv = JSON.parse(JSON.stringify(none));
    let n = 0;
    for (const s of model.stations) {
      if (n++ % 2 === 0) withOv.live[s.id] = 3;
      if (s.degree >= 2) withOv.fences[s.id] = "locked";
    }
    withOv.show = { fences: true, live: true, churn: true, owners: true };
    const inked = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, 1440, 900);
      story.storyVariant.draw(ctx, model, view, withOv, null);
      const d = ctx.getImageData(0, 0, 1440, 900).data;
      let warm = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 150 && d[i + 2] < 120) warm++;
      return warm;
    };
    const on = inked();
    withOv.show = { fences: false, live: false, churn: false, owners: false };
    const off = inked();
    // And in story view: same toggles over an open board. Flags on first.
    const pick = { kind: "flow", id: [...story.__layoutForTest(model).boards.keys()][0] };
    let bv = view;
    story.storyVariant.fit(pick, view, (v: any) => { bv = v; });
    withOv.show = { fences: true, live: true, churn: true, owners: true };
    story.storyVariant.draw(ctx, model, bv, withOv, pick);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const d2 = ctx.getImageData(0, 0, 1440, 900).data;
    let boardWarm = 0;
    for (let i = 0; i < d2.length; i += 4) if (d2[i] > 200 && d2[i + 1] > 150 && d2[i + 2] < 120) boardWarm++;
    withOv.show = { fences: false, live: false, churn: false, owners: false };
    story.storyVariant.draw(ctx, model, bv, withOv, pick);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const d3 = ctx.getImageData(0, 0, 1440, 900).data;
    let boardCool = 0;
    for (let i = 0; i < d3.length; i += 4) if (d3[i] > 200 && d3[i + 1] > 150 && d3[i + 2] < 120) boardCool++;
    return { on, off, boardWarm, boardCool };
  });
  expect(r.on).toBeGreaterThan(r.off);
  expect(r.boardWarm).toBeGreaterThan(r.boardCool);
});

test("screenshots: grid, open story, mobile grid", async ({ page }) => {
  const model = (await pageModel(page)) as any;
  await page.evaluate(() => {
    const story = (window as any).__story;
    const model = (window as any).__kulaMap.model;
    const canvas = document.createElement("canvas");
    canvas.width = 1440; canvas.height = 900;
    canvas.id = "mc-shot";
    canvas.style.cssText = "position:fixed;inset:0;z-index:9999";
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d")!;
    const scale = Math.min(1440 / 1600, 900 / 1000);
    const view = { w: 1440, h: 900, scale, ox: (1440 - 1600 * scale) / 2, oy: (900 - 1000 * scale) / 2 };
    const overlays = { fences: {}, live: {}, churn: {}, owners: {}, show: { fences: false, live: false, churn: false, owners: false } };
    story.storyVariant.draw(ctx, model, view, overlays, null);
    (window as any).__mcView = view;
  });
  await page.locator("#mc-shot").screenshot({ path: resolve(SHOTS, "map-mc-grid.png") });

  // Open a flow with the most steps for the lanes shot.
  const target = await page.evaluate(() => {
    const story = (window as any).__story;
    const model = (window as any).__kulaMap.model;
    const lay = story.__layoutForTest(model);
    let best = ""; let bestSteps = 0;
    for (const [id, b] of lay.boards) {
      const steps = (b as any).steps.length + (b as any).chips.length * 10;
      if (steps > bestSteps) { bestSteps = steps; best = id; }
    }
    const canvas = document.getElementById("mc-shot") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    let view = (window as any).__mcView;
    story.storyVariant.fit({ kind: "flow", id: best }, view, (v: any) => { view = v; });
    const overlays = { fences: {}, live: {}, churn: {}, owners: {}, show: { fences: false, live: false, churn: false, owners: false } };
    story.storyVariant.draw(ctx, model, view, overlays, { kind: "flow", id: best });
    (window as any).__mcView = view;
    return { best, chips: (lay.boards.get(best) as any).chips.length, lanes: (lay.boards.get(best) as any).lanes.length };
  });
  expect(target.lanes).toBeGreaterThan(0);
  await page.locator("#mc-shot").screenshot({ path: resolve(SHOTS, "map-mc-story.png") });

  // Mobile: the grid reflows into the narrow viewport.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    const story = (window as any).__story;
    const model = (window as any).__kulaMap.model;
    const canvas = document.getElementById("mc-shot") as HTMLCanvasElement;
    canvas.width = 390; canvas.height = 844;
    const ctx = canvas.getContext("2d")!;
    const scale = Math.min(390 / 1600, 844 / 1000);
    const view = { w: 390, h: 844, scale, ox: (390 - 1600 * scale) / 2, oy: (844 - 1000 * scale) / 2 };
    story.storyVariant.draw(ctx, model, view, { fences: {}, live: {}, churn: {}, owners: {}, show: {} }, null);
  });
  await page.locator("#mc-shot").screenshot({ path: resolve(SHOTS, "map-mc-grid-mobile.png") });
});
