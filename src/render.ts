// Isometric canvas renderer. Everything is precomputed into Path2D objects in
// "iso units" (one unit ≈ one metre on screen) per view rotation, so a frame is
// just a camera transform plus a few fills per visible item.

import type { Building, World } from "./model";
import type { Palette, Theme } from "./theme";

/** Vertical scale of heights relative to ground units. */
export const Z = 1.15;
const TREE_HEIGHT = 5;
const TREE_RADIUS = 3.4;
const DEPTH_BAND = 8;

export type Rotation = 0 | 1 | 2 | 3;

// x' = a·x + b·y, y' = c·x + d·y
const ROT: [number, number, number, number][] = [
  [1, 0, 0, 1],
  [0, -1, 1, 0],
  [-1, 0, 0, -1],
  [0, 1, -1, 0],
];

export function worldToIso(r: Rotation, x: number, y: number, z = 0): [number, number] {
  const [a, b, c, d] = ROT[r];
  const xr = a * x + b * y;
  const yr = c * x + d * y;
  return [xr - yr, (xr + yr) / 2 - z * Z];
}

/** Distance towards the viewer; larger is drawn later. */
export function depthOf(r: Rotation, x: number, y: number) {
  const [a, b, c, d] = ROT[r];
  return (a + c) * x + (b + d) * y;
}

export function isoToWorld(r: Rotation, sx: number, sy: number): [number, number] {
  const xr = sy + sx / 2;
  const yr = sy - sx / 2;
  const [a, b, c, d] = ROT[r];
  // Rotation matrices are orthonormal, so the inverse is the transpose.
  return [a * xr + c * yr, b * xr + d * yr];
}

type BBox = [number, number, number, number];

interface BuildingItem {
  kind: "b";
  idx: number;
  bbox: BBox;
  stoneA: Path2D;
  stoneB: Path2D;
  mansA: Path2D | null;
  mansB: Path2D | null;
  roof: Path2D;
  /** Windows, shopfronts and balconies, built lazily once zoomed in. */
  detail?: Detail | null;
}

interface Detail {
  dark: Path2D;
  lit: Path2D;
  shop: Path2D;
  balcony: Path2D;
}

interface TreeItem {
  kind: "t";
  bbox: BBox;
  canopy: Path2D;
  light: Path2D;
}

type Item = BuildingItem | TreeItem;

export interface RotView {
  rotation: Rotation;
  items: Item[];
  /** Building index → its item, for picking. */
  byBuilding: Map<number, BuildingItem>;
  slabSides: { left: Path2D; right: Path2D };
}

function signedArea(r: Float64Array) {
  let a = 0;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) a += r[j * 2] * r[i * 2 + 1] - r[i * 2] * r[j * 2 + 1];
  return a / 2;
}

function buildBuilding(b: Building, idx: number, r: Rotation): BuildingItem {
  const [a, bb, c, d] = ROT[r];
  const stoneA = new Path2D();
  const stoneB = new Path2D();
  const mansA = b.mansard ? new Path2D() : null;
  const mansB = b.mansard ? new Path2D() : null;
  const roof = new Path2D();
  const hs = b.h - b.mansard;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const quad = (p: Path2D, x1: number, y1: number, x2: number, y2: number, z1: number, z2: number) => {
    p.moveTo(x1, y1 - z1 * Z);
    p.lineTo(x2, y2 - z1 * Z);
    p.lineTo(x2, y2 - z2 * Z);
    p.lineTo(x1, y1 - z2 * Z);
    p.closePath();
  };

  b.rings.forEach((ring, ri) => {
    const n = ring.length / 2;
    const xr = new Float64Array(n);
    const yr = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      xr[i] = a * ring[i * 2] + bb * ring[i * 2 + 1];
      yr[i] = c * ring[i * 2] + d * ring[i * 2 + 1];
    }
    // Rotations keep orientation, so the original ring's winding tells us
    // which side is outside. Holes face the other way.
    const s = (signedArea(ring) > 0 ? 1 : -1) * (ri === 0 ? 1 : -1);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const sx1 = xr[i] - yr[i], sy1 = (xr[i] + yr[i]) / 2;
      const sx2 = xr[j] - yr[j], sy2 = (xr[j] + yr[j]) / 2;
      if (i === 0) roof.moveTo(sx1, sy1 - b.h * Z);
      else roof.lineTo(sx1, sy1 - b.h * Z);
      minX = Math.min(minX, sx1); maxX = Math.max(maxX, sx1);
      minY = Math.min(minY, sy1 - b.h * Z); maxY = Math.max(maxY, sy1);

      const dx = xr[j] - xr[i], dy = yr[j] - yr[i];
      const nx = s * dy, ny = -s * dx;
      if (nx + ny <= 0) continue; // faces away from the camera
      const facingRight = nx > ny;
      quad(facingRight ? stoneB : stoneA, sx1, sy1, sx2, sy2, 0, hs);
      if (b.mansard) quad(facingRight ? mansB! : mansA!, sx1, sy1, sx2, sy2, hs, b.h);
    }
    roof.closePath();
  });

  if (b.domes.length) {
    const [, sy] = worldToIso(r, b.cx, b.cy, b.top);
    minY = Math.min(minY, sy - 10);
  }
  return { kind: "b", idx, bbox: [minX, minY, maxX, maxY], stoneA, stoneB, mansA, mansB, roof };
}

export function buildRotView(world: World, r: Rotation): RotView {
  const depth = (x: number, y: number) => depthOf(r, x, y);

  type Pending = { depth: number; item?: Item; tree?: number };
  const pending: Pending[] = [];
  const byBuilding = new Map<number, BuildingItem>();
  world.buildings.forEach((b, i) => {
    const item = buildBuilding(b, i, r);
    byBuilding.set(i, item);
    pending.push({ depth: depth(b.cx, b.cy), item });
  });
  for (let i = 0; i < world.trees.length / 2; i++) {
    pending.push({ depth: depth(world.trees[i * 2], world.trees[i * 2 + 1]), tree: i });
  }
  pending.sort((p, q) => p.depth - q.depth);

  // Within each depth band draw buildings first, then that band's trees as a
  // single batch. Trees are small enough that the ordering error is invisible.
  const items: Item[] = [];
  let i = 0;
  while (i < pending.length) {
    const band = Math.floor(pending[i].depth / DEPTH_BAND);
    const trees: number[] = [];
    while (i < pending.length && Math.floor(pending[i].depth / DEPTH_BAND) === band) {
      const p = pending[i++];
      if (p.item) items.push(p.item);
      else trees.push(p.tree!);
    }
    if (!trees.length) continue;
    const canopy = new Path2D();
    const light = new Path2D();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of trees) {
      const [sx, sy0] = worldToIso(r, world.trees[t * 2], world.trees[t * 2 + 1]);
      const sy = sy0 - TREE_HEIGHT * Z;
      canopy.moveTo(sx + TREE_RADIUS, sy);
      canopy.arc(sx, sy, TREE_RADIUS, 0, Math.PI * 2);
      light.moveTo(sx - 0.9 + 1.7, sy - 1.1);
      light.arc(sx - 0.9, sy - 1.1, 1.7, 0, Math.PI * 2);
      minX = Math.min(minX, sx - TREE_RADIUS); maxX = Math.max(maxX, sx + TREE_RADIUS);
      minY = Math.min(minY, sy - TREE_RADIUS); maxY = Math.max(maxY, sy0);
    }
    items.push({ kind: "t", canopy, light, bbox: [minX, minY, maxX, maxY] });
  }

  // The two slab faces toward the camera, giving the map its "tile" look.
  const T = 45;
  const { W, H } = world;
  const corners = [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]].map(([x, y]) => worldToIso(r, x, y));
  const left = new Path2D();
  const right = new Path2D();
  for (let k = 0; k < 4; k++) {
    const p = corners[k];
    const q = corners[(k + 1) % 4];
    // Edge is in front if its midpoint is lower on screen than the centre.
    const midY = (p[1] + q[1]) / 2;
    if (midY <= 0) continue;
    const face = (p[0] + q[0]) / 2 < 0 ? left : right;
    face.moveTo(p[0], p[1]);
    face.lineTo(q[0], q[1]);
    face.lineTo(q[0], q[1] + T * Z);
    face.lineTo(p[0], p[1] + T * Z);
    face.closePath();
  }

  return { rotation: r, items, byBuilding, slabSides: { left, right } };
}

export interface Camera {
  /** View centre in iso units. */
  cx: number;
  cy: number;
  /** Canvas pixels per iso unit. */
  zoom: number;
}

const FLOOR = 3.1;
const SHOP_KINDS = new Set(["yes", "apartments", "residential", "retail", "commercial", "hotel"]);
const PLAIN_KINDS = new Set(["church", "chapel", "cathedral", "basilica", "religious", "temple", "train_station", "roof"]);

/** Façade detail aligned to each visible wall: window grid, shops, balconies. */
function buildDetail(b: Building, idx: number, r: Rotation): Detail | null {
  if (b.h < 6 || b.white || PLAIN_KINDS.has(b.kind)) return null;
  const [a, bb, c, d] = ROT[r];
  const det: Detail = { dark: new Path2D(), lit: new Path2D(), shop: new Path2D(), balcony: new Path2D() };
  const hs = b.h - b.mansard;
  const floors = Math.floor(hs / FLOOR);
  const old = b.style === "stone" || b.style === "brick";
  const shops = old && SHOP_KINDS.has(b.kind) && floors >= 3;

  b.rings.forEach((ring, ri) => {
    const n = ring.length / 2;
    const s = (signedArea(ring) > 0 ? 1 : -1) * (ri === 0 ? 1 : -1);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x1 = a * ring[i * 2] + bb * ring[i * 2 + 1], y1 = c * ring[i * 2] + d * ring[i * 2 + 1];
      const x2 = a * ring[j * 2] + bb * ring[j * 2 + 1], y2 = c * ring[j * 2] + d * ring[j * 2 + 1];
      const dx = x2 - x1, dy = y2 - y1;
      if (s * dy - s * dx <= 0) continue; // faces away (nx + ny <= 0)
      const L = Math.hypot(dx, dy);
      const slots = Math.floor(L / 3.3);
      if (slots < 1) continue;
      const sx1 = x1 - y1, sy1 = (x1 + y1) / 2, sx2 = x2 - y2, sy2 = (x2 + y2) / 2;
      const quad = (p: Path2D, u0: number, u1: number, z0: number, z1: number) => {
        const ax = sx1 + (sx2 - sx1) * u0, ay = sy1 + (sy2 - sy1) * u0;
        const bx = sx1 + (sx2 - sx1) * u1, by = sy1 + (sy2 - sy1) * u1;
        p.moveTo(ax, ay - z0 * Z);
        p.lineTo(bx, by - z0 * Z);
        p.lineTo(bx, by - z1 * Z);
        p.lineTo(ax, ay - z1 * Z);
        p.closePath();
      };
      if (!old) {
        // Modern blocks: continuous ribbon windows on every floor, and on
        // 1950–80s slabs a thin floor-slab line between them.
        for (let f = 0; f < floors; f++) {
          const z0 = f * FLOOR + 0.9;
          const lit = hash3(idx, i, f) < 0.4;
          quad(lit ? det.lit : det.dark, 0.04, 0.96, z0, z0 + 1.5);
          if (b.style === "modern") quad(det.balcony, 0.02, 0.98, f * FLOOR + 0.05, f * FLOOR + 0.25);
        }
        continue;
      }
      for (let k = 0; k < slots; k++) {
        const uc = (k + 0.5) / slots;
        const hw = 0.6 / L;
        if (shops) quad(det.shop, uc - 1.25 / L, uc + 1.25 / L, 0.3, 2.6);
        for (let f = shops ? 1 : 0; f < floors; f++) {
          const z0 = f * FLOOR + 0.85;
          const lit = hash3(idx, i * 31 + k, f) < 0.4;
          quad(lit ? det.lit : det.dark, uc - hw, uc + hw, z0, z0 + 1.75);
        }
        if (b.mansard > 2.2) {
          const lit = hash3(idx, i * 31 + k, 99) < 0.3;
          quad(lit ? det.lit : det.dark, uc - 0.45 / L, uc + 0.45 / L, hs + 0.7, hs + Math.min(2.2, b.mansard - 0.6));
        }
      }
      // Haussmann balconies on the 2nd and 5th floors, and a cornice.
      if (floors >= 4) quad(det.balcony, 0, 1, 2 * FLOOR + 0.05, 2 * FLOOR + 0.4);
      if (floors >= 6) quad(det.balcony, 0, 1, 5 * FLOOR + 0.05, 5 * FLOOR + 0.4);
      if (b.mansard) quad(det.balcony, 0, 1, hs - 0.35, hs);
    }
  });
  return det;
}

function hash3(a: number, b: number, c: number) {
  const s = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

function paletteOf(b: Building, theme: Theme) {
  if (b.white) return { wallA: theme.white.wallA, wallB: theme.white.wallB, roof: theme.white.roof, mansA: theme.white.wallA, mansB: theme.white.wallB };
  const walls = theme.walls[b.style];
  const [wallA, wallB] = walls[Math.floor(b.tone * walls.length)];
  const roofs = theme.roofs[b.roof];
  const [roof, mansA, mansB] = roofs[Math.floor(((b.tone * 7.31) % 1) * roofs.length)];
  return { wallA, wallB, roof, mansA, mansB };
}

function viewRect(ctx: CanvasRenderingContext2D, cam: Camera) {
  const { width: cw, height: ch } = ctx.canvas;
  const z = cam.zoom;
  return {
    ox: cw / 2 - cam.cx * z,
    oy: ch / 2 - cam.cy * z,
    rect: [cam.cx - cw / 2 / z, cam.cy - ch / 2 / z, cam.cx + cw / 2 / z, cam.cy + ch / 2 / z] as BBox,
  };
}

/** Ground layer: base slab, parks, water, streets and cast shadows. */
export function drawGround(ctx: CanvasRenderingContext2D, world: World, view: RotView, cam: Camera, theme: Theme, res: number) {
  const { width: cw, height: ch } = ctx.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  const z = cam.zoom;
  const { ox, oy } = viewRect(ctx, cam);
  const cssZoom = z / res;

  ctx.setTransform(z, 0, 0, z, ox, oy);
  ctx.fillStyle = theme.slabLeft;
  ctx.fill(view.slabSides.left);
  ctx.fillStyle = theme.slabRight;
  ctx.fill(view.slabSides.right);

  // The ground plane is world metres straight through an affine transform.
  const [a, b, c, d] = ROT[view.rotation];
  ctx.setTransform((a - c) * z, ((a + c) / 2) * z, (b - d) * z, ((b + d) / 2) * z, ox, oy);
  const g = world.ground;
  ctx.fillStyle = theme.ground;
  ctx.fill(g.slab);
  ctx.save();
  ctx.clip(g.slab);
  ctx.fillStyle = theme.park;
  ctx.fill(g.parks);
  ctx.fillStyle = theme.pitch;
  ctx.fill(g.pitches);
  ctx.fillStyle = theme.cemetery;
  ctx.fill(g.cemeteries);
  ctx.fillStyle = theme.water;
  ctx.fill(g.water, "evenodd");
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (cssZoom >= 0.7) {
    ctx.strokeStyle = theme.sidewalk;
    for (const r of world.roads) {
      if (r.color !== "road") continue;
      ctx.lineWidth = r.width + 3.5;
      ctx.stroke(r.path);
    }
  }
  for (const r of world.roads) {
    ctx.strokeStyle = theme[r.color];
    ctx.lineWidth = r.width;
    ctx.stroke(r.path);
  }
  ctx.fillStyle = theme.bridge;
  ctx.fill(g.bridges);
  ctx.fillStyle = theme.shadow;
  ctx.fill(g.shadows);
  ctx.fillStyle = theme.treeShadow;
  ctx.fill(g.treeShadows);
  ctx.restore();
}

/** Building layer: buildings, trees and monuments, back to front, on a transparent canvas. */
/**
 * Buildings and trees in the iso-space rectangle as depth-sorted erasers: each
 * one, drawn in turn with the movers, cuts away whatever is behind it but not
 * what is in front. Outlines are widened by `grow` iso units so painted
 * buildings a little bigger than their footprint still hide what's behind.
 */
export function occluders(ctx: CanvasRenderingContext2D, world: World, view: RotView, rect: BBox, grow: number) {
  const [vx0, vy0, vx1, vy1] = rect;
  const out: { depth: number; draw: () => void }[] = [];
  const erase = (fill: (Path2D | null)[], edge: Path2D) => {
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#000";
    for (const p of fill) if (p) ctx.fill(p);
    if (grow > 0) {
      ctx.lineWidth = grow * 2;
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#000";
      ctx.stroke(edge);
    }
    ctx.globalCompositeOperation = "source-over";
  };
  for (const it of view.items) {
    const [x0, y0, x1, y1] = it.bbox;
    if (x1 < vx0 || x0 > vx1 || y1 < vy0 || y0 > vy1) continue;
    if (it.kind === "b") {
      const b = world.buildings[it.idx];
      out.push({ depth: depthOf(view.rotation, b.cx, b.cy), draw: () => erase([it.stoneA, it.stoneB, it.mansA, it.mansB, it.roof], it.roof) });
    } else {
      // A band of trees: its ground line is the bottom of the box (depth = 2 × screen y).
      out.push({ depth: 2 * y1 - DEPTH_BAND / 2, draw: () => erase([it.canopy], it.canopy) });
    }
  }
  return out;
}

export function drawStructures(ctx: CanvasRenderingContext2D, world: World, view: RotView, cam: Camera, theme: Theme, res: number) {
  const { width: cw, height: ch } = ctx.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  const z = cam.zoom;
  const { ox, oy, rect: [vx0, vy0, vx1, vy1] } = viewRect(ctx, cam);
  ctx.setTransform(z, 0, 0, z, ox, oy);

  const cssZoom = z / res;
  const showDetail = cssZoom >= 1;
  const showEdges = cssZoom >= 0.8;
  ctx.lineWidth = 0.3;
  ctx.strokeStyle = theme.roofEdge;

  for (const it of view.items) {
    const [x0, y0, x1, y1] = it.bbox;
    if (x1 < vx0 || x0 > vx1 || y1 < vy0 || y0 > vy1) continue;
    if (it.kind === "b") {
      const bld = world.buildings[it.idx];
      const pal = paletteOf(bld, theme);
      ctx.fillStyle = pal.wallA;
      ctx.fill(it.stoneA);
      ctx.fillStyle = pal.wallB;
      ctx.fill(it.stoneB);
      if (it.mansA) {
        ctx.fillStyle = pal.mansA;
        ctx.fill(it.mansA);
        ctx.fillStyle = pal.mansB;
        ctx.fill(it.mansB!);
      }
      if (showDetail) {
        if (it.detail === undefined) it.detail = buildDetail(bld, it.idx, view.rotation);
        const det = it.detail;
        if (det) {
          ctx.fillStyle = theme.window;
          ctx.fill(det.dark);
          ctx.fillStyle = theme.windowLit;
          ctx.fill(det.lit);
          ctx.fillStyle = theme.shop;
          ctx.fill(det.shop);
          ctx.fillStyle = theme.balcony;
          ctx.fill(det.balcony);
        }
      }
      ctx.fillStyle = pal.roof;
      ctx.fill(it.roof, "evenodd");
      if (showEdges) ctx.stroke(it.roof);
      if (bld.domes.length) drawDomes(ctx, view.rotation, bld, bld.white ? theme.white : pal);
    } else {
      ctx.fillStyle = theme.tree;
      ctx.fill(it.canopy);
      if (cssZoom >= 0.6) {
        ctx.fillStyle = theme.treeLight;
        ctx.fill(it.light);
      }
    }
  }
}

/** Drums and domes, back to front, shaded with a left-to-right gradient. */
function drawDomes(ctx: CanvasRenderingContext2D, r: Rotation, b: Building, pal: Palette) {
  const placed = b.domes
    .map((d) => ({ d, iso: worldToIso(r, b.cx + d.dx, b.cy + d.dy) }))
    .sort((p, q) => p.iso[1] - q.iso[1]);
  for (const { d, iso: [cx, cy] } of placed) {
    if (d.glass) pal = { wallA: "#d8c27a", wallB: "#a8893f", roof: "#7fb0c9" };
    const rx = d.r * Math.SQRT2;
    const ry = rx / 2;
    const y0 = cy - d.base * Z;
    const y1 = cy - (d.base + d.drum) * Z;
    const shade = (light: string, dark: string) => {
      const g = ctx.createLinearGradient(cx - rx, 0, cx + rx, 0);
      g.addColorStop(0.15, light);
      g.addColorStop(1, dark);
      return g;
    };
    ctx.fillStyle = shade(pal.wallA, pal.wallB);
    ctx.beginPath();
    ctx.moveTo(cx - rx, y1);
    ctx.lineTo(cx - rx, y0);
    ctx.ellipse(cx, y0, rx, ry, 0, Math.PI, 0, true);
    ctx.lineTo(cx + rx, y1);
    ctx.closePath();
    ctx.fill();
    // Dome: upper half-ellipse plus the front of the drum's top rim.
    ctx.fillStyle = shade(pal.wallA, pal.roof);
    ctx.beginPath();
    ctx.ellipse(cx, y1, rx, d.dome * Z, 0, Math.PI, Math.PI * 2);
    ctx.ellipse(cx, y1, rx, ry, 0, 0, Math.PI);
    ctx.fill();
    // Lantern.
    const lr = rx * 0.14;
    const ly = y1 - d.dome * Z;
    ctx.fillStyle = pal.wallB;
    ctx.fillRect(cx - lr, ly - d.dome * 0.25 * Z, lr * 2, d.dome * 0.25 * Z + 1);
  }
}

/**
 * Paints one building on top of an already drawn frame, for hover and
 * selection. Drawn last so it stays visible even behind taller neighbours.
 */
export function drawHighlight(
  ctx: CanvasRenderingContext2D,
  view: RotView,
  cam: Camera,
  idx: number,
  pal: Palette,
  /** Tint strength; hover stays light so the building is still recognisable. */
  alpha = 1,
  /** How the tint mixes with the frame: over the painting, a blend keeps its detail. */
  blend: GlobalCompositeOperation = "source-over",
) {
  const it = view.byBuilding.get(idx);
  if (!it) return;
  const { width: cw, height: ch } = ctx.canvas;
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = blend;
  ctx.setTransform(cam.zoom, 0, 0, cam.zoom, cw / 2 - cam.cx * cam.zoom, ch / 2 - cam.cy * cam.zoom);
  if (blend !== "source-over") {
    // One even tint: blended faces filled one by one show their seams.
    const all = new Path2D();
    for (const p of [it.stoneA, it.stoneB, it.mansA, it.mansB, it.roof]) if (p) all.addPath(p);
    ctx.fillStyle = pal.roof;
    ctx.fill(all);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    return;
  }
  ctx.fillStyle = pal.wallA;
  ctx.fill(it.stoneA);
  if (it.mansA) ctx.fill(it.mansA);
  ctx.fillStyle = pal.wallB;
  ctx.fill(it.stoneB);
  if (it.mansB) ctx.fill(it.mansB);
  ctx.fillStyle = pal.roof;
  ctx.fill(it.roof, "evenodd");
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

/** Topmost building under an iso-space point, or null. */
export function pick(ctx: CanvasRenderingContext2D, view: RotView, ix: number, iy: number): number | null {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  try {
    for (let k = view.items.length - 1; k >= 0; k--) {
      const it = view.items[k];
      if (it.kind !== "b") continue;
      const [x0, y0, x1, y1] = it.bbox;
      if (ix < x0 || ix > x1 || iy < y0 || iy > y1) continue;
      if (
        ctx.isPointInPath(it.roof, ix, iy, "evenodd") ||
        ctx.isPointInPath(it.stoneA, ix, iy) ||
        ctx.isPointInPath(it.stoneB, ix, iy) ||
        (it.mansA && ctx.isPointInPath(it.mansA, ix, iy)) ||
        (it.mansB && ctx.isPointInPath(it.mansB, ix, iy))
      ) {
        return it.idx;
      }
    }
    return null;
  } finally {
    ctx.restore();
  }
}
