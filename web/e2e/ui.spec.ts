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

test.describe("overview + code panel", () => {
  test("the orrery plate draws the repository and its planets", async ({ page }) => {
    await open(page);
    await expect(page.locator(".orrery svg")).toBeVisible();
    await expect(page.locator(".orr-planet").first()).toBeVisible();
    const a = await page.locator(".orr-planet").first().getAttribute("transform");
    await page.waitForTimeout(600);
    expect(await page.locator(".orr-planet").first().getAttribute("transform")).not.toBe(a); // it turns
    await page.waitForTimeout(600);
    await page.screenshot({ path: "test-results/overview.png" });
  });

  test("a hotspot opens its file in the code panel", async ({ page }) => {
    await open(page);
    await page.locator(".hot-row:not(.hot-headrow)").first().click();
    const panel = page.locator(".code-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".cp-code > div").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  });

  test("inspector rows open source with the definition lit; locate still moves the graph", async ({ page }) => {
    await open(page, "graph");
    await page.keyboard.press("ControlOrMeta+k");
    await page.keyboard.type("parseHash");
    await page.locator(".palette").getByText("parseHash", { exact: true }).first().click();
    const row = page.locator(".inspector .sym:has(.kind-badge[title=\"function\"])").first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();
    const panel = page.locator(".code-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".cp-code > div.lit").first()).toBeVisible();
    await page.screenshot({ path: "test-results/code-panel.png" });
    const before = page.url();
    await row.hover();
    await row.locator(".sym-locate").click();
    await expect.poll(() => page.url()).not.toBe(before);
  });
});

test.describe("graph chrome", () => {
  test("one settings control, not two", async ({ page }) => {
    await open(page, "graph");
    await expect(page.getByRole("button", { name: /settings/i })).toHaveCount(1);
  });

  test("the mark assembles, centred, while the graph loads", async ({ page }) => {
    await page.route("**/api/graph*", async (r) => { await new Promise((f) => setTimeout(f, 1200)); await r.continue(); });
    await open(page, "graph");
    const ll = page.locator(".logo-loader");
    await expect(ll).toBeVisible();
    const [box, wrap] = await Promise.all([ll.locator(".ll-mark").boundingBox(), page.locator(".main").boundingBox()]);
    expect(Math.abs(box!.x + box!.width / 2 - (wrap!.x + wrap!.width / 2))).toBeLessThan(4);
    expect(Math.abs(box!.y + box!.height / 2 - (wrap!.y + wrap!.height / 2))).toBeLessThan(30);
    await page.waitForTimeout(700);
    await page.screenshot({ path: "test-results/graph-loading.png" });
    await expect(ll).toHaveCount(0, { timeout: 15_000 });
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
