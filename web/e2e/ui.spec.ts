import { expect, test, type Page } from "@playwright/test";

// Skip the once-per-session opening so every test lands on the app itself.
async function open(page: Page, hash = "overview") {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
    try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto(`/#${hash}`);
}

const radius = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).borderTopLeftRadius);

test.describe("shell", () => {
  test("loads the overview for this repository", async ({ page }) => {
    await open(page);
    await expect(page.locator(".ov-title h1")).toHaveText(/kula/);
    await expect(page.locator(".kpi-strip")).toBeVisible();
  });

  test("top bar carries only navigation, search and settings", async ({ page }) => {
    await open(page);
    const bar = page.locator(".topbar");
    await expect(bar.getByText(/graph current|no graph/)).toHaveCount(0);
    await expect(bar.getByRole("button", { name: /Reindex/ })).toHaveCount(0);
    await expect(bar.getByRole("button", { name: "Keyboard shortcuts" })).toHaveCount(0);
    await expect(bar.getByRole("button", { name: "Settings" })).toBeVisible();
  });

  test("mark is the dithered graph-sphere, drawn on the pixel grid", async ({ page }) => {
    await open(page);
    const mark = page.locator(".brand svg.logo");
    await expect(mark).toHaveAttribute("shape-rendering", "crispEdges");
    const d = await mark.locator("path").getAttribute("d");
    expect(d?.match(/M\d+ \d+h1v1h-1z/g)?.length ?? 0).toBeGreaterThan(150);
  });

  test("⌘K opens the palette and it can reindex", async ({ page }) => {
    await open(page);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.locator(".palette")).toBeVisible();
    await page.keyboard.type("reindex");
    await expect(page.locator(".palette").getByText(/Reindex/i).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".palette")).toHaveCount(0);
  });
});

test.describe("design language", () => {
  test("one typeface: JetBrains Mono everywhere", async ({ page }) => {
    await open(page);
    for (const sel of ["body", ".ov-title h1", ".kpi-cell b", ".card-head h2", ".section-title, .kpi-label"]) {
      const ff = await page.locator(sel).first().evaluate((el) => getComputedStyle(el).fontFamily);
      expect(ff, sel).toMatch(/^"?JetBrains Mono/);
    }
    const faces = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].map((f) => f.family); });
    expect(faces.join(",")).not.toMatch(/Antonio|Cormorant|Geist/);
  });

  test("Homonin ground and accent", async ({ page }) => {
    await open(page);
    const v = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return { bg: s.getPropertyValue("--bg").trim(), accent: s.getPropertyValue("--accent").trim(), line: s.getPropertyValue("--line").trim() };
    });
    expect(v).toEqual({ bg: "#050505", accent: "#f97f3a", line: "#24201d" });
  });

  test("sharp: framed surfaces and controls have square corners", async ({ page }) => {
    await open(page);
    for (const sel of [".card", ".kpi-strip", ".btn", ".search-trigger", ".chip"]) expect(await radius(page, sel), sel).toBe("0px");
  });

  test("errors get a thin even border, not an accent bar", async ({ page }) => {
    await page.route("**/api/repo", (r) => r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "missing or bad session token" }) }));
    await open(page);
    const t = page.locator(".toast.err").first();
    await expect(t).toBeVisible();
    const b = await t.evaluate((el) => { const s = getComputedStyle(el); return [s.borderLeftWidth, s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderTopLeftRadius]; });
    expect(b).toEqual(["1px", "1px", "1px", "1px", "0px"]);
  });
});

test.describe("graph", () => {
  test("renders, and packages toggle onto the rim", async ({ page }) => {
    await open(page, "graph");
    await expect(page.locator(".graph-wrap canvas").first()).toBeVisible();
    const btn = page.getByRole("button", { name: /Packages/ });
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    await expect(btn).toContainText(/\d+/);
    await page.waitForTimeout(5000); // let the layout settle before the snapshot
    await page.screenshot({ path: "test-results/graph-packages.png" });
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("kula.settings.v1") ?? "{}").packages);
    expect(stored).toBe(true);
  });
});

test.describe("api", () => {
  test("refuses requests without the session token", async ({ request }) => {
    const r = await request.get("/api/repo");
    expect(r.status()).toBe(401);
  });

  test("graph export includes package nodes wired by IMPORTS", async ({ request }) => {
    const g = await (await request.get("/api/graph?level=file", { headers: { "x-kula-token": "test" } })).json();
    const pk = g.nodes.filter((n: { kind: string }) => n.kind === "package");
    expect(pk.length).toBeGreaterThan(3);
    const ids = new Set(pk.map((n: { id: number }) => n.id));
    expect(g.edges.some((e: { dst: number; kind: string }) => ids.has(e.dst) && e.kind === "IMPORTS")).toBe(true);
  });
});

test("@mobile overview fits a phone without sideways scroll", async ({ page }) => {
  await open(page);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(0);
});
