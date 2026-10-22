// U2 – layers, rails and the Map · Runs · Evals switch. Acceptance from the
// contract (fused-canvas.md §8): layer toggle with six layers and defaults
// (§8.7), search pans the camera and never re-lays-out (§8.8), centred
// segmented control, tidy explicit and undoable, rail add/note/panel.
// Assert by name – the fixture is per worker.
import { expect, test, type Page } from "@playwright/test";

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
  // Defaults: Blocks + Agents + Runs on, the rest off (contract §5).
  for (const id of ["blocks", "agents", "runs"])
    await expect(layers.locator(`[data-testid=u2-layer-${id}]`)).toHaveAttribute("aria-pressed", "true");
  for (const id of ["flows", "chains", "fences"])
    await expect(layers.locator(`[data-testid=u2-layer-${id}]`)).toHaveAttribute("aria-pressed", "false");
});

test("turning a layer off hides its marks and back on restores them", async ({ page }) => {
  await open(page);
  const edge = page.locator("[data-testid=map-flow] .react-flow__edge").first();
  await expect(edge).toBeVisible();
  await page.locator("[data-testid=u2-layer-flows]").click();
  await expect(edge).not.toBeVisible();
  await page.locator("[data-testid=u2-layer-flows]").click();
  await expect(edge).toBeVisible();
  // Runs off hides the last-run dots, never navigates: the canvas stays.
  await expect(page.locator("[data-testid=map-flow-canvas]")).toBeVisible();
  await page.locator("[data-testid=u2-layer-runs]").click();
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
  const rail = page.locator("[data-testid=u2-rail]");
  await expect(rail).toBeVisible();
  // + opens the R1 add form (contract §8.6) – the agents info must be in.
  await rail.locator("[data-testid=u2-rail-add]").click();
  await expect(page.locator("[data-testid=u2-add-pop]")).toBeVisible();
  await expect(page.locator("[data-testid=ag-add-form]")).toBeVisible();
  await page.keyboard.press("Escape");
  // Note adds a sticky in the pipeline.
  await rail.locator("[data-testid=u2-rail-note]").click();
  await expect(page.locator("[data-testid=ws-tab-pipeline]")).toHaveAttribute("aria-selected", "true");
  // Panel opens the pipeline inspector.
  await rail.locator("[data-testid=u2-rail-panel]").click();
  await expect(page.locator("[data-testid=map-inspector]")).toBeVisible();
});

test("search moves the camera and never re-lays-out", async ({ page }) => {
  await open(page);
  // A stable landmark card and its position before the search.
  const card = page.locator("[data-testid=map-flow] .react-flow__node").first();
  await expect(card).toBeVisible();
  const before = await card.boundingBox();
  const transformBefore = await page.locator("[data-testid=map-flow-canvas] .react-flow__viewport").getAttribute("style");
  await page.locator("[data-testid=u2-rail-search]").click();
  await page.locator("[data-testid=u2-rail-search-input]").fill("serve");
  await page.locator("[data-testid=u2-rail-search-input]").press("Enter");
  await page.waitForTimeout(600); // the pan animates; the layout must not move
  // The camera moved…
  const transformAfter = await page.locator("[data-testid=map-flow-canvas] .react-flow__viewport").getAttribute("style");
  expect(transformAfter).not.toEqual(transformBefore);
  // …but the card kept its own position: no re-layout (B8 guard).
  const after = await card.boundingBox();
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(2);
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(2);
});

test("tidy is explicit and one undo puts the cards back", async ({ page }) => {
  await open(page);
  // Drag a card off its grid point so tidy has something to undo.
  const card = page.locator("[data-testid=map-flow] .react-flow__node").first();
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  if (!box) throw new Error("card has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + 8 + 60, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const dragged = await card.boundingBox();
  // Tidy: one confirmation-free click.
  await page.locator("[data-testid=u2-tidy]").click();
  await page.waitForTimeout(700);
  const tidied = await card.boundingBox();
  expect(Math.abs((tidied?.x ?? 0) - (dragged?.x ?? 0))).toBeGreaterThan(8);
  // One undo returns the card to its dragged position.
  await page.locator("[data-testid=u2-tidy-undo]").click();
  await page.waitForTimeout(700);
  const undone = await card.boundingBox();
  expect(Math.abs((undone?.x ?? 0) - (dragged?.x ?? 0))).toBeLessThan(2);
  expect(Math.abs((undone?.y ?? 0) - (dragged?.y ?? 0))).toBeLessThan(2);
  // The undo chip disappears once there is nothing to undo.
  await expect(page.locator("[data-testid=u2-tidy-undo]")).toHaveCount(0);
});
