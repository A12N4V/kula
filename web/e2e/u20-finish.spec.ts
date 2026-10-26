import { expect, test as base, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

// U20 · agents surfaces finishing: settings toggles that show two states and
// the Workspace/Scopes settings that used to need a hand-edited kula.toml, the
// card mark as a real "Edit logo" button with a studio that shows its values
// and offers Reset/Cancel, agent cards with a header "New agent" and an
// overflow delete, the Memory list grouped by agent with the graph behind a
// toggle, and Notes as one list + graph.

function fixtureScript(): string {
  for (const cwd of [process.cwd(), path.resolve(process.cwd(), "..")]) {
    const p = path.join(cwd, "e2e", "fixture.sh");
    if (fs.existsSync(p)) return p;
  }
  throw new Error("e2e/fixture.sh not found");
}

const test = base.extend<{ fx: string }>({
  fx: [
    async ({ }, use, workerInfo) => {
      let port = Number(process.env.KULA_PW_PORT ?? 7431) + 30 + workerInfo.workerIndex;
      const taken = async (p: number) => {
        try { await fetch(`http://localhost:${p}/`, { signal: AbortSignal.timeout(300) }); return true; } catch { return false; }
      };
      for (let p = port + 1; p < port + 12 && (await taken(port)); p++) port = p;
      const logFile = `/tmp/kula-fx-u20-w${workerInfo.workerIndex}.log`;
      const log = fs.openSync(logFile, "w");
      const proc = spawn("sh", [fixtureScript(), String(port)], {
        cwd: path.dirname(fixtureScript()) + "/..",
        stdio: ["ignore", log, log],
        env: { ...process.env, TMPDIR: "/tmp" },
      });
      const base = `http://localhost:${port}`;
      for (let i = 0; i < 240; i++) {
        try { const r = await fetch(`${base}/`); if (r.ok) break; } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 250));
      }
      await use(base);
      proc.kill("SIGTERM");
    },
    { scope: "worker" },
  ],
});

async function open(page: Page, fx: string, hash: string, wait: string) {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
    try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto(`${fx}/#${hash}`);
  await expect(page.getByTestId(wait)).toBeVisible();
}

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "own fixture, desktop only");
});

test.describe("settings", () => {
  test("toggles keep their label beside them and show two states", async ({ page, fx }) => {
    await open(page, fx, "agents/settings", "set-memory");
    const rows = page.locator(".set-row.toggle");
    await expect(rows.first()).toBeVisible();
    // the toggle sits beside the label, not underneath as a full-width bar
    const box = await rows.first().boundingBox();
    expect(box!.width).toBeLessThan(1200);
    const mem = page.getByTestId("set-memory");
    await expect(mem).toHaveAttribute("aria-checked", /true|false/);
  });

  test("workspace settings exist without hand-editing kula.toml", async ({ page, fx }) => {
    await open(page, fx, "agents/settings", "set-memory");
    for (const id of ["set-solo", "set-max-risk", "set-exclude", "set-max-file-kb", "set-default-branch", "set-pause-ms"]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    await expect(page.getByTestId("set-scopes")).toBeVisible();
  });
});

test.describe("agent cards", () => {
  test("the mark is an Edit logo button and the studio shows values, Reset and Cancel", async ({ page, fx }) => {
    await open(page, fx, "agents", "ag-head");
    await expect(page.getByTestId("ag-new")).toBeVisible();
    await expect(page.locator("button[aria-label^='Edit logo']").first()).toBeVisible();
    await expect(page.getByTestId("ag-src-filter")).toBeVisible();
    // open the studio from a mark
    await page.locator("button[aria-label^='Edit logo']").first().click();
    await expect(page.getByTestId("logo-studio")).toBeVisible();
    await expect(page.getByTestId("logo-dims-state")).toHaveText(/2D|3D/);
    await expect(page.getByTestId("logo-yaw-val")).toContainText("°");
    await expect(page.getByTestId("logo-density-val")).toBeVisible();
    await expect(page.getByTestId("logo-reset")).toBeVisible();
    await expect(page.getByTestId("logo-cancel")).toBeVisible();
    await page.getByTestId("logo-cancel").click();
    await expect(page.getByTestId("logo-studio")).toHaveCount(0);
  });

  test("a kula.toml agent offers delete in its overflow; builtins do not", async ({ page, fx }) => {
    await open(page, fx, "agents", "ag-head");
    const custom = page.locator(".ag-card").filter({ hasText: "kula.toml" }).first();
    if (await custom.count()) {
      await custom.hover();
      await expect(custom.locator("button[aria-label^='Delete']")).toBeVisible();
    }
    const builtin = page.locator(".ag-card").filter({ hasText: "built in" }).first();
    await builtin.hover();
    await expect(builtin.locator("button[aria-label^='Delete']")).toHaveCount(0);
  });
});

test.describe("memory", () => {
  test("one list grouped by agent, the graph behind a toggle", async ({ page, fx }) => {
    await open(page, fx, "agents/memory", "mem-graph-toggle");
    await expect(page.getByTestId("mem-graph-toggle")).toBeVisible();
    // the graph is not the default view
    await expect(page.locator(".m1-wrap, svg[aria-label^='Memory graph']").first()).toHaveCount(0);
    // the fixture seeds two memories by agent:e2e, so grouping is real
    await expect(page.locator(".ag-mem-group").first()).toBeVisible();
    await expect(page.locator(".ag-mem-author").first()).toContainText("agent:e2e");
    await page.getByTestId("mem-graph-toggle").click();
    await expect(page.locator("svg[aria-label^='Memory graph']").first()).toBeVisible();
  });
});

test.describe("notes", () => {
  test("one list plus the graph – no duplicate card column", async ({ page, fx }) => {
    await open(page, fx, "notes", "u14-search");
    // the old grouped card column is gone: at most the picked note renders,
    // and the fixture's one note is really in the list (never a vacuous pass)
    const sideNotes = page.locator(".notes-side .note");
    expect(await sideNotes.count()).toBeLessThanOrEqual(1);
    await expect(page.getByText("One verdict per path").first()).toBeVisible();
    await expect(page.getByTestId("notes-graph-toggle")).toBeVisible();
  });
});
