import { chromium } from "@playwright/test";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.addInitScript(() => { sessionStorage.setItem("kula.opened", "1"); localStorage.setItem("kula.settings.v1", JSON.stringify({ opening: false })); });
await p.goto("http://localhost:7821/#map");
await p.waitForSelector("[data-testid=map-view]", { timeout: 30000 });
await p.waitForTimeout(500);
const state = (tag) => p.evaluate((t) => {
  const key = document.querySelector("[data-testid=x5-legend]");
  const r = key.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const plain = document.querySelector("[data-testid=u9-plain-panel]");
  const dock = document.querySelector("[data-testid=map-plain-dock]");
  return { t, key: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), exp: key.getAttribute("aria-expanded") }, hit: hit ? hit.tagName + "." + hit.className : "none", plainBox: plain ? JSON.stringify(plain.getBoundingClientRect().toJSON()) : "none", dockVisible: dock ? getComputedStyle(dock).display : "gone" };
}, tag);
console.log(await state("initial"));
await p.locator("[data-testid=x5-legend]").click();
console.log(await state("after open click"));
await p.evaluate(() => { document.querySelector(".fc-card:not(.fc-card-sec)")?.click(); });
await p.waitForSelector("[data-testid=map-inspector]", { timeout: 15000 });
await p.waitForTimeout(300);
console.log(await state("inspector open"));
try { await p.locator("[data-testid=x5-legend]").click({ timeout: 5000 }); console.log("collapse click ok"); }
catch (e) { console.log("collapse click FAILED", e.message.split("\n")[0]); }
console.log(await state("end"));
await b.close();
