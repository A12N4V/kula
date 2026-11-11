// F1 · the perf harness: first canvas paint ≤ 1 500 ms and mean frame ≤ 20 ms
// during a 2-second scripted pan, on the 2 600-node #flow-lab fixture at
// 1440×900. Numbers are proof (see "Performance rules" in BRIEF.md).
import { expect, test } from "@playwright/test";

const LAB = "/#/flow-lab";
const READY = '[data-testid="flow-canvas"][data-fc-ready="1"]';

test.use({ viewport: { width: 1440, height: 900 } });

test.describe("flow canvas performance", () => {
  test("first canvas paint ≤ 1500 ms on the 2600-node lab", async ({ page }) => {
    // The paint timestamp is recorded in the page (MutationObserver on the
    // ready attribute) so Playwright's own polling latency never inflates it.
    await page.addInitScript(() => {
      (window as unknown as { __ready?: number }).__ready = undefined;
      const mo = new MutationObserver(() => {
        const el = document.querySelector('[data-testid="flow-canvas"]');
        if (el && el.getAttribute("data-fc-ready") === "1" && (window as unknown as { __ready?: number }).__ready === undefined) {
          (window as unknown as { __ready?: number }).__ready = performance.now();
        }
      });
      document.addEventListener("DOMContentLoaded", () => mo.observe(document.body, { subtree: true, attributes: true, childList: true }));
    });
    await page.goto(LAB);
    await page.waitForFunction(() => (window as unknown as { __ready?: number }).__ready !== undefined, { timeout: 20_000 });
    const paint = await page.evaluate(() => (window as unknown as { __ready?: number }).__ready ?? 0);
    // Print it so the RESULT notes can quote a measured number.
    console.log(`PERF first-canvas-paint ${Math.round(paint)} ms (bar 1500 ms)`);
    expect(paint).toBeLessThanOrEqual(1500);
  });

  test("mean frame ≤ 20 ms during a 2 s scripted pan", async ({ page }) => {
    await page.goto(LAB);
    await page.locator(READY).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(2500); // hydration finishes before the pan starts
    // rAF timestamp collector in the page.
    await page.evaluate(() => {
      const w = window as unknown as { __frames: number[]; __on: boolean };
      w.__frames = [];
      w.__on = true;
      const loop = (t: number) => {
        w.__frames.push(t);
        if (w.__on) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    // Scripted pan: middle-drag the pane for ~2 s.
    await page.mouse.move(720, 450);
    await page.mouse.down({ button: "middle" });
    const steps = 40;
    for (let i = 0; i < steps; i++) {
      await page.mouse.move(720 + (i % 2 === 0 ? -200 : 200), 450 + (i % 3 === 0 ? -120 : 120), { steps: 4 });
      await page.waitForTimeout(50);
    }
    await page.mouse.up({ button: "middle" });
    const mean = await page.evaluate(() => {
      const w = window as unknown as { __frames: number[]; __on: boolean };
      w.__on = false;
      const f = w.__frames;
      const deltas: number[] = [];
      for (let i = 1; i < f.length; i++) deltas.push(f[i] - f[i - 1]);
      deltas.sort((a, b) => a - b);
      const avg = deltas.reduce((s, d) => s + d, 0) / Math.max(1, deltas.length);
      return { avg, n: deltas.length, p95: deltas[Math.floor(deltas.length * 0.95)] ?? 0 };
    });
    console.log(`PERF mean-frame ${mean.avg.toFixed(2)} ms over ${mean.n} frames (bar 20 ms, p95 ${mean.p95.toFixed(1)} ms)`);
    expect(mean.n).toBeGreaterThan(30);
    expect(mean.avg).toBeLessThanOrEqual(20);
  });
});
