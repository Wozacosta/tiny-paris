// The names that aren't landmarks: streets, written flat on the roadway once
// you're close enough to read them, and the twenty arrondissements from afar.

import type { World } from "./model";
import { ROT, type Rotation } from "./render";
import { sample, type Box } from "./shapes";

export interface StreetName {
  text: string;
  x: number;
  y: number;
  /** The street's direction there, in world axes. */
  tx: number;
  ty: number;
  /** Letter height in metres. */
  size: number;
  /** How much street there is to write on. */
  len: number;
  /** The text's width in metres, measured the first time it's drawn. */
  width?: number;
}

/** Camera zoom (CSS px per metre) from which street names show. */
export const STREET_NAMES_ZOOM = 2.8;
const CELL = 300;
const UNNAMED = new Set(["cycleway", "service", "footway", "path"]);

/**
 * Where each street's name goes: the middle of its longest stretch in every
 * 300 m square it crosses, so a long boulevard is named again and again along
 * its way. Returns a lookup of the names in a box of world metres.
 */
export function streetNames(world: World): (box: Box) => StreetName[] {
  const best = new Map<string, StreetName>();
  for (const l of [...world.streets, ...world.walks]) {
    if (!l.name || UNNAMED.has(l.kind) || l.len < 45) continue;
    const p = sample(l, l.len / 2);
    const cell = `${Math.floor(p.x / CELL)},${Math.floor(p.y / CELL)}`;
    const key = `${l.name}|${cell}`;
    const had = best.get(key);
    if (had && had.len >= l.len) continue;
    best.set(key, { text: l.name.toUpperCase(), x: p.x, y: p.y, tx: p.tx, ty: p.ty, size: Math.max(3, Math.min(5.5, l.half * 0.95)), len: l.len });
  }
  const cells = new Map<string, StreetName[]>();
  for (const [key, n] of best) {
    const cell = key.slice(key.lastIndexOf("|") + 1);
    const list = cells.get(cell);
    if (list) list.push(n);
    else cells.set(cell, [n]);
  }
  return ([x0, y0, x1, y1]) => {
    const out: StreetName[] = [];
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) out.push(...(cells.get(`${cx},${cy}`) ?? []));
    }
    return out;
  };
}

/**
 * Writes street names on the ground, along their streets. `z`, `ox`, `oy`:
 * canvas pixels per iso unit and the iso origin on the canvas. Leaves the
 * context's transform changed.
 */
export function drawStreetNames(ctx: CanvasRenderingContext2D, r: Rotation, z: number, ox: number, oy: number, names: StreetName[]) {
  const [a, b, c, d] = ROT[r];
  // World metres on the ground to canvas pixels: the same plane the streets lie in.
  const m: [number, number, number, number] = [(a - c) * z, ((a + c) / 2) * z, (b - d) * z, ((b + d) / 2) * z];
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
  ctx.strokeStyle = "rgba(24, 30, 62, 0.62)";
  for (const n of names) {
    ctx.font = `600 ${n.size}px "Barlow Condensed", system-ui, sans-serif`;
    ctx.letterSpacing = `${n.size * 0.06}px`;
    n.width ??= ctx.measureText(n.text).width;
    if (n.width > n.len * 0.92) continue;
    // Left to right on screen, whichever way the street was mapped.
    const flip = m[0] * n.tx + m[2] * n.ty < 0 ? -1 : 1;
    ctx.setTransform(m[0], m[1], m[2], m[3], ox, oy);
    ctx.transform(n.tx * flip, n.ty * flip, -n.ty * flip, n.tx * flip, n.x, n.y);
    ctx.lineWidth = n.size * 0.24;
    ctx.strokeText(n.text, 0, 0);
    ctx.fillText(n.text, 0, 0);
  }
  ctx.letterSpacing = "0px";
}

/** The arrondissements, each at about its middle (inside the périphérique, for those with a bois): [name, lon, lat]. */
export const ARRONDISSEMENTS: [string, number, number][] = [
  ["1er", 2.3364, 48.8625], ["2e", 2.3428, 48.8683], ["3e", 2.36, 48.863], ["4e", 2.3576, 48.8543], ["5e", 2.3508, 48.8445],
  ["6e", 2.3328, 48.8491], ["7e", 2.3122, 48.8562], ["8e", 2.3126, 48.8728], ["9e", 2.3378, 48.8771], ["10e", 2.3608, 48.8761],
  ["11e", 2.3801, 48.8591], ["12e", 2.392, 48.84], ["13e", 2.3623, 48.8284], ["14e", 2.3265, 48.8292], ["15e", 2.2928, 48.8401],
  ["16e", 2.275, 48.8603], ["17e", 2.3065, 48.8875], ["18e", 2.3444, 48.8925], ["19e", 2.3848, 48.8871], ["20e", 2.4012, 48.8635],
];
