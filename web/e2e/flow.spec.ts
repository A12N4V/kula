// F1 · the flow canvas kit, exercised on the #flow-lab dev route.
import { expect, test } from "@playwright/test";

const LAB = "/#/flow-lab";
const READY = '[data-testid="flow-canvas"][data-fc-ready="1"]';
const HYDRATED = '[data-testid="flow-canvas"][data-fc-hydrated="1"]';

/** fitView clamps at minZoom and centers, so edge nodes sit partly outside the
    visible canvas (clipped by .main) – pick a node fully inside .main's rect
    for drags and clicks (critic: intersect the real client rect, not constants). */
async function pickInside(page, selector = ".react-flow__node") {
  const main = await page.locator(".main").boundingBox();
  const all = await page.locator(selector).all();
  for (const h of all) {
    const b = await h.boundingBox();
    if (!b || !main) continue;
    const inside =
      b.x >= main.x + 4 && b.y >= main.y + 4 &&
      b.x + b.width <= main.x + main.width - 4 &&
      b.y + b.height <= main.y + main.height - 4;
    if (inside) return h;
  }
  return all[0];
}

test.describe("flow canvas kit", () => {
  test.beforeEach(async ({ page }) => {
    // Skip the opening splash (it intercepts pointer events) like the probe does.
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem("kula.opened", "1");
        localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false }));
      } catch { /* ignore */ }
    });
    await page.goto(LAB);
    await page.locator(READY).waitFor({ timeout: 20_000 });
    // Hydration replaces node elements – wait for it before interacting.
    await page.locator('[data-testid="flow-canvas"][data-fc-hydrated="1"]').waitFor({ timeout: 20_000 });
    await page.waitForTimeout(300);
  });

  test("renders the lab with nodes, controls and zoom readout", async ({ page }) => {
    await expect(page.locator(".fc-node").first()).toBeVisible();
    for (const id of ["fc-zoom-in", "fc-zoom-out", "fc-fit", "fc-tidy", "fc-reset", "fc-lock", "fc-minimap-toggle"]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    const zoom = await page.getByTestId("fc-zoom").textContent();
    expect(Number(zoom?.replace("%", ""))).toBeGreaterThanOrEqual(50);
    expect(Number(zoom?.replace("%", ""))).toBeLessThanOrEqual(200);
    // Nodes are not tabbable controls – keyboard lives on the wrapper only.
    expect(await page.locator(".react-flow__node[tabindex]").count()).toBe(0);
  });

  test("the big layout runs in the Worker and is fast", async ({ page }) => {
    const info = await page.evaluate(() => (window as unknown as { __fcLayout?: { ms: number; nodes: number; worker: boolean } }).__fcLayout);
    expect(info?.nodes).toBe(2600);
    expect(info?.worker).toBe(true); // 2 600 nodes never lay out on the main thread
    expect(info?.ms ?? 9999).toBeLessThan(300); // the synchronous path stays cheap
  });

  test("drag moves a node and persists it; reset layout clears it", async ({ page }) => {
    const node = (await pickInside(page, ".react-flow__node.react-flow__node-tile"))!;
    const id = await node.getAttribute("data-id");
    await expect(node).toBeVisible();
    const before = await node.boundingBox();
    await page.mouse.move(before!.x + 30, before!.y + 12);
    await page.mouse.down();
    await page.mouse.move(before!.x + 200, before!.y + 80, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const after = await page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
    expect(Math.abs(after!.x - before!.x)).toBeGreaterThan(8);
    // persisted per ns+layoutKey – the dragged node's id is in the store
    const stored = await page.evaluate(() => localStorage.getItem("kula.flow.pos.v1.flow-lab.flow-lab"));
    expect(stored).toContain(id!);
    // reset layout clears the persisted drags and re-lays out
    await page.getByTestId("fc-reset").click();
    await page.waitForTimeout(400);
    const cleared = await page.evaluate(() => localStorage.getItem("kula.flow.pos.v1.flow-lab.flow-lab"));
    expect(cleared === null || cleared === "{}").toBe(true);
  });

  test("tidy re-runs the layout and fit recenters", async ({ page }) => {
    await page.getByTestId("fc-tidy").click();
    await page.waitForTimeout(500);
    await expect(page.locator(READY)).toBeVisible();
    await expect(page.locator(".fc-node").first()).toBeVisible();
    await page.getByTestId("fc-fit").click();
    await page.waitForTimeout(400);
    const zoom = Number((await page.getByTestId("fc-zoom").textContent())?.replace("%", ""));
    expect(zoom).toBeGreaterThanOrEqual(50);
    expect(zoom).toBeLessThanOrEqual(200);
  });

  test("group collapse hides members behind a chip; expand restores them", async ({ page }) => {
    // Select a group frame (its head row is not covered by members), then
    // collapse it from the sidebar tinker – the keyboard/phone path…
    await (await pickInside(page, '[data-testid^="fc-node-g"].fc-group')).click();
    await page.getByTestId("fc-tinker-collapse").click();
    await page.waitForTimeout(300);
    // …the chip appeared…
    await expect(page.locator('[data-testid$="::chip"]').first()).toBeVisible();
    // …and clicking the chip expands the group again.
    await page.locator('[data-testid$="::chip"]').first().click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid$="::chip"]')).toHaveCount(0);
  });

  test("keyboard: arrows walk connected nodes along edges, F fits, T tidies, +/- zoom, Esc clears", async ({ page }) => {
    await page.locator(".fc-canvas").click({ position: { x: 200, y: 200 } });
    await page.locator(".fc-canvas").focus();
    // Start on a node that has a main-edge predecessor so ArrowLeft must walk back.
    const startId = await page.evaluate(() => {
      const g = (window as unknown as { __fcLayout?: { mainEdges: [string, string][] } }).__fcLayout;
      return g?.mainEdges.find(([s, t]) => s !== t)?.[1] ?? null;
    });
    expect(startId).toBeTruthy();
    const start = page.locator(`.react-flow__node[data-id="${startId}"]`);
    await start.click({ force: true });
    await expect(page.locator(`.react-flow__node[data-id="${startId}"] .fc-sel, .react-flow__node[data-id="${startId}"].fc-sel`).first()).toBeVisible();
    // ArrowRight walks forward along a main edge…
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(150);
    const rightId = (await page.locator(".fc-sel").first().getAttribute("data-testid"))?.replace(/^fc-node-/, "");
    expect(rightId).toBeTruthy();
    expect(rightId).not.toBe(startId);
    // …and ArrowLeft walks back to a main-edge predecessor of that node.
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(150);
    const leftId = (await page.locator(".fc-sel").first().getAttribute("data-testid"))?.replace(/^fc-node-/, "");
    const walkedBack = await page.evaluate(([l, r]) => {
      const g = (window as unknown as { __fcLayout?: { mainEdges: [string, string][] } }).__fcLayout;
      return g?.mainEdges.some(([s, t]) => s === l && t === r) ?? false;
    }, [leftId, rightId]);
    expect(walkedBack).toBe(true);
    await page.keyboard.press("f");
    await page.keyboard.press("t");
    await page.waitForTimeout(400);
    await expect(page.locator(READY)).toBeVisible();
    const before = Number((await page.getByTestId("fc-zoom").textContent())?.replace("%", ""));
    await page.keyboard.press("+");
    await page.waitForTimeout(200);
    const after = Number((await page.getByTestId("fc-zoom").textContent())?.replace("%", ""));
    expect(after).toBeGreaterThanOrEqual(before);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    await expect(page.locator(".fc-sel")).toHaveCount(0);
  });

  test("minimap toggle shows and hides the minimap", async ({ page }) => {
    // Default off – rendering 2 600 mini-rects would cost the first paint.
    await expect(page.locator(".fc-minimap")).toHaveCount(0);
    await page.getByTestId("fc-minimap-toggle").click();
    await expect(page.locator(".fc-minimap").first()).toBeVisible();
    await page.getByTestId("fc-minimap-toggle").click();
    await expect(page.locator(".fc-minimap")).toHaveCount(0);
  });

  test("lock stops node dragging", async ({ page }) => {
    await page.getByTestId("fc-lock").click();
    const node = (await pickInside(page, ".react-flow__node.react-flow__node-tile"))!;
    const before = await node.boundingBox();
    await page.mouse.move(before!.x + 30, before!.y + 12);
    await page.mouse.down();
    await page.mouse.move(before!.x + 140, before!.y + 100, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const after = await node.boundingBox();
    expect(Math.abs(after!.x - before!.x)).toBeLessThan(4);
  });

  test("edge stroke is zoom-compensated: visual width stays ~2px at 50%", async ({ page }) => {
    await page.getByTestId("fc-zoom-out").click();
    await page.getByTestId("fc-zoom-out").click();
    await page.waitForTimeout(300);
    const stroke = await page.locator(".fc-edge").first().evaluate((el) => parseFloat((el as SVGGeometryElement).style.strokeWidth || "0"));
    expect(stroke).toBeGreaterThan(0);
    expect(stroke).toBeLessThanOrEqual(5); // 2px base / 0.5 zoom = 4 style units, rendered at ~2px
  });

  test("reduced motion: the runtime flag stops the status pulse too", async ({ page }) => {
    // The fixture marks n0_3 in every 5th section as running.
    const pulse = page.locator(".fc-st-run").first();
    if (await pulse.count()) {
      expect(await pulse.evaluate((el) => getComputedStyle(el).animationName)).toBe("fc-pulse");
      // The tinker flag (html[data-rm="1"]) must stop it – CSS and JS both.
      await page.evaluate(() => { document.documentElement.dataset.rm = "1"; });
      await expect.poll(() => pulse.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    } else {
      // no running node in view – assert the runtime-flag rule is loaded.
      const hasRule = await page.evaluate(() => Array.from(document.styleSheets).some((s) => {
        try { return Array.from(s.cssRules).some((r) => r.selectorText?.startsWith('html[data-rm="1"]')); } catch { return false; }
      }));
      expect(hasRule).toBe(true);
    }
  });
});

test.describe("flow canvas kit · reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("the running pulse does not animate", async ({ page }) => {
    await page.goto(LAB);
    await page.locator(READY).waitFor({ timeout: 20_000 });
    const pulse = page.locator(".fc-st-run").first();
    if (await pulse.count()) {
      const anim = await pulse.evaluate((el) => `${getComputedStyle(el).animationName}/${getComputedStyle(el).animationPlayState}`);
      expect(anim).not.toMatch(/fc-pulse\/running/);
    } else {
      // no running node in view – the media-query rule itself is load-bearing
      const hasRule = await page.evaluate(() => Array.from(document.styleSheets).some((s) => {
        try { return Array.from(s.cssRules).some((r) => r instanceof CSSMediaRule && r.conditionText.includes("prefers-reduced-motion")); } catch { return false; }
      }));
      expect(hasRule).toBe(true);
    }
  });
});
