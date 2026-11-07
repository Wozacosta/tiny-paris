// Hooks used by scripts/paint to render base tiles for AI painting.
// Only installed when the page is opened with ?export.

import type { Building, World } from "./model";
import {
  Z, buildRotView, depthOf, drawGround, drawStructures, isoToWorld, worldToIso,
  type Photo, type RoofShape, type Rotation, type RotView,
} from "./render";
import { DAY } from "./theme";

export interface TinyExport {
  /** Iso-space corners of a lon/lat box at ground level, for a view rotation. */
  corners(r: Rotation, w: number, s: number, e: number, n: number): [number, number][];
  /**
   * PNG data URL of the day map (no traffic, labels or UI) for one camera.
   * If the aerial data is downloaded (scripts/paint/0-ortho.mjs, 0-eaves.mjs),
   * roofs and ground are textured from the photos and roofs take their
   * LiDAR-measured shape.
   */
  render(r: Rotation, cx: number, cy: number, zoom: number, width: number, height: number, aerial?: boolean): Promise<string>;
}

/** paint/ortho/index.json, from scripts/paint/0-ortho.mjs. */
interface OrthoIndex { side: number; px: number; hpx: number; x0: number; y0: number; cols: number; rows: number }

/** Tallest roof worth texturing, in metres: how far below the view a roof can come from. */
const MAX_H = 120;
/** Roof cells this close above the eaves stay part of the flat, photo-textured roof. */
const FLAT = 0.8;
/** A drop this steep between neighbouring 50 cm cells is a wall, not a roof slope. */
const WALL = 1;

let orthoIndex: Promise<OrthoIndex | null> | null = null;
const photoTiles = new Map<string, Promise<HTMLImageElement | null>>();
const heightTiles = new Map<string, Promise<Uint16Array | null>>();

function photoTile(i: number, j: number) {
  const key = `${i}_${j}`;
  let p = photoTiles.get(key);
  if (!p) {
    const img = new Image();
    img.src = `/paint/ortho/${key}.jpg`;
    photoTiles.set(key, (p = img.decode().then(() => img, () => null)));
  }
  return p;
}

function heightTile(i: number, j: number) {
  const key = `${i}_${j}`;
  let p = heightTiles.get(key);
  if (!p) {
    p = fetch(`/paint/ortho/${key}.u16`).then((r) => (r.ok ? r.arrayBuffer().then((b) => new Uint16Array(b)) : null), () => null);
    heightTiles.set(key, p);
  }
  return p;
}

interface Aerial {
  photo: Photo;
  roofShape: RoofShape;
}

/** Photo and heights under a view, stitched from the tiles it needs. */
async function aerialFor(world: World, r: Rotation, cx: number, cy: number, zoom: number, width: number, height: number): Promise<Aerial | undefined> {
  orthoIndex ??= fetch("/paint/ortho/index.json").then((res) => (res.ok ? res.json() : null), () => null);
  const ix = await orthoIndex;
  if (!ix) return undefined;
  const hw = width / 2 / zoom, hh = height / 2 / zoom;
  const corners = [[cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh + MAX_H * 1.15], [cx - hw, cy + hh + MAX_H * 1.15]]
    .map(([sx, sy]) => isoToWorld(r, sx, sy));
  const i0 = Math.max(0, Math.floor((Math.min(...corners.map((p) => p[0])) - ix.x0) / ix.side));
  const i1 = Math.min(ix.cols - 1, Math.floor((Math.max(...corners.map((p) => p[0])) - ix.x0) / ix.side));
  const j0 = Math.max(0, Math.floor((Math.min(...corners.map((p) => p[1])) - ix.y0) / ix.side));
  const j1 = Math.min(ix.rows - 1, Math.floor((Math.max(...corners.map((p) => p[1])) - ix.y0) / ix.side));
  if (i1 < i0 || j1 < j0) return undefined;
  const wx = ix.x0 + i0 * ix.side, wy = ix.y0 + j0 * ix.side;

  // Photo: a canvas to draw from, and its pixels to colour roof cells with.
  const k = ix.px / ix.side;
  const pc = document.createElement("canvas");
  const pw = (pc.width = (i1 - i0 + 1) * ix.px), ph = (pc.height = (j1 - j0 + 1) * ix.px);
  const pg = pc.getContext("2d", { willReadFrequently: true })!;
  // Heights, in decimetres above ground.
  const hk = ix.hpx / ix.side;
  const hw2 = (i1 - i0 + 1) * ix.hpx, hh2 = (j1 - j0 + 1) * ix.hpx;
  const hs = new Uint16Array(hw2 * hh2);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const [img, t] = await Promise.all([photoTile(i, j), heightTile(i, j)]);
    if (img) pg.drawImage(img, (i - i0) * ix.px, (j - j0) * ix.px);
    if (t) for (let y = 0; y < ix.hpx; y++) hs.set(t.subarray(y * ix.hpx, (y + 1) * ix.hpx), ((j - j0) * ix.hpx + y) * hw2 + (i - i0) * ix.hpx);
  }
  const pix = pg.getImageData(0, 0, pw, ph).data;
  // LiDAR noise of a few decimetres would speckle flat roofs: a 3×3 median,
  // which unlike a blur keeps walls sharp.
  const sm = new Float32Array(hs.length);
  const win = new Uint16Array(9);
  for (let v = 1; v < hh2 - 1; v++) for (let u = 1; u < hw2 - 1; u++) {
    const q = v * hw2 + u;
    let n = 0;
    for (let dv = -hw2; dv <= hw2; dv += hw2) for (let du = -1; du <= 1; du++) win[n++] = hs[q + dv + du];
    win.sort();
    sm[q] = win[4] / 10;
  }

  const heightAt = (x: number, y: number) => {
    const u = Math.floor((x - wx) * hk), v = Math.floor((y - wy) * hk);
    return u < 0 || v < 0 || u >= hw2 || v >= hh2 ? 0 : sm[v * hw2 + u];
  };
  // Sun from the upper left of the screen, 45° up: the base render's light.
  const [lx, ly] = isoToWorld(r, -1, -0.5);
  const ln = Math.hypot(lx, ly);
  const L = [(lx / ln) * 0.707, (ly / ln) * 0.707, 0.707];
  const CELL = 1 / hk;
  // The grid neighbours just in front of a cell on the screen's left and right.
  const front = ([sx, sy]: [number, number]) => isoToWorld(r, sx, sy).map((v) => Math.round(v) * CELL) as [number, number];
  const [flx, fly] = front([-1, 0.5]), [frx, fry] = front([1, 0.5]);

  const roofShape: RoofShape = (ctx, idx, z, ox, oy, walls) => {
    const b = world.buildings[idx];
    const eave = b.h;
    const o = b.rings[0];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < o.length; i += 2) {
      x0 = Math.min(x0, o[i]); x1 = Math.max(x1, o[i]);
      y0 = Math.min(y0, o[i + 1]); y1 = Math.max(y1, o[i + 1]);
    }
    // Cells of the footprint that rise above the eaves.
    const cells: number[] = [];
    for (let y = (Math.floor((y0 - wy) * hk) + 0.5) / hk + wy; y < y1; y += CELL) {
      for (let x = (Math.floor((x0 - wx) * hk) + 0.5) / hk + wx; x < x1; x += CELL) {
        const h = heightAt(x, y);
        if (h > eave + FLAT && insideRings(x, y, b.rings)) cells.push(x, y, h);
      }
    }
    if (!cells.length) return;
    const toPx = (x: number, y: number, h: number) => {
      const [sx, sy] = worldToIso(r, x, y, h);
      return [sx * z + ox, sy * z + oy];
    };
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (let c = 0; c < cells.length; c += 3) {
      const [tx, ty] = toPx(cells[c], cells[c + 1], cells[c + 2]);
      const [, gy] = toPx(cells[c], cells[c + 1], eave);
      bx0 = Math.min(bx0, tx); bx1 = Math.max(bx1, tx);
      by0 = Math.min(by0, ty); by1 = Math.max(by1, gy);
    }
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    const cellW = Math.max(1, Math.round(z * CELL * 2)), cellH = Math.max(1, Math.round(z * CELL));
    bx0 = Math.max(0, Math.floor(bx0 - cellW)); by0 = Math.max(0, Math.floor(by0 - cellH));
    bx1 = Math.min(cw, Math.ceil(bx1 + cellW)); by1 = Math.min(ch, Math.ceil(by1 + cellH));
    const W = bx1 - bx0, H = by1 - by0;
    if (W <= 0 || H <= 0) return;

    const img = new ImageData(W, H);
    const out = new Uint32Array(img.data.buffer);
    const wallA = shadeRGB(walls[0]), wallB = shadeRGB(walls[1]), wallMid = shadeRGB(walls[0], walls[1]);
    const windowRGB = shadeRGB(DAY.window);
    const order = Array.from({ length: cells.length / 3 }, (_, i) => i * 3)
      .sort((a, c) => depthOf(r, cells[a], cells[a + 1]) - depthOf(r, cells[c], cells[c + 1]));
    for (const c of order) {
      const x = cells[c], y = cells[c + 1], h = cells[c + 2];
      // Slope light from the neighbouring heights.
      const gx = (heightAt(x + CELL, y) - heightAt(x - CELL, y)) / (2 * CELL);
      const gy = (heightAt(x, y + CELL) - heightAt(x, y - CELL)) / (2 * CELL);
      const nl = Math.hypot(gx, gy, 1);
      const lit = Math.max(0.7, Math.min(1.15, 0.65 + 0.5 * ((-gx * L[0] - gy * L[1] + L[2]) / nl)));
      // The photo over the cell, averaged so its finer grain doesn't speckle.
      const u = Math.min(pw - 2, Math.max(0, Math.floor((x - wx) * k - 0.5))), v = Math.min(ph - 2, Math.max(0, Math.floor((y - wy) * k - 0.5)));
      const p = (v * pw + u) * 4, q = p + pw * 4;
      const avg = (o: number) => (pix[p + o] + pix[p + 4 + o] + pix[q + o] + pix[q + 4 + o]) / 4;
      // Cells on a wall's edge (mixed LiDAR returns) are wall, not roof.
      const top = Math.hypot(gx, gy) > 2 ? wallMid : rgba(avg(0) * lit, avg(1) * lit, avg(2) * lit);
      // Each side drops to the neighbour in front of it (the eaves past the
      // footprint): a steep drop is a wall, a gentle one more of the roof.
      const below = (dx: number, dy: number) => (insideRings(x + dx, y + dy, b.rings) ? Math.max(eave, Math.min(h, heightAt(x + dx, y + dy))) : eave);
      const hl = below(flx, fly), hr = below(frx, fry);
      // A wall seen at an angle shows both faces in one cell: one blended colour.
      const wall = h - hl > WALL && h - hr > WALL ? wallMid : null;
      const sides = ([[hl, wallA], [hr, wallB]] as const).map(([hn, face]) => ({
        bottom: Math.round(toPx(x, y, hn)[1]) - by0,
        color: h - hn > WALL ? (wall ?? face) : top,
      }));
      const [tx, ty] = toPx(x, y, h);
      const left = Math.round(tx - cellW / 2) - bx0, topY = Math.round(ty - cellH / 2) - by0;
      for (let dx = 0; dx < cellW; dx++) {
        const px = left + dx;
        if (px < 0 || px >= W) continue;
        const s = dx < cellW / 2 ? 0 : 1, sd = sides[s];
        // Windows on measured walls too: one every 1.5 m along it, per 3 m floor.
        const along = s === 0 ? x * fly - y * flx : x * fry - y * frx;
        const bay = Math.floor(along / CELL / CELL / 3 + 0.5) % 3 === 1;
        for (let py = Math.max(0, topY); py < Math.min(H, Math.max(topY + cellH + 1, sd.bottom)); py++) {
          if (py <= topY + cellH || sd.color === top) out[py * W + px] = top;
          else {
            const zz = h - (py - topY) / (Z * z);
            out[py * W + px] = bay && zz % 3 > 1 && zz % 3 < 2.3 ? windowRGB : sd.color;
          }
        }
      }
    }
    const sprite = document.createElement("canvas");
    sprite.width = W;
    sprite.height = H;
    sprite.getContext("2d")!.putImageData(img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(sprite, bx0, by0);
  };

  return { photo: (ctx) => ctx.drawImage(pc, wx, wy, pw / k, ph / k), roofShape };
}

function insideRings(x: number, y: number, rings: Float64Array[]) {
  let n = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) n = !n;
    }
  }
  return n;
}

/** Packed little-endian RGBA, opaque. */
function rgba(r: number, g: number, b: number) {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (0xff << 24) | (c(b) << 16) | (c(g) << 8) | c(r);
}

/** A hex colour packed as RGBA, or the mix of two. */
function shadeRGB(hex: string, other = hex) {
  const n = parseInt(hex.slice(1), 16), m = parseInt(other.slice(1), 16);
  const mix = (s: number) => (((n >> s) & 255) + ((m >> s) & 255)) / 2;
  return rgba(mix(16), mix(8), mix(0));
}

/**
 * The world with every building's walls stopping at its LiDAR eave height
 * (paint/ortho/eaves.json), so the measured roof can be drawn above them.
 */
async function eaveWorld(world: World): Promise<World | null> {
  const eaves: number[] | null = await fetch("/paint/ortho/eaves.json").then((r) => (r.ok ? r.json() : null), () => null);
  if (!eaves) return null;
  const buildings = world.buildings.map((b, i): Building => {
    const e = eaves[i] / 10;
    return e > 0 ? { ...b, h: e, mansard: 0, domes: [] } : b;
  });
  return { ...world, buildings };
}

export function installExport(world: World) {
  const views: RotView[] = [];
  const eaveViews: RotView[] = [];
  let eaved: Promise<World | null> | null = null;
  const api: TinyExport = {
    corners(r, w, s, e, n) {
      return [[w, n], [e, n], [e, s], [w, s]].map(([lon, lat]) => {
        const [x, y] = world.project(lon, lat);
        return worldToIso(r, x, y);
      });
    },
    async render(r, cx, cy, zoom, width, height, aerial = true) {
      eaved ??= eaveWorld(world);
      const w = (aerial && (await eaved)) || world;
      const view = w === world ? (views[r] ??= buildRotView(world, r)) : (eaveViews[r] ??= buildRotView(w, r));
      const make = () => {
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        return c;
      };
      const ground = make(), build = make(), out = make();
      const cam = { cx, cy, zoom };
      const air = aerial ? await aerialFor(w, r, cx, cy, zoom, width, height) : undefined;
      drawGround(ground.getContext("2d")!, w, view, cam, DAY, 1, air?.photo);
      drawStructures(build.getContext("2d")!, w, view, cam, DAY, 1, air?.photo, w === world ? undefined : air?.roofShape);
      const ctx = out.getContext("2d")!;
      ctx.fillStyle = DAY.ground;
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(ground, 0, 0);
      ctx.drawImage(build, 0, 0);
      return out.toDataURL("image/png");
    },
  };
  (window as unknown as { tinyExport: TinyExport }).tinyExport = api;
}
