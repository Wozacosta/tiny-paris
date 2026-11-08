// City life that isn't traffic: boats and péniches on the Seine and canals,
// people drinking along the Canal Saint-Martin, and a manif at République.
// Sidewalks, terraces, picnics and mainline trains live in StreetLife.
// Drawn in the same depth-sorted pass as vehicles (see Traffic.draw).

import { makeLane, type Lane, type Transit, type World } from "./model";
import { depthOf, worldToIso, type Rotation } from "./render";
import { box, dot, person, sample, shade, SHIRTS, SKINS } from "./shapes";
import type { Sprites } from "./sprites";
import { StreetLife } from "./streetlife";
import type { Theme } from "./theme";

export interface Item {
  depth: number;
  draw: () => void;
}

type InView = (x: number, y: number, z: number, pad: number) => boolean;

const PENICHE = 0, MOUCHE = 1, SMALL = 2, TOUR = 3;
type BoatKind = typeof PENICHE | typeof MOUCHE | typeof SMALL | typeof TOUR;

interface Boat {
  kind: BoatKind;
  lane: Lane;
  s: number;
  dir: 1 | -1;
  speed: number;
  colour: number;
}

interface Reveller {
  x: number;
  y: number;
  /** Facing direction (towards the water). */
  fx: number;
  fy: number;
  seated: boolean;
  dancer: boolean;
  look: number;
  phase: number;
}

interface Party {
  x: number;
  y: number;
  people: Reveller[];
  bottles: [number, number, string][];
  blanket: { x: number; y: number; tx: number; ty: number; colour: string } | null;
  speaker: [number, number] | null;
}

interface Protester {
  hx: number;
  hy: number;
  look: number;
  phase: number;
  flag: string | null;
}

interface Banner {
  ax: number; ay: number; bx: number; by: number;
  colour: string;
  band: string;
  looks: [number, number];
}

const UNION_COLOURS = ["#d7261e", "#e8792b", "#f2c230", "#2a62b8", "#6a2a8c", "#1f9e5a"];
const BLANKETS = ["#c94f4f", "#3f6fb0", "#e0b23a", "#4d9a6b", "#d9d2c3"];
const BOTTLES = ["#2f6b3a", "#6b3a1f", "#c9c1a6"];

/** Seeded random so crowds look the same on every load. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** A copy of a lane shifted sideways by `d` metres (positive = left of travel). */
function offsetLane(l: Lane, d: number): Lane {
  const n = l.pts.length / 2;
  const out = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const tx = l.pts[b * 2] - l.pts[a * 2], ty = l.pts[b * 2 + 1] - l.pts[a * 2 + 1];
    const len = Math.hypot(tx, ty) || 1;
    out[i * 2] = l.pts[i * 2] + (ty / len) * d;
    out[i * 2 + 1] = l.pts[i * 2 + 1] - (tx / len) * d;
  }
  return makeLane(out, 0, false, l.kind);
}

/** Sign of the offsetLane distance that moves a lane north (y decreasing). */
function northSign(l: Lane) {
  // offsetLane shifts along (ty, -tx), whose y is negative when tx > 0.
  return l.pts.at(-2)! - l.pts[0] > 0 ? 1 : -1;
}

function inRing(x: number, y: number, r: Float64Array) {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export class Life {
  private boats: Boat[] = [];
  private parties: Party[] = [];
  private protesters: Protester[] = [];
  private banners: Banner[] = [];
  private balloons: { x: number; y: number; colour: string; phase: number }[] = [];
  private flares: { x: number; y: number; colour: string; phase: number }[] = [];
  private vans: { x: number; y: number; tx: number; ty: number }[] = [];
  private soundTruck: { x: number; y: number; tx: number; ty: number } | null = null;
  private time = 0;
  private sprites: Sprites | null = null;
  private useSprites = false;
  /** Where the crowd faces: the monument. */
  private focus: [number, number] = [0, 0];

  private street: StreetLife;

  setSprites(s: Sprites) {
    this.sprites = s;
    this.street.setSprites(s);
  }

  constructor(private world: World, transit: Transit) {
    this.street = new StreetLife(world, transit);
    const rand = rng(1900);
    const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
    const add = (kind: BoatKind, lane: Lane, speed: number) =>
      this.boats.push({ kind, lane, s: rand() * lane.len, dir: rand() < 0.5 ? 1 : -1, speed: speed * (0.8 + rand() * 0.4), colour: Math.floor(rand() * 6) });

    for (const w of transit.waterways) {
      const l = w.lane;
      if (w.kind === "river") {
        // Two lanes either side of the Seine's centre line, one per direction
        // of travel; boats keep to the right like on the real river.
        const sgn = northSign(l);
        const lanes = [-1, 1].map((side) => offsetLane(l, sgn * side * 14));
        const n = Math.max(1, Math.round(l.len / 1500));
        for (let k = 0; k < n; k++) {
          add(PENICHE, pick(lanes), 2.6);
          add(MOUCHE, pick(lanes), 3.5);
          add(SMALL, pick(lanes), 4);
        }
      } else if (/Bassin/.test(w.name)) {
        for (const d of [-14, -5, 5, 14]) for (let i = 0; i < 2; i++) add(SMALL, offsetLane(l, d), 1.6);
        add(TOUR, l, 2.2);
      } else if (w.name === "Canal Saint-Martin") {
        for (let i = 0; i < 4; i++) add(SMALL, l, 1.5);
        add(TOUR, l, 1.8);
      } else {
        add(SMALL, l, 1.8);
        if (l.len > 400) add(PENICHE, l, 2);
      }
    }

    // Revellers along both quays of the open Canal Saint-Martin and the Bassin de la Villette.
    for (const w of transit.waterways) {
      const csm = w.name === "Canal Saint-Martin";
      if (!csm && w.name !== "Bassin de la Villette") continue;
      const half = csm ? 13.5 : 34;
      const every = csm ? 7 : 9;
      const chance = csm ? 0.6 : 0.35;
      for (let s = 4; s < w.lane.len - 4; s += every) {
        const p = sample(w.lane, s);
        for (const side of [-1, 1]) {
          if (rand() > chance) continue;
          // Quay edge, and the direction facing the water.
          const nx = p.ty * side, ny = -p.tx * side;
          const qx = p.x + nx * half, qy = p.y + ny * half;
          const n = 2 + Math.floor(rand() * 6);
          const people: Reveller[] = [];
          for (let k = 0; k < n; k++) {
            const u = (k - (n - 1) / 2) * 0.75 + (rand() - 0.5) * 0.3;
            const standing = rand() < 0.22;
            const back = standing ? 1 + rand() * 0.8 : 0.3;
            people.push({
              x: qx + p.tx * u + nx * back, y: qy + p.ty * u + ny * back,
              fx: -nx, fy: -ny, seated: !standing, dancer: standing && rand() < 0.55,
              look: Math.floor(rand() * 64), phase: rand() * 6.28,
            });
          }
          const bottles: [number, number, string][] = [];
          for (let k = 0, m = Math.floor(rand() * 5); k < m; k++) {
            bottles.push([qx + p.tx * (rand() - 0.5) * n * 0.8 + nx * 0.9, qy + p.ty * (rand() - 0.5) * n * 0.8 + ny * 0.9, pick(BOTTLES)]);
          }
          this.parties.push({
            x: qx, y: qy, people, bottles,
            blanket: rand() < 0.3 ? { x: qx + nx * 1.4, y: qy + ny * 1.4, tx: p.tx, ty: p.ty, colour: pick(BLANKETS) } : null,
            speaker: rand() < 0.15 ? [qx + nx * 1.2 + p.tx, qy + ny * 1.2 + p.ty] : null,
          });
        }
      }
    }

    const rep = transit.squares.find((q) => q.name === "Place de la République");
    if (rep) this.buildProtest(rep.ring, rep.holes, rand);
  }

  private buildProtest(ring: Float64Array, holes: Float64Array[], rand: () => number) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]);
      y0 = Math.min(y0, ring[i + 1]); y1 = Math.max(y1, ring[i + 1]);
    }
    const [sx, sy] = this.world.project(2.3639, 48.8675); // Monument à la République
    this.focus = [sx, sy];
    const spot = (): [number, number] => {
      for (;;) {
        // Denser towards the statue: average two uniform draws.
        const x = x0 + ((rand() + rand() + rand()) / 3) * (x1 - x0);
        const y = y0 + ((rand() + rand() + rand()) / 3) * (y1 - y0);
                if (!inRing(x, y, ring) || Math.hypot(x - sx, y - sy) < 17) continue; // not on the monument's base
        if (!holes.some((h) => inRing(x, y, h))) return [x, y];
      }
    };
    for (let i = 0; i < 520; i++) {
      const [hx, hy] = spot();
      this.protesters.push({
        hx, hy, look: Math.floor(rand() * 64), phase: rand() * 6.28,
        flag: rand() < 0.1 ? UNION_COLOURS[Math.floor(rand() * UNION_COLOURS.length)] : null,
      });
    }
    // Banners face roughly the same way: across the square's long axis.
    const ang = Math.atan2(y1 - y0, x1 - x0) + Math.PI / 2;
    for (let i = 0; i < 26; i++) {
      const [cx, cy] = spot();
      const a = ang + (rand() - 0.5) * 0.6, w = 2.5 + rand() * 2;
      const colour = rand() < 0.6 ? "#f4f1ea" : UNION_COLOURS[Math.floor(rand() * UNION_COLOURS.length)];
      this.banners.push({
        ax: cx - Math.cos(a) * w / 2, ay: cy - Math.sin(a) * w / 2, bx: cx + Math.cos(a) * w / 2, by: cy + Math.sin(a) * w / 2,
        colour, band: UNION_COLOURS[Math.floor(rand() * UNION_COLOURS.length)],
        looks: [Math.floor(rand() * 64), Math.floor(rand() * 64)],
      });
    }
    for (const colour of ["#d7261e", "#e8792b", "#f2c230"]) {
      const [x, y] = spot();
      this.balloons.push({ x, y, colour, phase: rand() * 6 });
    }
    for (let i = 0; i < 7; i++) {
      const [x, y] = spot();
      this.flares.push({ x, y, colour: rand() < 0.7 ? "#e8473a" : "#f08ab0", phase: rand() });
    }
    this.soundTruck = { x: sx + (x1 - x0) * 0.12, y: sy + 4, tx: Math.cos(ang - Math.PI / 2), ty: Math.sin(ang - Math.PI / 2) };
    // CRS vans along the square's edge, nose to tail, just outside it.
    const n = ring.length / 2;
    for (let k = 0; k < 7; k++) {
      const i = Math.floor((k / 7) * n), j = (i + 1) % n;
      const ex = ring[j * 2] - ring[i * 2], ey = ring[j * 2 + 1] - ring[i * 2 + 1];
      const len = Math.hypot(ex, ey) || 1;
      const mx = ring[i * 2], my = ring[i * 2 + 1];
      const ox = mx - sx, oy = my - sy, ol = Math.hypot(ox, oy) || 1;
      this.vans.push({ x: mx + (ox / ol) * 9, y: my + (oy / ol) * 9, tx: ex / len, ty: ey / len });
    }
  }

  step(dt: number) {
    this.time += dt;
    this.street.step(dt);
    for (const b of this.boats) {
      b.s += b.dir * b.speed * dt;
      if (b.s < 0 || b.s > b.lane.len) {
        b.dir = b.dir === 1 ? -1 : 1;
        b.s = Math.max(0, Math.min(b.lane.len, b.s));
      }
    }
  }

  collect(items: Item[], ctx: CanvasRenderingContext2D, r: Rotation, inView: InView, theme: Theme, cssZoom: number) {
    this.useSprites = !!this.sprites && cssZoom >= 1.1;
    this.street.collect(items, ctx, r, inView, theme, cssZoom);
    const onMap = this.world.onMap;
    if (cssZoom >= 0.55) {
      for (const b of this.boats) {
        const p = sample(b.lane, b.s);
        if (!onMap(p.x, p.y, 12) || !inView(p.x, p.y, 0, 40)) continue;
        // Never on a quay: bow, stern and both sides must be over water.
        const half = b.kind === PENICHE ? 18 : b.kind === SMALL ? 3 : 14, beam = b.kind === SMALL ? 1.5 : 4;
        const water = this.world.onWater;
        if (!water(p.x + p.tx * half, p.y + p.ty * half) || !water(p.x - p.tx * half, p.y - p.ty * half) ||
            !water(p.x + p.ty * beam, p.y - p.tx * beam) || !water(p.x - p.ty * beam, p.y + p.tx * beam)) continue;
        const tx = p.tx * b.dir, ty = p.ty * b.dir;
        items.push({ depth: depthOf(r, p.x, p.y), draw: () => this.drawBoat(ctx, r, b, p.x, p.y, tx, ty, theme) });
      }
    }
    if (cssZoom < 1.3) return;
    for (const party of this.parties) {
      if (!inView(party.x, party.y, 0, 10)) continue;
      items.push({ depth: depthOf(r, party.x, party.y), draw: () => this.drawParty(ctx, r, party, theme) });
    }
    if (this.protesters.length && inView(this.protesters[0].hx, this.protesters[0].hy, 0, 400)) this.collectProtest(items, ctx, r, inView);
  }

  private drawBoat(ctx: CanvasRenderingContext2D, r: Rotation, b: Boat, x: number, y: number, tx: number, ty: number, theme: Theme) {
    const night = theme.name === "night";
    const L = b.kind === PENICHE ? 38 : b.kind === MOUCHE ? 40 : b.kind === TOUR ? 24 : 5;
    // Wake: a pale V spreading behind the stern.
    const [sx, sy] = worldToIso(r, x - tx * L / 2, y - ty * L / 2);
    ctx.strokeStyle = night ? "rgba(200,220,255,0.25)" : "rgba(255,255,255,0.55)";
    ctx.lineWidth = b.kind === SMALL ? 0.25 : 0.5;
    ctx.beginPath();
    for (const side of [-1, 1]) {
      const wl = L * 0.6;
      const [ex, ey] = worldToIso(r, x - tx * (L / 2 + wl) - ty * side * wl * 0.35, y - ty * (L / 2 + wl) + tx * side * wl * 0.35);
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
    }
    ctx.stroke();

    if (this.useSprites) {
      const id = b.kind === PENICHE ? "peniche" : b.kind === MOUCHE ? "mouche" : b.kind === TOUR ? "mouche" : `boat-${b.colour % 4}`;
      const scale = b.kind === TOUR ? 0.6 : 1;
      if (this.sprites!.draw(ctx, r, id, x, y, -0.4, tx, ty, 0, scale)) {
        if (night && b.kind !== SMALL) dot(ctx, r, x - tx * L * 0.4, y - ty * L * 0.4, 3, "#ffd27a", 0.8);
        return;
      }
    }

    if (b.kind === PENICHE) {
      const deck = ["#1f6f5c", "#8e2b2b", "#2c4f8a", "#6b4f2a", "#3d3d46", "#a0522d"][b.colour];
      box(ctx, r, x, y, -0.2, tx, ty, 38, 5, 1.4, "#1d1f24", "#2b2e35");
      box(ctx, r, x + tx * 3, y + ty * 3, 1.2, tx, ty, 26, 4.2, 0.5, "#4a4036", b.colour % 2 ? "#b59a6a" : "#5a5f66");
      box(ctx, r, x - tx * 15, y - ty * 15, 1.2, tx, ty, 6, 4.4, 2.3, deck, shade(deck, 1.15));
      box(ctx, r, x - tx * 16, y - ty * 16, 3.5, tx, ty, 2.5, 2.2, 1.2, "#e9e6df", "#c8c4bb");
      if (night) dot(ctx, r, x - tx * 15, y - ty * 15, 2.4, "#ffd27a", 0.8);
      // A little car on the roof, as péniches carry.
      if (b.colour % 3 === 0) box(ctx, r, x - tx * 13, y - ty * 13, 3.5, tx, ty, 3.6, 1.6, 0.9, "#b8352e", "#d04a42");
    } else if (b.kind === MOUCHE) {
      box(ctx, r, x, y, -0.2, tx, ty, 40, 7, 1.4, "#f1f0ea", "#e2e0d8");
      box(ctx, r, x - tx * 1, y - ty * 1, 1.2, tx, ty, 32, 6.4, 1.9, night ? "#ffe2a0" : "#7fa9c4", night ? "#d9d6cc" : "#eef2f4");
      box(ctx, r, x + tx * 17, y + ty * 17, 1.2, tx, ty, 3, 3, 2.4, "#f1f0ea", "#ffffff");
    } else if (b.kind === TOUR) {
      box(ctx, r, x, y, -0.2, tx, ty, 24, 4.8, 1.1, "#f4f4ef", "#e6e5df");
      box(ctx, r, x, y, 0.9, tx, ty, 24.2, 4.85, 0.25, "#2a62b8", null);
      box(ctx, r, x - tx * 1, y - ty * 1, 1.15, tx, ty, 16, 4.2, 1.6, night ? "#ffe2a0" : "#86b3cc", "#f6f6f2");
    } else {
      const canopy = ["#d7261e", "#2a62b8", "#f2c230", "#1f9e5a", "#e8792b", "#f4f4ef"][b.colour];
      box(ctx, r, x, y, -0.1, tx, ty, 5, 2.1, 0.7, "#f4f4ef", "#d8d6cf");
      box(ctx, r, x - tx * 0.4, y - ty * 0.4, 1.6, tx, ty, 2.8, 1.9, 0.08, canopy, canopy);
      for (const u of [-1, 0.6]) {
        const [hx, hy] = worldToIso(r, x + tx * u, y + ty * u, 1.15);
        ctx.fillStyle = SKINS[(b.colour + Math.round(u)) & 3];
        ctx.beginPath();
        ctx.arc(hx, hy, 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
      if (night) dot(ctx, r, x + tx * 2.4, y + ty * 2.4, 0.8, "#ffffff", 0.35);
    }
  }

  /** Someone sitting on the quay edge, legs over the water. */
  private sitter(ctx: CanvasRenderingContext2D, r: Rotation, p: Reveller) {
    const shirt = SHIRTS[p.look % SHIRTS.length], skin = SKINS[(p.look >> 3) % SKINS.length];
    box(ctx, r, p.x + p.fx * 0.35, p.y + p.fy * 0.35, 0.05, p.fx, p.fy, 0.6, 0.32, 0.18, "#2d3a55", null);
    box(ctx, r, p.x, p.y, 0.05, p.fx, p.fy, 0.32, 0.4, 0.6, shirt, null);
    const [hx, hy] = worldToIso(r, p.x, p.y, 0.9);
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(hx, hy, 0.19, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawParty(ctx: CanvasRenderingContext2D, r: Rotation, party: Party, theme: Theme) {
    const night = theme.name === "night";
    if (party.blanket) {
      const b = party.blanket;
      box(ctx, r, b.x, b.y, 0, b.tx, b.ty, 2.2, 1.6, 0.03, b.colour, b.colour);
    }
    for (const [x, y, c] of party.bottles) box(ctx, r, x, y, 0, 1, 0, 0.12, 0.12, 0.35, c, c);
    if (party.speaker) box(ctx, r, party.speaker[0], party.speaker[1], 0, 1, 0, 0.35, 0.25, 0.45, "#1c1c22", "#2c2c34");
    if (this.useSprites) {
      // Back to front so nearer people overlap further ones.
      const order = party.people.slice().sort((p, q) => depthOf(r, p.x, p.y) - depthOf(r, q.x, q.y));
      for (const p of order) {
        const look = p.look % 12;
        if (p.seated) this.sprites!.draw(ctx, r, `sit-${look}`, p.x, p.y, -0.15, p.fx, p.fy);
        else if (p.dancer) this.sprites!.draw(ctx, r, `cheer-${look}`, p.x, p.y, 0, p.fx, p.fy, this.time * 0.8 + p.phase);
        else this.sprites!.draw(ctx, r, `hold-${look}`, p.x, p.y, 0, p.fx, p.fy);
      }
      if (night) dot(ctx, r, party.x, party.y, 0.4, "rgba(255, 210, 122, 0.9)", 0.35);
      return;
    }
    // Seated first (closer to the edge), then standing behind them.
    for (const p of party.people) if (p.seated) this.sitter(ctx, r, p);
    for (const p of party.people) {
      if (p.seated) continue;
      const bob = p.dancer ? Math.abs(Math.sin(this.time * 5 + p.phase)) * 0.18 : 0;
      person(ctx, r, p.x, p.y, bob, SHIRTS[p.look % SHIRTS.length], null, SKINS[(p.look >> 3) % SKINS.length]);
    }
    if (night) dot(ctx, r, party.x, party.y, 0.4, "rgba(255, 210, 122, 0.9)", 0.35);
  }

  private collectProtest(items: Item[], ctx: CanvasRenderingContext2D, r: Rotation, inView: InView) {
    const t = this.time;
    for (const p of this.protesters) {
      // Milling about a little around their spot.
      const x = p.hx + Math.sin(t * 0.4 + p.phase) * 0.8, y = p.hy + Math.cos(t * 0.33 + p.phase * 1.7) * 0.8;
      if (!inView(x, y, 0, 6)) continue;
      items.push({
        depth: depthOf(r, x, y),
        draw: () => {
          const jump = Math.max(0, Math.sin(t * 3 + p.phase * 3) - 0.9) * 1.2; // the odd jump, chanting
          if (this.useSprites) {
            const fx = this.focus[0] - x, fy = this.focus[1] - y, fl = Math.hypot(fx, fy) || 1;
            const id = p.flag ? `hold-${p.look % 12}` : p.look % 3 ? `cheer-${p.look % 12}` : `walk-${p.look % 12}`;
            this.sprites!.draw(ctx, r, id, x, y, jump, fx / fl, fy / fl, p.look % 3 ? t * 0.7 + p.phase : 0);
          } else {
            person(ctx, r, x, y, jump, SHIRTS[p.look % SHIRTS.length], null, SKINS[(p.look >> 3) % SKINS.length]);
          }
          if (p.flag) {
            const [bx, by] = worldToIso(r, x + 0.25, y, 1.2 + jump);
            const [tx2, ty2] = worldToIso(r, x + 0.25, y, 3.4 + jump);
            ctx.strokeStyle = "#4a3b2a";
            ctx.lineWidth = 0.08;
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(tx2, ty2);
            ctx.stroke();
            const wave = Math.sin(t * 4 + p.phase) * 0.25;
            ctx.fillStyle = p.flag;
            ctx.beginPath();
            ctx.moveTo(tx2, ty2);
            ctx.lineTo(tx2 + 1.3, ty2 + 0.25 + wave);
            ctx.lineTo(tx2 + 1.3, ty2 + 1.05 + wave);
            ctx.lineTo(tx2, ty2 + 0.8);
            ctx.fill();
          }
        },
      });
    }
    for (const b of this.banners) {
      const cx = (b.ax + b.bx) / 2, cy = (b.ay + b.by) / 2;
      if (!inView(cx, cy, 0, 8)) continue;
      items.push({
        depth: depthOf(r, cx, cy) + 0.1,
        draw: () => {
          if (this.useSprites) {
            // Banner carriers face the same way, out of the banner's front.
            const fx = -(b.by - b.ay), fy = b.bx - b.ax, fl = Math.hypot(fx, fy) || 1;
            this.sprites!.draw(ctx, r, `hold-${b.looks[0] % 12}`, b.ax, b.ay, 0, fx / fl, fy / fl);
            this.sprites!.draw(ctx, r, `hold-${b.looks[1] % 12}`, b.bx, b.by, 0, fx / fl, fy / fl);
          } else {
            person(ctx, r, b.ax, b.ay, 0, SHIRTS[b.looks[0] % SHIRTS.length], null, SKINS[(b.looks[0] >> 3) % SKINS.length]);
            person(ctx, r, b.bx, b.by, 0, SHIRTS[b.looks[1] % SHIRTS.length], null, SKINS[(b.looks[1] >> 3) % SKINS.length]);
          }
          const corners = [[b.ax, b.ay, 0.9], [b.bx, b.by, 0.9], [b.bx, b.by, 1.9], [b.ax, b.ay, 1.9]].map(([x, y, z]) => worldToIso(r, x, y, z));
          ctx.fillStyle = b.colour;
          ctx.beginPath();
          corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.fill();
          // A coloured band of "lettering" across it.
          const band = [[b.ax, b.ay, 1.25], [b.bx, b.by, 1.25], [b.bx, b.by, 1.55], [b.ax, b.ay, 1.55]].map(([x, y, z]) => worldToIso(r, x, y, z));
          ctx.fillStyle = b.band;
          ctx.beginPath();
          band.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.fill();
        },
      });
    }
    for (const bl of this.balloons) {
      if (!inView(bl.x, bl.y, 9, 10)) continue;
      items.push({
        depth: depthOf(r, bl.x, bl.y),
        draw: () => {
          const z = 8 + Math.sin(t * 0.8 + bl.phase) * 0.4;
          const [gx, gy] = worldToIso(r, bl.x, bl.y, 0);
          const [bx, by] = worldToIso(r, bl.x, bl.y, z);
          ctx.strokeStyle = "rgba(60,60,60,0.7)";
          ctx.lineWidth = 0.06;
          ctx.beginPath();
          ctx.moveTo(gx, gy);
          ctx.lineTo(bx, by + 2.4);
          ctx.stroke();
          const g = ctx.createRadialGradient(bx - 0.8, by - 0.8, 0.3, bx, by, 2.6);
          g.addColorStop(0, shade(bl.colour, 1.3));
          g.addColorStop(1, bl.colour);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.ellipse(bx, by, 2.2, 2.6, 0, 0, Math.PI * 2);
          ctx.fill();
        },
      });
    }
    // Smoke flares: puffs rising and fading on a loop.
    for (const f of this.flares) {
      if (!inView(f.x, f.y, 6, 10)) continue;
      items.push({
        depth: depthOf(r, f.x, f.y) + 0.5,
        draw: () => {
          for (let k = 0; k < 6; k++) {
            const age = (t * 0.35 + f.phase + k / 6) % 1;
            const [px, py] = worldToIso(r, f.x + age * 2.5, f.y - age * 1.5, 1 + age * 9);
            ctx.globalAlpha = 0.55 * (1 - age);
            ctx.fillStyle = f.colour;
            ctx.beginPath();
            ctx.arc(px, py, 0.5 + age * 2.6, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          dot(ctx, r, f.x, f.y, 1.2, "#fff2c0", 0.3);
        },
      });
    }
    const truck = this.soundTruck;
    if (truck && inView(truck.x, truck.y, 0, 10)) {
      items.push({
        depth: depthOf(r, truck.x, truck.y),
        draw: () => {
          box(ctx, r, truck.x, truck.y, 0.3, truck.tx, truck.ty, 7, 2.4, 2.6, "#f2f2ee", "#ffffff");
          box(ctx, r, truck.x, truck.y, 1.2, truck.tx, truck.ty, 7.05, 2.45, 0.5, "#d7261e", null);
          for (const u of [-2, 0, 2]) box(ctx, r, truck.x + truck.tx * u, truck.y + truck.ty * u, 2.9, truck.tx, truck.ty, 0.7, 0.7, 0.8, "#1c1c22", "#2c2c34");
        },
      });
    }
    const flash = Math.floor(t * 4) % 2 === 0;
    for (const v of this.vans) {
      if (!inView(v.x, v.y, 0, 8)) continue;
      items.push({
        depth: depthOf(r, v.x, v.y),
        draw: () => {
          box(ctx, r, v.x, v.y, 0.3, v.tx, v.ty, 5.5, 2.2, 2.2, "#1f2a44", "#2a3858");
          box(ctx, r, v.x, v.y, 1.1, v.tx, v.ty, 5.55, 2.25, 0.25, "#f4f4f4", null);
          if (flash) dot(ctx, r, v.x, v.y, 2.6, "#4aa3ff", 0.5);
        },
      });
    }
  }
}
