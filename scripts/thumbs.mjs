// Cuts a small picture of each landmark out of the painted map, for the
// desktop strip of landmarks: public/thumbs/<slug>.webp.
//   node scripts/thumbs.mjs
// Run it again after a stitch that repaints a landmark.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { LANDMARKS, slug } from "../src/landmarks.ts";
import { landmarkPixel } from "./paint/landmarks.mjs";

const OUT = "public/thumbs";
const [W, H] = [360, 240]; // shown at 180 × 120, sharp on 2× screens
const m = JSON.parse(await readFile("public/painted/manifest.json", "utf8"));
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
for (const l of LANDMARKS) {
  const [px, py] = landmarkPixel(m, l);
  // Closer than the "Go to" view, so the landmark fills the picture; wider
  // for tall things, so their top fits. Whole pixels, so the chunks meet
  // without seams.
  const tall = (((l.top ?? 0) + 40) * m.zoom) / 0.75;
  const cw = Math.round(Math.max(1300 / l.zoom, (tall * W) / H)), ch = Math.round((cw * H) / W);
  const lift = Math.max(l.z ?? 10, (l.top ?? 0) - (0.3 * ch) / m.zoom);
  const x0 = Math.round(px - cw / 2), y0 = Math.round(py - lift * m.zoom - ch / 2);
  const chunks = [];
  for (let cy = Math.floor(y0 / m.chunk); cy <= Math.floor((y0 + ch) / m.chunk); cy++)
    for (let cx = Math.floor(x0 / m.chunk); cx <= Math.floor((x0 + cw) / m.chunk); cx++) {
      const file = `public/painted/0/${cx}_${cy}.webp`;
      if (existsSync(file)) chunks.push({ x: cx * m.chunk - x0, y: cy * m.chunk - y0, data: (await readFile(file)).toString("base64") });
    }
  const url = await page.evaluate(
    async ({ chunks, cw, ch, W, H }) => {
      // Full size first, then one smooth shrink.
      const full = new OffscreenCanvas(cw, ch), f = full.getContext("2d");
      f.fillStyle = "#e9e4d4";
      f.fillRect(0, 0, cw, ch);
      for (const p of chunks) {
        const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(p.data), (c) => c.charCodeAt(0))], { type: "image/webp" }));
        f.drawImage(bmp, p.x, p.y);
      }
      const c = new OffscreenCanvas(W, H), g = c.getContext("2d");
      g.imageSmoothingQuality = "high";
      g.drawImage(full, 0, 0, W, H);
      const blob = await c.convertToBlob({ type: "image/webp", quality: 0.78 });
      return `data:image/webp;base64,${btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())))}`;
    },
    { chunks, cw, ch, W, H },
  );
  await writeFile(`${OUT}/${slug(l.name)}.webp`, Buffer.from(url.split(",")[1], "base64"));
}
await browser.close();
console.log(`${LANDMARKS.length} thumbnails in ${OUT}`);
