// Measures what a slow phone would feel: long main-thread tasks while the city
// loads, and frame times with the traffic running, on a 4× slowed CPU.
//   node scripts/perf.mjs            (starts its own dev server)
// Prints one JSON line; compare before and after a change.

import { createServer } from "vite";
import { chromium } from "playwright-core";

const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const cdp = await page.context().newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await page.addInitScript(() => {
  // By day, whatever the hour: night is measured apart, below.
  sessionStorage.setItem("tp-night", sessionStorage.getItem("tp-night") ?? "off");
  window.__long = [];
  new PerformanceObserver((l) => window.__long.push(...l.getEntries().map((e) => Math.round(e.duration)))).observe({ type: "longtask", buffered: true });
});
const t0 = Date.now();
await page.goto("http://localhost:5199/");
await page.waitForFunction(() => /\d buildings/.test(document.getElementById("stats").textContent), null, { timeout: 180_000 });
const load = { readyMs: Date.now() - t0, longTasks: await page.evaluate(() => window.__long.filter((d) => d >= 100).sort((a, b) => b - a).slice(0, 8)) };

/** Frame intervals over `ms` at a place and zoom. */
async function frames(lon, lat, zoom, ms = 5000) {
  await page.evaluate(([lon, lat, zoom]) => window.__goto(lon, lat, zoom), [lon, lat, zoom]);
  await page.waitForTimeout(1500);
  return page.evaluate((ms) => new Promise((done) => {
    const d = [];
    let last = performance.now();
    const start = last;
    const tick = (now) => {
      d.push(now - last);
      last = now;
      if (now - start < ms) requestAnimationFrame(tick);
      else {
        d.sort((a, b) => a - b);
        done({ fps: Math.round(1000 / (d.reduce((a, b) => a + b, 0) / d.length)), p95ms: Math.round(d[Math.floor(d.length * 0.95)]) });
      }
    };
    requestAnimationFrame(tick);
  }), ms);
}
const out = { load, republique: {}, opera: {}, night: {} };
for (const z of [1.2, 2.5, 4]) {
  out.republique[z] = await frames(2.3639, 48.8675, z);
  out.opera[z] = await frames(2.3316, 48.8719, z);
}
await page.click("#night");
out.night = { 0.5: await frames(2.3639, 48.8675, 0.5), 2.5: await frames(2.3639, 48.8675, 2.5), 4: await frames(2.3639, 48.8675, 4) };
console.log(JSON.stringify(out));
await browser.close();
await server.close();
