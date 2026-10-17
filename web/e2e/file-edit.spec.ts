// E1: the editable code panel. Editing happens only on a scratch file this
// spec creates in the disposable agents fixture (the same repo clone the
// agents tests write to), and the file is deleted again afterwards – the
// real repository is never touched.
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { FIXTURE } from "../playwright.config";

const port = Number(process.env.KULA_PW_PORT ?? 7431) + 1;
// The template every test starts from; the symbol name is substituted per test.
const CONTENT = "export function e1_probe() {\n  return 1;\n}\n";

const api = (page: Page, method: string, u: string, body?: unknown) =>
  page.evaluate(([m, u, body]) =>
    fetch(u, {
      method: m,
      headers: { "x-kula-token": document.querySelector('meta[name="kula-token"]')?.content ?? "", "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }).then((r) => r.json().then((j) => [r.status, j])),
  [method, u, body]);

async function openPanel(page: Page, name: string, fn: string) {
  // Workers share this fixture: wait until our symbol is searchable (another
  // worker's reindex can briefly hold the store), indexing again if needed.
  for (let i = 0; i < 30; i++) {
    const [, s] = await api(page, "GET", `/api/search?q=${encodeURIComponent(fn)}`);
    if (Array.isArray(s) && s.length) break;
    if (i === 9) await api(page, "POST", "/api/index");
    await page.waitForTimeout(1_000);
  }
  await page.getByRole("button", { name: /search/i }).first().click();
  await expect(page.locator(".palette input")).toBeVisible({ timeout: 10_000 });
  await page.keyboard.type(fn);
  const hit = page.locator(".palette .res").filter({ hasText: fn }).first();
  await expect(hit).toBeVisible({ timeout: 15_000 });
  await hit.click();
  // The graph focuses the symbol; the inspector's source row (labelled
  // "<file>:<line>") opens the code panel.
  const row = page.locator(`text=${name}:1`).last();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  const panel = page.locator(".code-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".cp-code")).toContainText(fn, { timeout: 15_000 });
}

// Save from the panel. The fixture runs an agent task scoped to src/mcp.rs and
// src/agent.rs, so a scratch file at the repo root is fenced: the panel asks
// for the "I know this is fenced" tick before it writes. The helper waits for
// that confirm row when it appears, so each test below asserts its own
// behaviour rather than the fence.
async function confirmFenceIfShown(panel: ReturnType<Page["locator"]>) {
  const fence = panel.locator("[data-testid=cp-note-fence]");
  try {
    await fence.waitFor({ state: "visible", timeout: 4_000 });
    const anyway = fence.locator("[data-testid=cp-save-anyway]");
    await expect(anyway).toBeDisabled();
    await fence.locator("[data-testid=cp-fence-tick]").check();
    await expect(anyway).toBeEnabled();
    await anyway.click();
  } catch { /* no fence: the save went straight through */ }
}

async function saveViaPanel(page: Page, panel: ReturnType<Page["locator"]>) {
  await panel.locator("[data-testid=cp-save]").click();
  await confirmFenceIfShown(panel);
}

test.describe("e1: editable code panel", () => {
  let repo: string;
  let file: string; // absolute path of this test's scratch file
  let base: string; // the file's starting text, with this test's symbol name in it
  let name: string;
  let fnName: string;
  // Workers share the fixture repo and run in parallel: prefix every name with
  // this worker's index so a worker never touches another's scratch file, and
  // sweep only its own leftovers from earlier (timed-out) runs.
  let who: string;

  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000);
    who = `e1_scratch_w${test.info().workerIndex}_`;
    repo = fs.readFileSync(`/tmp/kula-fixture-${port}.path`, "utf8").trim();
    for (const f of fs.readdirSync(repo)) if (f.startsWith(who)) fs.rmSync(path.join(repo, f), { force: true });
    name = `${who}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}.ts`;
    fnName = `e1_fn_${Math.random().toString(36).slice(2, 8)}`;
    base = CONTENT.replace("e1_probe", fnName);
    file = path.join(repo, name);
    fs.writeFileSync(file, base);
    await page.addInitScript(() => {
      try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
      try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
    });
    await page.goto(`${FIXTURE}/#overview`);
    await api(page, "POST", "/api/index");
  });

  test.afterEach(() => {
    try { fs.rmSync(file, { force: true }); } catch { /* already gone */ }
  });

  test("edit shows Revert and Save, revert clears them", async ({ page }) => {
    await openPanel(page, name, fnName);
    const panel = page.locator(".code-panel");
    await expect(panel.locator("[data-testid=cp-revert]")).toHaveCount(0);
    await expect(panel.locator("[data-testid=cp-save]")).toHaveCount(0);
    await panel.locator("[data-testid=cp-area]").fill(base + "// not saved yet\n");
    await expect(panel.locator("[data-testid=cp-modified]")).toBeVisible();
    await expect(panel.locator("[data-testid=cp-revert]")).toBeVisible();
    await expect(panel.locator("[data-testid=cp-save]")).toBeVisible();
    await panel.locator("[data-testid=cp-revert]").click();
    await expect(panel.locator("[data-testid=cp-revert]")).toHaveCount(0);
    await expect(panel.locator("[data-testid=cp-save]")).toHaveCount(0);
    await expect(panel.locator("[data-testid=cp-modified]")).toHaveCount(0);
    // The file on disk is unchanged after a revert.
    expect(fs.readFileSync(file, "utf8")).toBe(base);
  });

  test("save writes to disk and Revert/Save hide", async ({ page }) => {
    await openPanel(page, name, fnName);
    const panel = page.locator(".code-panel");
    const saved = base + "// saved from the panel\n";
    await panel.locator("[data-testid=cp-area]").fill(saved);
    await saveViaPanel(page, panel);
    await expect(panel.locator("[data-testid=cp-revert]")).toHaveCount(0);
    await expect(panel.locator("[data-testid=cp-save]")).toHaveCount(0);
    await expect(panel.locator("[data-testid=cp-modified]")).toHaveCount(0);
    expect(fs.readFileSync(file, "utf8")).toBe(saved);
    // The panel's hash now matches what is on disk.
    const [, g] = await api(page, "GET", `/api/file?path=${encodeURIComponent(name)}`);
    expect(g.content).toBe(saved);
    expect(g.base_hash).toHaveLength(64);
  });

  test("Cmd/Ctrl+S saves without a mouse", async ({ page }) => {
    await openPanel(page, name, fnName);
    const panel = page.locator(".code-panel");
    const saved = base + "// saved with Cmd+S\n";
    await panel.locator("[data-testid=cp-area]").fill(saved);
    await page.keyboard.press("ControlOrMeta+s");
    // ⌘S runs the same save: the fence confirm row appears, the tick writes.
    await confirmFenceIfShown(panel);
    await expect(panel.locator("[data-testid=cp-save]")).toHaveCount(0);
    expect(fs.readFileSync(file, "utf8")).toBe(saved);
  });

  test("a fenced file shows the verdict and asks before saving", async ({ page }) => {
    await openPanel(page, name, fnName);
    const panel = page.locator(".code-panel");
    await panel.locator("[data-testid=cp-area]").fill(base + "// behind a fence\n");
    await panel.locator("[data-testid=cp-save]").click();
    const fence = panel.locator("[data-testid=cp-note-fence]");
    await expect(fence).toBeVisible();
    await expect(fence).toContainText("Fenced:");
    // Without the tick, nothing is written and the panel stays dirty.
    await expect(fence.locator("[data-testid=cp-save-anyway]")).toBeDisabled();
    expect(fs.readFileSync(file, "utf8")).toBe(base);
    await fence.locator("[data-testid=cp-fence-tick]").check();
    await fence.locator("[data-testid=cp-save-anyway]").click();
    await expect(panel.locator("[data-testid=cp-save]")).toHaveCount(0);
    expect(fs.readFileSync(file, "utf8")).toBe(base + "// behind a fence\n");
  });

  test("a change on disk while editing shows the conflict row", async ({ page }) => {
    await openPanel(page, name, fnName);
    const panel = page.locator(".code-panel");
    await panel.locator("[data-testid=cp-area]").fill(base + "// panel edit\n");
    // Simulate another writer before our save lands.
    fs.writeFileSync(file, "// someone else wrote first\n");
    // The save passes the fence confirm row first, then the server's 409.
    await panel.locator("[data-testid=cp-save]").click();
    await confirmFenceIfShown(panel);
    const note = panel.locator("[data-testid=cp-note-conflict]");
    await expect(note).toBeVisible({ timeout: 15_000 });
    await expect(note).toContainText("changed on disk");
    await expect(note.locator("[data-testid=cp-reload]")).toBeVisible();
    await expect(note.locator("[data-testid=cp-overwrite]")).toBeVisible();
    // Reload adopts what is on disk and clears the note.
    await note.locator("[data-testid=cp-reload]").click();
    await expect(note).toHaveCount(0);
    await expect(panel.locator(".cp-code")).toContainText("someone else wrote first");
  });

  test("Esc with unsaved changes asks inline before closing", async ({ page }) => {
    await openPanel(page, name, fnName);
    const panel = page.locator(".code-panel");
    await panel.locator("[data-testid=cp-area]").fill(base + "// unsaved\n");
    await page.keyboard.press("Escape");
    const note = panel.locator("[data-testid=cp-note-discard]");
    await expect(note).toBeVisible();
    await note.locator("[data-testid=cp-keep]").click();
    await expect(panel).toBeVisible(); // kept editing
    await page.keyboard.press("Escape");
    await expect(panel.locator("[data-testid=cp-note-discard]")).toBeVisible();
    await expect(panel.locator("[data-testid=cp-note-discard] [data-testid=cp-discard]")).toBeVisible();
    await panel.locator("[data-testid=cp-note-discard] [data-testid=cp-discard]").click();
    await expect(panel).toHaveCount(0);
    expect(fs.readFileSync(file, "utf8")).toBe(base);
  });

  test("Tab inserts two spaces", async ({ page }) => {
    await openPanel(page, name, fnName);
    const panel = page.locator(".code-panel");
    const area = panel.locator("[data-testid=cp-area]");
    await area.fill("");
    await area.click();
    await page.keyboard.press("Tab");
    await expect(area).toHaveValue("  ");
    await expect(panel.locator("[data-testid=cp-save]")).toBeVisible();
  });
});