// Renders the painted area from the live map as overlapping base tiles.
//   node scripts/paint/1-base.mjs [--out paint/base] [--only 9_7,17_7]
// Writes paint/base/<col>_<row>.png and paint/manifest.json (not with --only).

import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { AREA, DIR, OVERLAP, ROTATION, STEP, TILE, ZOOM, areaPolygon, openExportPage } from "./common.mjs";

const { values: opt } = parseArgs({
  options: { out: { type: "string", default: `${DIR}/base` }, only: { type: "string" } },
});
const only = opt.only ? new Set(opt.only.split(",")) : null;

const { page, close } = await openExportPage();
try {
  const corners = await page.evaluate(
    ({ r, a }) => window.tinyExport.corners(r, a.w, a.s, a.e, a.n),
    { r: ROTATION, a: AREA },
  );
  const poly = areaPolygon(corners);
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  // Mosaic origin and size in canvas pixels, padded so edge tiles get context.
  const pad = OVERLAP / ZOOM;
  const ox = Math.min(...xs) - pad, oy = Math.min(...ys) - pad;
  const width = Math.ceil((Math.max(...xs) + pad - ox) * ZOOM);
  const height = Math.ceil((Math.max(...ys) + pad - oy) * ZOOM);
  const cols = Math.ceil((width - OVERLAP) / STEP);
  const rows = Math.ceil((height - OVERLAP) / STEP);

  // Skip tiles that don't touch the area at all.
  const inPoly = (x, y) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const touches = (c, r) => {
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
      if (inPoly(ox + (c * STEP + (TILE * i) / 8) / ZOOM, oy + (r * STEP + (TILE * j) / 8) / ZOOM)) return true;
    }
    return false;
  };

  await mkdir(opt.out, { recursive: true });
  const tiles = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!touches(c, r)) continue;
      tiles.push({ c, r });
      if (only && !only.has(`${c}_${r}`)) continue;
      // Camera centre of this tile, in iso units.
      const cx = ox + (c * STEP + TILE / 2) / ZOOM;
      const cy = oy + (r * STEP + TILE / 2) / ZOOM;
      const url = await page.evaluate(
        ({ R, cx, cy, Z, T }) => window.tinyExport.render(R, cx, cy, Z, T, T),
        { R: ROTATION, cx, cy, Z: ZOOM, T: TILE },
      );
      await writeFile(`${opt.out}/${c}_${r}.png`, Buffer.from(url.split(",")[1], "base64"));
      process.stdout.write(".");
    }
  }
  const manifest = { area: AREA, rotation: ROTATION, zoom: ZOOM, tile: TILE, step: STEP, overlap: OVERLAP, origin: [ox, oy], width, height, cols, rows, polygon: poly, tiles };
  if (!only) await writeFile(`${DIR}/manifest.json`, JSON.stringify(manifest, null, 2));
  console.log(`\n${tiles.length} base tiles (${cols}×${rows} grid, mosaic ${width}×${height}px)`);
} finally {
  await close();
}
