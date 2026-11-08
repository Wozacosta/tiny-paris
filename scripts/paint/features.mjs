// What each tile actually contains (rail tracks, water), from the map data,
// so prompts can say so outright: the model invents canals and rail yards
// wherever it is merely told how to paint them.

import { readFileSync } from "node:fs";

const world = JSON.parse(readFileSync("public/data/paris.json", "utf8"));

// Map data (decimetres) to mosaic pixels for rotation 3 (sx = x + y, sy = (y - x) / 2).
const toPixel = (m, dx, dy) => {
  const x = dx / 10, y = dy / 10;
  return [(x + y - m.origin[0]) * m.zoom, ((y - x) / 2 - m.origin[1]) * m.zoom];
};

const inside = (px, py, ring) => {
  let hit = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const [xi, yi, xj, yj] = [ring[i], ring[i + 1], ring[j], ring[j + 1]];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

/** Per tile: metres of rail track and of elevated métro, and share of the tile covered by water. */
export function tileFeatures(m) {
  const rails = world.roads.filter((r) => r.k === "rail").map((r) => {
    const pts = [];
    for (let i = 0; i < r.p.length; i += 2) pts.push(toPixel(m, r.p[i], r.p[i + 1]));
    return pts;
  });
  const water = world.water.map((poly) => {
    const ring = [];
    for (let i = 0; i < poly[0].length; i += 2) ring.push(...toPixel(m, poly[0][i], poly[0][i + 1]));
    const xs = ring.filter((_, i) => i % 2 === 0), ys = ring.filter((_, i) => i % 2 === 1);
    return { ring, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  });
  // Métro line 2's viaduct: vertices at least 2 m up.
  const viaduct = (world.metro ?? []).map((l) => {
    const pts = [];
    for (let i = 0; i < l.p.length; i += 2) pts.push([...toPixel(m, l.p[i], l.p[i + 1]), l.z[i / 2]]);
    return pts;
  });
  const out = new Map();
  for (const { c, r } of m.tiles) {
    const x0 = c * m.step, y0 = r * m.step, x1 = x0 + m.tile, y1 = y0 + m.tile;
    let rail = 0;
    for (const pts of rails) for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      if (mx > x0 && mx < x1 && my > y0 && my < y1) rail += Math.hypot(bx - ax, by - ay) / m.zoom;
    }
    let elevated = 0;
    for (const pts of viaduct) for (let i = 1; i < pts.length; i++) {
      const [ax, ay, az] = pts[i - 1], [bx, by, bz] = pts[i];
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      if (az >= 2 && bz >= 2 && mx > x0 && mx < x1 && my > y0 && my < y1) elevated += Math.hypot(bx - ax, by - ay) / m.zoom;
    }
    let wet = 0;
    const N = 32;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const px = x0 + ((i + 0.5) / N) * m.tile, py = y0 + ((j + 0.5) / N) * m.tile;
      if (water.some((w) => px > w.box[0] && px < w.box[2] && py > w.box[1] && py < w.box[3] && inside(px, py, w.ring))) wet++;
    }
    out.set(`${c}_${r}`, { rail: Math.round(rail), viaduct: Math.round(elevated), water: wet / (N * N) });
  }
  return out;
}
