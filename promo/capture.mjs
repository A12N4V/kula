// Capture every shot of the launch film, as clips in promo/out/clips/.
//
// Typographic scenes (promo/scenes/*.html) draw a frame for a time t, so they
// are rendered frame by frame at 30 fps – exact, and identical every run. App
// shots are the real UI, driven by Playwright against a disposable seeded
// clone of this repository (web/e2e/fixture.sh) and recorded through the
// DevTools screencast, so motion is real and text stays sharp.
//
//   node promo/capture.mjs            all shots
//   node promo/capture.mjs graph agents   just these
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "web/package.json"));
const { chromium } = require("@playwright/test");

const OUT = join(ROOT, "promo/out/clips");
const FPS = 30, W = 1920, H = 1080, PORT = Number(process.env.PROMO_PORT ?? 7490);
const BASE = `http://localhost:${PORT}`;
const BAR = 8 / 3;
const only = new Set(process.argv.slice(2));
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ffmpeg = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });

// ------------------------------------------------------------------ typography

const TYPE = [
  { name: "problem", file: "problem.html", dur: 4 * BAR },
  { name: "mark", file: "mark.html", dur: 2 * BAR },
  { name: "agents-card", file: "card.html?k=" + encodeURIComponent("AGENTS") + "&a=" + encodeURIComponent("Now let the agents in.") + "&b=" + encodeURIComponent("On your terms."), dur: BAR },
  { name: "outro", file: "outro.html", dur: 4 * BAR },
];

/** Module scripts need http: serve the repository read-only on a loopback port. */
const TYPES = { html: "text/html", js: "text/javascript", css: "text/css", woff2: "font/woff2" };
let staticBase = null;
function serveRoot() {
  if (staticBase) return staticBase;
  const srv = createServer((req, res) => {
    const path = join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!path.startsWith(ROOT) || !existsSync(path)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": TYPES[path.split(".").pop()] ?? "application/octet-stream" }).end(readFileSync(path));
  }).listen(0, "127.0.0.1");
  srv.unref();
  staticBase = new Promise((r) => srv.on("listening", () => r(`http://127.0.0.1:${srv.address().port}`)));
  return staticBase;
}

async function renderType(browser, s) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.goto(`${await serveRoot()}/promo/scenes/${s.file}`);
  await page.waitForFunction(() => typeof window.render === "function");
  await page.evaluate(() => window.ready);
  const dir = join(OUT, s.name + ".frames");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const n = Math.round(s.dur * FPS);
  for (let f = 0; f < n; f++) {
    await page.evaluate((t) => window.render(t), f / FPS);
    await page.screenshot({ path: join(dir, String(f).padStart(5, "0") + ".png") });
  }
  await page.close();
  ffmpeg(["-framerate", String(FPS), "-i", join(dir, "%05d.png"), "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", join(OUT, s.name + ".mp4")]);
  rmSync(dir, { recursive: true, force: true });
  writeFileSync(join(OUT, s.name + ".json"), JSON.stringify({ duration: n / FPS }));
  console.log("type ", s.name, (n / FPS).toFixed(2) + "s");
}

// ------------------------------------------------------------------ app shots

/** A visible cursor (headless has none) and a caption, injected into the page. */
async function chrome(page, cap) {
  await page.evaluate((cap) => {
    const st = document.createElement("style");
    st.textContent = `
      #promo-cur { position: fixed; z-index: 99999; left: 0; top: 0; width: 18px; height: 18px; pointer-events: none;
        transition: transform .55s cubic-bezier(.22,1,.36,1); transform: translate(-40px, -40px); }
      #promo-cur::before { content: ""; position: absolute; inset: 0; background: #f97f3a; clip-path: polygon(0 0, 100% 62%, 52% 62%, 30% 100%); }
      #promo-cur.down::after { content: ""; position: absolute; left: -14px; top: -14px; width: 32px; height: 32px; border: 1px solid #f97f3a; animation: ring .4s ease-out forwards; }
      @keyframes ring { from { opacity: 1; transform: scale(.4) } to { opacity: 0; transform: scale(1.6) } }
      #promo-cap { position: fixed; z-index: 99998; left: 88px; bottom: 76px; padding: 16px 22px 18px; background: #000; border: 1px solid #332d28;
        font-family: "JetBrains Mono Variable", "JetBrains Mono", monospace; color: #e8e2d9; max-width: 1100px;
        clip-path: inset(0 100% 0 0); animation: cap .5s steps(12, end) .15s forwards; }
      #promo-cap i { display: block; font-style: normal; font-size: 15px; font-weight: 600; letter-spacing: .16em; color: #f97f3a; margin-bottom: 6px; }
      #promo-cap b { font-size: 38px; font-weight: 700; letter-spacing: -.01em; }
      @keyframes cap { to { clip-path: inset(0 0 0 0) } }`;
    document.head.appendChild(st);
    const c = document.createElement("div"); c.id = "promo-cur"; document.body.appendChild(c);
    if (cap) { const d = document.createElement("div"); d.id = "promo-cap"; d.innerHTML = `<i>${cap[0]}</i><b>${cap[1]}</b>`; document.body.appendChild(d); }
  }, cap);
}

async function point(page, loc, { click = true, dx = 0.5, dy = 0.5 } = {}) {
  const b = await loc.boundingBox();
  if (!b) return;
  const x = b.x + b.width * dx, y = b.y + b.height * dy;
  await page.evaluate(([x, y]) => { const c = document.getElementById("promo-cur"); if (c) c.style.transform = `translate(${x}px, ${y}px)`; }, [x, y]);
  await sleep(600);
  if (click) {
    await page.evaluate(() => { const c = document.getElementById("promo-cur"); c?.classList.remove("down"); void c?.offsetWidth; c?.classList.add("down"); });
    await page.mouse.click(x, y);
  }
}

async function typeSlow(page, s, delay = 55) {
  for (const ch of s) { await page.keyboard.type(ch); await sleep(delay); }
}

const settled = (page) => page.locator(".graph-loader").waitFor({ state: "detached", timeout: 30_000 }).catch(() => {});
async function inspect(page, name) {
  await page.keyboard.press("Meta+k");
  await sleep(250);
  await typeSlow(page, name, 40);
  await sleep(350);
  await point(page, page.locator(".palette").getByText(name, { exact: true }).first());
  await page.locator(".inspector h2").waitFor();
}

// Each shot: where it starts, what happens, how long to record, its caption.
const SHOTS = [
  { name: "graph", hash: "graph", dur: 8, cap: ["01 · THE MAP", "Every symbol. Every call. Every directory."], act: async (p) => {
    await sleep(3200);
    const box = await p.locator(".graph-canvas").boundingBox();
    await p.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
    for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, -120); await sleep(180); }
  } },
  { name: "impact", hash: "graph", dur: 7, prepare: settled, cap: ["02 · IMPACT", "What breaks if this changes."], act: async (p) => {
    await inspect(p, "context_pack");
    await sleep(500);
    await point(p, p.locator(".inspector").getByRole("button", { name: "Impact" }));
    await sleep(2200);
  } },
  { name: "contrast", hash: "graph/contrast/main/feat%2Fagent-scope/overlay", dur: 7.5, cap: ["03 · CONTRAST", "What a branch does to the architecture."], act: async () => { await sleep(7000); } },
  { name: "report", hash: "graph/contrast/main/feat%2Fagent-scope/report", dur: 4, cap: ["04 · REVIEW", "The structure, not just the lines."], act: async (p) => { await sleep(1500); await p.mouse.wheel(0, 300); await sleep(2000); } },
  { name: "query", hash: "query", dur: 4.5, cap: ["05 · THE GRAPH IS RDF", "Ask it anything. In SPARQL."], act: async (p) => {
    await sleep(600);
    await point(p, p.locator(".kq-ex").first());
    await sleep(2600);
  } },
  { name: "console", hash: "console", dur: 5, cap: ["06 · STILL JUST GIT", "kula commit · kula rebase · kula impact"], act: async (p) => {
    const input = p.getByRole("textbox", { name: "kula command" });
    await input.click();
    await typeSlow(p, "impact publish", 45);
    await p.keyboard.press("Enter");
    await sleep(2500);
  } },
  { name: "fences", hash: "graph", dur: 8, prepare: settled, cap: ["07 · FENCES", "Lock a function, not just a path."], act: async (p) => {
    await sleep(400);
    await p.keyboard.press("f");
    await sleep(2800);
    await point(p, p.locator(".fence-key select"), { click: false });
    await p.locator(".fence-key select").selectOption("refactor");
    await sleep(3000);
  } },
  { name: "hook", hash: "console", dur: 4.5, cap: ["08 · THE HOOK", "A fenced edit is turned back – with the reason."], act: async (p) => {
    const input = p.getByRole("textbox", { name: "kula command" });
    await input.click();
    await typeSlow(p, "guard check packaging/apt/build-repo.sh src/store.rs", 30);
    await p.keyboard.press("Enter");
    await sleep(2000);
  } },
  { name: "agents", hash: "agents", dur: 6, cap: ["09 · WORKFLOWS", "How work is done here – for every agent."], act: async (p) => {
    await sleep(2600);
    await p.mouse.move(900, 600);
    for (let i = 0; i < 4; i++) { await p.mouse.wheel(0, 120); await sleep(220); }
    await sleep(1500);
  } },
  { name: "workflows", hash: "agents/workflows", dur: 4.5, cap: ["10 · YOUR OWN", "explore · fix · refactor · tests · docs · yours"], act: async (p) => {
    await sleep(500);
    await point(p, p.locator(".wf-tile").filter({ hasText: "refactor" }));
    await sleep(2400);
  } },
  { name: "fence-edit", hash: "agents/fences", dur: 5.5, cap: ["11 · kula.toml, IN PLACE", "Fences, edited where you see them."], act: async (p) => {
    await sleep(400);
    await point(p, p.getByRole("button", { name: "Add fence" }));
    const paths = p.locator(".fence-row").last().getByLabel("Paths");
    await point(p, paths);
    await typeSlow(p, "src/gen", 70);
    await sleep(900);
    await p.keyboard.press("Tab");
    await sleep(1400);
  } },
  { name: "memory", hash: "agents/memory", dur: 5, cap: ["12 · MEMORY", "It knows when it's stale."], act: async (p) => {
    await sleep(700);
    const stale = p.locator(".ag-mem.stale").first();
    if (await stale.count()) { await point(p, stale.getByRole("button", { name: "Still true" })); }
    await sleep(2400);
  } },
  { name: "autofill", hash: "graph", dur: 6, prepare: async (p) => { await settled(p); }, cap: ["13 · WRITE WHERE YOU ARE", "Notes fill themselves from what you're looking at."], act: async (p) => {
    await inspect(p, "resolve_target");
    await point(p, p.locator(".rail").getByRole("button", { name: "Notes" }));
    await sleep(500);
    const target = p.getByLabel("Note target");
    await target.fill("");
    await point(p, target);
    await sleep(2200);
  } },
  { name: "connect", hash: "agents/connect", dur: 4.5, cap: ["14 · ANY AGENT", "Claude Code · Cursor · Codex · Gemini · MCP"], act: async (p) => {
    await sleep(500);
    await point(p, p.getByRole("button", { name: "Connect all" }));
    await sleep(2600);
  } },
  { name: "finale", hash: "graph", dur: 9, cap: null, act: async (p) => {
    await sleep(5200);
    await p.keyboard.press("f");
    await sleep(3500);
  } },
];

async function recordApp(browser, s) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: "dark" });
  await ctx.addInitScript(() => {
    try { sessionStorage.setItem("kula.opened", "1"); } catch { /* */ }
    try { localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); } catch { /* */ }
  });
  const page = await ctx.newPage();
  // A shot that needs a settled graph loads it first, off camera.
  if (s.prepare) { await page.goto(`${BASE}/#${s.hash}`); await s.prepare(page); await sleep(800); }
  else { await page.goto("about:blank"); }
  const dir = join(OUT, s.name + ".frames");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    const f = join(dir, String(frames.length).padStart(5, "0") + ".jpg");
    writeFileSync(f, Buffer.from(data, "base64"));
    frames.push({ f, t: metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  if (!s.prepare) await page.goto(`${BASE}/#${s.hash}`);
  await chrome(page, s.cap);
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  const t0 = Date.now() / 1000;
  await Promise.race([s.act(page), sleep(s.dur * 1000)]).catch((e) => console.warn(s.name, e.message));
  const left = s.dur - (Date.now() / 1000 - t0);
  if (left > 0) await sleep(left * 1000);
  await cdp.send("Page.stopScreencast");
  await sleep(200);
  await ctx.close();
  if (!frames.length) throw new Error(`${s.name}: no frames`);
  // Frames arrive when the page paints; hold each until the next for a constant-rate clip.
  const start = frames[0].t, end = start + s.dur;
  let list = "";
  frames.forEach((fr, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].t : end;
    list += `file '${fr.f}'\nduration ${Math.max(0.001, next - fr.t).toFixed(4)}\n`;
  });
  list += `file '${frames[frames.length - 1].f}'\n`;
  writeFileSync(join(dir, "list.txt"), list);
  ffmpeg(["-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"), "-vf", `fps=${FPS},scale=${W}:${H}:flags=lanczos,format=yuv420p`, "-c:v", "libx264", "-preset", "slow", "-crf", "15", "-t", String(s.dur), join(OUT, s.name + ".mp4")]);
  rmSync(dir, { recursive: true, force: true });
  writeFileSync(join(OUT, s.name + ".json"), JSON.stringify({ duration: s.dur, frames: frames.length }));
  console.log("app  ", s.name, frames.length, "frames");
}

// ------------------------------------------------------------------ main

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
for (const s of TYPE) if (!only.size || only.has(s.name)) await renderType(browser, s);

const appShots = SHOTS.filter((s) => !only.size || only.has(s.name));
if (appShots.length) {
  if (!existsSync(join(ROOT, "target/debug/kula"))) execFileSync("cargo", ["build"], { cwd: ROOT, stdio: "inherit" });
  const server = spawn("sh", [join(ROOT, "web/e2e/fixture.sh"), String(PORT)], { cwd: join(ROOT, "web"), stdio: ["ignore", "ignore", "inherit"], detached: true });
  try {
    for (let i = 0; i < 120; i++) { try { if ((await fetch(BASE)).ok) break; } catch { /* starting */ } await sleep(500); }
    for (const s of appShots) await recordApp(browser, s);
  } finally {
    try { process.kill(-server.pid); } catch { /* gone */ }
  }
}
await browser.close();
