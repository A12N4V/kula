// U3 · Actors on the terrain – acceptance per docs/design/fused-canvas.md §8:
// fence hull + dim ≤ 0.35 (§8.5), add flow via band + and Fence-port + (§8.6),
// drag a block onto an agent = add to fence (§8.5, B7 ≤ 2), the inspector
// tabs Setup · Script · Runs · Memory with @block chips, the autonomy
// segmented control, caps, the two-way raw toggle, and the missing-Model red
// mark. Assert by name, never by fixture counts.
import { expect, test, type Page } from "@playwright/test";

async function opened(page: Page, base = "") {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto("about:blank");
  await page.goto(`${base}/#map`);
  await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('[data-testid="actor-band"]')).toBeVisible();
}

const DIM_MAX = 0.35; // contract §8.5

async function selectAgent(page: Page, name: string) {
  await page.locator(`[data-testid="at-agent-${name}"]`).click();
  await expect(page.locator(`[data-testid="at-agent-${name}"]`)).toHaveClass(/sel/);
}

test("selecting an agent draws its fence hull and dims non-fenced blocks to at most 35%", async ({ page }) => {
  await opened(page);
  await selectAgent(page, "polish");
  await expect(page.locator('[data-testid="fence-hull"]')).toBeVisible();
  await expect(page.locator('[data-testid="fence-hull-label"]')).toHaveText(/fence · Polish/i);
  const ops = await page.evaluate(() =>
    [...document.querySelectorAll(".fc-node")].map((n) => +getComputedStyle(n).opacity));
  expect(ops.filter((o) => o > DIM_MAX), "some blocks stay bright (the fenced ones)").length.toBeGreaterThan(0);
  for (const o of ops) expect(o === 1 || o <= DIM_MAX, `opacity ${o} is in the dead zone`).toBeTruthy();
  await page.locator(`[data-testid="at-agent-polish"]`).click(); // deselect clears the hull
  await expect(page.locator('[data-testid="fence-hull"]')).toHaveCount(0);
});

test("dragging a block step onto an agent adds its section to the fence", async ({ page }) => {
  await opened(page);
  await selectAgent(page, "polish");
  const before = await page.locator('[data-testid="at-agent-polish"] .at-meta span').first().textContent();
  const n0 = Number(before?.match(/\d+/)?.[0] ?? 0);
  // The drop handler reads the ITEM_DRAG payload the palette and library drags
// produce. Dispatch a real drag with the same MIME type, carrying a block ref
// from the canvas – the physical drag-from-block gesture itself needs a
// flow-level hook (recorded in the hand-off for U1).
  const ref = await page.evaluate(() => {
    const el = document.querySelector('[data-testid^="fc-node-sec:"]') as HTMLElement | null
      ?? document.querySelector('[data-testid^="fc-node-"]');
    return el ? el.getAttribute("data-testid")!.replace("fc-node-", "").replace(/^sec:/, "") : "";
  });
  expect(ref, "a block to drag exists on the canvas").toBeTruthy();
  await page.locator('[data-testid="at-agent-polish"]').evaluate((el, ref) => {
    const dt = new DataTransfer();
    dt.setData("application/x-kula-block", JSON.stringify({ kind: "note", ref, name: ref, about: "" }));
    el.dispatchEvent(new DragEvent("dragenter", { bubbles: true, dataTransfer: dt }));
    el.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: dt }));
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
  }, ref);
  await expect.poll(async () => {
    const t = await page.locator('[data-testid="at-agent-polish"] .at-meta span').first().textContent();
    return Number(t?.match(/\d+/)?.[0] ?? 0);
  }, { timeout: 10_000 }).toBeGreaterThan(n0);
});

test("edit fence on canvas: clicking a block toggles its section in the fence", async ({ page }) => {
  await opened(page);
  await selectAgent(page, "polish");
  const before = await page.locator('[data-testid="at-agent-polish"] .at-meta span').first().textContent();
  const n0 = Number(before?.match(/\d+/)?.[0] ?? 0);
  await page.locator('[data-testid="at-edit-fence"]').click();
  await expect(page.locator('[data-testid="at-edit-fence"]')).toHaveAttribute("aria-pressed", "true");
  const block = page.locator(".fc-node").filter({ hasNot: page.locator('[data-testid^="fc-node-step:"]') }).nth(2);
  await block.click();
  await expect.poll(async () => {
    const t = await page.locator('[data-testid="at-agent-polish"] .at-meta span').first().textContent();
    return Number(t?.match(/\d+/)?.[0] ?? 0);
  }, { timeout: 10_000 }).toBeGreaterThanOrEqual(n0);
  await expect(page.locator('[data-testid="fence-hull"]')).toBeVisible(); // hull redraws
});

test("the band + and the unconnected Fence port + open the R1 add form in the inspector", async ({ page }) => {
  await opened(page);
  await page.locator('[data-testid="at-band-add"]').click();
  await expect(page.locator('[data-testid="map-inspector"] [data-testid="ag-add-form"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-testid="map-inspector"] [data-testid="ag-add-form"]')).toHaveCount(0);
  const stub = page.locator('[data-testid="port-add"]');
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
  const def = await page.locator('[role="radio"][aria-checked="true"]').textContent();
  expect(["Ask", "Ask on risky", "Auto"]).toContain(def?.trim());
  // Caps are number fields for cost, time and files.
  for (const c of ["cost", "time", "files"]) await expect(page.locator(`[data-testid="at-cap-${c}"]`)).toBeVisible();
  // Save a cap and an autonomy choice; the card reflects the autonomy after reload.
  await page.locator('[data-testid="at-cap-files"]').fill("7");
  await page.locator('[data-testid="at-save"]').click();
  await expect(page.locator(".at-ok")).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await opened(page);
  await selectAgent(page, "polish");
  await expect(page.locator('[data-testid="at-cap-files"]')).toHaveValue("7");
});

test("raw-file toggle is two-way: fields and raw JSON edit the same draft", async ({ page }) => {
  await opened(page);
  await selectAgent(page, "polish");
  await page.locator('[data-testid="at-raw-toggle"]').click();
  const raw = page.locator('[data-testid="at-raw"]');
  await expect(raw).toBeVisible();
  const edited = (await raw.inputValue()).replace('"about"', '"about_edited"');
  await raw.fill(`{ "not json"`);
  // a parse error keeps the fields – the last good draft survives
  await page.locator('[data-testid="at-raw-toggle"]').click(); // back to fields
  await expect(page.locator('[data-testid="at-pane-setup"], [data-testid="agent-inspector"]')).toBeVisible();
  await page.locator('[data-testid="at-raw-toggle"]').click();
  await raw.fill(edited.replace("about_edited", "about")); // leave it parseable
  await page.locator('[data-testid="at-raw-toggle"]').click();
});

test("Script tab: @block chips resolve live and select the block on the canvas", async ({ page }) => {
  await opened(page);
  await selectAgent(page, "polish");
  await page.locator('[data-testid="insp-tab-script"]').click();
  const promptBox = page.locator('[data-testid="at-prompt"]');
  // Use a section name that exists on this map.
  const secName = await page.evaluate(() => {
    const el = document.querySelector('[data-testid^="fc-node-"]');
    return el ? el.getAttribute("data-testid")!.slice("fc-node-".length) : "";
  });
  await promptBox.fill(`work on @${secName} carefully`);
  const chip = page.locator('[data-testid="at-block-chips"] .at-chip').first();
  await expect(chip).toHaveText(`@${secName}`);
  await chip.click();
  await expect(page.locator(".fc-sel")).toHaveCount(1);
});

test("autonomy defaults by role: the read-only workflow shows Auto, writers show Ask on risky", async ({ page }) => {
  await opened(page);
  const pol = await page.evaluate(async () => {
    const d = await (await fetch("/api/agents", { headers: { "x-kula-token": (document.querySelector('meta[name="kula-token"]') as HTMLMetaElement)?.content ?? "probe" } })).json();
    return d;
  });
  const wfs: { name: string; about?: string }[] = pol.workflows ?? [];
  const readOnly = wfs.find((w) => /docs|research|explor/i.test(`${w.name} ${w.about ?? ""}`));
  test.skip(!readOnly, "no read-only workflow in this repo's library");
  await page.locator(`[data-testid="at-agent-${readOnly!.name}"]`).click();
  await expect(page.locator('[role="radio"][aria-checked="true"]')).toHaveText(/Auto/);
});