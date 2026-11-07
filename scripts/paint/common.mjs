// Shared settings and helpers for the AI-painting pipeline:
//   1-base.mjs   render base tiles of the area from the live map
//   2-paint.mjs  repaint each tile with Gemini
//   3-stitch.mjs blend painted tiles into web chunks for the app

import { createServer } from "vite";
import { chromium } from "playwright-core";

import { BBOX } from "../geo.mjs";

/** The painted area: the whole map. */
export const AREA = BBOX;
/** View rotation the painting is made for (north to the upper left). */
export const ROTATION = 3;
/** Canvas pixels per iso unit (≈ per metre) in the base render. */
export const ZOOM = 2;
export const TILE = 1024;
export const OVERLAP = 160;
export const STEP = TILE - OVERLAP;
/** Extra iso units above the area's top edge so tall buildings aren't cut. */
export const HEADROOM = 80;

export const DIR = "paint";

/** Starts the app's dev server and a headless Chrome page in export mode. */
export async function openExportPage() {
  const server = await createServer({ server: { port: 0 }, logLevel: "error" });
  await server.listen();
  const url = server.resolvedUrls.local[0];
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(`${url}?export`);
  await page.waitForFunction(() => "tinyExport" in window, null, { timeout: 120_000 });
  return {
    page,
    async close() {
      await browser.close();
      await server.close();
    },
  };
}

/** Plain Chrome page with no app, for canvas work like stitching. */
export async function openBlankPage() {
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage();
  return { page, close: () => browser.close() };
}

/** Area outline in iso units: ground diamond with its far edges raised by HEADROOM. */
export function areaPolygon(corners) {
  const cy = corners.reduce((a, p) => a + p[1], 0) / 4;
  return corners.map(([x, y]) => [x, y < cy ? y - HEADROOM : y]);
}
