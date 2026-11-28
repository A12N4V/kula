// M0 proof: the Map view loads, the variant toggle changes the URL, the
// inspector opens on a stub pick, and the test drawer records one result to
// localStorage. Plus the model unit checks (no Vitest in this repo, so they
// run in the page against the pure builder).

import { expect, test } from "@playwright/test";

test("map view loads with header and canvas", async ({ page }) => {
  await page.goto("/#/map");
  await expect(page.getByTestId("map-view")).toBeVisible();
  await expect(page.getByTestId("variant-a")).toBeVisible();
  await expect(page.getByTestId("map-canvas")).toBeVisible();
  await expect(page.getByTestId("overlay-fences")).toBeVisible();
  // the model built from the repo's own flowmap
  const stations = await page.evaluate(() => (window as any).__kulaMap?.model?.stations?.length ?? 0);
  expect(stations).toBeGreaterThan(0);
});

test("variant toggle changes the URL and is remembered", async ({ page }) => {
  await page.goto("/#/map");
  await page.getByTestId("variant-b").click();
  await expect(page).toHaveURL(/#map\/b/);
  await page.reload();
  await expect(page.getByTestId("variant-b")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("variant-a").click();
  await expect(page).toHaveURL(/#map\/a/);
});

test("inspector opens on a stub pick", async ({ page }) => {
  await page.goto("/#/map");
  // wait for the model, then click the position of a real station on the canvas
  await page.waitForFunction(() => ((window as any).__kulaMap?.layout?.stations?.length ?? 0) > 0);
  const at = await page.evaluate(() => {
    const m = (window as any).__kulaMap.model;
    const lay = (window as any).__kulaMap.layout;
    const v = { scale: 0.5, ox: 0, oy: 0 };
    const s = lay.stations[0];
    return { x: s.x * v.scale + v.ox, y: s.y * v.scale + v.oy, name: m.stations.find((t: any) => t.id === s.id).name };
  });
  const box = await page.getByTestId("map-canvas").boundingBox();
  await page.mouse.click(box!.x + at.x, box!.y + at.y);
  const ins = page.getByTestId("map-inspector");
  await expect(ins).toBeVisible();
  await expect(ins).toContainText(at.name);
  await page.getByTestId("inspector-close").click();
  await expect(ins).not.toBeVisible();
});

test("find on map flies to a station and opens the inspector", async ({ page }) => {
  await page.goto("/#/map");
  await page.waitForFunction(() => ((window as any).__kulaMap?.model?.stations?.length ?? 0) > 0);
  const name = await page.evaluate(() => (window as any).__kulaMap.model.stations[0].name);
  await page.getByTestId("map-find").fill(name.slice(0, 6));
  await page.getByTestId("map-find-list").getByRole("button").first().click();
  await expect(page.getByTestId("map-inspector")).toBeVisible();
  await expect(page).toHaveURL(/#map\/a\/s\//);
});

test("test drawer records one result to localStorage", async ({ page }) => {
  await page.goto("/#/map");
  await page.evaluate(() => localStorage.removeItem("kula.map.ab"));
  await page.getByTestId("map-test-toggle").click();
  await expect(page.getByTestId("ab-drawer")).toBeVisible();
  await expect(page.getByTestId("ab-task")).toBeVisible();
  // answer task 1 correctly through the map: find its flow and pick it
  const label = await page.evaluate(() => {
    const m = (window as any).__kulaMap.model;
    const routed = m.flows.filter((f: any) => f.route);
    return (routed[0] ?? m.flows[0]).label;
  });
  await page.getByTestId("map-find").fill(label.slice(0, 6));
  await page.getByTestId("map-find-list").getByRole("button").first().click();
  await expect(page.getByTestId("ab-rate")).toBeVisible();
  await page.getByTestId("ab-rate-clarity-4").click();
  await page.getByTestId("ab-rate-speed-4").click();
  await page.getByTestId("ab-rate-look-4").click();
  await page.getByTestId("ab-note").fill("spec");
  await page.getByTestId("ab-next").click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("kula.map.ab") ?? "[]"));
  expect(stored.length).toBe(1);
  expect(stored[0].variant).toMatch(/^[abc]$/);
  expect(typeof stored[0].ms).toBe("number");
  expect(stored[0].ratings.clarity).toBe(4);
});

test("model: dedup, degree, layer, determinism (in page)", async ({ page }) => {
  await page.goto("/#/map");
  const r = await page.evaluate(async () => {
    const { build } = (window as any).__kulaMap;
    const [fm, graph] = await Promise.all([
      fetch("/api/flowmap").then((x) => x.json()),
      fetch("/api/graph").then((x) => x.json()),
    ]);
    const a = build(fm, graph);
    const b = build(fm, graph);
    const json = (m: any) => JSON.stringify({ d: m.domains, f: m.flows, s: m.stations, i: m.interchanges.map((x: any) => x.id) });
    // dedup: stations ≤ total step occurrences
    const totalSteps = fm.flows.reduce((n: number, f: any) => n + f.steps.length, 0);
    const degreeOk = a.stations.every((s: any) => s.degree === s.flows.length && s.degree >= 1);
    const interchanges = a.interchanges.every((s: any) => s.degree >= 2);
    const entryLayered = a.flows.every((f: any) => f.steps[0]?.layer === "test" || f.steps[0]?.layer === "entry");
    const layersKnown = a.stations.every((s: any) => ["entry", "handler", "logic", "data", "io", "test"].includes(s.layer));
    return {
      deterministic: json(a) === json(b),
      dedup: a.stations.length <= totalSteps,
      hasInterchange: a.interchanges.length > 0,
      degreeOk,
      interchanges,
      entryLayered,
      layersKnown,
    };
  });
  expect(r.deterministic).toBe(true);
  expect(r.dedup).toBe(true);
  expect(r.hasInterchange).toBe(true);
  expect(r.degreeOk).toBe(true);
  expect(r.interchanges).toBe(true);
  expect(r.entryLayered).toBe(true);
  expect(r.layersKnown).toBe(true);
});
