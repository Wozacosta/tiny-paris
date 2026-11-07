// Small 3D shapes drawn in iso space, shared by everything that moves.

import type { Lane } from "./model";
import { worldToIso, type Rotation } from "./render";

export interface Sample {
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
}

export function sample(lane: Lane, s: number): Sample {
  const { pts, cum } = lane;
  s = Math.max(0, Math.min(lane.len, s));
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo] || 1;
  const t = (s - cum[lo]) / seg;
  const x0 = pts[lo * 2], y0 = pts[lo * 2 + 1], x1 = pts[hi * 2], y1 = pts[hi * 2 + 1];
  const z = lane.zs ? lane.zs[lo] + (lane.zs[hi] - lane.zs[lo]) * t : 0;
  return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, z, tx: (x1 - x0) / seg, ty: (y1 - y0) / seg };
}

export type Pt = [number, number];

export function hull(points: Pt[]): Pt[] {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [], upper: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

export function poly(ctx: CanvasRenderingContext2D, pts: Pt[], color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fill();
}

/**
 * An oriented box: centre (x, y), base height z0, heading (tx, ty). The
 * silhouette is filled with `side`, then the top face with `top` if given.
 */
export function box(
  ctx: CanvasRenderingContext2D, r: Rotation,
  x: number, y: number, z0: number, tx: number, ty: number,
  L: number, W: number, H: number, side: string, top: string | null,
) {
  const nx = -ty, ny = tx;
  const corners: [number, number][] = [
    [x + tx * L / 2 + nx * W / 2, y + ty * L / 2 + ny * W / 2],
    [x + tx * L / 2 - nx * W / 2, y + ty * L / 2 - ny * W / 2],
    [x - tx * L / 2 - nx * W / 2, y - ty * L / 2 - ny * W / 2],
    [x - tx * L / 2 + nx * W / 2, y - ty * L / 2 + ny * W / 2],
  ];
  const lo = corners.map(([cx, cy]) => worldToIso(r, cx, cy, z0));
  const hi = corners.map(([cx, cy]) => worldToIso(r, cx, cy, z0 + H));
  poly(ctx, hull([...lo, ...hi]), side);
  if (top) poly(ctx, hi, top);
}

export function dot(ctx: CanvasRenderingContext2D, r: Rotation, x: number, y: number, z: number, color: string, size: number) {
  const [sx, sy] = worldToIso(r, x, y, z);
  ctx.fillStyle = color;
  ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
}

/** A small standing person: legs/torso box, vest band, head. */
export function person(ctx: CanvasRenderingContext2D, r: Rotation, x: number, y: number, z: number, body: string, vest: string | null, skin: string) {
  box(ctx, r, x, y, z, 1, 0, 0.4, 0.3, 1.1, body, null);
  if (vest) box(ctx, r, x, y, z + 0.75, 1, 0, 0.42, 0.32, 0.25, vest, null);
  const [hx, hy] = worldToIso(r, x, y, z + 1.45);
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(hx, hy, 0.2, 0, Math.PI * 2);
  ctx.fill();
}

export const SHIRTS = ["#3b6fb6", "#c0392b", "#f2f2f2", "#2d2d34", "#e2b33c", "#5b8c5a", "#8e5ea2", "#e67e22"];
export const SKINS = ["#f1c9a5", "#d9a77c", "#a8714a", "#6b4429"];
const shadeCache = new Map<string, string>();
/** Multiplies a #rrggbb colour's channels by `k`. */
export function shade(hex: string, k: number) {
  const key = hex + k;
  let out = shadeCache.get(key);
  if (!out) {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k));
    out = `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    shadeCache.set(key, out);
  }
  return out;
}

/** A soft oval shadow on the ground under something L×W metres heading (tx, ty). */
export function groundShadow(ctx: CanvasRenderingContext2D, r: Rotation, x: number, y: number, tx: number, ty: number, L: number, W: number, alpha = 0.22) {
  const nx = -ty, ny = tx;
  ctx.fillStyle = `rgba(30, 30, 50, ${alpha})`;
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const u = Math.cos(a) * L * 0.55, v = Math.sin(a) * W * 0.6;
    const [sx, sy] = worldToIso(r, x + tx * u + nx * v + 0.4, y + ty * u + ny * v - 0.4);
    i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
  }
  ctx.fill();
}
