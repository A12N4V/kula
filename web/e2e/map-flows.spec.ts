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
  // R0: the flows lens is gone – flows are an overlay list in the inspector
  // on the one canvas; picking a flow selects its sections on the canvas.
  test("the flows overlay in the inspector lists the value flows", async ({ page }) => {
    await open(page);
    // A cold server builds the map inside the first GET /api/map (~11 s on
    // this repo) – give the first assert the cold-build budget.
    await expect(page.locator("[data-testid=map-view]")).toBeVisible({ timeout: 30_000 });
    const api = await page.evaluate(async () => {
      const token = document.querySelector('meta[name="kula-token"]')?.content ?? "";
      const r = await fetch("/api/map", { headers: { "x-kula-token": token } });
      return (await r.json()).value_flows as { name: string; outcome: string }[];
    });
    expect(api.length).toBeGreaterThan(0);
    // a selection opens the inspector; the flows list rides the inspect tab
    await page.locator(".fc-card").first().click();
    await expect(page.locator("[data-testid=map-flows-list]")).toBeAttached();
    const rows = page.locator("[data-testid=map-flows-list] .vf-row-name");
    expect(await rows.count()).toBeGreaterThan(0);
    const names = new Set(api.map((f) => f.name));
    for (const r of await rows.all()) expect(names.has((await r.textContent()) ?? "")).toBe(true);
    // the row button carries the outcome sentence as its title
    const firstName = (await rows.first().textContent()) ?? "";
    const first = api.find((f) => f.name === firstName)!;
    await expect(page.locator("[data-testid=map-flow-0]")).toHaveAttribute("title", `${first.name} – ${first.outcome}`);
  });

  test("picking a flow selects its first section on the canvas", async ({ page }) => {
    await open(page);
    await expect(page.locator("[data-testid=map-view]")).toBeVisible({ timeout: 30_000 });
    await page.locator(".fc-card").first().click();
    await expect(page.locator("[data-testid=map-flows-list]")).toBeAttached();
    await page.locator("[data-testid=map-flow-0]").click();
    // the canvas selection moved to the flow's first section (the inspector
    // names the selected block; the canvas card carries the selection state)
    await expect(page.locator("[data-testid=map-flow] .fc-canvas")).not.toHaveAttribute("data-fc-selection", "");
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
