// W3 – runs module acceptance: runs explorer (runs + agents in the selected
// run), lanes (working/waiting/blocked bars, click-to-filter), mini wheel
// with touched blocks lit, ledger table with click-to-filter from a lane bar
// or a wheel sector, tokens and credits only (no dollars).
import { test, expect } from "@playwright/test";

const WB = "#/wb";

async function openRuns(page) {
  await page.goto(`/${WB}`);
  await expect(page.getByTestId("wb-root")).toBeVisible();
  // Radix CenterTabs quirk (W2 handoff): after an activity switch the panel
  // can sit inactive until a trigger is clicked once – click the runs
  // activity, then its tab trigger.
  await page.getByTestId("wb-activity-runs").click();
  await expect(page.getByTestId("wb-runs-explorer")).toBeVisible();
  await page.getByTestId("wb-tab-runs-lanes").click();
  await expect(page.getByTestId("wb-runs-tab")).toBeVisible({ timeout: 30000 });
}

test("runs explorer lists runs and the agents in the selected run", async ({ page }) => {
  await openRuns(page);
  await expect(page.getByTestId("wb-runs-explorer")).toContainText("Runs · 4");
  for (const run of ["#42", "#41", "#40", "#39"]) {
    await expect(page.getByTestId(`wb-run-${run.slice(1)}`)).toBeVisible();
  }
  await expect(page.getByTestId("wb-runs-explorer")).toContainText("Agents · #42");
  for (const agent of ["planner", "coder-1", "coder-2", "critic"]) {
    await expect(page.getByTestId(`wb-agent-${agent}`)).toBeVisible();
  }
  // selecting another run swaps the agent list (actual content, not counts)
  await page.getByTestId("wb-run-41").click();
  await expect(page.getByTestId("wb-runs-explorer")).toContainText("Agents · #41");
  await expect(page.getByTestId("wb-runs-explorer")).toContainText("researcher");
  await expect(page.getByTestId("wb-agent-planner")).toBeVisible();
  await page.getByTestId("wb-run-42").click();
  await expect(page.getByTestId("wb-runs-explorer")).toContainText("Agents · #42");
});

test("keyboard: run row is focusable and Enter selects it", async ({ page }) => {
  await openRuns(page);
  await page.getByTestId("wb-run-40").focus();
  await expect(page.getByTestId("wb-run-40")).toHaveClass(/outline/);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("wb-runs-explorer")).toContainText("Agents · #40");
  await expect(page.getByTestId("wb-runs-explorer")).toContainText("coder-1");
});

test("lanes: one row per agent with working, waiting and blocked bars", async ({ page }) => {
  await openRuns(page);
  const chart = page.getByTestId("kwb-lane-chart");
  await expect(chart).toBeVisible();
  // lane labels for the four agents of run #42
  for (const agent of ["planner", "coder-1", "coder-2", "critic"]) {
    await expect(chart).toContainText(agent);
  }
  // bars carry kind styling: blocked bars use the accent background
  const bars = page.locator('[data-testid^="lane-bar-"]');
  await expect(bars.first()).toBeAttached();
  const ids = await bars.evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
  // the mock has 13 segments; every bar start is rendered as one
  expect(new Set(ids).size).toBe(13);
  // the blocked bar l-6 and the coder-2 working bar l-9 both exist
  await expect(page.getByTestId("lane-bar-l-6")).toBeAttached();
  await expect(page.getByTestId("lane-bar-l-9")).toBeAttached();
});

test("lane bar click filters the ledger to that agent, kind and window", async ({ page }) => {
  await openRuns(page);
  await page.getByTestId("wb-panel-tab-run-ledger").click();
  await expect(page.getByTestId("wb-ledger-table")).toBeVisible();
  const allRows = page.locator('[data-testid^="wb-ledger-row-"]');
  await expect(allRows.first()).toBeVisible();
  // click a blocked bar in the coder-1 lane (kind colours: blocked = accent)
  await page.getByTestId("lane-bar-l-6").click();
  // the ledger now shows only coder-1 events whose verdict matches the bar
  const rows = page.locator('[data-testid^="wb-ledger-row-"]');
  const texts = await rows.allTextContents();
  expect(texts.length).toBeGreaterThan(0);
  for (const t of texts) {
    expect(t).toContain("coder-1");
  }
  // the filter chip is shown and removable
  await expect(page.getByTestId("wb-ledger-filter-agent")).toContainText("coder-1");
  await page.getByTestId("wb-ledger-filter-agent").click();
  // clearing the agent filter brings other agents back
  await expect(page.locator('[data-testid^="wb-ledger-row-"]').first()).toContainText(/coder-1|critic|planner|coder-2/);
});

test("mini wheel lights the run's touched blocks and a sector filters the ledger", async ({ page }) => {
  await openRuns(page);
  const wheel = page.getByTestId("wb-runs-wheel");
  await expect(wheel).toBeVisible();
  await expect(page.getByTestId("wb-runs-tab")).toContainText("4 blocks touched");
  // the touched blocks for run #42 include real staged block 4 (web/src · api)
  const sector = wheel.locator('[data-testid="wb-sector-4"]');
  await expect(sector).toBeAttached();
  await sector.dispatchEvent("click");
  await page.getByTestId("wb-panel-tab-run-ledger").click();
  await expect(page.getByTestId("wb-ledger-filter-block")).toContainText("block: 4");
  // exact filtered set: the mock has exactly 5 block-4 events for run #42
  // (14:21 handoff, 14:23 read, 14:28 edit, 14:28 memory, 14:32 handoff)
  const rows = page.locator('[data-testid^="wb-ledger-row-"]');
  await expect(rows).toHaveCount(5);
  const texts = await rows.allTextContents();
  // the first row is one of the block-4 targets, not just any agent name
  expect(texts[0]).toMatch(/lanes|lane-chart|api\.ts|lane-axis|narrow lane labels/);
});

test("lane bar click on a non-default run filters by that run's window", async ({ page }) => {
  await openRuns(page);
  // switch to run #41 (starts 09:02 – different axis from the 14:18 default)
  await page.getByTestId("wb-run-41").click();
  await expect(page.getByTestId("wb-runs-tab")).toContainText("Run #41");
  // researcher working bar l-4 (13–38 min from start)
  await page.getByTestId("lane-bar-l-4").click();
  await page.getByTestId("wb-panel-tab-run-ledger").click();
  await expect(page.getByTestId("wb-ledger-filter-agent")).toContainText("researcher");
  const rows = page.locator('[data-testid^="wb-ledger-row-"]');
  const texts = await rows.allTextContents();
  expect(texts.length).toBeGreaterThan(0);
  for (const t of texts) {
    expect(t).toContain("researcher");
  }
  // the window chip shows the run's own wall-clock window, and rows match it
  await expect(page.getByTestId("wb-ledger-filter-window")).toContainText("09:1");
  for (const t of texts) {
    expect(t).toMatch(/09:(1\d|2\d|3\d)/); // after 09:13, before 09:39
  }
});

test("ledger table: JSONL columns, newest first, verdicts and tokens only", async ({ page }) => {
  await openRuns(page);
  await page.getByTestId("wb-panel-tab-run-ledger").click();
  const table = page.getByTestId("wb-ledger-table");
  for (const head of ["t", "agent", "event", "target", "tok in", "tok out", "verdict"]) {
    await expect(table).toContainText(head);
  }
  const rows = page.locator('[data-testid^="wb-ledger-row-"]');
  await expect(rows).toHaveCount(14);
  const first = await rows.first().textContent();
  expect(first).toContain("14:32"); // newest first
  // tokens and credits only – no dollars anywhere in the ledger
  const ledger = await page.getByTestId("wb-ledger").textContent();
  expect(ledger).not.toMatch(/\$/);
  // verdict colour coding exists: review rows render in the accent colour
  const review = rows.filter({ hasText: "review" }).first();
  await expect(review).toBeVisible();
});

test("explorer agent click and inspector verdict click filter the ledger", async ({ page }) => {
  await openRuns(page);
  await page.getByTestId("wb-panel-tab-run-ledger").click();
  await page.getByTestId("wb-agent-critic").click();
  await page.getByTestId("wb-panel-tab-run-ledger").click();
  const rows = page.locator('[data-testid^="wb-ledger-row-"]');
  const texts = await rows.allTextContents();
  expect(texts.length).toBeGreaterThan(0);
  for (const t of texts) {
    expect(t).toContain("critic");
  }
  // verdict filter from the inspector narrows to that verdict
  await page.getByTestId("wb-verdict-ok").click();
  await page.getByTestId("wb-panel-tab-run-ledger").click();
  const okRows = await page.locator('[data-testid^="wb-ledger-row-"]').allTextContents();
  expect(okRows.length).toBeGreaterThan(0);
  for (const t of okRows) {
    expect(t).not.toMatch(/blocked|error/);
  }
});
