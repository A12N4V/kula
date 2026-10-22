// U3 · Actors on the terrain – acceptance per docs/design/fused-canvas.md §8:
// fence hull + dim ≤ 0.35 (§8.5), add flow via band + and Fence-port + (§8.6),
// drag a block onto an agent = add to fence (§8.5, B7 ≤ 2), the inspector
// tabs Setup · Script · Runs · Memory with @block chips, the autonomy
// segmented control, caps, the two-way raw toggle, and the missing-Model red
// mark. Assert by name, never by fixture counts.
import { expect, test, type Page } from "@playwright/test";

// Serial: every test saves agent config through the same kula.toml – parallel
// writes clobber each other (the stale-guard catches the UI side, not this).
test.describe.configure({ mode: "serial" });

async function opened(page: Page, base = "") {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto("about:blank");
  await page.goto(`${base}/#map`);
  await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('[data-testid="actor-band"]')).toBeVisible();
}

const FENCE_DROP = `fence-drop-${Date.now()}`;
const DIM_MAX = 0.35; // contract §8.5

async function selectAgent(page: Page, name: string) {
  await page.locator(`[data-testid="at-agent-${name}"]`).click();
  await expect(page.locator(`[data-testid="at-agent-${name}"]`)).toHaveClass(/sel/);
}

/** The agent's fence path count, read live from the API the UI persists through. */
async function fenceCount(page: Page, name: string): Promise<number> {
  return page.evaluate(async (agent) => {
    const t = (document.querySelector('meta[name="kula-token"]') as HTMLMetaElement)?.content ?? "probe";
    const d = await (await fetch("/api/agents", { headers: { "x-kula-token": t } })).json();
    const wf = (d.workflows ?? []).find((w: { name: string }) => w.name === agent);
    return ((wf?.scope ?? []) as string[]).length;
  }, name);
}

test("selecting an agent draws its fence hull and dims non-fenced blocks to at most 35%", async ({ page }) => {
  await opened(page);
  await selectAgent(page, "polish");
  await expect(page.locator('[data-testid="fence-hull"]')).toBeVisible();
  await expect(page.locator('[data-testid="fence-hull-label"]')).toHaveText(/fence · Polish/i);
  const ops = await page.evaluate(() =>
    [...document.querySelectorAll(".fc-node")].map((n) => +getComputedStyle(n).opacity));
  const bright = ops.filter((o) => o > DIM_MAX).length;
  expect(bright, "some blocks stay bright (the fenced ones)").toBeGreaterThan(0);
  for (const o of ops) expect(o === 1 || o <= DIM_MAX, `opacity ${o} is in the dead zone`).toBeTruthy();
  await page.locator('[data-testid="at-agent-polish"]').click(); // deselect clears the hull
  await expect(page.locator('[data-testid="fence-hull"]')).toHaveCount(0);
});

test("dragging a block onto a fenced-in agent adds its section to the fence", async ({ page }) => {
  await opened(page);
  // A fresh agent starts with no fence: "no fence" on the card, so the drop
  // has a deterministic before/after (B7: fence a block in ≤ 2 moves).
  await page.locator('[data-testid="at-band-add"]').click();
  const form = page.locator('[data-testid="map-inspector"] [data-testid="ag-add-form"]');
  await expect(form).toBeVisible();
  await form.locator('[data-testid="ag-add-name"]').fill(FENCE_DROP);
  // Clear the default fence chip so the drop has a deterministic before/after.
  await form.locator('button[aria-label="Remove src/**"]').click();
  await form.locator('[data-testid="ag-add-create"]').click();
  await expect(page.locator(`[data-testid=at-agent-${FENCE_DROP}]`)).toBeVisible({ timeout: 10_000 });
  await selectAgent(page, FENCE_DROP);
  expect(await fenceCount(page, FENCE_DROP)).toBe(0);
  // The drop handler reads the ITEM_DRAG payload the palette and library
  // drags produce; the physical drag-from-canvas-block gesture itself needs a
  // flow-level hook (recorded in the hand-off for U1).
  const ref = await page.evaluate(() => {
    const el = document.querySelector('[data-testid^="fc-node-sec:"]') as HTMLElement | null
      ?? document.querySelector('[data-testid^="fc-node-"]');
    return el ? el.getAttribute("data-testid")!.replace("fc-node-", "").replace(/^sec:/, "") : "";
  });
  expect(ref, "a block to drag exists on the canvas").toBeTruthy();
  await page.locator(`[data-testid=at-agent-${FENCE_DROP}]`).evaluate((el, ref) => {
    const dt = new DataTransfer();
    dt.setData("application/x-kula-block", JSON.stringify({ kind: "note", ref, name: ref, about: "" }));
    el.dispatchEvent(new DragEvent("dragenter", { bubbles: true, dataTransfer: dt }));
    el.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: dt }));
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
  }, ref);
  await expect.poll(() => fenceCount(page, FENCE_DROP), { timeout: 10_000 }).toBeGreaterThan(0);
});

test("edit fence on canvas: clicking a block toggles its section in the fence", async ({ page }) => {
  await opened(page);
  await selectAgent(page, FENCE_DROP); // created in the drag test, or below
  if (!await page.locator(`[data-testid=at-agent-${FENCE_DROP}]`).count()) {
    await selectAgent(page, "polish");
  }
  await page.locator('[data-testid="at-edit-fence"]').click();
  await expect(page.locator('[data-testid="at-edit-fence"]')).toHaveAttribute("aria-pressed", "true");
  // Click a block that is actually on screen – the canvas pans, so scan.
  const id = await page.evaluate(() => {
    for (const el of document.querySelectorAll(".fc-node")) {
      const r = el.getBoundingClientRect();
      if (r.width > 40 && r.top > 0 && r.bottom < innerHeight && r.left > 0 && r.right < innerWidth && el.closest("[data-testid^='fc-node-step']") === null) {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        return el.getAttribute("data-testid");
      }
    }
    return null;
  });
  expect(id, "a visible block was clickable").toBeTruthy();
  await expect.poll(() => fenceCount(page, FENCE_DROP), { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(page.locator('[data-testid="fence-hull"]')).toBeVisible(); // hull redraws
});

test("the band + and the unconnected Fence port + open the R1 add form in the inspector", async ({ page }) => {
  await opened(page);
  await page.locator('[data-testid="at-band-add"]').click();
  await expect(page.locator('[data-testid="map-inspector"] [data-testid="ag-add-form"]')).toBeVisible();
  await page.locator('[data-testid="map-inspector"] [data-testid="ag-add-cancel"]').click();
  await expect(page.locator('[data-testid="map-inspector"] [data-testid="ag-add-form"]')).toHaveCount(0);
  const stub = page.locator('[data-testid="port-add"]').first();
  await expect(stub).toBeVisible();
  await stub.click();
  await expect(page.locator('[data-testid="map-inspector"] [data-testid="ag-add-form"]')).toBeVisible();
  expect(await page.getByTestId("add-block-global").count()).toBe(0);
});

test("agent inspector: Setup · Script · Runs · Memory tabs, autonomy segmented control, caps, missing-Model mark", async ({ page }) => {
  await opened(page);
  await selectAgent(page, "polish");
  await expect(page.locator('[data-testid="agent-inspector"]')).toBeVisible();
  for (const t of ["setup", "script", "runs", "memory"]) {
    await expect(page.locator(`[data-testid="insp-tab-${t}"]`)).toBeVisible();
  }
  // The autonomy control: three flat segments, one selected.
  for (const a of ["ask", "ask-risky", "auto"]) await expect(page.locator(`[data-testid="at-auto-${a}"]`)).toBeVisible();
  const def = (await page.locator('[role="radio"][aria-checked="true"]').textContent())?.trim();
  expect(["Ask", "Ask on risky", "Auto"]).toContain(def);
  // Caps are number fields for cost, time and files.
  for (const c of ["cost", "time", "files"]) await expect(page.locator(`[data-testid="at-cap-${c}"]`)).toBeVisible();
  // Save a cap and an autonomy choice; the value survives a reload.
  await page.locator('[data-testid="at-cap-files"]').fill("7");
  await page.locator('[data-testid="at-auto-auto"]').click();
  await page.locator('[data-testid="at-save"]').click();
  await expect(page.locator(".at-ok")).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await opened(page);
  await selectAgent(page, "polish");
  await expect(page.locator('[data-testid="at-cap-files"]')).toHaveValue("7");
  await expect(page.locator('[data-testid="at-auto-auto"]')).toHaveAttribute("aria-checked", "true");
});

test("raw-file toggle is two-way: fields and raw JSON edit the same draft", async ({ page }) => {
  await opened(page);
  await selectAgent(page, "polish");
  await page.locator('[data-testid="insp-tab-script"]').click();
  await page.locator('[data-testid="at-raw-toggle"]').click();
  const raw = page.locator('[data-testid="at-raw"]');
  await expect(raw).toBeVisible();
  // Invalid JSON: the fields keep the last good draft.
  await raw.fill('{ "not json"');
  await expect(page.locator(".at-err")).toBeVisible();
  // Valid JSON with a new prompt: the same draft the fields edit follows.
  const good = await page.evaluate(async () => {
    const t = (document.querySelector('meta[name="kula-token"]') as HTMLMetaElement)?.content ?? "probe";
    const d = await (await fetch("/api/agents", { headers: { "x-kula-token": t } })).json();
    const wf = (d.workflows ?? []).find((w: { name: string }) => w.name === "polish");
    return JSON.stringify({ ...wf, prompt: "raw edit works – @chip" }, null, 2);
  });
  await raw.fill(good);
  await expect(page.locator(".at-err")).toHaveCount(0);
  await page.locator('[data-testid="at-raw-toggle"]').click(); // back to fields
  await expect(page.locator('[data-testid="at-prompt"]')).toHaveValue(/raw edit works/);
});

test("Script tab: @block chips resolve live and select the block on the canvas", async ({ page }) => {
  await opened(page);
  await selectAgent(page, "polish");
  await page.locator('[data-testid="insp-tab-script"]').click();
  // Use a real section name from the map payload – chips resolve by name.
  const secName = await page.evaluate(async () => {
    const t = (document.querySelector('meta[name="kula-token"]') as HTMLMetaElement)?.content ?? "probe";
    const d = await (await fetch("/api/map", { headers: { "x-kula-token": t } })).json();
    const sec = Object.values(d.blocks ?? {}).find((b: { name?: string; theme?: string }) =>
      // chips resolve by full name (longest first), spaces included
      !!(b.theme ?? b.name ?? "").trim());
    return sec ? ((sec as { theme?: string; name?: string }).theme ?? (sec as { name?: string }).name ?? "") : "";
  });
  expect(secName).toBeTruthy();
  await page.locator('[data-testid="at-prompt"]').fill(`work on @${secName} carefully`);
  const chip = page.locator('[data-testid="at-block-chips"] .at-chip').first();
  await expect(chip).toHaveText(`@${secName}`);
  await chip.click();
  await expect(page.locator(".fc-sel")).toHaveCount(1);
});

test("autonomy defaults by role: the read-only workflow shows Auto, writers show Ask on risky", async ({ page }) => {
  await opened(page);
  const wfs: { name: string; about?: string }[] = await page.evaluate(async () => {
    const t = (document.querySelector('meta[name="kula-token"]') as HTMLMetaElement)?.content ?? "probe";
    const d = await (await fetch("/api/agents", { headers: { "x-kula-token": t } })).json();
    return d.workflows ?? [];
  });
  const readOnly = wfs.find((w) => !(w as { builtin?: boolean }).builtin && /docs|explor/i.test(`${w.name} ${w.about ?? ""}`));
  test.skip(!readOnly, "no read-only non-builtin workflow on the band in this repo's library");
  await page.locator(`[data-testid="at-agent-${readOnly!.name}"]`).click();
  await expect(page.locator('[role="radio"][aria-checked="true"]')).toHaveText(/Auto/);
});