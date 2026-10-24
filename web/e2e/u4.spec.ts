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
  await expect(page.locator(".fc-node").first()).toBeVisible({ timeout: 30_000 });
}

/** A pipeline of three blocks on two distinct canvas sections: a trigger that
 *  reads sec1, an agent that writes sec2 (and reads sec1), a gate. Gives the
 *  plan both a write tint and a read outline. */
async function seedPipeline(page: Page) {
  await page.evaluate(() => {
    // nested-squares map: sections land as closed solid squares
    const ids = [...document.querySelectorAll('.fc-solid[data-testid^="fc-node-"]')]
      .map((e) => (e.getAttribute("data-testid") ?? "").slice("fc-node-".length))
      .filter((id) => !id.startsWith("fn:") && !id.startsWith("step:"));
    const [sec1, sec2] = [...new Set(ids)];
    localStorage.setItem("kula.pipeline.map", JSON.stringify([
      { id: "u4-t", kind: "trigger", ref: "manual", name: "Start", section: sec1 },
      { id: "u4-a", kind: "agent", ref: "polish", name: "Polish agent", section: sec2 },
      { id: "u4-g", kind: "gate", ref: "kula check", name: "Check" },
    ]));
  });
  await page.reload();
  await expect(page.locator('[data-testid="ws-seg-u4-a"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".fc-node").first()).toBeVisible({ timeout: 30_000 });
}

test("dry-run builds the plan: write tint, read outline, strike excludes, approve runs", async ({ page }) => {
  await opened(page);
  await seedPipeline(page);
  await page.locator('[data-testid="u4-dry-run"]').click();
  await expect(page.locator('[data-testid="u4-plan-overlay"]')).toBeVisible();
  await expect(page.locator('[data-testid="u4-plan-bar"]')).toContainText("3 blocks");
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
  // The fake run follows an approved plan (the transport Run starts the real
  // runner, which waits on a live agent – the fake run is the U4 surface).
  await page.locator('[data-testid="u4-dry-run"]').click();
  await expect(page.locator('[data-testid="u4-plan-bar"]')).toBeVisible();
  await page.locator('[data-testid="u4-approve"]').click();
  const gate = page.locator('[data-testid="ask-gate"]');
  await expect(gate).toBeVisible({ timeout: 20_000 });
  const box = await gate.boundingBox();
  const tbox = await page.locator('[data-testid="ws-runbar"]').boundingBox();
  expect(box && tbox && Math.abs(box.y + box.height - tbox.y) < 60, `gate at ${box?.y} not above transport at ${tbox?.y}`).toBe(true);
  for (const answer of ["Allow once", "Allow for run", "Deny"]) await expect(gate.getByText(answer, { exact: false })).toBeVisible();
  // keys 1/2/3 answer it: 2 = allow for run, then the gate closes
  await page.keyboard.press("2");
  await expect(gate).toBeHidden();
  // not a modal: the canvas below stays interactive
  await expect(page.locator(".fc-node").first()).toBeVisible();
  // the allowed write landed: a change badge shows on the map
  await expect.poll(async () => page.locator('[data-testid^="u4-badge-"]').count(), { timeout: 15_000 }).toBeGreaterThan(0);
});

test("conflict marks land on the block in place; change badges show + and acknowledge", async ({ page }) => {
  await opened(page);
  await seedPipeline(page);
  await page.locator('[data-testid="u4-dry-run"]').click();
  await expect(page.locator('[data-testid="u4-plan-bar"]')).toBeVisible();
  await page.locator('[data-testid="u4-approve"]').click();
  await page.locator('[data-testid="ask-gate"]').waitFor({ timeout: 20_000 });
  await page.keyboard.press("1"); // allow once – the write lands, conflict is flagged
  await expect.poll(async () => page.locator('[data-testid^="u4-conflict-"]').count(), { timeout: 20_000 }).toBeGreaterThan(0);
  await expect.poll(async () => page.locator('[data-testid^="u4-badge-"]').count(), { timeout: 20_000 }).toBeGreaterThan(0);
  // open the step detail from the conflict mark: decision line, diff, ack.
  // The mark rides the camera transform and may sit off-viewport, so the
  // click is dispatched on the element itself.
  await page.locator('[data-testid^="u4-conflict-"]').first().evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('[data-testid="ndv"]')).toBeVisible();
  await expect(page.locator('[data-testid^="u4-decision-"]').first()).toBeVisible();
  await expect(page.locator('[data-testid^="u4-ndv-changes-"] p').first()).toContainText("+");
  // acknowledge every change in the step – a block can carry several
  const acks = page.locator('[data-testid^="u4-ack-"]');
  while (await acks.count()) await acks.first().click();
  // acknowledged changes stop showing badges on the map
  await expect(page.locator('[data-testid^="u4-badge-"]')).toHaveCount(0, { timeout: 10_000 });
});

test("deny keeps the edit off the run: no conflict, decision says denied", async ({ page }) => {
  await opened(page);
  await seedPipeline(page);
  await page.locator('[data-testid="u4-dry-run"]').click();
  await expect(page.locator('[data-testid="u4-plan-bar"]')).toBeVisible();
  await page.locator('[data-testid="u4-approve"]').click();
  await page.locator('[data-testid="ask-gate"]').waitFor({ timeout: 20_000 });
  await page.keyboard.press("3");
  await expect(page.locator('[data-testid="ask-gate"]')).toBeHidden();
  await expect(page.locator('[data-testid^="u4-conflict-"]')).toHaveCount(0, { timeout: 15_000 });
  // the decision line records the denial in the step detail: select the
  // agent's block on the transport timeline, Enter opens the step detail
  await page.locator('[data-testid="ws-seg-u4-a"]').click();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-testid="ndv"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid^="u4-decision-"]').first()).toContainText("Denied", { timeout: 10_000 });
});
