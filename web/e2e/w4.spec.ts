import { test, expect } from "@playwright/test";

// W4 – agents activity: connectors summary, kula:// tree, team graph with
// file badges, agent inspector with memory access matrix, memory editor with
// blame gutter, history and diff-first save. All data mocked (MOCK labels).

async function openAgents(page: import("@playwright/test").Page) {
  await page.goto("/#/wb");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.click('[data-testid="wb-activity-agents"]');
  // The center tab mounts on its trigger click in the sketch shell.
  await page.click('[data-testid="wb-tab-agents-team"]');
}

test("connectors summary: one line per kind with count and status dot", async ({ page }) => {
  await openAgents(page);
  const explorer = page.getByTestId("wb-agents-explorer");
  await expect(explorer.getByTestId("wb-connectors")).toBeVisible();
  // Five kinds, each with a count and a dot.
  for (const kind of ["harnesses", "mcp", "skills", "hooks", "services"]) {
    await expect(explorer.getByTestId(`wb-connector-${kind}`)).toBeVisible();
    await expect(explorer.getByTestId(`wb-connector-dot-${kind}`)).toBeVisible();
  }
  // drift/down kinds render the dot in the accent (skills drifted).
  const skillsDot = explorer.getByTestId("wb-connector-dot-skills");
  await expect(skillsDot).toHaveClass(/bg-primary/);
  // Expanding a kind lists its members with counts; clicking opens the config.
  await page.getByTestId("wb-connector-harnesses").click();
  await expect(page.getByTestId("wb-connector-item-harness-claude-code")).toBeVisible();
  await page.getByTestId("wb-connector-item-harness-claude-code").click();
  await expect(page.getByTestId("wb-file-viewer")).toContainText("harnesses.toml");
});

test("kula:// tree opens files; memory rows route to the memory editor", async ({ page }) => {
  await openAgents(page);
  // Teams branch is open at first glance; open a config from the tree.
  await page.locator('[data-testid="file-tree-item-kula://teams/map-rework/coder-1.toml"]').first().click();
  await expect(page.getByTestId("wb-file-viewer")).toContainText('harness = "claude-code"');
  // The real source is named in the header.
  await expect(page.getByTestId("wb-file-viewer")).toContainText("source · kula.toml [agents.coder-1]");
  // fences.toml and runs are read-only.
  await page.locator('[data-testid="file-tree-item-kula://fences.toml"]').first().click();
  await expect(page.getByTestId("wb-file-viewer")).toContainText("read-only");
  // A memory file opens the editor with a blame gutter.
  await page.locator('[data-testid="file-tree-item-kula://memory/by-block/indexer/0007-walk-tree-order.md"]').first().click();
  await expect(page.getByTestId("wb-memory-editor")).toBeVisible();
  await expect(page.getByTestId("wb-memory-anchor")).toContainText("indexer::parse::walk_tree");
});

test("team graph: waves as frames, badges open the config beside the graph", async ({ page }) => {
  await openAgents(page);
  const graph = page.getByTestId("wb-team-graph");
  await expect(graph).toBeVisible();
  for (const wave of ["1", "2", "3"]) {
    await expect(graph.getByTestId(`wb-wave-${wave}`)).toBeVisible();
  }
  // File badge opens the agent config in a split tab beside the graph.
  await page.getByTestId("wb-badge-coder-2").click();
  await expect(page.getByTestId("wb-file-viewer")).toContainText('harness = "codex"');
  await expect(page.getByTestId("wb-team-graph")).toBeVisible();
  // Node click selects the agent; inspector shows config + access matrix.
  await page.getByTestId("wb-node-coder-2").click();
  const inspector = page.getByTestId("wb-agents-inspector");
  await expect(inspector).toContainText("Agent · coder-2");
  await expect(inspector).toContainText("Memory access · coder-2");
  await expect(inspector).toContainText("by me");
  // Closing the file returns to the full graph.
  await page.getByTestId("wb-file-close").click();
  await expect(page.getByTestId("wb-file-viewer")).toHaveCount(0);
});

test("memory editor: edit, save shows the diff first, history lists revisions", async ({ page }) => {
  await openAgents(page);
  await page.locator('[data-testid="file-tree-item-kula://memory/by-block/indexer/0007-walk-tree-order.md"]').first().click();
  const editor = page.getByTestId("wb-memory-editor");
  // Blame gutter: author · rev · date per line.
  await expect(page.getByTestId("code-blame-l3")).toContainText("co · r2 · 11-04");
  await expect(page.getByTestId("wb-memory-history")).toContainText("r3 · 11-04 · critic · run #40");
  // Edit, then save: the diff shows in the strip first.
  await page.getByTestId("wb-memory-edit").click();
  const box = page.getByTestId("wb-memory-textarea");
  await box.fill(box.inputValue() + "\nverified by coder-2 after re-run");
  await page.getByTestId("wb-memory-save").click();
  const diff = page.getByTestId("wb-memory-diff");
  await expect(diff).toBeVisible();
  await expect(diff).toContainText("unsaved");
  await expect(diff).toContainText("Write revision r4");
  await diff.getByTestId("wb-memory-apply").click();
  await expect(page.getByTestId("wb-memory-diff")).toHaveCount(0);
});

test("agents at 390x844: explorer rows meet the 40px small-target rule @responsive", async ({ page }) => {
  await page.goto("/#/wb");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('[data-testid="wb-activity-agents"]');
  const tree = page.getByTestId("wb-kula-tree");
  await expect(tree).toBeVisible();
  // Tree rows are 40px tall on mobile (md size of the kit file-tree).
  const row = page.locator('[data-testid="file-tree-item-kula://fences.toml"]');
  const box = await row.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(40);
});
