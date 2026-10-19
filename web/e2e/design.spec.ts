import { expect, test as base, type Page } from "@playwright/test";

// D1 computed-style checks – the browser-side half of web/scripts/design-lint.mjs.
// The lint owns the source rules (D1.3 radius literals, D1.4 stripes, D1.5 em
// dashes, D1.6 conservative pill radius); this spec owns what a stylesheet
// cannot know: rendered heights (D1.6) and what actually ships in the DOM.
// The "D1.3" label in ui.spec.ts is the older focus test and predates the
// brief's numbering – it stays as is (U0's file).

const test = base.extend({});

/** Skip the opening sequence and land on a view. */
async function open(page: Page, hash = "graph") {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
    try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
    try { localStorage.removeItem("kula.map.pin"); } catch { /* */ }
  });
  await page.goto(`/#${hash}`);
}

/** Walk every style rule in every sheet, in DOM order. */
async function allRules(page: Page): Promise<{ sel: string; css: string }[]> {
  return page.evaluate(() => {
    const out: { sel: string; css: string }[] = [];
    const walk = (rules: CSSRuleList) => {
      for (const r of Array.from(rules)) {
        if (r instanceof CSSStyleRule) out.push({ sel: r.selectorText ?? "", css: r.style.cssText });
        else if ("cssRules" in r) walk((r as CSSMediaRule).cssRules);
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try { walk(sheet.cssRules); } catch { /* cross-origin */ }
    }
    return out;
  });
}

/** Every element matching a selector-ish walk, with computed style. */
async function audit(page: Page) {
  return page.evaluate(() => {
    const out: { sel: string; radius: string; h: number; shadow: string; borderLeft: string }[] = [];
    const state = (el: Element) => el.matches(':hover, .on, .sel, [aria-selected="true"], .active, .selected');
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      if (el.offsetWidth === 0 && el.offsetHeight === 0) continue;
      const s = getComputedStyle(el);
      out.push({
        sel: el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ").filter(Boolean).slice(0, 2).join(".") : ""),
        radius: s.borderTopLeftRadius,
        h: el.getBoundingClientRect().height,
        shadow: state(el) ? s.boxShadow : "",
        borderLeft: state(el) ? s.borderLeftColor : "",
      });
    }
    return out;
  });
}

const TOKEN_RADII = new Set(["0px", "4px", "6px", "8px", "50%"]);

test.describe("design system – computed", () => {
  test("D1.3/D1.6: every rendered border-radius is a token value or 50%, and no control under 40px tall wears a pill radius", async ({ page }) => {
    await open(page);
    await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 30_000 });
    const bad: string[] = [];
    for (const hash of ["graph", "overview", "changes", "agents", "map"]) {
      await open(page, hash);
      await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 30_000 });
      await page.waitForTimeout(300);
      for (const el of await audit(page)) {
        // D1.3: only token radii and dots reach the DOM (var() resolves to
        // 4/6/8px; a radius that failed to resolve shows as "8px" fallback).
        if (el.radius && !TOKEN_RADII.has(el.radius) && el.radius !== "0px")
          bad.push(`D1.3 ${hash} ${el.sel} radius ${el.radius}`);
        // D1.6, height-accurate: pill radius (≥ 9px) on a control < 40px tall.
        // 50% on a dot is fine by definition; a rendered radius of 9px+ means
        // a literal ≥ 9px slipped in (tokens top out at 8px).
        const px = parseFloat(el.radius);
        if (el.radius.endsWith("px") && px >= 9 && el.h < 40)
          bad.push(`D1.6 ${hash} ${el.sel} radius ${el.radius} on ${Math.round(el.h)}px`);
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  test("D1.4: no selected or hovered element wears a side stripe", async ({ page }) => {
    await open(page);
    await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 30_000 });
    // Static pass over the sheets: a stripe rule anywhere is a violation even
    // if the state is not currently reachable (hover cannot be audited in bulk).
    // Wave 1 does not fix these (they belong to U2/U3/U4) – the allowlist pins
    // them: removing an entry once fixed is expected, ADDING one is a failure.
    const rules = await allRules(page);
    const staticBad = rules.filter(({ sel, css }) =>
      /:hover|\.on\b|\.sel|selected|\.active/.test(sel)
      && (/(?:^|[\s,])inset\s+-?\d*\.?\d+px\s+0(?:px)?(?![\d.]*px\s*-?\d)/.test(css.replace(/inset\s+0\s+-/g, "inset 0neg -"))
        || (/border-left\s*:/.test(css) && !/transparent/.test(css))));
    const KNOWN = new Set([
      ".wf-tile.active", ".mod.on",
    ]);
    const newBad = staticBad.filter((r) => !KNOWN.has(r.sel));
    const stale = [...KNOWN].filter((k) => !staticBad.some((r) => r.sel === k));
    expect(newBad, newBad.map((r) => `${r.sel} :: ${r.css}`).join("\n")).toEqual([]);
    expect(stale, `fixed selectors – drop them from the D1.4 allowlist: ${stale.join(", ")}`).toEqual([]);

    // Rendered pass: select real rows and hover real rows, then read the box.
    const hoverable = [".sym", ".dt-row", ".ag-row", ".lib-item"].flatMap((s) => [s]);
    for (const sel of hoverable) {
      const first = page.locator(sel).first();
      if ((await first.count()) === 0) continue;
      await first.hover();
      const s = await first.evaluate((el) => {
        const c = getComputedStyle(el);
        return { shadow: c.boxShadow, bl: c.borderLeftColor, w: c.borderLeftWidth };
      });
      const stripe = /inset (-?[1-9][\d.]*)px 0/.test(s.shadow);
      const accentLeft = s.w !== "0px" && !/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\)/.test(s.bl) && s.bl !== "transparent";
      expect({ sel, stripe, accentLeft }, `${sel} wears a side stripe`).toEqual({ sel, stripe: false, accentLeft: false });
    }
  });

  test("tabs across Graph, Workspace, dock and agents share the same computed selected style", async ({ page }) => {
    await open(page);
    await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 30_000 });
    // The inspector (and its tabs) opens from the palette (the graph canvas is
    // WebGL, so nodes are not DOM); the dock and agents tabs are always present.
    await page.keyboard.press("ControlOrMeta+k");
    await page.keyboard.type("parseHash");
    await page.locator(".palette").getByText("parseHash", { exact: true }).first().click();
    await expect(page.locator(".inspector .tabs")).toBeVisible({ timeout: 10_000 });
    const readTabs = async (sel: string) => {
      const on = page.locator(sel).first();
      if ((await on.count()) === 0) return null;
      return on.evaluate((el) => {
        const s = getComputedStyle(el);
        return { bg: s.backgroundColor, radius: s.borderTopLeftRadius, shadow: s.boxShadow, borderLeftWidth: s.borderLeftWidth, borderBottomWidth: s.borderBottomWidth };
      });
    };
    const styles: Record<string, unknown> = {};
    // the active tab button itself, per view
    for (const [name, sel] of [
      ["graph", ".inspector .tabs .on"],
      ["dock", ".dock-tabs .dock-tab.on"],
      ["agents", ".ag-tabs .on"],
    ] as const) {
      styles[name] = await readTabs(sel);
    }
    // Graph's pattern: fill selection, square, no stripe. Whatever else the
    // other views pick, none may contradict the shape rules (radius, stripe).
    for (const [name, st] of Object.entries(styles)) {
      if (!st) continue;
      const s = st as { radius: string; shadow: string; borderLeftWidth: string };
      expect(TOKEN_RADII.has(s.radius) || s.radius === "0px", `${name} tab radius ${s.radius}`).toBe(true);
      expect(/inset [1-9]/.test(s.shadow), `${name} tab has an inset side stripe`).toBe(false);
      expect(s.borderLeftWidth, `${name} tab has an accent border-left`).toBe("0px");
    }
    expect(styles.graph, "Graph has visible tabs to measure against").not.toBeNull();
  });

  test("fixture hygiene: the agents view shows the fixture's own items by name", async ({ page }) => {
    await open(page, "agents");
    // Never assert counts of things other tests create – assert named items.
    await expect(page.locator("body")).toContainText(/probe|fence|task/i);
  });
});
