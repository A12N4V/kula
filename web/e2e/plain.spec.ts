// X5 · The plain-language map – failing-first acceptance tests for
// docs/design/plain-map.md §6 (contract posted to the board, wave 1).
// Each test carries `test.fixme` until the U module that owns it lands the
// behaviour (owner in the table in plain-map.md §6); X6 un-fixmes as each
// lands. Test ids named here (`x5-*`) are part of the contract – U modules
// attach exactly these `data-testid` values.
// Assert by name, never by fixture counts (the fixture is per worker).
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE } from "../playwright.config";
import { explore, mapSettings } from "./explore";

test.use({ baseURL: FIXTURE });

/** The fixture's agent list is shared by every suite: seed the fenced agent
    ("polish", src/**) and the unfenced one ("everywhere") before each test,
    keeping the rest – same seeding U6's suite uses (U6 hand-off). */
async function seedAgents(request: import("@playwright/test").APIRequestContext) {
  const h = { "x-kula-token": "test" };
  const info = await (await request.get(`${FIXTURE}/api/agents`, { headers: h })).json();
  const all = (info.workflows ?? []) as { name: string; builtin?: boolean }[];
  const own = all.filter((w) => !w.builtin);
  const want = [
    { name: "polish", about: "Small cleanups", scope: ["src/**"], steps: ["Tidy", "verify"] },
    { name: "everywhere", about: "Runs anywhere", steps: ["Tidy"] },
  ];
  const merged = [...own];
  for (const w of want) if (!own.some((x) => x.name === w.name)) merged.push(w);
  if (merged.length === own.length) return;
  const r = await request.post(`${FIXTURE}/api/agents/workflows_save`, { headers: h, data: { workflows: merged } });
  expect(r.ok(), await r.text()).toBeTruthy();
}
test.beforeEach(async ({ request }) => { await seedAgents(request); });

async function opened(page: Page) {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto("about:blank");
  await page.goto("/#map");
  await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 30_000 });
  // the fixture builds its map cold on the first GET /api/map (~11 s)
  await expect(page.locator(".fc-node").first()).toBeVisible({ timeout: 30_000 });
}

/** One of the fixture's blocks whose plain name is stable and known
 *  (verified live: `/api/map/explain` returns source "name" entries), and
 *  that is on screen – the fitted view pans the first blocks off the left
 *  edge, so the hover target is picked from the visible squares. */
async function aBlock(page: Page) {
  // the fitted view pans once after mount – the pick must measure the camera
  // after it stops, or it lands on a square the pan then carries off screen
  await page.waitForTimeout(1000);
  const id = await page.evaluate(() => {
    for (const el of document.querySelectorAll(".fc-node[data-block]")) {
      const r = el.getBoundingClientRect();
      if (r.width > 40 && r.top > 0 && r.bottom < innerHeight && r.left > 0 && r.right < innerWidth) {
        // skip blocks a chip or sheet covers – the hover must reach the square
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (hit && (hit === el || el.contains(hit))) return el.getAttribute("data-block");
      }
    }
    return null;
  });
  // the layout keeps earlier hydration stages in the DOM – an off-view stage
  // copy of the same block sits out of the viewport, so hover only the
  // currently visible one (the pick above measured the visible rect).
  return page.locator(`.fc-node[data-block="${id}"]:visible`).first();
}

// §1 Reading layer (U9)

test("T1 captions show plain names by default, never dir · code-name", async ({ page }) => {
  await opened(page);
  // the map lands fitted: earlier hydration-stage copies sit off-view with an
  // empty box, so read the first caption actually on screen
  const caption = page.locator('[data-testid="x5-plain-caption"]:visible').first();
  await expect(caption).toBeVisible();
  const words = (await caption.textContent())?.trim().split(/\s+/) ?? [];
  expect(words.length).toBeGreaterThan(0);
  expect(words.length).toBeLessThanOrEqual(4);
  // the directory-prefixed technical caption is gone by default
  await expect(page.locator(".fc-node", { hasText: /\w+ · \w+/ })).toHaveCount(0);
});

test("T2 the Show code names toggle swaps captions to technical names and back", async ({ page }) => {
  await opened(page);
  // U11: the plain-words panel lives behind its chip – open it first.
  await page.locator('[data-testid="u9-plain-chip"]').click();
  const toggle = page.locator('[data-testid="x5-plain-toggle"]');
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  // a code square's caption – the whole-codebase square has no code name
  const cap = page.locator('[data-testid^="fc-node-"]:not([data-testid="fc-node-codebase"]) [data-testid="x5-plain-caption"]').first();
  const plain = (await cap.textContent()) ?? "";
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const code = (await cap.textContent()) ?? "";
  expect(code.trim()).not.toBe(plain.trim());
  // the technical name is a code identifier, not the plain words
  expect(code.trim()).toMatch(/[A-Za-z_]/);
  await toggle.click();
  await expect(cap).toHaveText(plain);
});

test("T3 hovering a square shows its one-sentence summary", async ({ page }) => {
  await opened(page);
  const block = await aBlock(page);
  await block.hover();
  const sentence = page.locator('[data-testid="x5-plain-sentence"]');
  await expect(sentence).toBeVisible();
  const text = (await sentence.textContent()) ?? "";
  expect(text.trim().length).toBeGreaterThan(10);
  expect(text.trim().endsWith(".")).toBeTruthy();
});

test("T4 the explain run shows named/total progress and renders the reason when it cannot start", async ({ page }) => {
  await opened(page);
  // U11: open the plain-words chip first
  await page.locator('[data-testid="u9-plain-chip"]').click();
  await page.locator('[data-testid="x5-plain-run"]').click();
  const progress = page.locator('[data-testid="x5-plain-progress"]');
  await expect(progress).toBeVisible();
  // named / total counts, e.g. "12 / 40 named"
  await expect(progress).toContainText("/");
  // when the run cannot start (no model), the reason shows instead of a spinner
  const started = await page.evaluate(async () => {
    const token = document.querySelector('meta[name="kula-token"]')?.content ?? "";
    const r = await fetch("/api/map/explain/run", { method: "POST", headers: { "x-kula-token": token, "content-type": "application/json" }, body: "{}" });
    return (await r.json()) as { started: boolean; reason?: string };
  });
  if (!started.started) await expect(page.locator('[data-testid="x5-plain-reason"]')).toBeVisible();
});

// §2 Legend (U7)
// T5–T7 re-fixmed by X6 after live-checking a699d36: U7 mounts the legend
// and journeys rows inside the inspector aside, which is hidden until a
// square is selected – X5 §2 requires the key visible on #map with no
// click, open on first visit. Un-fixme when U7 mounts it always-available.

test.fixme("T5 the legend is a collapsible key in the right column with the five rows", async ({ page }) => {
  await opened(page);
  const key = page.locator('[data-testid="x5-legend"]');
  await expect(key).toBeVisible();
  await key.click();
  const panel = page.locator('[data-testid="x5-legend-panel"]');
  await expect(panel).toBeVisible();
  for (const row of ["colour", "size", "glyph", "ring", "agent"]) {
    await expect(panel.locator(`[data-testid="x5-legend-${row}"]`)).toBeVisible();
  }
  // it is in the right column, not a modal over the canvas
  const panelBox = await panel.boundingBox();
  const canvasBox = await page.locator(".fc-canvas").boundingBox();
  expect(panelBox!.x).toBeGreaterThanOrEqual(canvasBox!.x + canvasBox!.width - 320);
  await key.click();
  await expect(panel).not.toBeVisible();
});

// §3 Journeys (U7)

test.fixme("T6 picking a journey opens the numbered sentence strip over the map", async ({ page }) => {
  await opened(page);
  await page.locator('[data-testid="x5-journey-row"]').first().click();
  const strip = page.locator('[data-testid="x5-journey-strip"]');
  await expect(strip).toBeVisible();
  await expect(strip.locator('[data-testid="x5-journey-step-1"]')).toBeVisible();
  // steps are numbered sentences, not technical paths
  await expect(strip.locator('[data-testid="x5-journey-step-1"]')).toContainText("1");
});

test.fixme("T7 Next walks the camera square to square; the step is marked current", async ({ page }) => {
  await opened(page);
  await page.locator('[data-testid="x5-journey-row"]').first().click();
  const before = await page.evaluate(() => JSON.stringify(document.querySelector(".fc-canvas")?.getBoundingClientRect()));
  await page.locator('[data-testid="x5-journey-next"]').click();
  const after = await page.evaluate(() => JSON.stringify(document.querySelector(".fc-canvas")?.getBoundingClientRect()));
  // the camera (canvas transform) moved under the strip
  expect(after).not.toBe(before);
  await expect(page.locator('[data-testid="x5-journey-step-2"]')).toHaveAttribute("aria-current", "step");
  await page.locator('[data-testid="x5-journey-prev"]').click();
  await expect(page.locator('[data-testid="x5-journey-step-1"]')).toHaveAttribute("aria-current", "step");
});

// §4 Question box (U9)

test("T8 asking in plain words lights the top hit distinctly and lists plain results", async ({ page }) => {
  await opened(page);
  await explore(page); await page.locator('[data-testid="x5-question-mode"]').click();
  await page.locator('[data-testid="x5-question-input"]').fill("save files");
  await page.locator('[data-testid="x5-question-input"]').press("Enter");
  await expect(page.locator('[data-testid="x5-question-result"]').first()).toBeVisible();
  const top = page.locator('[data-testid="x5-question-top"]');
  await expect(top).toBeVisible();
  // exactly one full ring; the lit squares carry their plain captions
  await expect(top).toContainText(/\S/);
  await expect(page.locator('[data-testid="x5-question-hit"]')).not.toHaveCount(0);
});

// §5 Agents on the terrain (U6)

test("T9 a fenced agent sits beside its first fenced square with dashed wires", async ({ page }) => {
  await opened(page);
  // agents layer on (U5's toggle in the bottom summary)
  // U6 realises the x5-agent-node contract as the kit node fc-node-agent:<name>
  // (harmonograph mark, dashed hue border); U6 hand-off, decision 1.
  const agent = page.locator('[data-testid^="fc-node-agent:"]').first();
  await expect(agent).toBeVisible({ timeout: 30_000 });
  const agentBox = await agent.boundingBox();
  const squares = await page.locator(".fc-node").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
  const near = squares.filter((s) => Math.abs(s.y - agentBox!.y) < agentBox!.height * 2 && Math.abs(s.x - agentBox!.x) < 400);
  expect(near.length).toBeGreaterThan(0);
  // adjacent: within one grid cell of its first fenced square
  const gap = Math.min(...near.map((s) => Math.abs(s.x - (agentBox!.x + agentBox!.width))));
  expect(gap).toBeLessThan(120);
  // x5-agent-dashed is realised as the kit's dashed 1px edge class (U6 hand-off)
  await expect(page.locator(".fc-edge.fc-dashed").first()).toBeAttached();
});

test("T10 an unfenced agent gets the whole-codebase block; the toggle removes every agent mark", async ({ page }) => {
  await opened(page);
  // the fixture seeds an unfenced agent: it gets one banded whole-codebase block
  const whole = page.locator('[data-testid="fc-node-codebase"]');
  await expect(whole).toBeVisible({ timeout: 30_000 });
  // bands = directory shares: the band row carries one hue band (i) per
  // top directory – more than one means real shares, not a flat block
  expect(await whole.locator('[data-testid="x5-agent-band"] i').count()).toBeGreaterThan(1);
  // agents off ⇒ zero agent marks in the DOM (removed, not hidden)
  await explore(page); await mapSettings(page); await page.locator('[data-testid="u2-layer-agents"]').click();
  await expect(page.locator('[data-testid^="fc-node-agent:"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="fc-node-codebase"]')).toHaveCount(0);
});
