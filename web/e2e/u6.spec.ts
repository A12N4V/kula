// U6 · Agents on the terrain – with the Agents layer on, a fenced agent is an
// agent square (harmonograph mark, name, dashed hue border) in the band above
// the zone row, over the zone it covers, outside every zone frame, with
// dashed gradient wires into its fenced squares; an agent with access to the
// whole codebase sits beside the "whole codebase" block (colour bands =
// directory shares), also outside the zones; Agents off → no agent marks
// anywhere. Assert by name, never counts.
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE } from "../playwright.config";
import { explore, mapSettings } from "./explore";

test.use({ baseURL: FIXTURE });

/** The fixture's agent list is shared by every suite: (re)seed the fenced
    agent ("polish", scoped to src/**) and the unfenced one ("everywhere")
    right before each test, keeping the rest. */
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

test.describe.configure({ mode: "serial" });

async function opened(page: Page) {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto("about:blank");
  await page.goto(`/#map`);
  await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 30_000 });
  await page.locator(".fc-solid").first().waitFor({ state: "attached", timeout: 30_000 });
  await expect(page.locator('[data-testid="fc-node-agent:polish"]')).toBeAttached({ timeout: 30_000 });
}

test("agents layer off → no agent marks anywhere, on → the agent squares appear", async ({ page }) => {
  await opened(page);
  // on: both seeded agents are on the terrain
  await expect(page.locator('[data-testid="fc-node-agent:polish"]')).toBeVisible();
  await expect(page.locator('[data-testid="fc-node-agent:everywhere"]')).toBeVisible();
  // off: removed from the DOM, not hidden
  await explore(page); await mapSettings(page); await page.locator('[data-testid="u2-layer-agents"]').click();
  await expect(page.locator('[data-testid^="fc-node-agent:"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="fc-node-codebase"]')).toHaveCount(0);
  // back on for the rest of the checks
  await explore(page); await mapSettings(page); await page.locator('[data-testid="u2-layer-agents"]').click();
  await expect(page.locator('[data-testid="fc-node-agent:polish"]')).toBeVisible();
});

test("a fenced agent's square sits above its zone, outside the zone frame (U12 band)", async ({ page }) => {
  await opened(page);
  const geo = await page.evaluate(() => {
    const box = (el: Element) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    const hit = (a: ReturnType<typeof box>, b: ReturnType<typeof box>, pad = 2) =>
      Math.min(a.r, b.r) - Math.max(a.l, b.l) - pad > 0 && Math.min(a.b, b.b) - Math.max(a.t, b.t) - pad > 0;
    const a = document.querySelector('[data-testid="fc-node-agent:polish"]')!;
    const ab = box(a);
    // above the zone row: no zone frame or block square shares its band
    const zones = [...document.querySelectorAll('[data-testid^="fc-node-zone"]')].map(box);
    const blocks = [...document.querySelectorAll('[data-testid="map-flow"] .fc-solid')]
      .filter((el) => { const t = el.getAttribute("data-testid") ?? ""; return !t.startsWith("fc-node-agent:") && t !== "fc-node-codebase" && !t.startsWith("fc-node-zone"); })
      .map(box);
    // and it sits over the zone its fenced squares live in (x-range overlap with that zone)
    const over = zones.some((z) => Math.min(ab.r, z.r) - Math.max(ab.l, z.l) > 0);
    return { over, onZone: zones.some((z) => hit(ab, z)), onBlock: blocks.some((s) => hit(ab, s)),
      aboveEveryZone: zones.every((z) => ab.b <= z.t) };
  });
  expect(geo.onZone, "agent square inside a zone frame").toBe(false);
  expect(geo.onBlock, "agent square over a block square").toBe(false);
  expect(geo.aboveEveryZone, "agent square above the zone row").toBe(true);
  expect(geo.over, "agent square over the zone it covers").toBe(true);
  // and it carries the agent's harmonograph mark and its name
  await expect(page.locator('[data-testid="fc-node-agent:polish"]')).toContainText("polish");
  await expect(page.locator('[data-testid="fc-node-agent:polish"] [data-figure]').first()).toBeAttached();
});

test("an unfenced agent wires into the whole-codebase block (colour-banded)", async ({ page }) => {
  await opened(page);
  const cb = page.locator('[data-testid="fc-node-codebase"]');
  await expect(cb).toBeVisible();
  await expect(cb).toContainText("Whole codebase");
  // bands = directory shares, drawn inside the square
  await expect(cb.locator('[data-testid="x5-agent-band"]')).toBeAttached();
  await expect(cb.locator('[data-testid="x5-agent-band"] i').first()).toBeVisible();
  // the agent square sits left of it, wired in by a dashed wire
  const side = await page.evaluate(() => {
    const a = document.querySelector('[data-testid="fc-node-agent:everywhere"]')!.getBoundingClientRect();
    const c = document.querySelector('[data-testid="fc-node-codebase"]')!.getBoundingClientRect();
    return a.right <= c.left + 2;
  });
  expect(side, "unfenced agent square is left of the whole-codebase block").toBe(true);
});

// The actor band is gone: agents live only on the map, and clicking an
// agent's square picks it (the inspector opens on it with the fence verbs).
test("no actor band; clicking an agent square picks the agent", async ({ page }) => {
  await opened(page);
  await expect(page.locator('[data-testid="actor-band"]')).toHaveCount(0);
  await page.locator("[data-testid=fc-fit]").click();
  await page.locator('[data-testid="at-agent-polish"]').click();
  await expect(page.locator('[data-testid="at-agent-polish"]')).toHaveClass(/sel/);
  await expect(page.locator('[data-testid="ag-bar"]')).toBeVisible();
  await expect(page.locator('[data-testid="at-edit-fence"]')).toBeVisible();
});
