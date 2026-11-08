// Renders the painted area from the live map as overlapping base tiles.
//   node scripts/paint/1-base.mjs [--out paint/base] [--only 9_7,17_7] [--mask] [--manifest]
// Writes paint/base/<col>_<row>.png and paint/manifest.json (with --only, only
// if --manifest is given; --only "" --manifest writes just the manifest).
// With --mask, writes the stone-wall masks the stitch recolours with
// (paint/stonemask/<col>_<row>.png) instead, and leaves the manifest alone.

import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { AREA, DIR, GRID_ANCHOR, OVERLAP, ROTATION, STEP, TILE, ZOOM, areaPolygon, openExportPage } from "./common.mjs";

const { values: opt } = parseArgs({
  options: { out: { type: "string" }, only: { type: "string" }, mask: { type: "boolean", default: false }, manifest: { type: "boolean", default: false } },
});
const only = opt.only != null ? new Set(opt.only.split(",").filter(Boolean)) : null;
opt.out ??= opt.mask ? `${DIR}/stonemask` : `${DIR}/base`;

const { page, close } = await openExportPage();
try {
  const outline = await page.evaluate((r) => window.tinyExport.outline(r), ROTATION);
  const tall = await page.evaluate((r) => window.tinyExport.tall(r, 40), ROTATION);
  const poly = areaPolygon(outline, tall);
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  // Mosaic origin and size in canvas pixels, padded so edge tiles get
  // context, and snapped to the first map's tile grid.
  const pad = OVERLAP / ZOOM, S = STEP / ZOOM;
  const ox = GRID_ANCHOR[0] - Math.ceil((GRID_ANCHOR[0] - (Math.min(...xs) - pad)) / S) * S;
  const oy = GRID_ANCHOR[1] - Math.ceil((GRID_ANCHOR[1] - (Math.min(...ys) - pad)) / S) * S;
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
        ({ R, cx, cy, Z, T, mask }) => (mask ? window.tinyExport.stoneMask(R, cx, cy, Z, T, T) : window.tinyExport.render(R, cx, cy, Z, T, T)),
        { R: ROTATION, cx, cy, Z: ZOOM, T: TILE, mask: opt.mask },
      );
      await writeFile(`${opt.out}/${c}_${r}.png`, Buffer.from(url.split(",")[1], "base64"));
      process.stdout.write(".");
    }
  }
  const manifest = { area: AREA, rotation: ROTATION, zoom: ZOOM, tile: TILE, step: STEP, overlap: OVERLAP, origin: [ox, oy], width, height, cols, rows, polygon: poly, tiles };
  if ((!only || opt.manifest) && !opt.mask) await writeFile(`${DIR}/manifest.json`, JSON.stringify(manifest, null, 2));
  console.log(`\n${tiles.length} base tiles (${cols}×${rows} grid, mosaic ${width}×${height}px)`);
} finally {
  await close();
}
