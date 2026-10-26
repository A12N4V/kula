import { expect, test, type Page } from "@playwright/test";

// U15: the Agents tab is a portfolio of cards – the agent's own harmonograph
// draws itself on top, the body carries the agent id, where it lives, the
// name, the role and the tags line – and a + card to add one. Clicking a card
// opens the agent sidebar (the same pane mechanism as the code panel) holding
// the whole editor; Esc or close returns focus to the card.

async function open(page: Page, hash = "agents") {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
    try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto(`/#${hash}`);
}

test.describe("agent cards and the agent sidebar", () => {
  test("the agents are a grid of cards, with a + card", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop");
    await open(page);
    const grid = page.locator(".ag-cards");
    await expect(grid).toBeVisible();
    const cards = grid.locator(".ag-card");
    expect(await cards.count()).toBeGreaterThanOrEqual(2);
    // every agent has its card: id, source tag, name, role and tags line
    const first = page.locator("[data-testid^=ag-card-]").first();
    await expect(first.locator(".card__t")).not.toBeEmpty();
    await expect(first.locator(".card__meta")).toContainText(/built in|kula\.toml/);
    await expect(first.locator(".card__fmt")).toBeVisible();
    // the art: the agent's own harmonograph, drawn (fully drawn once motion settles)
    await expect(first.locator(".ag-card-art-svg path.ag-card-seg").first()).toBeVisible();
    // and the + card is last
    await expect(page.getByTestId("ag-card-add")).toBeVisible();
  });

  test("a card opens the agent sidebar; Esc closes it and focus returns to the card", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop");
    await open(page);
    const name = await page.locator("[data-testid^=ag-card-]:not([data-testid=ag-card-add])").first().getAttribute("data-testid");
    const card = page.locator(`[data-testid=${name}]`);
    // the card body opens the agent; the mark on top opens the logo studio (U17)
    await card.locator(".card__t").click();
    // the sidebar is a pane: controls, grip, the editor inside
    const side = page.getByTestId("ag-side");
    await expect(side).toBeVisible();
    await expect(side).toHaveAttribute("data-pane", /.*/);
    await expect(page.getByTestId("ag-side-ctl")).toBeVisible();
    await expect(page.locator(".ag-side .grip-left")).toBeVisible();
    await expect(side.locator(".wf-edit")).toBeVisible();
    // everything the old editor had, now as collapsible sections (U18): role,
    // memory, steps, skills, fences – and one primary action. No service
    // picker, and no direct Workspace deploy: teams deploy agents (B2).
    await expect(side.locator(".wf-basics")).toBeVisible();
    await expect(side.locator(".seg")).toBeVisible();
    await expect(side.getByTestId("ag-sec-steps")).toBeVisible();
    await expect(side.getByTestId("ag-sec-skills")).toBeVisible();
    const fenceHead = side.getByTestId("ag-sec-fences").locator(".ag-sec-head");
    if ((await fenceHead.getAttribute("aria-expanded")) === "false") await fenceHead.click();
    await expect(side.locator(".ff-open")).toBeVisible();
    await expect(side.getByLabel("Service")).toHaveCount(0);
    await expect(side.getByRole("button", { name: "Use on Workspace" })).toHaveCount(0);
    await expect(side.getByRole("button", { name: "Save" })).toBeVisible();
    // close returns focus to the card that opened it
    await page.getByTestId("ag-side-close").click();
    await expect(side).toHaveCount(0);
    await expect(card).toBeFocused();
    // and Esc does the same
    await card.locator(".card__t").click();
    await expect(side).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(side).toHaveCount(0);
    await expect(card).toBeFocused();
  });

  test("the + card adds an agent in the compact form; the sidebar opens on it", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop");
    await open(page);
    await page.getByTestId("ag-card-add").click();
    const form = page.locator("[data-testid=ag-add-form]");
    await expect(form).toBeVisible();
    const name = `card-agent-${Date.now()}`;
    await form.locator("[data-testid=ag-add-name]").fill(name);
    await form.getByLabel("Role").fill("Cards smoke agent");
    await form.locator("[data-testid=ag-add-name]").press("Enter");
    // the sidebar opens on the new agent, with the card in the grid
    await expect(page.locator(".ag-side-head h2")).toHaveText(name);
    const card = page.locator(`[data-testid=ag-card-${name}]`);
    await expect(card).toBeVisible();
    // the actions row stays inside the pane – no sideways spill
    const box = await page.locator(".wf-edit").getByRole("button", { name: "Delete" }).boundingBox();
    const pane = await page.getByTestId("ag-side").boundingBox();
    expect(box!.x, "the editor actions stay inside the pane").toBeLessThanOrEqual(pane!.x + pane!.width);
    // clean up from the sidebar
    page.once("dialog", (d) => d.accept());
    await page.locator(".wf-edit").getByRole("button", { name: "Delete" }).click();
    await expect(card).toHaveCount(0);
  });

  test("@responsive the cards fit 390 and the sidebar is a bottom sheet", async ({ page }, info) => {
    test.skip(info.project.name !== "phone" && info.project.name !== "tablet");
    await open(page);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, "the agents grid scrolls sideways").toBeLessThanOrEqual(1);
    await page.locator("[data-testid^=ag-card-]:not([data-testid=ag-card-add])").first().locator(".card__t").click();
    const side = page.getByTestId("ag-side");
    await expect(side).toBeVisible();
    // phone: every pane is a bottom sheet (the shared pane rule)
    const atBottom = await side.evaluate((el) => el.getBoundingClientRect().bottom >= window.innerHeight - 60);
    expect(atBottom, "the sidebar should reach the bottom of the window").toBe(true);
  });
});
