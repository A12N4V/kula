// Value-flow canvas (M3) – tiles render with name + outcome, the payload's
// order is stable across two /api/map fetches, and the entry tile is the
// D-shaped first node. Runs against the repo server; no fixture writes.

import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, hash = "map") {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
    try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto(`/#${hash}`);
}

test.describe("map value flows", () => {
  test("the flows lens renders entry, flow and section tiles", async ({ page }) => {
    await open(page);
    // A cold server builds the map inside the first GET /api/map (~11 s on
    // this repo) – the view only renders its testid once the payload lands,
    // so give the first assert the cold-build budget, not the 5 s default.
    await expect(page.locator("[data-testid=map-view]")).toBeVisible({ timeout: 30_000 });
    await page.locator("[data-testid=map-view-flows]").click();
    await expect(page.locator("[data-testid=map-flows]")).toBeVisible();
    // The canvas is hydrated with at least one entry tile and one flow tile.
    await expect(page.locator("[data-testid=vf-canvas][data-fc-ready='1']")).toBeAttached({ timeout: 15_000 });
    const nodes = page.locator("[data-testid^=fc-node-vf]");
    expect(await nodes.count()).toBeGreaterThan(1);
  });

  test("flow tiles carry their name and outcome sentence", async ({ page }) => {
    await open(page);
    await page.locator("[data-testid=map-view-flows]").click();
    const api = await page.evaluate(async () => {
      const token = document.querySelector('meta[name="kula-token"]')?.content ?? "";
      const r = await fetch("/api/map", { headers: { "x-kula-token": token } });
      return (await r.json()).value_flows as { name: string; outcome: string }[];
    });
    expect(api.length).toBeGreaterThan(0);
    const names = new Set(api.map((f) => f.name));
    // The canvas virtualises off-screen nodes, so assert on what is rendered:
    // every flow tile shows a real flow name as its title and its outcome
    // sentence as the subtitle line under the tile.
    const tiles = page.locator(`[data-testid^="fc-node-vf:f"]`);
    expect(await tiles.count()).toBeGreaterThan(0);
    for (const t of await tiles.all()) {
      const [title, subtitle] = await t.locator(".fc-title, .fc-sub").allTextContents();
      expect(names.has(title)).toBe(true);
      const f = api.find((x) => x.name === title)!;
      expect(subtitle).toBe(f.outcome);
    }
  });

  test("the entry tile is D-shaped and sits in the leftmost rank", async ({ page }) => {
    await open(page);
    await page.locator("[data-testid=map-view-flows]").click();
    await expect(page.locator("[data-testid=vf-canvas][data-fc-ready='1']")).toBeAttached({ timeout: 15_000 });
    const entry = page.locator(".fc-node.fc-entry").first();
    await expect(entry).toBeVisible();
    // The D shape is the tile box's radius: round back (left), flat face (right).
    // The virtualized canvas remounts nodes under load; poll so a mid-remount
    // read (empty computed style) does not fail the shape check.
    await expect(async () => {
      const radii = await entry.locator(".fc-tile-box").evaluate((el) => {
        const s = getComputedStyle(el);
        return { tl: parseFloat(s.borderTopLeftRadius), br: parseFloat(s.borderBottomRightRadius) };
      });
      expect(radii.tl).toBeGreaterThan(4); // the D's round back
      expect(radii.br).toBe(0); // the D's flat face toward the flow
    }).toPass({ timeout: 10_000 });
    // Leftmost: no tile sits to its left.
    const x = await entry.evaluate((el) => (el as HTMLElement).getBoundingClientRect().left);
    const others = await page.locator(".fc-node:not(.fc-entry)").evaluateAll((els) => els.map((e) => (e as HTMLElement).getBoundingClientRect().left));
    if (others.length) expect(x).toBeLessThanOrEqual(Math.min(...others) + 1);
  });

  test("value_flows order is identical across two /api/map fetches", async ({ page }) => {
    await open(page);
    const [a, b] = await page.evaluate(async () => {
      const token = document.querySelector('meta[name="kula-token"]')?.content ?? "";
      const h = { headers: { "x-kula-token": token } };
      const x = await (await fetch("/api/map", h)).json();
      const y = await (await fetch("/api/map", h)).json();
      return [JSON.stringify(x.value_flows), JSON.stringify(y.value_flows)];
    });
    expect(b).toBe(a);
    const flows = JSON.parse(a) as { name: string; entry: number; members: number[]; sections: string[] }[];
    // Sorted by (name, entry); members are real leaf ids; sections are block ids.
    const keys = flows.map((f) => `${f.name}\u0000${f.entry}`);
    expect([...keys].sort()).toEqual(keys);
    for (const f of flows) {
      expect(f.members.length).toBeGreaterThan(0);
      expect(f.sections.every((s) => s.startsWith("b"))).toBe(true);
    }
  });
});
