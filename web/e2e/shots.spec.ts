import { expect, test, type Page } from "@playwright/test";

// README screenshots, against the seeded fixture (e2e/fixture.sh): run with
//   KULA_SHOTS=1 pnpm exec playwright test shots --project desktop
// and they land in docs/assets/. Skipped in the normal suite.
const FIXTURE = `http://localhost:${Number(process.env.KULA_PW_PORT ?? 7431) + 1}`;
const OUT = "../docs/assets";

test.skip(!process.env.KULA_SHOTS, "set KULA_SHOTS=1 to refresh the README screenshots");
test.use({ baseURL: FIXTURE, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
test.describe.configure({ mode: "serial" });

async function at(page: Page, hash: string, opening = false) {
  await page.addInitScript((opening) => {
    try { if (!opening) sessionStorage.setItem("kula.opened", "1"); else sessionStorage.removeItem("kula.opened"); } catch { /* */ }
    try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening })); } catch { /* */ }
  }, opening);
  await page.goto("about:blank"); // a hash-only change would not reload the app
  await page.goto(`/#${hash}`);
}
const settled = async (page: Page) => {
  await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(1200);
};
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/ui-${name}.png` });
async function inspect(page: Page, name: string) {
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type(name);
  await page.locator(".palette").getByText(name, { exact: true }).first().click();
  await expect(page.locator(".inspector h2")).toHaveText(name);
}

test("opening", async ({ page }) => {
  await at(page, "overview", true);
  await expect(page.locator(".opening")).toBeVisible();
  await page.waitForTimeout(2600);
  await shot(page, "opening");
});

test("overview", async ({ page }) => {
  await at(page, "overview");
  await expect(page.locator(".coupling .cpl-cell").first()).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, "overview");
});

test("graph, impact, fences and a path", async ({ page }) => {
  await at(page, "graph");
  await settled(page);
  await shot(page, "graph");
  await inspect(page, "context_pack");
  await page.locator(".inspector").getByRole("button", { name: "Impact" }).click();
  await page.waitForTimeout(1200);
  await shot(page, "impact");
  await page.keyboard.press("Escape");
  await page.keyboard.press("f");
  await page.waitForTimeout(900);
  await shot(page, "fences");
  await at(page, "graph/fences/refactor");
  await settled(page);
  await shot(page, "workflow-preview");
});

test("contrast: overlay, side by side, report", async ({ page }) => {
  for (const [mode, name] of [["overlay", "contrast"], ["split", "split"], ["report", "report"]]) {
    await at(page, `graph/contrast/main/feat%2Fagent-scope/${mode}`);
    await page.waitForTimeout(mode === "report" ? 1500 : 4500);
    await shot(page, name);
  }
});

test("git views", async ({ page }) => {
  await at(page, "changes");
  await page.locator(".list .item, .list .file").first().click().catch(() => {});
  await page.waitForTimeout(800);
  await shot(page, "changes");
  await at(page, "history");
  await page.waitForTimeout(1000);
  await shot(page, "history");
  await at(page, "branches");
  await page.waitForTimeout(2000);
  await shot(page, "compare");
});

test("proposals, issues, notes", async ({ page }) => {
  await at(page, "proposals/1");
  await page.waitForTimeout(2500);
  await shot(page, "proposal");
  await at(page, "issues/2");
  await page.waitForTimeout(800);
  await shot(page, "issues");
  await at(page, "notes");
  await page.waitForTimeout(800);
  await shot(page, "notes");
});

test("agents: overview, workflows, fences, memory, docs, connect", async ({ page }) => {
  await at(page, "agents");
  await expect(page.locator(".loop-step").first()).toBeVisible();
  await page.waitForTimeout(700); // cards fade in
  await shot(page, "agents");
  for (const t of ["workflows", "fences", "memory", "docs", "connect"]) {
    await at(page, `agents/${t}`);
    await page.waitForTimeout(900);
    await shot(page, `agents-${t}`);
  }
});

test("notes autofill", async ({ page }) => {
  await at(page, "graph");
  await settled(page);
  await inspect(page, "resolve_target");
  await page.locator(".rail").getByRole("button", { name: "Notes" }).click();
  const target = page.getByLabel("Note target");
  await target.fill("");
  await target.focus();
  await page.mouse.move(900, 700);
  await page.waitForTimeout(700);
  await shot(page, "autofill");
});

test("query, console", async ({ page }) => {
  await at(page, "query");
  await page.locator(".kq-ex").first().click();
  await expect(page.locator(".kq-table tbody tr").first()).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, "query");
  await at(page, "console");
  const input = page.getByRole("textbox", { name: "kula command" });
  await input.fill("guard list");
  await input.press("Enter");
  await expect(page.locator(".console .entry")).toHaveCount(1);
  await input.fill("memory recall publish");
  await input.press("Enter");
  await expect(page.locator(".console .entry")).toHaveCount(2);
  await page.waitForTimeout(400);
  await shot(page, "console");
});
