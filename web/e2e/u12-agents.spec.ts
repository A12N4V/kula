// U12 · Agents outside the boxes – with the Agents layer on, every agent
// square lives in the band above the zone row: it never intersects a block
// square, a zone frame or a zone label; a fenced agent sits over the zone it
// covers with its gradient wires dropping into its fenced squares; an
// unfenced agent sits beside the whole-codebase square, also outside; and a
// block dropped on an agent square fences that block's section. Assert by
// name, never counts.
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE } from "../playwright.config";
import { explore } from "./explore";

test.use({ baseURL: FIXTURE });

test.describe.configure({ mode: "serial" });

async function opened(page: Page) {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto("about:blank");
  await page.goto(`/#map`);
  await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 30_000 });
  await page.locator(".fc-solid").first().waitFor({ state: "attached", timeout: 30_000 });
  await expect(page.locator('[data-testid^="fc-node-agent:"]').first()).toBeAttached({ timeout: 30_000 });
}

/** Bounding-box geometry of every agent square against block squares, zone
    frames and zone labels, read from the live canvas. */
type Box = { l: number; t: number; r: number; b: number };
const hit = (a: Box, b: Box, pad = 1) => Math.min(a.r, b.r) - Math.max(a.l, b.l) - pad > 0 && Math.min(a.b, b.b) - Math.max(a.t, b.t) - pad > 0;

async function agentGeometry(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element): Box => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    const agents = [...document.querySelectorAll('[data-testid^="fc-node-agent:"]')].map((el) => ({ id: el.getAttribute("data-testid")!, ...box(el) }));
    const zones = [...document.querySelectorAll('[data-testid^="fc-node-zone"]')].map((el) => ({ id: el.getAttribute("data-testid")!, ...box(el) }));
    // a zone label is the frame's title text
    const labels = zones.map((z) => ({ id: z.id, l: z.l + 1, t: z.t + 1, r: z.r - 1, b: z.t + 26 }));
    const blocks = [...document.querySelectorAll('[data-testid="map-flow"] .fc-solid')]
      .filter((el) => { const t = el.getAttribute("data-testid") ?? ""; return !t.startsWith("fc-node-agent:") && t !== "fc-node-codebase" && !t.startsWith("fc-node-zone"); })
      .map((el) => ({ id: el.getAttribute("data-testid")!, ...box(el) }));
    return { agents, zones, labels, blocks };
  });
}

test("no agent square intersects a block square, a zone frame or a zone label", async ({ page }) => {
  await opened(page);
  await page.locator("[data-testid=fc-fit]").click();
  await page.waitForTimeout(600);
  const g = await agentGeometry(page);
  expect(g.agents.length, "agents render with the layer on").toBeGreaterThan(0);
  for (const a of g.agents) {
    for (const s of g.blocks) expect(hit(a, s), `${a.id} intersects block ${s.id}`).toBe(false);
    for (const z of g.zones) expect(hit(a, z), `${a.id} intersects zone frame ${z.id}`).toBe(false);
    for (const l of g.labels) expect(hit(a, l), `${a.id} intersects zone label ${l.id}`).toBe(false);
  }
});

test("a fenced agent sits over the zone it covers; an unfenced agent sits beside the whole-codebase square", async ({ page }) => {
  await opened(page);
  const geo = await page.evaluate(() => {
    const box = (el: Element) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    const a = box(document.querySelector('[data-testid="fc-node-agent:polish"]')!);
    const cb = box(document.querySelector('[data-testid="fc-node-codebase"]')!);
    const u = box(document.querySelector('[data-testid="fc-node-agent:everywhere"]')!);
    const zones = [...document.querySelectorAll('[data-testid^="fc-node-zone"]')].map(box);
    return {
      polishOverZone: zones.some((z) => Math.min(a.r, z.r) - Math.max(a.l, z.l) > 0),
      beside: u.r <= cb.l + 2,
      sameBand: Math.abs(u.t - cb.t) < 220,
    };
  });
  expect(geo.polishOverZone, "fenced agent over its zone").toBe(true);
  expect(geo.beside, "unfenced agent left of the whole-codebase square").toBe(true);
  expect(geo.sameBand, "unfenced agent rides in the band with the codebase square").toBe(true);
});

test("a fenced agent's gradient wires drop into its fenced squares", async ({ page }) => {
  await opened(page);
  // assert by name: the dashed wires out of the polish agent's square
  const n = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="map-flow"] [data-edge-id]')]
      .filter((el) => (el.getAttribute("data-edge-id") ?? "").startsWith("agent:polish>")).length);
  expect(n, "a wire from agent:polish into its fenced square").toBeGreaterThan(0);
});

test("dropping a block on an agent square fences it – the square lights as the drop target", async ({ page }) => {
  await opened(page);
  await explore(page); await page.locator('[data-testid="u2-rail-add"]').click();
  const form = page.locator('[data-testid="map-inspector"] [data-testid="ag-add-form"]');
  await expect(form).toBeVisible();
  const NAME = `band-drop-${Date.now()}`;
  await form.locator('[data-testid="ag-add-name"]').fill(NAME);
  await form.locator('button[aria-label="Remove src/**"]').click();
  await form.locator('[data-testid="ag-add-create"]').click();
  const square = page.locator(`[data-testid=at-agent-${NAME}]`);
  await expect(square).toBeAttached({ timeout: 10_000 });
  await page.locator("[data-testid=fc-fit]").click();
  // the drop highlight: dragover lights the square
  await square.evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData("application/x-kula-block", JSON.stringify({ kind: "note", ref: "b0", name: "b0", about: "" }));
    el.dispatchEvent(new DragEvent("dragenter", { bubbles: true, dataTransfer: dt }));
    el.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: dt }));
  });
  await expect(square).toHaveClass(/over/);
  const before = await page.evaluate(async (name) => {
    const t = (document.querySelector('meta[name="kula-token"]') as HTMLMetaElement)?.content ?? "probe";
    const d = await (await fetch("/api/agents", { headers: { "x-kula-token": t } })).json();
    const wf = (d.workflows ?? []).find((w: { name: string }) => w.name === name);
    return ((wf?.scope ?? []) as string[]).length;
  }, NAME);
  await square.evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData("application/x-kula-block", JSON.stringify({ kind: "note", ref: "b0", name: "b0", about: "" }));
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
  });
  await expect.poll(async () => page.evaluate(async (name) => {
    const t = (document.querySelector('meta[name="kula-token"]') as HTMLMetaElement)?.content ?? "probe";
    const d = await (await fetch("/api/agents", { headers: { "x-kula-token": t } })).json();
    const wf = (d.workflows ?? []).find((w: { name: string }) => w.name === name);
    return ((wf?.scope ?? []) as string[]).length;
  }, NAME), { timeout: 10_000 }).toBeGreaterThan(before);
});
