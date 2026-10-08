import { expect, test as base, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

function fixtureScript(): string {
  for (const cwd of [process.cwd(), path.resolve(process.cwd(), "..")]) {
    const p = path.join(cwd, "e2e", "fixture.sh");
    if (fs.existsSync(p)) return p;
  }
  throw new Error("e2e/fixture.sh not found");
}

const test = base.extend({
  fx: [
    async ({ }, use, workerInfo) => {
      const port = Number(process.env.KULA_PW_PORT ?? 7431) + 10 + workerInfo.workerIndex;
      const logFile = `/tmp/kula-fx-w${workerInfo.workerIndex}.log`;
      const log = fs.openSync(logFile, "w");
      const proc = spawn("sh", [fixtureScript(), String(port)], {
        cwd: path.dirname(fixtureScript()) + "/..",
        stdio: ["ignore", log, log],
        env: { ...process.env, TMPDIR: "/tmp" },
      });
      const url = `http://localhost:${port}`;
      const deadline = Date.now() + 180_000;
      let up = false;
      while (Date.now() < deadline) {
        try { if ((await fetch(url)).ok) { up = true; break; } } catch { /* not up yet */ }
        await new Promise((f) => setTimeout(f, 300));
      }
      if (!up) throw new Error(`fixture on port ${port} did not come up`);
      await use(url);
      proc.kill("SIGTERM");
      fs.closeSync(log);
    },
    { scope: "worker", timeout: 240_000 },
  ],
});

async function open(page: Page, hash: string, fx: string) {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
  });
  await page.goto(`${fx}/#${hash}`);
}

test("debug T1 edit loop", async ({ page, request }, workerInfo) => {
  const port = Number(process.env.KULA_PW_PORT ?? 7431) + 10 + workerInfo.workerIndex;
  const fx = `http://localhost:${port}`;
  const proc = spawn("sh", [fixtureScript(), String(port)], {
    cwd: path.dirname(fixtureScript()) + "/..",
    stdio: ["ignore", fs.openSync(`/tmp/kula-fx-dbg.log`, "w"), fs.openSync(`/tmp/kula-fx-dbg.log`, "w")],
    env: { ...process.env, TMPDIR: "/tmp" },
  });
  for (let up = Date.now() + 120_000; Date.now() < up; await new Promise((f) => setTimeout(f, 300))) {
    try { if ((await fetch(fx)).ok) break; } catch { /* not up yet */ }
  }
  test.setTimeout(180_000);
  const log = (...m: unknown[]) => console.log("DBG", new Date().toISOString().slice(11, 23), ...m);

  page.on("console", (c) => { if (c.type() === "error" || c.type() === "warning") log(`console ${c.type()}: ${c.text().slice(0, 200)}`); });
  page.on("request", (r) => { if (r.url().includes("/api/")) log(`> ${r.method()} ${r.url().split("/api")[1]}`); });
  page.on("response", async (r) => {
    if (r.url().includes("/api/agents/teams_save") || r.url().includes("/api/file")) {
      log(`< ${r.status()} ${r.url().split("/api")[1]}`);
      try { const b = await r.text(); log("   body:", b.slice(0, 300)); } catch { /* */ }
    }
  });
  page.on("requestfailed", (r) => log(`FAILED ${r.method()} ${r.url().split("/api")[1]} :: ${r.failure()?.errorText}`));

  await open(page, "agents/teams", fx);
  log("opened");
  const raw = await request.get(`${fx}/api/file?path=kula.toml`, { headers: { "x-kula-token": "test" } });
  log("raw status:", raw.status(), "url:", raw.url());
  log("raw body head:", (await raw.text()).slice(0, 200));
  const toml = JSON.parse(await request.get(`${fx}/api/file?path=kula.toml`, { headers: { "x-kula-token": "test" } }).then((r) => r.text()));
  log("toml before:", toml.content.length, "chars");

  // create team from template
  await page.getByLabel("New team from a template").click();
  await page.getByLabel("Team name").fill("e2e-crew");
  await page.getByRole("button", { name: /Create e2e-crew/ }).click();
  const t2 = await (await request.get(`${fx}/api/file?path=kula.toml`, { headers: { "x-kula-token": "test" } })).json();
  log("after create, e2e-crew in toml:", t2.content.includes('name = "e2e-crew"'));

  const inspector = page.locator(".map-inspector");
  const card = page.locator(".org-card").filter({ has: page.locator(".org-name", { hasText: "Cursor" }) });
  log("org-card Cursor count:", await card.count());

  for (let i = 0; i < 3; i++) {
    log(`--- iteration ${i}`);
    try {
      await card.click({ timeout: 3000 });
      log("clicked card");
      await inspector.getByLabel("Role").fill("welder");
      log("filled role");
      const hand = inspector.locator(".chip-toggle").filter({ hasText: "Codex" });
      log("hand count:", await hand.count());
      await hand.click({ timeout: 3000 });
      log("toggled on:", await hand.getAttribute("aria-pressed"));
      await hand.click({ timeout: 3000 });
      log("toggled off:", await hand.getAttribute("aria-pressed"));
      await page.getByRole("button", { name: "Back to the team" }).click({ timeout: 3000 });
      log("back to team");
      const save = page.getByRole("button", { name: "Save", exact: true }).first();
      await expect(save).toBeEnabled({ timeout: 3000 });
      log("save enabled");
      await save.click({ timeout: 3000 });
      log("clicked save");
      await page.waitForTimeout(1500);
      const t = await (await request.get(`${fx}/api/file?path=kula.toml`, { headers: { "x-kula-token": "test" } })).json();
      log("welder in toml after save:", t.content.includes("welder"));
      if (t.content.includes("welder")) break;
    } catch (e) {
      log("caught:", String(e).split("\n")[0]);
    }
  }
});
