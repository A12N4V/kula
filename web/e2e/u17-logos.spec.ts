import { expect, test, type Page } from "@playwright/test";

// U17: colour families and the logo studio. Agents read blue (190–250°),
// teams read orange (15–45°), research reads green–teal (120–170°); the hue
// pair is still hashed per name inside the band. Clicking any card's mark
// opens the logo studio (a live preview, 2D/3D, yaw and pitch dials, density
// and line weight sliders, a reroll seed) and Save logo posts logo_save; the
// saved svg then replaces the hashed mark wherever that name is shown.

async function open(page: Page, hash = "agents") {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
    try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto(`/#${hash}`);
}

/** Every oklch hue inside an element's mark strokes. */
async function hues(page: Page, scope: string): Promise<number[]> {
  return page.locator(scope).evaluate((el) => {
    const out: number[] = [];
    for (const p of Array.from(el.querySelectorAll("path[stroke]"))) {
      const m = /oklch\([\d.]+ [\d.]+ ([\d.]+)\)/.exec(p.getAttribute("stroke") ?? "");
      if (m) out.push(Number(m[1]));
    }
    return out;
  });
}

test.describe("colour families", () => {
  test("agent cards draw in the blue family, 190–250°", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop");
    await open(page);
    await expect(page.locator(".ag-cards .ag-card").first()).toBeVisible();
    const hs = await hues(page, ".ag-cards .ag-card .ag-card-art-svg >> nth=0");
    expect(hs.length).toBeGreaterThan(0);
    for (const h of hs) expect(h).toBeGreaterThanOrEqual(190);
    for (const h of hs) expect(h).toBeLessThanOrEqual(250);
  });
});

test.describe("the logo studio", () => {
  test("clicking a card's mark opens the studio with its controls", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop");
    await open(page);
    const mark = page.locator(".ag-cards .ag-card [data-testid^=ag-art-]").first();
    await mark.click();
    const studio = page.getByTestId("logo-studio");
    await expect(studio).toBeVisible();
    // live preview, projection toggle, dials and sliders, reroll, save
    await expect(page.getByTestId("logo-preview")).toBeVisible();
    await expect(page.getByTestId("logo-dims")).toBeVisible();
    await expect(page.getByTestId("logo-yaw")).toBeVisible();
    await expect(page.getByTestId("logo-pitch")).toBeVisible();
    await expect(page.getByTestId("logo-density")).toBeVisible();
    await expect(page.getByTestId("logo-lw")).toBeVisible();
    await expect(page.getByTestId("logo-reroll")).toBeVisible();
    await expect(page.getByTestId("logo-save")).toBeVisible();
    // the mark click did not open the agent sidebar underneath
    await expect(page.getByTestId("ag-side")).toHaveCount(0);
    // Esc closes and focus returns to the card that opened the studio
    await page.keyboard.press("Escape");
    await expect(studio).toHaveCount(0);
    const card = page.locator(".ag-cards .ag-card").first();
    await expect(card).toBeFocused();
  });

  test("2D flattens the projection; reroll draws a different curve", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop");
    await open(page);
    await page.locator(".ag-cards .ag-card [data-testid^=ag-art-]").first().click();
    await expect(page.getByTestId("logo-studio")).toBeVisible();
    const d3 = await page.getByTestId("logo-preview").locator("path").first().getAttribute("d");
    await page.getByTestId("logo-dims").click(); // to 2D
    const d2 = await page.getByTestId("logo-preview").locator("path").first().getAttribute("d");
    expect(d2).not.toBe(d3);
    await page.getByTestId("logo-reroll").click();
    const dRerolled = await page.getByTestId("logo-preview").locator("path").first().getAttribute("d");
    expect(dRerolled).not.toBe(d3);
    // density changes how much of the curve is drawn (the first stroke's path moves)
    const dDen0 = await page.getByTestId("logo-preview").locator("path").first().getAttribute("d");
    await page.getByTestId("logo-density").fill("0");
    const dDen1 = await page.getByTestId("logo-preview").locator("path").first().getAttribute("d");
    expect(dDen1).not.toBe(dDen0);
  });

  test("Save logo posts logo_save; the saved svg then replaces the mark", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop");
    const saves: { kind?: string; name?: string; params?: { dims?: number; density?: number } }[] = [];
    await page.route("**/api/agents/logo_save", async (r) => {
      saves.push(r.request().postDataJSON() as object);
      await r.fulfill({ json: { ok: true } });
    });
    let logos: unknown[] = [];
    await page.route("**/api/agent/logos", async (r) => {
      await r.fulfill({ json: logos });
    });
    await open(page);
    const mark = page.locator(".ag-cards .ag-card [data-testid^=ag-art-]").first();
    const name = (await mark.getAttribute("data-testid"))!.replace("ag-art-", "");
    await mark.click();
    await page.getByTestId("logo-save").click();
    await expect(page.getByTestId("logo-saved")).toBeVisible({ timeout: 5000 });
    expect(saves).toHaveLength(1);
    expect(saves[0].kind).toBe("agent");
    expect(saves[0].name).toBe(name);
    expect(saves[0].params?.dims).toBe(3);
    expect(typeof saves[0].params?.density).toBe("number");
    // the saved svg comes back on the next load and replaces the hashed mark
    const svg = (saves[0] as { svg?: string }).svg ?? "";
    expect(svg).toContain("<svg");
    logos = [{ kind: "agent", name, svg, params: saves[0].params }];
    await open(page);
    const art = page.locator(".ag-cards .ag-card [data-testid^=ag-art-]").first();
    await expect(art).toHaveClass(/logo-saved/);
    await expect(art.locator("svg path").first()).toBeVisible();
  });
});
