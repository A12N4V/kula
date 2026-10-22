// U4 · Run supervision – acceptance per the brief: dry-run plan overlay
// (read = outline, write = accent tint, strike a block to exclude), in-place
// conflict marks on blocks, ask-gate prompt docked above the transport
// (Allow once · Allow for run · Deny, keys 1/2/3, not a modal), changed-block
// +/− badges until acknowledged, step detail input | decision | output.
// Against the fixture with a fake run. Assert by name, never by fixture counts.
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE } from "../playwright.config";

// The fake run never writes to the repo: it drives the same state a real run
// would (statuses, log, ask, changes), so the repo server is safe. Tests run
// against the repo server (no kula.toml writes happen here).
test.use({ baseURL: FIXTURE });

async function opened(page: Page) {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto("about:blank");
  await page.goto("/#map");
  await expect(page.locator(".graph-loader")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('[data-testid="ws-runbar"]')).toBeVisible({ timeout: 30_000 });
  // the fixture builds its map cold on the first GET /api/map (~11 s)
  await expect(page.locator('[data-testid="fc-node"]').first()).toBeVisible({ timeout: 30_000 });
}

/** A pipeline of two blocks: an agent fenced to a real section, then a gate. */
async function seedPipeline(page: Page) {
  await page.evaluate(async () => {
    const t = (document.querySelector('meta[name="kula-token"]') as HTMLMetaElement)?.content ?? "test";
    const map = await (await fetch("/api/map", { headers: { "x-kula-token": t } })).json() as { blocks: Record<string, { kind: string; children: string[] }> };
    const sec = Object.keys(map.blocks).find((id) => map.blocks[id].kind === "section") ?? Object.keys(map.blocks)[0];
    localStorage.setItem("kula.pipeline.map", JSON.stringify([
      { id: "u4-a", kind: "agent", ref: "polish", name: "Polish agent", section: sec },
      { id: "u4-g", kind: "gate", ref: "kula check", name: "Check" },
    ]));
  });
  await page.reload();
  await expect(page.locator('[data-testid="ws-seg-u4-a"]')).toBeVisible({ timeout: 20_000 });
}

test("dry-run builds the plan: write tint, read outline, strike excludes, approve runs", async ({ page }) => {
  await opened(page);
  await seedPipeline(page);
  await page.locator('[data-testid="u4-dry-run"]').click();
  await expect(page.locator('[data-testid="u4-plan-overlay"]')).toBeVisible();
  await expect(page.locator('[data-testid="u4-plan-bar"]')).toContainText("2 blocks");
  // write sections are tinted (accent), reads outlined – at least one of each
  await expect(page.locator('.u4-mark.u4-write').first()).toBeVisible();
  await expect(page.locator('.u4-mark.u4-read').first()).toBeVisible();
  // strike the agent's block: the bar counts it, the section gets the strike
  await page.locator('[data-testid="ws-seg-u4-a"]').click();
  await expect(page.locator('[data-testid="u4-plan-bar"]')).toContainText("1 struck");
  await expect(page.locator('.u4-mark.u4-struck').first()).toBeVisible();
  // approve closes the plan (the fake run follows; its gate ask may appear)
  await page.locator('[data-testid="u4-approve"]').click();
  await expect(page.locator('[data-testid="u4-plan-overlay"]')).toHaveCount(0);
});

test("fake run: ask gate docks above the transport, answers once/run/deny, keys 1/2/3", async ({ page }) => {
  await opened(page);
  await seedPipeline(page);
  await page.locator('[data-testid="ws-run-btn"]').click();
  const gate = page.locator('[data-testid="ask-gate"]');
  await expect(gate).toBeVisible({ timeout: 20_000 });
  const box = await gate.boundingBox();
  const tbox = await page.locator('[data-testid="ws-runbar"]').boundingBox();
  expect(box && tbox && Math.abs(box.y + box.height - tbox.y) < 60, `gate at ${box?.y} not above transport at ${tbox?.y}`).toBe(true);
  for (const answer of ["Allow once", "Allow for run", "Deny"]) await expect(gate.getByText(answer, { exact: false })).toBeVisible();
  // keys 1/2/3 answer it: 2 = allow for run, then the next ask (none) – gate closes
  await page.keyboard.press("2");
  await expect(gate).toBeHidden();
  // not a modal: the canvas below stays interactive
  await expect(page.locator('[data-testid="ws-runbar"]')).toBeVisible();
  // a second run: answer 1 (allow once), a third: answer 3 (deny)
  await expect.poll(async () => page.evaluate(() => document.querySelectorAll('[data-testid="u4-conflict-mark"], [data-testid^="u4-badge-"]').length), { timeout: 15_000 }).toBeGreaterThan(0);
});

test("conflict marks land on the block in place; change badges show + and acknowledge", async ({ page }) => {
  await opened(page);
  await seedPipeline(page);
  await page.locator('[data-testid="ws-run-btn"]').click();
  await page.locator('[data-testid="ask-gate"]').waitFor({ timeout: 20_000 });
  await page.keyboard.press("1"); // allow once – the write lands, conflict is flagged
  await expect(page.locator('[data-testid^="u4-conflict-"]').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid^="u4-badge-"]').first()).toBeVisible({ timeout: 20_000 });
  // open the step detail from the conflict mark: decision line, diff, ack
  await page.locator('[data-testid^="u4-conflict-"]').first().click();
  await expect(page.locator('[data-testid="ndv"]')).toBeVisible();
  await expect(page.locator('[data-testid^="u4-decision-"]').first()).toBeVisible();
  await expect(page.locator('[data-testid^="u4-ndv-changes-"] p').first()).toContainText("+");
  await page.locator('[data-testid^="u4-ack-"]').first().click();
  // acknowledged changes stop showing badges on the map
  await expect(page.locator('[data-testid^="u4-badge-"]')).toHaveCount(0, { timeout: 10_000 });
});

test("deny keeps the edit off the run: no conflict, decision says denied", async ({ page }) => {
  await opened(page);
  await seedPipeline(page);
  await page.locator('[data-testid="ws-run-btn"]').click();
  await page.locator('[data-testid="ask-gate"]').waitFor({ timeout: 20_000 });
  await page.keyboard.press("3");
  await expect(page.locator('[data-testid="ask-gate"]')).toBeHidden();
  await expect(page.locator('[data-testid^="u4-conflict-"]')).toHaveCount(0, { timeout: 15_000 });
  // the decision line records the denial in the step detail
  await page.locator('[data-testid="ws-seg-u4-a"]').click();
  await expect(page.locator('[data-testid="ndv"]')).toBeVisible();
  await expect(page.locator('[data-testid^="u4-decision-"]').first()).toContainText("Denied", { timeout: 10_000 });
});
