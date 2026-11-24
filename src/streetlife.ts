// Everyday life on the ground: people walking the sidewalks, café terraces,
// picnics on the lawns, and RER and mainline trains in and out of Gare du Nord
// and Gare de l'Est. Collected into the same depth-sorted pass as traffic.

import { makeLane, pointInRing, type Lane, type Transit, type World } from "./model";
import { depthOf, worldToIso, type Rotation } from "./render";
import { box, boxInView, dot, laneBoxes, person, sample, SHIRTS, SKINS, type Box } from "./shapes";
import type { Sprites } from "./sprites";
import type { Theme } from "./theme";
import type { Item } from "./life";

type InView = (x: number, y: number, z: number, pad: number) => boolean;

interface Walker {
  lane: number;
  s: number;
  dir: 1 | -1;
  speed: number;
  /** Sideways offset from the path's centre line, metres. */
  side: number;
  look: number;
  phase: number;
}

interface Seat {
  x: number;
  y: number;
  fx: number;
  fy: number;
  look: number;
}

interface Terrace {
  x: number;
  y: number;
  tables: [number, number][];
  people: Seat[];
}

interface Picnic {
  x: number;
  y: number;
  tx: number;
  ty: number;
  blanket: string;
  people: Seat[];
}

interface Train {
  route: Lane;
  kind: "rer" | "intercity";
  cars: number;
  carLen: number;
  /** Head position along the route (0 = buffer stops in the station). */
  s: number;
  /** +1 leaving the station, -1 arriving. */
  dir: 1 | -1;
  /** Seconds left standing at the platform or off the map. */
  wait: number;
}

/** Camera zooms (CSS px per metre) below which vehicles and boats, and then people, are neither drawn nor simulated. */
export const MOVERS_ZOOM = 1;
export const PEOPLE_ZOOM = 2.2;

const WALKERS = 60000;
const BLANKETS = ["#c94f4f", "#3f6fb0", "#e0b23a", "#4d9a6b", "#d9d2c3", "#e48aa8"];
const TRAIN_TOP = 16; // m/s, ~60 km/h inside the city
const TRAIN_ACC = 0.5;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function ringArea(r: Float64Array) {
  let a = 0;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += r[j] * r[i + 1] - r[i] * r[j + 1];
  return Math.abs(a) / 2;
}

export class StreetLife {
  private walkers: Walker[] = [];
  private slice = 0;
  /** Each path's bounding box, to skip the walkers on paths far from the view. */
  private walkBox = new Float32Array(0);
  /**
   * The walkers within a few streets of the view, and the box they were picked
   * in: of 60,000 people, only these walk and are looked at each frame. Picked
   * again when the view leaves the box, and every few seconds, as they wander.
   */
  private active: Walker[] = [];
  private activeBox: Box | null = null;
  private activeAt = 0;
  private terraces: Terrace[] = [];
  private picnics: Picnic[] = [];
  private trains: Train[] = [];
  private time = 0;
  private sprites: Sprites | null = null;
  private useSprites = false;

  constructor(private world: World) {}

  /**
   * Puts everyone in place. In slices (`pace` hands the page back every 25 ms
   * or so): done in one go it froze the map for most of a second on a phone.
   */
  async build(transit: Transit, pace: () => Promise<void>) {
    const rand = rng(2026);
    const { walks } = this.world;

    this.walkBox = laneBoxes(walks);

    // Walkers spread over the network in proportion to path length.
    const cum = new Float64Array(walks.length);
    walks.forEach((l, i) => (cum[i] = (i ? cum[i - 1] : 0) + l.len));
    const total = cum[cum.length - 1] ?? 0;
    for (let k = 0; total && k < WALKERS; k++) {
      if (k % 4096 === 0) await pace();
      const t = rand() * total;
      let lo = 0, hi = cum.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] < t) lo = mid + 1;
        else hi = mid;
      }
      const jog = rand() < 0.06;
      this.walkers.push({
        lane: lo, s: rand() * walks[lo].len, dir: rand() < 0.5 ? 1 : -1,
        speed: jog ? 2.6 + rand() * 0.8 : 1.1 + rand() * 0.5,
        side: (rand() - 0.5) * 1.6, look: Math.floor(rand() * 64), phase: rand(),
      });
    }

    await this.buildTerraces(transit, rand, pace);
    await pace();
    this.buildPicnics(rand);
    await pace();
    this.buildTrains(rand);
  }

  setSprites(s: Sprites) {
    this.sprites = s;
  }

  /** Terraces on the sidewalk in front of cafés and bars, facing the street. */
  private async buildTerraces(transit: Transit, rand: () => number, pace: () => Promise<void>) {
    const cafes = transit.cafes ?? [];
    if (!cafes.length) return;
    // Street points every 3 m, bucketed in a 20 m grid.
    const C = 20;
    const grid = new Map<string, [number, number, number, number, number][]>();
    let done = 0;
    for (const l of this.world.streets) {
      if (++done % 512 === 0) await pace();
      if (l.kind === "cycleway" || l.kind === "service") continue;
      for (let s = 0; s <= l.len; s += 3) {
        const p = sample(l, s);
        const key = `${Math.floor(p.x / C)},${Math.floor(p.y / C)}`;
        let b = grid.get(key);
        if (!b) grid.set(key, (b = []));
        b.push([p.x, p.y, p.tx, p.ty, l.half]);
      }
    }
    for (const [x, y, kind, outdoor] of cafes) {
      if (++done % 512 === 0) await pace();
      if (outdoor < 0) continue;
      if (rand() > (outdoor > 0 ? 1 : kind === 2 ? 0.35 : 0.75)) continue;
      let best: [number, number, number, number, number] | null = null, bd = 25;
      const gx = Math.floor(x / C), gy = Math.floor(y / C);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        for (const q of grid.get(`${gx + i},${gy + j}`) ?? []) {
          const d = Math.hypot(q[0] - x, q[1] - y);
          if (d < bd) { bd = d; best = q; }
        }
      }
      if (!best) continue;
      const [px, py, tx, ty, half] = best;
      // Normal from the street towards the café.
      let nx = -ty, ny = tx;
      if ((x - px) * nx + (y - py) * ny < 0) { nx = -nx; ny = -ny; }
      const off = Math.min(bd - 1, half + 2.2);
      const cx = px + nx * off, cy = py + ny * off;
      const n = 2 + Math.floor(rand() * 4);
      const tables: [number, number][] = [];
      const people: Seat[] = [];
      for (let k = 0; k < n; k++) {
        const u = (k - (n - 1) / 2) * 1.7;
        const tx0 = cx + tx * u, ty0 = cy + ty * u;
        tables.push([tx0, ty0]);
        // Parisian terraces: chairs side by side, facing the street.
        const seats = rand() < 0.75 ? 1 + Math.floor(rand() * 2) : 0;
        for (let m = 0; m < seats; m++) {
          const v = seats === 1 ? 0 : (m - 0.5) * 0.7;
          people.push({ x: tx0 + tx * v + nx * 0.55, y: ty0 + ty * v + ny * 0.55, fx: -nx, fy: -ny, look: Math.floor(rand() * 64) });
        }
      }
      this.terraces.push({ x: cx, y: cy, tables, people });
    }
  }

  /** Groups on blankets on park lawns, more in bigger parks. */
  private buildPicnics(rand: () => number) {
    for (const g of this.world.greens) {
      if (g.kind !== "park") continue;
      const area = ringArea(g.ring);
      if (area < 2500) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < g.ring.length; i += 2) {
        x0 = Math.min(x0, g.ring[i]); x1 = Math.max(x1, g.ring[i]);
        y0 = Math.min(y0, g.ring[i + 1]); y1 = Math.max(y1, g.ring[i + 1]);
      }
      const n = Math.min(60, Math.round(area / 1500));
      for (let k = 0, tries = 0; k < n && tries < n * 20; tries++) {
        const x = x0 + rand() * (x1 - x0), y = y0 + rand() * (y1 - y0);
        if (!pointInRing(x, y, g.ring)) continue;
        k++;
        const a = rand() * Math.PI * 2, tx = Math.cos(a), ty = Math.sin(a);
        const m = 2 + Math.floor(rand() * 4);
        const people: Seat[] = [];
        for (let j = 0; j < m; j++) {
          const b = (j / m) * Math.PI * 2 + rand() * 0.4;
          const px = x + Math.cos(b) * 1.3, py = y + Math.sin(b) * 1.0;
          people.push({ x: px, y: py, fx: x - px, fy: y - py, look: Math.floor(rand() * 64) });
        }
        this.picnics.push({ x, y, tx, ty, blanket: BLANKETS[Math.floor(rand() * BLANKETS.length)], people });
      }
    }
  }

  /**
   * Routes out of the two stations: from each buffer stop, follow the
   * straightest track onwards until the map ends.
   */
  private buildTrains(rand: () => number) {
    const { rails } = this.world;
    if (!rails.length) return;
    const ends = new Map<string, number[]>();
    rails.forEach((l, i) => {
      for (const e of [l.a, l.b]) ends.set(e, [...(ends.get(e) ?? []), i]);
    });
    const stations = [
      { at: this.world.project(2.3553, 48.8812), kind: "intercity" as const },
      { at: this.world.project(2.3590, 48.8772), kind: "intercity" as const },
    ];
    const pointOf = (l: Lane, end: "a" | "b") => (end === "a" ? [l.pts[0], l.pts[1]] : [l.pts[l.pts.length - 2], l.pts[l.pts.length - 1]]);
    const routes: { lane: Lane; station: number }[] = [];
    stations.forEach((st, si) => {
      const starts: [number, "a" | "b"][] = [];
      rails.forEach((l, i) => {
        for (const end of ["a", "b"] as const) {
          const key = end === "a" ? l.a : l.b;
          if ((ends.get(key) ?? []).length !== 1) continue; // a buffer stop
          const [x, y] = pointOf(l, end);
          if (Math.hypot(x - st.at[0], y - st.at[1]) < 320) starts.push([i, end]);
        }
      });
      for (const [i0, end0] of starts) {
        const pts: number[] = [];
        const used = new Set<number>();
        let i = i0, from = end0;
        while (!used.has(i) && pts.length < 4000) {
          used.add(i);
          const l = rails[i];
          const n = l.pts.length / 2;
          for (let k = 0; k < n; k++) {
            const idx = from === "a" ? k : n - 1 - k;
            if (pts.length && k === 0) continue;
            pts.push(l.pts[idx * 2], l.pts[idx * 2 + 1]);
          }
          const key = from === "a" ? l.b : l.a;
          const m = pts.length;
          const hx = pts[m - 2] - pts[m - 4], hy = pts[m - 1] - pts[m - 3], hl = Math.hypot(hx, hy) || 1;
          let next = -1, nextFrom: "a" | "b" = "a", bestDot = 0.85;
          for (const j of ends.get(key) ?? []) {
            if (used.has(j)) continue;
            const lj = rails[j];
            const f: "a" | "b" = lj.a === key ? "a" : "b";
            const nj = lj.pts.length / 2;
            const [ax, ay] = f === "a" ? [lj.pts[0], lj.pts[1]] : [lj.pts[nj * 2 - 2], lj.pts[nj * 2 - 1]];
            const [bx, by] = f === "a" ? [lj.pts[2], lj.pts[3]] : [lj.pts[nj * 2 - 4], lj.pts[nj * 2 - 3]];
            const d = ((bx - ax) * hx + (by - ay) * hy) / ((Math.hypot(bx - ax, by - ay) || 1) * hl);
            if (d > bestDot) { bestDot = d; next = j; nextFrom = f; }
          }
          if (next < 0) break;
          i = next;
          from = nextFrom;
        }
        const lane = makeLane(Float64Array.from(pts), 0, true, "rail");
        if (lane.len > 900) routes.push({ lane, station: si });
      }
    });
    // Keep distinct routes (they share the main lines), at most a dozen.
    routes.sort((a, b) => b.lane.len - a.lane.len);
    const kept: typeof routes = [];
    for (const r of routes) {
      const end = sample(r.lane, r.lane.len);
      if (kept.some((k) => Math.hypot(sample(k.lane, k.lane.len).x - end.x, sample(k.lane, k.lane.len).y - end.y) < 15 && k.station === r.station)) continue;
      kept.push(r);
      if (kept.length >= 12) break;
    }
    for (const r of kept) {
      const rer = rand() < 0.55;
      this.trains.push({
        route: r.lane, kind: rer ? "rer" : "intercity", cars: rer ? 4 + Math.floor(rand() * 3) : 6 + Math.floor(rand() * 4),
        carLen: rer ? 24 : 20, s: rand() * r.lane.len, dir: rand() < 0.5 ? 1 : -1, wait: 0,
      });
    }
  }

  /** `zoom`: what is too small to see stays where it is. */
  step(dt: number, zoom: number) {
    this.time += dt;
    const { walks, walkJunctions } = this.world;
    // A quarter of them per frame, each moving four frames' worth.
    const part = this.slice++ % 4;
    for (let i = part; zoom >= PEOPLE_ZOOM && i < this.active.length; i += 4) {
      const w = this.active[i];
      w.s += w.dir * w.speed * dt * 4;
      const l = walks[w.lane];
      if (w.s >= 0 && w.s <= l.len) continue;
      const key = w.s > l.len ? l.b : l.a;
      const next = (walkJunctions.get(key) ?? []).filter((i) => i !== w.lane);
      if (!next.length) {
        w.dir = w.dir === 1 ? -1 : 1;
        w.s = Math.max(0, Math.min(l.len, w.s));
        continue;
      }
      const j = next[Math.floor(Math.random() * next.length)];
      const nl = walks[j];
      w.lane = j;
      if (nl.a === key) { w.s = 0; w.dir = 1; }
      else { w.s = nl.len; w.dir = -1; }
    }
    for (const t of zoom >= MOVERS_ZOOM ? this.trains : []) {
      if (t.wait > 0) {
        t.wait -= dt;
        continue;
      }
      const L = t.route.len, train = t.cars * (t.carLen + 0.6);
      // Accelerate away from the platform, brake into it (s is the distance from it either way).
      const v = t.dir === 1
        ? Math.max(1.5, Math.min(TRAIN_TOP, Math.sqrt(2 * TRAIN_ACC * (t.s + 5))))
        : Math.max(1, Math.min(TRAIN_TOP, Math.sqrt(2 * TRAIN_ACC * Math.max(0, t.s - 2))));
      t.s += t.dir * v * dt;
      if (t.dir === 1 && t.s > L + train) {
        // Off the map: come back in a little later.
        t.dir = -1;
        t.s = L + train;
        t.wait = 20 + Math.random() * 60;
      } else if (t.dir === -1 && t.s <= 2) {
        t.s = 2;
        t.dir = 1;
        t.wait = 40 + Math.random() * 80; // at the platform
      }
    }
  }

  collect(items: Item[], ctx: CanvasRenderingContext2D, r: Rotation, inView: InView, theme: Theme, cssZoom: number, wb: Box) {
    const a = this.activeBox;
    if (cssZoom >= PEOPLE_ZOOM && (!a || wb[0] < a[0] || wb[1] < a[1] || wb[2] > a[2] || wb[3] > a[3] || this.time - this.activeAt > 5)) {
      const box: Box = [wb[0] - 200, wb[1] - 200, wb[2] + 200, wb[3] + 200];
      this.active = this.walkers.filter((w) => boxInView(this.walkBox, w.lane, box));
      this.activeBox = box;
      this.activeAt = this.time;
    }
    this.useSprites = !!this.sprites && cssZoom >= 1.1;
    if (cssZoom >= MOVERS_ZOOM) {
      for (const t of this.trains) {
        if (t.wait > 0 && t.dir === -1) continue; // off the map
        for (let k = 0; k < t.cars; k++) {
          // Cars trail behind the head, which leads in the direction of travel.
          const s = t.s - t.dir * (k * (t.carLen + 0.6) + t.carLen / 2);
          if (s < 0 || s > t.route.len) continue;
          const p = sample(t.route, s);
          if (!inView(p.x, p.y, 0, 30)) continue;
          items.push({ depth: depthOf(r, p.x, p.y), draw: () => this.drawCar(ctx, r, t, p.x, p.y, p.tx * t.dir, p.ty * t.dir, k === 0, theme) });
        }
      }
    }
    if (cssZoom < PEOPLE_ZOOM) return;
    const { walks } = this.world;
    for (const w of this.active) {
      if (!boxInView(this.walkBox, w.lane, wb)) continue;
      const p = sample(walks[w.lane], w.s);
      const x = p.x - p.ty * w.side, y = p.y + p.tx * w.side;
      if (!inView(x, y, 0, 4)) continue;
      items.push({ depth: depthOf(r, x, y), draw: () => this.drawWalker(ctx, r, w, x, y, p.tx * w.dir, p.ty * w.dir) });
    }
    for (const t of this.terraces) {
      if (!inView(t.x, t.y, 0, 8)) continue;
      items.push({ depth: depthOf(r, t.x, t.y), draw: () => this.drawTerrace(ctx, r, t, theme) });
    }
    for (const p of this.picnics) {
      if (!inView(p.x, p.y, 0, 5)) continue;
      items.push({ depth: depthOf(r, p.x, p.y), draw: () => this.drawPicnic(ctx, r, p) });
    }
  }

  private drawWalker(ctx: CanvasRenderingContext2D, r: Rotation, w: Walker, x: number, y: number, tx: number, ty: number) {
    if (this.useSprites) {
      // About one stride cycle per 1.4 m; joggers cycle faster.
      const t = this.time * w.speed / 1.4 + w.phase;
      if (this.sprites!.draw(ctx, r, `walk-${w.look % 12}`, x, y, 0, tx, ty, t)) return;
    }
    person(ctx, r, x, y, 0, SHIRTS[w.look % SHIRTS.length], null, SKINS[(w.look >> 3) % SKINS.length]);
  }

  private seat(ctx: CanvasRenderingContext2D, r: Rotation, p: Seat, z: number) {
    if (this.useSprites && this.sprites!.draw(ctx, r, `sit-${p.look % 12}`, p.x, p.y, z, p.fx, p.fy)) return;
    person(ctx, r, p.x, p.y, z - 0.3, SHIRTS[p.look % SHIRTS.length], null, SKINS[(p.look >> 3) % SKINS.length]);
  }

  private drawTerrace(ctx: CanvasRenderingContext2D, r: Rotation, t: Terrace, theme: Theme) {
    const night = theme.name === "night";
    for (const [x, y] of t.tables) {
      box(ctx, r, x, y, 0, 1, 0, 0.08, 0.08, 0.72, "#3a3530", "#3a3530");
      box(ctx, r, x, y, 0.72, 1, 0, 0.62, 0.62, 0.04, "#c9c3b8", "#a9a398");
      if (night) dot(ctx, r, x, y, 0.8, "#ffd27a", 0.35);
    }
    const order = t.people.slice().sort((a, b) => depthOf(r, a.x, a.y) - depthOf(r, b.x, b.y));
    for (const p of order) this.seat(ctx, r, p, 0.3);
  }

  private drawPicnic(ctx: CanvasRenderingContext2D, r: Rotation, p: Picnic) {
    box(ctx, r, p.x, p.y, 0, p.tx, p.ty, 2.4, 1.8, 0.03, p.blanket, p.blanket);
    const order = p.people.slice().sort((a, b) => depthOf(r, a.x, a.y) - depthOf(r, b.x, b.y));
    for (const s of order) this.seat(ctx, r, s, -0.2);
  }

  private drawCar(ctx: CanvasRenderingContext2D, r: Rotation, t: Train, x: number, y: number, tx: number, ty: number, head: boolean, theme: Theme) {
    const night = theme.name === "night";
    if (this.useSprites && this.sprites!.draw(ctx, r, t.kind, x, y, 0.3, tx, ty)) {
      if (head && theme.headlight) dot(ctx, r, x + tx * t.carLen / 2, y + ty * t.carLen / 2, 1.2, theme.headlight, 1.4);
      return;
    }
    const rer = t.kind === "rer";
    box(ctx, r, x, y, 0.3, tx, ty, t.carLen, 2.9, rer ? 1.4 : 1.1, rer ? "#1d4f9c" : "#5e6d7f", null);
    box(ctx, r, x, y, rer ? 1.7 : 1.4, tx, ty, t.carLen, 2.9, rer ? 2.2 : 1.9, night ? "#ffe2a0" : "#eef0f2", night ? "#c9ced4" : "#f6f7f8");
    if (head && theme.headlight) dot(ctx, r, x + tx * t.carLen / 2, y + ty * t.carLen / 2, 1.2, theme.headlight, 1.4);
  }
}
