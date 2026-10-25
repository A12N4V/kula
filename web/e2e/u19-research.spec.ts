import { expect, test as base, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

// U19: research loops and templates as portfolio cards. A loop card carries
// the same layout as an agent card – the loop's harmonograph on top in the
// research family (green–teal, 120–170°, one hue pair hashed per name), a
// mono eyebrow, a light display title, an italic serif description and accent
// tags. Template cards start a custom loop; a card opens the loop's editor;
// a built-in loop deletes as a hide and comes back through "restore".

function fixtureScript(): string {
  for (const cwd of [process.cwd(), path.resolve(process.cwd(), "..")]) {
    const p = path.join(cwd, "e2e", "fixture.sh");
    if (fs.existsSync(p)) return p;
  }
  throw new Error("e2e/fixture.sh not found");
}

/** The research tests write kula.toml, so every worker gets its own fixture
 *  (the same pattern ui.spec uses) – no shared state between workers. */
const test = base.extend<{ fx: string }>({
  fx: [
    async ({ }, use, workerInfo) => {
      let port = Number(process.env.KULA_PW_PORT ?? 7431) + 20 + workerInfo.workerIndex;
      const taken = async (p: number) => {
        try { await fetch(`http://localhost:${p}/`, { signal: AbortSignal.timeout(300) }); return true; } catch { return false; }
      };
      for (let p = port + 1; p < port + 12 && (await taken(port)); p++) port = p;
      const logFile = `/tmp/kula-fx-u19-w${workerInfo.workerIndex}.log`;
      const log = fs.openSync(logFile, "w");
      const proc = spawn("sh", [fixtureScript(), String(port)], {
        cwd: path.dirname(fixtureScript()) + "/..",
        stdio: ["ignore", log, log],
        env: { ...process.env, TMPDIR: "/tmp" },
      });
      const base = `http://localhost:${port}`;
      for (let i = 0; i < 240; i++) {
        try { const r = await fetch(`${base}/`); if (r.ok) break; } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 500));
      }
      await use(base);
      proc.kill("SIGTERM");
      fs.closeSync(log);
    },
  ],
});

async function open(page: Page, fx: string, hash = "agents/research") {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
    try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto(`${fx}/#${hash}`);
  await expect(page.getByTestId("rs-card-add")).toBeVisible();
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

test.describe.configure({ mode: "serial" });

// The research tests write kula.toml on their own fixture: desktop only.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "writes to its own fixture");
});

test.describe("research cards", () => {
  test("loop and template cards carry the agent card layout and the research family", async ({ page, fx }) => {
    // The fixture has no loop: create one through the form (the + card).
    await open(page, fx);
    await page.getByTestId("rs-card-add").click();
    const form = page.getByTestId("rs-form");
    await expect(form).toBeVisible();
    await form.getByLabel("Loop name").fill("u19-loop");
    await form.getByLabel("Metric command").fill("echo 41");
    await form.getByRole("button", { name: "Create u19-loop" }).click();
    // The card grid: the loop card reads like an agent card.
    const card = page.getByTestId("rs-card-u19-loop");
    await expect(card).toBeVisible();
    await expect(card.locator(".card__t")).toHaveText("u19-loop");
    await expect(card.locator(".card__d")).toContainText("Seconds the test suite");
    await expect(card.locator(".card__fmt")).toContainText("lower");
    await expect(card.locator(".card__meta")).toContainText("kula.toml");
    await expect(card.locator(`[data-testid=rs-art-u19-loop] svg`)).toBeVisible();
    // The research family: every mark hue inside 120–170°.
    const hs = await hues(page, "[data-testid=rs-art-u19-loop]");
    expect(hs.length).toBeGreaterThan(0);
    for (const h of hs) { expect(h).toBeGreaterThanOrEqual(120); expect(h).toBeLessThanOrEqual(170); }
    // Template cards: one per template, each with its own mark.
    const tpls = page.getByTestId("rs-templates").locator(".rs-tpl");
    await expect(tpls).toHaveCount(7);
    for (const t of await tpls.all()) await expect(t.locator(".card__art svg")).toBeVisible();
  });

  test("a card opens the loop editor; the mark opens the logo studio", async ({ page, fx }) => {
    await open(page, fx);
    await page.getByTestId("rs-card-add").click();
    const form = page.getByTestId("rs-form");
    await form.getByLabel("Loop name").fill("u19-open");
    await form.getByLabel("Metric command").fill("echo 7");
    await form.getByRole("button", { name: "Create u19-open" }).click();
    // Creating opens the loop editor with the loop's structure.
    const panel = page.getByTestId("rs-open");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("may edit");
    await expect(panel.locator(".r-name")).toHaveText("u19-open");
    await panel.getByRole("button", { name: "Close loop" }).click();
    await expect(page.getByTestId("rs-open")).toHaveCount(0);
    // The mark is the studio's door, like on agent cards.
    await page.getByTestId("rs-art-u19-open").click();
    await expect(page.getByTestId("logo-studio")).toBeVisible();
    await page.getByTestId("logo-close").click();
    await expect(page.getByTestId("logo-studio")).toHaveCount(0);
  });

  test("a template card prefills the new-loop form; the loop is saved through research_template_save", async ({ page, fx }) => {
    await open(page, fx);
    await page.getByTestId("rs-tpl-lint").locator(".card__t").click();
    const form = page.getByTestId("rs-form");
    await expect(form).toBeVisible();
    await expect(form).toContainText("from Fewer lint warnings");
    await expect(form.getByLabel("Metric command")).not.toHaveValue("");
    await form.getByLabel("Loop name").fill("u19-lint");
    await form.getByRole("button", { name: "Create u19-lint" }).click();
    await expect(page.getByTestId("rs-open").locator(".r-name")).toHaveText("u19-lint");
    // The loop landed in kula.toml as its own workflow.
    const tok = await page.evaluate(() => document.querySelector('meta[name="kula-token"]')?.content ?? "test");
    const readToml = async () => (await (await page.request.get("/api/file?path=kula.toml", { headers: { "x-kula-token": tok } })).json()).content as string;
    await expect.poll(readToml).toContain('name = "u19-lint"');
  });

  test("deleting a custom loop removes it; a built-in hides with a restore chip", async ({ page, fx }) => {
    await open(page, fx);
    // Custom loop: delete asks once, then the card is gone.
    await page.getByTestId("rs-card-add").click();
    const form = page.getByTestId("rs-form");
    await form.getByLabel("Loop name").fill("u19-gone");
    await form.getByLabel("Metric command").fill("echo 3");
    await form.getByRole("button", { name: "Create u19-gone" }).click();
    await page.getByTestId("rs-open").getByTestId("rs-delete").click();
    await page.getByTestId("rs-open").getByTestId("rs-delete").click();
    await expect(page.getByTestId("rs-card-u19-gone")).toHaveCount(0);
    // Built-in: hide the `explore` workflow (it is not a loop, but the hide
    // and restore path is the same one a built-in loop takes).
    const tok = await page.evaluate(() => document.querySelector('meta[name="kula-token"]')?.content ?? "test");
    await page.request.post("/api/agents/research_template_delete", { data: { name: "explore" }, headers: { "x-kula-token": tok } });
    await page.reload();
    await expect(page.getByTestId("rs-restore")).toBeVisible();
    await page.getByTestId("rs-restore").getByRole("button", { name: "restore explore" }).click();
    await expect(page.getByTestId("rs-restore")).toHaveCount(0);
    const readToml = async () => (await (await page.request.get("/api/file?path=kula.toml", { headers: { "x-kula-token": tok } })).json()).content as string;
    await expect.poll(readToml).not.toContain("disabled");
  });
});
