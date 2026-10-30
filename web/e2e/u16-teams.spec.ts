import { expect, test as base, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

// U16: teams are a map canvas – a tab bar with every team (and a + tab whose
// inline name saves through team_save), a React Flow canvas below (the map's
// dotted ground, zoom controls and pan) with members as agent squares, the
// lead on top, edges from the lead, drag to arrange (saved with team_layout),
// and a team sidebar pane (same mechanism as the agent sidebar) listing the
// agents from the Agents tab as small cards with + / −, plus team settings.

/** Path to e2e/fixture.sh whether the runner was started from web/ or the repo root. */
function fixtureScript(): string {
  const cwd = process.cwd();
  const p = path.join(cwd, "e2e", "fixture.sh");
  if (fs.existsSync(p)) return p;
  throw new Error("e2e/fixture.sh not found");
}

const test = base.extend({
  fx: [
    async ({ }, use, workerInfo) => {
      // One fixture per worker: the tests write kula.toml, so nothing shares.
      let port = Number(process.env.KULA_PW_PORT ?? 7431) + 10 + workerInfo.workerIndex;
      const taken = async (p: number) => {
        try { await fetch(`http://localhost:${p}/`, { signal: AbortSignal.timeout(300) }); return true; } catch { return false; }
      };
      for (let p = port + 1; p < port + 12 && (await taken(port)); p++) port = p;
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
      if (!up) {
        const out = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "(no log)";
        throw new Error(`fixture on port ${port} did not come up in 180s\nfixture log:\n${out}`);
      }
      const probe = await fetch(`${url}/api/agents`, { headers: { "x-kula-token": "test" } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const ours = probe && Array.isArray(probe.rules) && probe.rules.some((r: { reason?: string }) => r.reason === "release pipeline: signed packages");
      if (!ours) throw new Error(`something else is serving on fixture port ${port} – not this run's fixture\nfixture log:\n${fs.readFileSync(logFile, "utf8")}`);
      await use(url);
      proc.kill("SIGTERM");
      fs.closeSync(log);
      try {
        const repo = fs.readFileSync(`/tmp/kula-fixture-${port}.path`, "utf8").trim();
        fs.rmSync(repo, { recursive: true, force: true });
        fs.rmSync(`/tmp/kula-fixture-${port}.path`, { force: true });
      } catch { /* fixture may have died before writing the path file */ }
    },
    { scope: "worker", timeout: 240_000 },
  ],
});

test.use({ baseURL: ({ fx }, use) => use(fx) });

async function open(page: Page) {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
    try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  await page.goto("/#agents/teams");
  await page.waitForLoadState("networkidle").catch(() => {});
}

const toml = async (request: import("@playwright/test").APIRequestContext) =>
  (await (await request.get("/api/file?path=kula.toml", { headers: { "x-kula-token": "test" } })).json()).content as string;

test.describe("teams as a map canvas", () => {
  test("the tab bar lists every team, the canvas shows members as squares with the lead on top", async ({ page }) => {
    await open(page);
    // one tab per team in the fixture, and the + tab
    await expect(page.getByTestId("team-tab-add")).toBeVisible();
    await expect(page.getByTestId("team-tab-steer")).toBeVisible();
    await expect(page.getByTestId("team-tab-ship")).toBeVisible();
    // picking a team mounts the canvas with its members
    await page.getByTestId("team-tab-ship").click();
    const canvas = page.getByTestId("team-canvas");
    await expect(canvas).toBeVisible();
    const nodes = canvas.locator(".tc-node");
    expect(await nodes.count()).toBeGreaterThanOrEqual(2);
    // each member square carries its harmonograph and a name
    await expect(nodes.first().locator("path").first()).toBeVisible();
    await expect(nodes.first().locator(".tc-node-name")).not.toBeEmpty();
    // edges from the lead: at least one edge in a team of teams
    await expect(canvas.locator(".react-flow__edge").first()).toBeVisible();
    // the lead is on top: the node marked "lead" is drawn above the members –
    // its z-index (2) sits over theirs (0)
    // (seat nodes only: the all-teams org canvas also draws a group node per team)
    const seats = canvas.locator(".react-flow__node-tc");
    const lead = seats.filter({ hasText: /lead/i }).first();
    await expect(lead).toBeVisible();
    const zLead = await lead.evaluate((el) => Number(getComputedStyle(el).zIndex || 0));
    const zMember = await seats.filter({ hasNotText: /lead/i }).first().evaluate((el) => Number(getComputedStyle(el).zIndex || 0));
    expect(zLead).toBeGreaterThan(zMember);
    // every team sits on one org canvas: switching tabs picks a team, it
    // never swaps the canvas out (ship's Cursor seat stays on screen)
    await page.getByTestId("team-tab-steer").click();
    await expect(page.getByTestId("team-tab-steer")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("team-canvas")).toContainText(/on Cursor/);
    for (const t of ["ship", "steer"]) await expect(canvas.locator(".react-flow__node-tg").filter({ hasText: t })).toHaveCount(1);
  });

  test("the + tab creates a team with an inline name; Enter saves via team_save", async ({ page, request }) => {
    await open(page);
    await page.getByTestId("team-tab-add").click();
    const name = `u16-crew-${Date.now() % 100000}`;
    const input = page.getByTestId("team-add-name");
    await expect(input).toBeFocused();
    await input.fill(name);
    // an existing name is refused inline
    await input.fill("steer");
    await expect(page.locator(".tc-add")).toContainText("already exists");
    await input.fill(name);
    await input.press("Enter");
    const tab = page.getByTestId(`team-tab-${name}`);
    await expect(tab).toBeVisible();
    await expect(tab).toHaveClass(/on/);
    await expect(page.getByTestId("team-canvas")).toBeVisible();
    await expect.poll(async () => toml(request)).toContain(`name = "${name}"`);
    // clean up: delete through the sidebar (the confirm is accepted)
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("team-side-toggle").click();
    const side = page.getByTestId("team-side");
    await expect(side).toBeVisible();
    await side.getByTestId("team-delete").click();
    await expect(tab).toHaveCount(0);
    await expect.poll(async () => toml(request)).not.toContain(`name = "${name}"`);
  });

  test("the sidebar lists agents with + / −, adds and removes members, edits settings", async ({ page, request }) => {
    await open(page);
    await page.getByTestId("team-tab-ship").click();
    await page.getByTestId("team-side-toggle").click();
    const side = page.getByTestId("team-side");
    await expect(side).toBeVisible();
    await expect(side).toHaveAttribute("data-pane", /.*/);
    // the agents from the Agents tab, each with a + to add
    const add = side.getByTestId("team-add-tests");
    await expect(add).toBeVisible();
    await expect(add).toHaveAttribute("aria-pressed", "true"); // already a member of ship
    // add an agent that is not in the team yet, then remove it again
    const candidate = side.locator("[data-testid^=team-add-][aria-pressed=false]").first();
    const wf = (await candidate.getAttribute("data-testid"))!.replace("team-add-", "");
    await candidate.click();
    await expect(side.locator(`[data-testid=team-add-${wf}]`)).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => {
      const body = await toml(request);
      const block = body.slice(body.indexOf('name = "ship"'));
      return block.slice(0, block.indexOf("[[team]]", 1) > 0 ? block.indexOf("[[team]]", 1) : undefined);
    }).toContain(`workflow = "${wf}"`);
    await side.locator(`[data-testid=team-add-${wf}]`).click();
    await expect(side.locator(`[data-testid=team-add-${wf}]`).first()).toHaveAttribute("aria-pressed", "false");
    // the removal round-trips before anything else is edited: team_save is
    // debounced and team_remove_member writes by name, so a rename typed while
    // the removal is still in flight can race it on the server
    await expect.poll(async () => {
      const body = await toml(request);
      const block = body.slice(body.indexOf('name = "ship"'));
      return block.slice(0, block.indexOf("[[team]]", 1) > 0 ? block.indexOf("[[team]]", 1) : undefined);
    }, { timeout: 15_000 }).not.toContain(`workflow = "${wf}"`);
    // team settings: rename through the sidebar, the server sees it (the save
    // is debounced 600 ms, so the poll waits well past it under load)
    const renamed = `ship-${Date.now() % 100000}`;
    await side.getByLabel("Team name").fill(renamed);
    await expect(page.getByTestId(`team-tab-${renamed}`)).toBeVisible();
    await expect.poll(async () => toml(request), { timeout: 15_000 }).toContain(`name = "${renamed}"`);
    // nesting: ship answers to steer by default
    await expect(side.getByLabel("Answers to team")).toHaveValue("steer");
  });

  test("dragging a member saves the arrangement with team_layout", async ({ page, request }) => {
    await open(page);
    await page.getByTestId("team-tab-ship").click();
    const canvas = page.getByTestId("team-canvas");
    await expect(canvas).toBeVisible();
    // a seat, not a team's group frame (that drags only by its head)
    const node = canvas.locator(".react-flow__node-tc").filter({ hasText: "cursor" }).first();
    await expect(node).toBeVisible();
    const box = await node.boundingBox();
    if (!box) throw new Error("node not on screen – fit the canvas");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 140, box.y + box.height / 2 + 60, { steps: 8 });
    await page.mouse.up();
    // the layout save is debounced 500 ms; poll kula.toml instead of a fixed
    // sleep, so load on the server cannot outlast the wait
    await expect.poll(async () => toml(request), { timeout: 15_000 }).toContain("positions");
  });

  test("@responsive the canvas and the tab bar fit the phone", async ({ page }, info) => {
    test.skip(info.project.name === "desktop", "phone-only overlap check");
    await open(page);
    await page.getByTestId("team-tab-ship").click();
    await expect(page.getByTestId("team-canvas")).toBeVisible();
  });
});
