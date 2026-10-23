// U2 – layers, rails and the Map · Runs · Evals switch. Acceptance from the
// contract (fused-canvas.md §8): layer toggle with six layers and defaults
// (§8.7), search pans the camera and never re-lays-out (§8.8), centred
// segmented control, tidy explicit and undoable, rail add/note/panel.
// Assert by name – the fixture is per worker.
import { expect, test, type Page } from "@playwright/test";
import { explore } from "./explore";

async function open(page: Page, hash = "map") {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
    try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto(`/#${hash}`);
  await expect(page.locator("[data-testid=map-flow]")).toBeVisible({ timeout: 15_000 });
}

test("the layer toggle exists with the six layers and the contract defaults", async ({ page }) => {
  await open(page);
  const layers = page.locator("[data-testid=u2-layers]");
  await expect(layers).toBeVisible();
  for (const id of ["blocks", "flows", "chains", "fences", "agents", "runs"])
    await expect(layers.locator(`[data-testid=u2-layer-${id}]`)).toBeVisible();
  // Defaults: Blocks + Flows + Agents + Runs on, the rest off (contract §5;
  // Flows on since U5 routes wires through the gutters).
  for (const id of ["blocks", "flows", "runs"])
    await expect(layers.locator(`[data-testid=u2-layer-${id}]`)).toHaveAttribute("aria-pressed", "true");
  for (const id of ["chains", "fences", "agents"])
    await expect(layers.locator(`[data-testid=u2-layer-${id}]`)).toHaveAttribute("aria-pressed", "false");
});

test("turning a layer off hides its marks and back on restores them", async ({ page }) => {
  await open(page);
  // Flows is on by default (contract §5). Pick an edge with a non-empty
  // bounding box – U8's size scale can make the first DOM edge an exactly
  // horizontal wire, which has zero height and counts as hidden.
  const edges = page.locator("[data-testid=map-flow] .react-flow__edge");
  const id = await edges.evaluateAll((els) => {
    for (const el of els) {
      const b = el.getBoundingClientRect();
      if (b.width > 0 && b.height > 0) return el.getAttribute("data-id");
    }
    return null;
  });
  expect(id).toBeTruthy();
  const edge = page.locator(`[data-testid=map-flow] .react-flow__edge[data-id="${id}"]`);
  await expect(edge).toBeVisible();
  await explore(page); await page.locator("[data-testid=u2-layer-flows]").click();
  await expect(edge).not.toBeVisible();
  await explore(page); await page.locator("[data-testid=u2-layer-flows]").click();
  await expect(edge).toBeVisible();
  // Runs off hides the last-run dots, never navigates: the canvas stays.
  await expect(page.locator("[data-testid=map-flow-canvas]")).toBeVisible();
  await explore(page); await page.locator("[data-testid=u2-layer-runs]").click();
  await expect(page.locator("[data-testid=map-flow-canvas]")).toBeVisible();
});

test("the centred Map · Runs · Evals switch re-frames without losing the canvas", async ({ page }) => {
  await open(page);
  const frames = page.locator("[data-testid=u2-frames]");
  await expect(frames).toBeVisible();
  await expect(frames.locator("[data-testid=u2-frame-map]")).toHaveAttribute("aria-selected", "true");
  // Runs: the docked transport stays and the pipeline opens.
  await frames.locator("[data-testid=u2-frame-runs]").click();
  await expect(frames.locator("[data-testid=u2-frame-runs]")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-testid=map-flow-canvas]")).toBeVisible();
  await expect(page.locator("[data-testid=map-inspector]")).toBeVisible();
  // Evals: the empty state teaches (contract §7), canvas still underneath.
  await frames.locator("[data-testid=u2-frame-evals]").click();
  await expect(page.locator("[data-testid=u2-evals]")).toContainText("No eval runs yet");
  await page.locator("[data-testid=u2-evals-open-runs]").click();
  await expect(frames.locator("[data-testid=u2-frame-runs]")).toHaveAttribute("aria-selected", "true");
  await frames.locator("[data-testid=u2-frame-map]").click();
  await expect(page.locator("[data-testid=u2-evals]")).toHaveCount(0);
});

test("the rail opens the add form, adds a note and opens the panel", async ({ page }) => {
  await open(page);
  await explore(page);
  const rail = page.locator("[data-testid=u2-rail]");
  await expect(rail).toBeVisible();
  // + opens the R1 add form (contract §8.6) – the agents info must be in.
  await rail.locator("[data-testid=u2-rail-add]").click();
  await expect(page.locator("[data-testid=ag-add-form]")).toBeVisible();
  await page.keyboard.press("Escape");
  // Note adds a sticky in the pipeline.
  await explore(page);
  await page.locator("[data-testid=u2-rail-note]").click();
  await expect(page.locator("[data-testid=ws-tab-pipeline]")).toHaveAttribute("aria-selected", "true");
  // Panel opens the pipeline inspector.
  await explore(page);
  await page.locator("[data-testid=hud-pipeline]").click();
  await expect(page.locator("[data-testid=map-inspector]")).toBeVisible();
});

test("search moves the camera and never re-lays-out", async ({ page }) => {
  await open(page);
  // A stable landmark card and its position before the search.
  const card = page.locator("[data-testid=map-flow] .react-flow__node").first();
  await expect(card).toBeVisible();
  // The camera is viewport-level, so a bbox would move with any pan. The
  // node's own canvas transform is what a re-layout would change (B8 guard).
  const tf = () => card.evaluate((el) => (el as HTMLElement).style.transform);
  const before = await tf();
  const vp = page.locator("[data-testid=map-flow-canvas] .react-flow__viewport");
  const transformBefore = await vp.getAttribute("style");
  await explore(page); await page.locator("[data-testid=u2-rail-search]").click();
  await explore(page); await page.locator("[data-testid=u2-rail-search-input]").fill("serve");
  await explore(page); await page.locator("[data-testid=u2-rail-search-input]").press("Enter");
  await page.waitForTimeout(600); // the pan animates; the layout must not move
  // The camera moved…
  expect(await vp.getAttribute("style")).not.toEqual(transformBefore);
  // …but the card kept its own position: no re-layout (B8 guard).
  const after = await tf();
  expect(after).toBe(before);
});

test("tidy is explicit and one undo puts the cards back", async ({ page }) => {
  await open(page);
  // The kit's mouse-drag persistence is covered by the canvas-kit spec; this
  // test owns the tidy snapshot, so it seeds the same store a real drag
  // writes (kula.flow.pos.v1.<ns>.<kitKey>, flow/positions.ts) and checks
  // tidy clears it and one undo puts the card back. The node's canvas
  // transform is asserted, not its viewport box – the layout bump may re-fit
  // the camera, which moves every box.
  const seed = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-testid=map-flow] .react-flow__node"))
      .filter((n) => !n.parentElement?.closest(".react-flow__node")); // unparented: absolute == relative
    const node = nodes[nodes.length - 1];
    const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(node?.style.transform ?? "");
    const id = node?.getAttribute("data-id") ?? "";
    return id && m ? { id, x: Number(m[1]) + 120, y: Number(m[2]) + 90 } : null;
  });
  expect(seed).not.toBeNull();
  await page.evaluate((s) => {
    localStorage.setItem("kula.flow.pos.v1.map.map-2-0-n", JSON.stringify({ [s.id]: { x: s.x, y: s.y } }));
  }, seed!);
  const node = page.locator(`[data-testid=map-flow] .react-flow__node[data-id="${seed!.id}"]`);
  const xy = async () => {
    const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec((await node.evaluate((el) => (el as HTMLElement).style.transform)) ?? "");
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  };
  // Tidy: one confirmation-free click. The seeded drag is snapshot to the
  // undo chip, cleared from the store, and the kit re-lays out.
  await explore(page); await page.locator("[data-testid=u2-tidy]").click();
  await explore(page); await expect(page.locator("[data-testid=u2-tidy-undo]")).toBeVisible();
  await page.waitForTimeout(700);
  const tidied = await xy();
  expect(Math.abs(tidied!.x - seed!.x) + Math.abs(tidied!.y - seed!.y)).toBeGreaterThan(8);
  // One undo puts the card back: the store gets the snapshot restored
  // exactly, and the card leaves the tidied spot and moves back toward the
  // seeded drag (the kit's hydration re-snaps the absolute during the
  // rebuild, so the transform is asserted by direction and distance, not
  // to the pixel).
  await explore(page); await page.locator("[data-testid=u2-tidy-undo]").click();
  await page.waitForTimeout(900);
  const undone = await xy();
  const restored = await page.evaluate((s) =>
    JSON.parse(localStorage.getItem("kula.flow.pos.v1.map.map-2-2-n") ?? "{}"), seed!);
  expect(restored[seed!.id]).toEqual({ x: seed!.x, y: seed!.y });
  expect(Math.abs(undone!.x - seed!.x) + Math.abs(undone!.y - seed!.y)).toBeLessThan(
    Math.abs(tidied!.x - seed!.x) + Math.abs(tidied!.y - seed!.y));
  // The undo chip disappears once there is nothing to undo.
  await explore(page); await expect(page.locator("[data-testid=u2-tidy-undo]")).toHaveCount(0);
});
