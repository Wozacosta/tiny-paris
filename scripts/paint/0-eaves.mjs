// Each building's eave height from the LiDAR heights: where its walls stop and
// its real roof (slopes, towers, spires) starts in the base render.
//   node scripts/paint/0-eaves.mjs   (after 0-ortho.mjs)
// Writes paint/ortho/eaves.json: decimetres per building, in the map data's
// order, 0 where the LiDAR has nothing to say.

import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { DIR } from "./common.mjs";

const ix = JSON.parse(readFileSync(`${DIR}/ortho/index.json`, "utf8"));
const raw = JSON.parse(readFileSync("public/data/northeast.json", "utf8"));
const k = raw.scale;
const res = ix.side / ix.hpx;

const tiles = new Map();
function heightAt(x, y) {
  const fx = (x - ix.x0) / res, fy = (y - ix.y0) / res;
  const i = Math.floor(fx / ix.hpx), j = Math.floor(fy / ix.hpx);
  if (i < 0 || j < 0 || i >= ix.cols || j >= ix.rows) return NaN;
  const key = `${i}_${j}`;
  let t = tiles.get(key);
  if (!t) {
    const b = readFileSync(`${DIR}/ortho/${key}.u16`);
    tiles.set(key, (t = new Uint16Array(b.buffer, b.byteOffset, b.length / 2)));
  }
  return t[Math.floor(fy - j * ix.hpx) * ix.hpx + Math.floor(fx - i * ix.hpx)] / 10;
}

function inside(x, y, rings) {
  let n = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) n = !n;
    }
  }
  return n;
}

const eaves = raw.buildings.map((b) => {
  const rings = b.r.map((r) => r.map((v) => v / k));
  // Just inside the walls, every metre: the cornice line, not the roof's middle.
  const hs = [];
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const ax = r[j], ay = r[j + 1], dx = r[i] - ax, dy = r[i + 1] - ay, L = Math.hypot(dx, dy);
      if (L < 0.5) continue;
      const nx = -dy / L, ny = dx / L;
      for (let s = 0.5; s < L; s += 1) {
        const px = ax + (dx * s) / L, py = ay + (dy * s) / L;
        for (const o of [0.75, -0.75]) {
          const qx = px + nx * o, qy = py + ny * o;
          if (!inside(qx, qy, rings)) continue;
          const h = heightAt(qx, qy);
          if (h >= 2) hs.push(h);
          break;
        }
      }
    }
  }
  if (hs.length < 4) return 0;
  hs.sort((a, b) => a - b);
  // The median: walls reach the usual cornice line, while towers, ridges and
  // trees leaning over the edge don't raise them.
  return Math.round(hs[Math.floor(hs.length * 0.5)] * 10);
});
await writeFile(`${DIR}/ortho/eaves.json`, JSON.stringify(eaves));
const n = eaves.filter(Boolean).length;
console.log(`eaves for ${n}/${eaves.length} buildings`);
