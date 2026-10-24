// U14: notes open in the editor. Seeded notes are created through the API in
// the disposable agents fixture, so the real repository is never touched.
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE } from "../playwright.config";

const api = async (page: Page, method: string, u: string, body?: unknown): Promise<[number, unknown]> =>
  page.evaluate(async ([m, u, body]) => {
    const r = await fetch(u, {
      method: m,
      headers: { "x-kula-token": document.querySelector('meta[name="kula-token"]')?.content ?? "", "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const t = await r.text();
    return [r.status, t ? JSON.parse(t) : null];
  }, [method, u, body] as const);

async function seedNote(page: Page, target: string, body: string): Promise<number> {
  const [, j] = await api(page, "POST", "/api/meta/notes/new", { target, body });
  return (j as { id?: number }).id ?? 0;
}

async function openNotes(page: Page) {
  await page.goto(`${FIXTURE}/#notes`);
  await expect(page.getByTestId("u14-new-note")).toBeVisible({ timeout: 15_000 });
}

async function seedOne(page: Page) {
  await openNotes(page);
  const n = await seedNote(page, "file:web/src/api.ts", "## U14 seed\n\n- round trip\n- revert");
  await page.reload();
  await expect(page.getByTestId(`u14-note-${n}`)).toBeVisible({ timeout: 15_000 });
  return n;
}

test("list note opens in the editable code panel with markdown", async ({ page }) => {
  const n = await seedOne(page);
  await page.getByTestId(`u14-note-${n}`).click();
  const panel = page.locator(".code-panel");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByTestId("cp-code")).toContainText("U14 seed");
  // markdown highlighting: the seeded heading is tokenised, not plain text
  await expect(panel.locator(".cp-code code span")).not.toHaveCount(0);
  // Save/Revert appear once the draft is dirty, with the pane chrome
  await expect(panel.getByTestId("cp-ctl")).toBeVisible();
  await expect(panel.getByTestId("cp-max")).toBeVisible();
  await expect(panel.getByTestId("cp-close")).toBeVisible();
  await panel.getByTestId("cp-area").fill("## U14 seed\n\n- round trip\n- revert\n- touched");
  await expect(panel.getByTestId("cp-save")).toBeVisible();
  await expect(panel.getByTestId("cp-revert")).toBeVisible();
  // the textarea is editable
  await expect(panel.getByTestId("cp-area")).toBeEditable();
});

test("edit and save round-trips through the API", async ({ page }) => {
  const n = await seedOne(page);
  await page.getByTestId(`u14-note-${n}`).click();
  const panel = page.locator(".code-panel");
  const area = panel.getByTestId("cp-area");
  await expect(area).toBeEditable();
  await area.fill("## U14 seed – saved via editor\n\n- round trip\n- revert");
  await panel.getByTestId("cp-save").click();
  // the dirty dot clears once saved
  await expect(panel.getByTestId("cp-modified")).toHaveCount(0, { timeout: 10_000 });
  // the round trip: the API now holds the new body
  const [, meta] = await api(page, "GET", "/api/meta");
  const stored = ((meta as { notes: { id: number; body: string }[] }).notes ?? []).find((x) => x.id === n);
  expect(stored?.body).toContain("saved via editor");
  // the list reflects it too
  await expect(page.getByTestId(`u14-note-${n}`)).toContainText("saved via editor");
});

test("revert restores the loaded body without saving", async ({ page }) => {
  const n = await seedOne(page);
  await page.getByTestId(`u14-note-${n}`).click();
  const panel = page.locator(".code-panel");
  const area = panel.getByTestId("cp-area");
  await area.fill("temporary scratch that must never persist");
  await panel.getByTestId("cp-revert").click();
  await expect(area).toHaveValue(/U14 seed/);
  const [, meta] = await api(page, "GET", "/api/meta");
  const stored = ((meta as { notes: { id: number; body: string }[] }).notes ?? []).find((x) => x.id === n);
  expect(stored?.body).not.toContain("must never persist");
});

test("new note opens an empty editor with an editable target", async ({ page }) => {
  await seedOne(page);
  await page.getByTestId("u14-new-note").click();
  const panel = page.locator(".code-panel");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  const area = panel.getByTestId("cp-area");
  await expect(area).toHaveValue("");
  const target = panel.getByTestId("cp-note-target");
  await expect(target).toBeEditable();
  await target.fill("file:web/src/CodePanel.tsx");
  await area.fill("fresh note from u14");
  await panel.getByTestId("cp-save").click();
  await expect(panel.getByTestId("cp-modified")).toHaveCount(0, { timeout: 10_000 });
  const [, meta] = await api(page, "GET", "/api/meta");
  const made = ((meta as { notes: { id: number; body: string; target: string }[] }).notes ?? [])
    .find((x) => x.body === "fresh note from u14");
  expect(made?.target).toBe("file:web/src/CodePanel.tsx");
  // clean up so the fixture stays small
  if (made?.id) await api(page, "DELETE", `/api/meta/notes/${made.id}`);
});

test("a sticky note on the map opens in the editor and saves back", async ({ page }) => {
  await page.goto(`${FIXTURE}/#map`);
  // the canvas context menu has an explicit "Add sticky note" item
  await page.locator(".react-flow").first().click({ button: "right", position: { x: 400, y: 300 } });
  await page.getByTestId("cm-sticky").click({ timeout: 10_000 });
  // the sticky is selected; its node panel carries the Edit verb
  const edit = page.getByTestId("u14-sticky-edit");
  await expect(edit).toBeVisible({ timeout: 15_000 });
  await edit.click();
  const panel = page.locator(".code-panel");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  const area = panel.getByTestId("cp-area");
  await area.fill("sticky body from u14");
  await panel.getByTestId("cp-save").click();
  await expect(panel.getByTestId("cp-modified")).toHaveCount(0, { timeout: 10_000 });
  // round trip: closing and reopening the sticky shows the saved body
  await panel.getByTestId("cp-close").click();
  await edit.click();
  await expect(area).toHaveValue("sticky body from u14", { timeout: 10_000 });
});

test("search narrows the list", async ({ page }) => {
  const n = await seedOne(page);
  const box = page.getByTestId("u14-search");
  await box.fill("round trip");
  await expect(page.getByTestId(`u14-note-${n}`)).toBeVisible();
  await box.fill("zzz-no-such-note");
  await expect(page.getByTestId(`u14-note-${n}`)).toHaveCount(0);
  await expect(page.locator(".empty").first()).toBeVisible();
});
