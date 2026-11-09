// Hooks used by scripts/paint to render base tiles for AI painting.
// Only installed when the page is opened with ?export.

import { GRANDE_ARCHE, type Building, type World } from "./model";
import {
  Z, buildRotView, depthOf, drawGround, drawStructures, isoToWorld, worldToIso,
  type Extra, type Photo, type RoofShape, type Rotation, type RotView,
} from "./render";
import { box, hull, poly } from "./shapes";
import { DAY } from "./theme";
import { drawTrackPiece, trackPieces, type TrackStyle } from "./tracks";

export interface TinyExport {
  /** Iso-space corners of a lon/lat box at ground level, for a view rotation. */
  corners(r: Rotation, w: number, s: number, e: number, n: number): [number, number][];
  /** The map's outline in iso space at ground level, for a view rotation. */
  outline(r: Rotation): [number, number][];
  /** Buildings at least `min` metres tall, in iso space: [x, ground y, top y]. */
  tall(r: Rotation, min: number): [number, number, number][];
  /**
   * PNG data URL of the day map (no traffic, labels or UI) for one camera.
   * If the aerial data is downloaded (scripts/paint/0-ortho.mjs, 0-eaves.mjs),
   * roofs and ground are textured from the photos and roofs take their
   * LiDAR-measured shape.
   */
  render(r: Rotation, cx: number, cy: number, zoom: number, width: number, height: number, aerial?: boolean): Promise<string>;
  /**
   * PNG data URL, same framing as render(): white where a wall that isn't
   * brick shows, black elsewhere (roofs, brick walls, trees, ground). The
   * stitch uses it to take red off walls the painting made brick by mistake.
   */
  stoneMask(r: Rotation, cx: number, cy: number, zoom: number, width: number, height: number): string;
}

/**
 * The métro's structures as pieces to merge into the building layer: iron
 * decks on pairs of stone columns, solid ramps where a line comes down, open
 * trenches where it goes under. In the app they're drawn live with the
 * trains; in the base render they're part of the city, so the painting
 * shows them.
 */
function viaductPieces(world: World, r: Rotation): Extra[] {
  const style: TrackStyle = {
    deckW: 5.2, deckH: 1.6, deck: ["#3e4d47", "#66746c"], stone: ["#bfb39c", "#d6ccb8"], pillarW: 0.9, pillarPair: 1.6, trench: "#363b38",
  };
  return trackPieces(world.metro, 6, 12).map((p) => ({ depth: depthOf(r, p.x, p.y), draw: (ctx) => drawTrackPiece(ctx, r, p, style) }));
}

/**
 * The Grande Arche as an open cube for the painter to follow: two side walls,
 * the roof and the plinth, with the opening along the axis to the Arc de
 * Triomphe. Inner faces are glass, the rest white marble.
 */
function archePieces(world: World, r: Rotation): Extra[] {
  const b = world.buildings.find((x) => x.info?.name === GRANDE_ARCHE);
  if (!b) return [];
  // Along the axis (bearing 116°, towards the Arc) and across it, in world x east, y south.
  const th = (116 * Math.PI) / 180;
  const u = [Math.sin(th), -Math.cos(th)], v = [Math.cos(th), Math.sin(th)];
  const at = (a: number, c: number): [number, number] => [b.cx + u[0] * a + v[0] * c, b.cy + u[1] * a + v[1] * c];
  const H = 54, T = 18; // half-width, wall and roof thickness
  const sun = [0.55, -0.5];
  // A box from (a0, c0) to (a1, c1) across and along, z0 to z1; `inner` marks
  // the side (±1 across) that faces the opening.
  const block = (a0: number, a1: number, c0: number, c1: number, z0: number, z1: number, inner: number) => {
    const faces: { n: number[]; inner: boolean; pts: [number, number][] }[] = [
      { n: u, inner: false, pts: [at(a1, c0), at(a1, c1)] },
      { n: [-u[0], -u[1]], inner: false, pts: [at(a0, c1), at(a0, c0)] },
      { n: v, inner: inner === 1, pts: [at(a1, c1), at(a0, c1)] },
      { n: [-v[0], -v[1]], inner: inner === -1, pts: [at(a0, c0), at(a1, c0)] },
    ];
    const depth = (p: [number, number][]) => depthOf(r, (p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2);
    faces.sort((f, g) => depth(f.pts) - depth(g.pts));
    return (ctx: CanvasRenderingContext2D) => {
      for (const f of faces) {
        const lit = 0.5 + 0.5 * Math.max(0, f.n[0] * sun[0] + f.n[1] * sun[1]);
        const col = f.inner ? `hsl(205 18% ${38 + 20 * lit}%)` : `hsl(40 10% ${70 + 22 * lit}%)`;
        const [p, q] = f.pts;
        poly(ctx, [worldToIso(r, ...p, z0), worldToIso(r, ...q, z0), worldToIso(r, ...q, z1), worldToIso(r, ...p, z1)], col);
      }
      poly(ctx, [at(a0, c0), at(a1, c0), at(a1, c1), at(a0, c1)].map((p) => worldToIso(r, ...p, z1)), "hsl(40 8% 84%)");
    };
  };
  const parts = [
    { c: -H + T / 2, draw: block(-H, H, -H, -H + T, 0, 110, 1) },
    { c: H - T / 2, draw: block(-H, H, H - T, H, 0, 110, -1) },
    { c: 0, draw: block(-H, H, -H + T, H - T, 0, 6, 0) },
    { c: 0, draw: block(-H, H, -H + T, H - T, 110 - T, 110, 0) },
  ];
  // Plinth before roof; the walls by which side is nearer.
  return parts.map((p, i) => ({ depth: depthOf(r, ...at(0, p.c)) + i * 1e-3, draw: p.draw }));
}

/**
 * The Eiffel Tower as a rough 3D shape for the painter to follow: four
 * splayed legs up to the first platform, a tapering shaft to the third, and
 * the antenna, in the tower's bronze.
 */
function eiffelPieces(world: World, r: Rotation): Extra[] {
  const b = world.buildings.find((x) => x.info?.name === "Tour Eiffel");
  if (!b) return [];
  const { cx, cy } = b;
  // The tower is square to the Champ de Mars, 44° off the map grid (its OSM footprint),
  // so one face looks at the Seine.
  const cos = Math.cos((44 * Math.PI) / 180), sin = Math.sin((44 * Math.PI) / 180);
  const at = (dx: number, dy: number): [number, number] => [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  // Frustum around (dx, dy) from the centre: square of half-size a at z0 to half-size c at z1.
  const frustum = (ctx: CanvasRenderingContext2D, x: number, y: number, z0: number, z1: number, a: number, c: number, side: string, top: string | null) => {
    const sq = (h: number, z: number) => [[-h, -h], [h, -h], [h, h], [-h, h]].map(([dx, dy]) => worldToIso(r, ...at(x + dx, y + dy), z));
    const lo = sq(a, z0), hi = sq(c, z1);
    poly(ctx, hull([...lo, ...hi]), side);
    if (top) poly(ctx, hi, top);
  };
  const BRONZE = "#6e5a45", LIT = "#8a7258", DARK = "#4f4033";
  const draw = (ctx: CanvasRenderingContext2D) => {
    // Legs: from the corners of the 125 m base inward to the first platform.
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      for (let k = 0; k < 6; k++) {
        const z0 = (k / 6) * 57, z1 = ((k + 1) / 6) * 57;
        const off = (z: number) => 50 - (z / 57) * 22 - Math.sin((z / 57) * Math.PI) * 4;
        const w = (z: number) => 13 - (z / 57) * 4;
        const mid = (z0 + z1) / 2;
        frustum(ctx, sx * off(mid), sy * off(mid), z0, z1, w(z0), w(z1), k % 2 ? BRONZE : DARK, null);
      }
    }
    frustum(ctx, 0, 0, 55, 59, 36, 36, DARK, LIT); // first platform
    frustum(ctx, 0, 0, 59, 113, 30, 17, BRONZE, null);
    frustum(ctx, 0, 0, 113, 117, 20, 20, DARK, LIT); // second platform
    frustum(ctx, 0, 0, 117, 274, 15, 5, BRONZE, null);
    frustum(ctx, 0, 0, 274, 280, 7, 7, DARK, LIT); // top platform
    frustum(ctx, 0, 0, 280, 325, 2.5, 0.6, BRONZE, null); // antenna
  };
  return [{ depth: depthOf(r, cx, cy), draw }];
}

/** paint/ortho/index.json, from scripts/paint/0-ortho.mjs. */
interface OrthoIndex { side: number; px: number; hpx: number; x0: number; y0: number; cols: number; rows: number }

/** Tallest roof worth texturing, in metres: how far below the view a roof can come from. */
const MAX_H = 120;
/** Height grid spacing in metres (LiDAR HD's 50 cm). */
const CELL_M = 0.5;
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

  // The Grande Arche's flattened outlines: archePieces() draws it, not the LiDAR.
  const arche = world.buildings.find((b) => b.info?.name === GRANDE_ARCHE);
  const nearArche = (b: Building) => !!arche && b.h <= 1 && Math.hypot(b.cx - arche.cx, b.cy - arche.cy) < 75;
  const roofShape: RoofShape = (ctx, idx, z, ox, oy, walls) => {
    const b = world.buildings[idx];
    if (b.info?.name === "Tour Eiffel" || nearArche(b)) return;
    const eave = b.h;
    const o = b.rings[0];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < o.length; i += 2) {
      x0 = Math.min(x0, o[i]); x1 = Math.max(x1, o[i]);
      y0 = Math.min(y0, o[i + 1]); y1 = Math.max(y1, o[i + 1]);
    }
    // The footprint as a grid of height cells.
    const gi0 = Math.floor((x0 - wx) * hk), gj0 = Math.floor((y0 - wy) * hk);
    const gw = Math.floor((x1 - wx) * hk) - gi0 + 1, gh = Math.floor((y1 - wy) * hk) - gj0 + 1;
    const cx = (i: number) => wx + (gi0 + i + 0.5) / hk, cy = (j: number) => wy + (gj0 + j + 0.5) / hk;
    const n = gw * gh;
    const inside = new Uint8Array(n), raw = new Float32Array(n);
    let count = 0;
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      if (!insideRings(cx(i), cy(j), b.rings)) continue;
      inside[j * gw + i] = 1;
      raw[j * gw + i] = Math.max(eave, heightAt(cx(i), cy(j)));
      count++;
    }
    if (!count) return;
    const { heights: fh, slope: onSlope } = cleanRoof(raw, inside, gw, gh, eave);

    // The roof's material from the photo: its shadow-free average colour, so
    // shadows, overhanging trees and grime don't stain it.
    const photoAt = (x: number, y: number) => {
      const u = Math.min(pw - 2, Math.max(0, Math.floor((x - wx) * k - 0.5))), v = Math.min(ph - 2, Math.max(0, Math.floor((y - wy) * k - 0.5)));
      const p = (v * pw + u) * 4, q = p + pw * 4;
      return [0, 1, 2].map((c) => (pix[p + c] + pix[p + 4 + c] + pix[q + c] + pix[q + 4 + c]) / 4);
    };
    const material = roofMaterial(gw, gh, inside, (i, j) => photoAt(cx(i), cy(j)));

    const toPx = (x: number, y: number, h: number) => {
      const [sx, sy] = worldToIso(r, x, y, h);
      return [sx * z + ox, sy * z + oy];
    };
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      if (!inside[j * gw + i]) continue;
      const [tx, ty] = toPx(cx(i), cy(j), fh[j * gw + i]);
      const [, gy] = toPx(cx(i), cy(j), eave);
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
    const at = (i: number, j: number) => (i < 0 || j < 0 || i >= gw || j >= gh || !inside[j * gw + i] ? eave : fh[j * gw + i]);
    // Grid steps to the neighbours just in front on the screen's left and right.
    const fl = [Math.round(flx * hk), Math.round(fly * hk)], fr = [Math.round(frx * hk), Math.round(fry * hk)];
    const cells: number[] = [];
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) if (inside[j * gw + i]) cells.push(j * gw + i);
    cells.sort((a, c) => depthOf(r, cx(a % gw), cy((a / gw) | 0)) - depthOf(r, cx(c % gw), cy((c / gw) | 0)));
    for (const q of cells) {
      const i = q % gw, j = (q / gw) | 0, x = cx(i), y = cy(j), h = fh[q];
      const gx = (at(i + 1, j) - at(i - 1, j)) / (2 * CELL), gy = (at(i, j + 1) - at(i, j - 1)) / (2 * CELL);
      const slope = Math.hypot(gx, gy);
      const nl = Math.hypot(gx, gy, 1);
      // Flat roofs evenly lit; slopes shaded towards or away from the sun.
      const lit = slope < 0.2 ? 1 : Math.max(0.72, Math.min(1.15, 0.65 + 0.5 * ((-gx * L[0] - gy * L[1] + L[2]) / nl)));
      const ph2 = photoAt(x, y);
      // A little of the photo for texture (skylights, panels, terraces), never its shadows.
      const lum = (c: number[]) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
      const w = lum(ph2) < lum(material) * 0.85 ? 0.08 : 0.25;
      const top = rgba(...([0, 1, 2].map((c) => (material[c] * (1 - w) + ph2[c] * w) * lit) as [number, number, number]));
      const hl = Math.min(h, at(i + fl[0], j + fl[1])), hr = Math.min(h, at(i + fr[0], j + fr[1]));
      // A roof slope continues down to its neighbours as roof, never as wall.
      const flatTop = !onSlope[q];
      const both = flatTop && h - hl > WALL && h - hr > WALL;
      const [tx, ty] = toPx(x, y, h);
      const left = Math.round(tx - cellW / 2) - bx0, topY = Math.round(ty - cellH / 2) - by0;
      for (let dx = 0; dx < cellW; dx++) {
        const px = left + dx;
        if (px < 0 || px >= W) continue;
        const sideL = dx < cellW / 2, hn = sideL ? hl : hr;
        const wall = flatTop && h - hn > WALL;
        const face = both ? wallMid : sideL ? wallA : wallB;
        const bottom = wall || h - hn > 0 ? Math.round(toPx(x, y, hn)[1]) - by0 : topY + cellH;
        // Windows on measured walls: 1.2 m wide every 2.6 m along the face, per 3 m floor.
        const [nx, ny] = sideL ? [flx, fly] : [frx, fry];
        const along = (x * -ny + y * nx) / Math.hypot(nx, ny) / 2.6;
        const bay = ((along % 1) + 1) % 1 > 0.3 && ((along % 1) + 1) % 1 < 0.76;
        for (let py = Math.max(0, topY); py < Math.min(H, Math.max(topY + cellH + 1, bottom)); py++) {
          if (py <= topY + cellH || !wall) out[py * W + px] = top;
          else {
            const zz = h - (py - topY) / (Z * z);
            out[py * W + px] = bay && zz % 3 > 0.9 && zz % 3 < 2.2 ? windowRGB : face;
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

/** Roof cells this far apart in height are separate levels. */
const LEVEL_GAP = 1.5;
/** A level, slope or patch smaller than this many cells (2 m²) is noise. */
const MIN_CELLS = 8;

/**
 * A building's LiDAR roof made clean: flat parts snapped to the building's
 * main levels, small patches (chimneys, vents, noise, overhanging branches)
 * dissolved into their surroundings, slopes (mansards, pitched roofs, domes)
 * smoothed. Heights at least `eave`; `inside` marks the footprint; `slope`
 * marks cells on a roof slope.
 */
function cleanRoof(raw: Float32Array, inside: Uint8Array, gw: number, gh: number, eave: number) {
  const n = gw * gh;
  const at = (a: Float32Array, i: number, j: number, d: number) => (i < 0 || j < 0 || i >= gw || j >= gh || !inside[j * gw + i] ? d : a[j * gw + i]);
  // Slopes: a steady gradient between 20° and 70°.
  const slope = new Uint8Array(n);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const q = j * gw + i;
    if (!inside[q]) continue;
    const h = raw[q];
    const gx = (at(raw, i + 1, j, h) - at(raw, i - 1, j, h)) / (2 * CELL_M), gy = (at(raw, i, j + 1, h) - at(raw, i, j - 1, h)) / (2 * CELL_M);
    const g = Math.hypot(gx, gy);
    if (g > 0.35 && g < 2.7 && raw[q] > eave + 0.5) slope[q] = 1;
  }
  // Levels: peaks of the flat cells' height histogram, half-metre bins.
  const hist = new Map<number, number>();
  for (let q = 0; q < n; q++) if (inside[q] && !slope[q]) {
    const bin = Math.round(raw[q] * 2);
    hist.set(bin, (hist.get(bin) ?? 0) + 1);
  }
  const peaks: number[] = [eave];
  [...hist.entries()].sort((a, c) => c[1] - a[1]).forEach(([bin, cnt]) => {
    const h = bin / 2;
    if (cnt >= MIN_CELLS && peaks.every((p) => Math.abs(p - h) >= LEVEL_GAP)) peaks.push(h);
  });
  const out = new Float32Array(n);
  for (let q = 0; q < n; q++) {
    if (!inside[q]) continue;
    if (slope[q]) { out[q] = raw[q]; continue; }
    let best = eave;
    for (const p of peaks) if (Math.abs(p - raw[q]) < Math.abs(best - raw[q])) best = p;
    out[q] = best;
  }
  // Dissolve small patches (same level, or connected slopes) into the level around them.
  const seen = new Uint8Array(n);
  const stack: number[] = [], comp: number[] = [];
  for (let q0 = 0; q0 < n; q0++) {
    if (!inside[q0] || seen[q0]) continue;
    comp.length = 0;
    stack.push(q0);
    seen[q0] = 1;
    while (stack.length) {
      const q = stack.pop()!;
      comp.push(q);
      const i = q % gw, j = (q / gw) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj, nq = nj * gw + ni;
        if (ni < 0 || nj < 0 || ni >= gw || nj >= gh || seen[nq] || !inside[nq]) continue;
        if (slope[q0] ? !slope[nq] : slope[nq] || out[nq] !== out[q0]) continue;
        seen[nq] = 1;
        stack.push(nq);
      }
    }
    if (comp.length >= MIN_CELLS) continue;
    // The most common level bordering the patch, else the eaves.
    const around = new Map<number, number>();
    for (const q of comp) {
      const i = q % gw, j = (q / gw) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj, nq = nj * gw + ni;
        if (ni < 0 || nj < 0 || ni >= gw || nj >= gh || !inside[nq] || comp.includes(nq) || slope[nq]) continue;
        around.set(out[nq], (around.get(out[nq]) ?? 0) + 1);
      }
    }
    const fill = [...around.entries()].sort((a, c) => c[1] - a[1])[0]?.[0] ?? eave;
    for (const q of comp) { out[q] = fill; slope[q] = 0; }
  }
  // Smooth what's left of the slopes so they read as surfaces, not steps.
  const sm = out.slice();
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const q = j * gw + i;
    if (!slope[q]) continue;
    let s = 0, c = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ni = i + di, nj = j + dj, nq = nj * gw + ni;
      if (ni < 0 || nj < 0 || ni >= gw || nj >= gh || !inside[nq] || !slope[nq]) continue;
      s += out[nq]; c++;
    }
    sm[q] = s / c;
  }
  return { heights: sm, slope };
}

/**
 * A roof's covering colour from the photo over its cells: green if it's
 * mostly planted, else the mean of its lit, unplanted pixels.
 */
function roofMaterial(gw: number, gh: number, inside: Uint8Array, photo: (i: number, j: number) => number[]): number[] {
  const px: number[][] = [];
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) if (inside[j * gw + i]) px.push(photo(i, j));
  const lum = (c: number[]) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  const green = (c: number[]) => c[1] - (c[0] + c[2]) / 2 > 10;
  const greens = px.filter(green);
  if (greens.length > px.length * 0.45) return [128, 158, 102];
  const lit = px.filter((c) => !green(c)).sort((a, c) => lum(a) - lum(c));
  const keep = lit.slice(Math.floor(lit.length * 0.35));
  if (!keep.length) return [150, 155, 160];
  return [0, 1, 2].map((c) => keep.reduce((s, p) => s + p[c], 0) / keep.length);
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
    // The Eiffel Tower's LiDAR is a lattice: it gets its own shape instead.
    if (b.info?.name === "Tour Eiffel" || b.h <= 1) return b;
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
    outline(r) {
      const b = world.boundary;
      return Array.from({ length: b.length / 2 }, (_, k) => worldToIso(r, b[k * 2], b[k * 2 + 1]));
    },
    tall(r, min) {
      return world.buildings.filter((b) => b.top >= min).map((b) => {
        const [x, y] = worldToIso(r, b.cx, b.cy);
        return [x, y, worldToIso(r, b.cx, b.cy, b.top)[1]];
      });
    },
    stoneMask(r, cx, cy, zoom, width, height) {
      const view = (views[r] ??= buildRotView(world, r));
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      const g = c.getContext("2d")!;
      g.fillStyle = "#000";
      g.fillRect(0, 0, width, height);
      g.setTransform(zoom, 0, 0, zoom, width / 2 - cx * zoom, height / 2 - cy * zoom);
      // Back to front, so whatever stands in front covers what's behind.
      for (const it of view.items) {
        if (it.kind === "b") {
          g.fillStyle = world.buildings[it.idx].style === "brick" ? "#000" : "#fff";
          for (const p of [it.stoneA, it.stoneB, it.mansA, it.mansB]) if (p) g.fill(p);
          g.fillStyle = "#000";
          g.fill(it.roof, "evenodd");
        } else {
          g.fillStyle = "#000";
          g.fill(it.canopy);
        }
      }
      return c.toDataURL("image/png");
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
      drawStructures(build.getContext("2d")!, w, view, cam, DAY, 1, air?.photo, w === world ? undefined : air?.roofShape, [...viaductPieces(w, r), ...eiffelPieces(w, r), ...archePieces(w, r)]);
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
