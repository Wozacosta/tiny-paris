// Everything that moves: cars, RATP buses on their real lines, cyclists (some
// on Vélib'), garbage trucks with their crew, and metro trains on the line 2
// viaduct. Also Vélib' stations and the viaduct itself, which share this layer.
// It is drawn live every frame between the ground and the buildings, so
// buildings in front hide whatever is behind them for free.

import { BIKE_ROADS, CAR_ROADS, TRUCK_ROADS, type Lane, type Transit, type World } from "./model";
import { depthOf, worldToIso, type Occluder, type Rotation } from "./render";
import { Life } from "./life";
import { MOVERS_ZOOM, PEOPLE_ZOOM } from "./streetlife";
import { box, dot, groundShadow, person, sample, shade, SHIRTS, SKINS, type Sample } from "./shapes";
import type { Sprites } from "./sprites";
import { drawTrackPiece, pieceDepth, trackPieces, type TrackPiece, type TrackStyle } from "./tracks";

/** Car sprites, weighted roughly like Paris traffic (lots of white, grey and black). */
const CAR_SPRITES = [
  "car-white", "car-white", "car-black", "car-grey", "car-silver", "car-white", "car-blue", "car-red",
  "car-grey", "car-black", "suv-dark", "suv-white", "van-white", "van-white", "delivery", "taxi",
  "taxi", "car-silver", "car-white", "car-black", "car-grey", "suv-dark", "police", "car-white",
];
/** Zoom (CSS px per metre) above which sprites replace the simple boxes. */
const SPRITE_ZOOM = 1.1;
import type { Theme } from "./theme";

const CAR = 0, BUS = 1, TRAIN = 2, BIKE = 3, TRUCK = 4;
type Kind = typeof CAR | typeof BUS | typeof TRAIN | typeof BIKE | typeof TRUCK;

interface Vehicle {
  kind: Kind;
  lane: number;
  s: number;
  dir: 1 | -1;
  speed: number;
  /** Paint index, Vélib' type for bikes, or bus line index. */
  color: number;
  /** Seconds left standing still (bus stops, bin collection). */
  wait: number;
  /** Distance left until the next stop. */
  until: number;
}

const TRAIN_CARS = 5;
const TRAIN_CAR_LEN = 15;
/** Between cars: just the gangway. */
const TRAIN_GAP = 0.2;
/** Depth below the street over which a train going underground fades out. */
const TRAIN_FADE = 3.5;
const PILLAR_EVERY = 14;

const VELIB_GREEN = "#86b817";
const VELIB_BLUE = "#2f7fc2";

const TRACK_DAY: TrackStyle = {
  deckW: 5, deckH: 1.2, deck: ["#55665e", "#73837a"], stone: ["#c9bda6", "#d8cdb8"], pillarW: 1.2, trench: "#3d4340",
};
const TRACK_NIGHT: TrackStyle = { ...TRACK_DAY, deck: ["#2f3a3c", "#3d4a4b"], stone: ["#5a5670", "#66627c"], trench: "#1d2124" };

interface Station {
  x: number;
  y: number;
  tx: number;
  ty: number;
  docks: number;
  /** Which docks have a bike: 0 empty, 1 mechanical (green), 2 electric (blue). */
  bikes: number[];
}

export class Traffic {
  private vehicles: Vehicle[] = [];
  private track: TrackPiece[] = [];
  /** Raised trains held back by draw(raisedApart), for drawRaised. */
  private raised: { depth: number; draw: () => void }[] = [];
  /** Off when the painting already shows the viaduct: only the trains go on top. */
  showViaduct = true;
  private stations: Station[] = [];
  /** Flattened bus line stretches, and for each the stretch that follows it. */
  private busSegs: Lane[] = [];
  private busNext: number[] = [];
  private busLine: number[] = [];
  private time = 0;
  private life: Life;
  private sprites: Sprites | null = null;
  /** Set for the current draw call: sprites are ready and we're zoomed in enough. */
  private useSprites = false;

  setSprites(s: Sprites) {
    this.sprites = s;
    this.life.setSprites(s);
  }

  constructor(private world: World, private transit: Transit) {
    this.life = new Life(world, transit);
    const { streets, metro } = world;
    const rand = (n: number) => Math.floor(Math.random() * n);
    const add = (v: Omit<Vehicle, "wait" | "until"> & Partial<Vehicle>) => this.vehicles.push({ wait: 0, until: 30 + Math.random() * 300, ...v });

    // Pick street lanes of the allowed classes, weighted by length.
    const picker = (allowed: Set<string>) => {
      const ids = streets.map((l, i) => (allowed.has(l.kind) ? i : -1)).filter((i) => i >= 0);
      const cum = new Float64Array(ids.length);
      ids.forEach((id, i) => (cum[i] = (i ? cum[i - 1] : 0) + streets[id].len));
      const total = cum[ids.length - 1] || 0;
      const pick = () => {
        const t = Math.random() * total;
        let lo = 0, hi = ids.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (cum[mid] < t) lo = mid + 1;
          else hi = mid;
        }
        return ids[lo];
      };
      return { pick, total };
    };
    const spawnOn = (kind: Kind, lane: number, speed: number, color: number) =>
      add({ kind, lane, s: Math.random() * streets[lane].len, dir: Math.random() < 0.5 ? 1 : -1, speed, color });

    const cars = picker(CAR_ROADS);
    for (let i = 0, n = Math.min(9000, Math.round(cars.total / 40)); i < n; i++) spawnOn(CAR, cars.pick(), 6 + Math.random() * 6, rand(64));

    const bikes = picker(BIKE_ROADS);
    for (let i = 0, n = Math.min(4000, Math.round(bikes.total / 80)); i < n; i++) {
      // ~35% Vélib' (two thirds mechanical green, a third electric blue).
      const r = Math.random();
      const type = r < 0.23 ? 1 : r < 0.35 ? 2 : 0;
      spawnOn(BIKE, bikes.pick(), 3.5 + Math.random() * 2.5, type * 100 + rand(SHIRTS.length * SKINS.length));
    }

    const trucks = picker(TRUCK_ROADS);
    for (let i = 0, n = Math.round(trucks.total / 3000); i < n; i++) spawnOn(TRUCK, trucks.pick(), 2.8, 0);

    // RATP buses follow their real line; without line data, the main roads.
    transit.lines.forEach((line, li) => {
      const first = this.busSegs.length;
      line.segs.forEach((seg, k) => {
        this.busSegs.push(seg);
        this.busLine.push(li);
        this.busNext.push(k === line.segs.length - 1 ? first : first + k + 1);
      });
      const len = line.segs.reduce((a, l) => a + l.len, 0);
      for (let k = 0, n = Math.max(2, Math.round(len / 500)); k < n; k++) {
        const seg = first + rand(line.segs.length);
        add({ kind: BUS, lane: seg, s: Math.random() * this.busSegs[seg].len, dir: 1, speed: 6, color: li });
      }
    });
    if (!transit.lines.length) {
      const majors = picker(new Set(["primary", "secondary", "tertiary"]));
      for (let i = 0, n = Math.round(majors.total / 450); i < n; i++) spawnOn(BUS, majors.pick(), 5.5, -1);
    }

    metro.forEach((l, i) => {
      for (let k = 0; k < Math.max(1, Math.round(l.len / 900)); k++) add({ kind: TRAIN, lane: i, s: Math.random() * l.len, dir: 1, speed: 11, color: 0 });
    });

    this.track = trackPieces(metro, 8, PILLAR_EVERY);

    this.stations = transit.velib.map((v, i) => this.placeStation(v.x, v.y, v.capacity, i));
  }

  /** Lines a station up with the nearest street, along the pavement. */
  /** Streets by the 300 m cell of their first point, for placeStation. */
  private streetCells: Map<string, number[]> | null = null;

  private placeStation(x: number, y: number, capacity: number, seed: number): Station {
    const C = 300;
    if (!this.streetCells) {
      this.streetCells = new Map();
      this.world.streets.forEach((l, i) => {
        if (l.kind === "cycleway") return;
        const key = `${Math.floor(l.pts[0] / C)},${Math.floor(l.pts[1] / C)}`;
        const list = this.streetCells!.get(key);
        if (list) list.push(i);
        else this.streetCells!.set(key, [i]);
      });
    }
    // Lanes starting within 300 m (lanes are short in Paris), in their original
    // order so ties resolve as before.
    const near: number[] = [];
    for (let cx = Math.floor(x / C) - 1; cx <= Math.floor(x / C) + 1; cx++) {
      for (let cy = Math.floor(y / C) - 1; cy <= Math.floor(y / C) + 1; cy++) near.push(...(this.streetCells.get(`${cx},${cy}`) ?? []));
    }
    near.sort((a, b) => a - b);
    let best = Infinity, tx = 1, ty = 0, px = x, py = y;
    for (const i of near) {
      const l = this.world.streets[i];
      const p = l.pts;
      if (Math.abs(p[0] - x) > 300 || Math.abs(p[1] - y) > 300) continue;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const ax = p[i], ay = p[i + 1], bx = p[i + 2], by = p[i + 3];
        const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
        const qx = ax + dx * t, qy = ay + dy * t;
        const d = Math.hypot(x - qx, y - qy);
        if (d < best) {
          best = d;
          const len = Math.sqrt(len2);
          tx = dx / len; ty = dy / len; px = qx; py = qy;
          // Sit on the pavement: the side of the street the station is on.
          const side = Math.sign((x - qx) * -ty + (y - qy) * tx) || 1;
          px = qx - ty * side * (l.half + 1.2);
          py = qy + tx * side * (l.half + 1.2);
        }
      }
    }
    const docks = Math.max(8, Math.min(24, Math.round(capacity * 0.6)));
    const bikes = Array.from({ length: docks }, (_, k) => {
      const h = Math.sin(seed * 91.7 + k * 13.3) * 43758.5453 % 1;
      const f = Math.abs(h);
      return f < 0.35 ? 0 : f < 0.8 ? 1 : 2;
    });
    return { x: best < 40 ? px : x, y: best < 40 ? py : y, tx, ty, docks, bikes };
  }

  /** A random vehicle to follow: a bus on tonight's/today's lines, a Vélib', or a garbage truck. */
  pickToFollow(kind: "bus" | "velib" | "truck", night: boolean): number | null {
    const ids = this.vehicles
      .map((v, i) => ({ v, i }))
      .filter(({ v }) =>
        kind === "bus" ? v.kind === BUS && (v.color < 0 || this.transit.lines[this.busLine[v.lane]].night === night)
        : kind === "velib" ? v.kind === BIKE && v.color >= 100
        : v.kind === TRUCK)
      .map(({ i }) => i);
    return ids.length ? ids[Math.floor(Math.random() * ids.length)] : null;
  }

  /** Dev: puts a train's head at the track point nearest (x, y), optionally stopped there. */
  placeTrain(x: number, y: number, stop = false) {
    let best = Infinity, lane = 0, s = 0;
    this.world.metro.forEach((l, i) => {
      for (let k = 0; k < l.pts.length / 2; k++) {
        const d = Math.hypot(l.pts[k * 2] - x, l.pts[k * 2 + 1] - y);
        if (d < best) [best, lane, s] = [d, i, l.cum[k]];
      }
    });
    const v = this.vehicles.find((v) => v.kind === TRAIN)!;
    Object.assign(v, { lane, s, speed: stop ? 0 : 11 });
  }

  /** World position of a vehicle, and a label for it. */
  where(i: number): { x: number; y: number; z: number; label: string } {
    const v = this.vehicles[i];
    if (v.kind === BUS && v.color >= 0) {
      const p = sample(this.busSegs[v.lane], v.s);
      return { x: p.x, y: p.y, z: 2, label: `Bus ${this.transit.lines[this.busLine[v.lane]].ref}` };
    }
    const p = sample(v.kind === TRAIN ? this.world.metro[v.lane] : this.world.streets[v.lane], v.s);
    const label = v.kind === BIKE ? (v.color >= 200 ? "Vélib' électrique" : "Vélib'") : v.kind === TRUCK ? (v.wait > 0 ? "Garbage truck · collecting" : "Garbage truck") : "Bus";
    return { x: p.x, y: p.y, z: p.z + 1, label };
  }

  get count() {
    const c = { cars: 0, buses: 0, trains: 0, bikes: 0, trucks: 0, lines: new Set(this.transit.lines.map((l) => l.ref)).size, stations: this.stations.length };
    for (const v of this.vehicles) {
      if (v.kind === CAR) c.cars++;
      else if (v.kind === BUS) c.buses++;
      else if (v.kind === TRAIN) c.trains++;
      else if (v.kind === BIKE) c.bikes++;
      else c.trucks++;
    }
    return c;
  }

  /** `zoom`: the camera's; below MOVERS_ZOOM nothing is visible, so nothing moves. */
  step(dt: number, zoom: number) {
    this.time += dt;
    this.life.step(dt, zoom);
    if (zoom < MOVERS_ZOOM) return;
    const { streets, junctions, metro } = this.world;
    for (const v of this.vehicles) {
      if (v.wait > 0) {
        v.wait -= dt;
        continue;
      }
      const d = v.speed * dt;
      v.s += v.dir * d;

      // Buses pull in at stops, trucks at every few bins.
      if (v.kind === BUS || v.kind === TRUCK) {
        v.until -= d;
        if (v.until <= 0) {
          v.wait = v.kind === BUS ? 6 + Math.random() * 6 : 3 + Math.random() * 4;
          v.until = v.kind === BUS ? 280 + Math.random() * 200 : 20 + Math.random() * 25;
        }
      }

      if (v.kind === TRAIN) {
        // Tracks are one-way chains; trains loop back through the tunnel.
        if (v.s > metro[v.lane].len + TRAIN_CARS * TRAIN_CAR_LEN) v.s = 0;
        continue;
      }
      if (v.kind === BUS && v.color >= 0) {
        // Along the line, stretch after stretch, round and round.
        const seg = this.busSegs[v.lane];
        if (v.s > seg.len) {
          v.lane = this.busNext[v.lane];
          v.s = 0;
        }
        continue;
      }

      const lane = streets[v.lane];
      if (v.s >= 0 && v.s <= lane.len) continue;
      const allowed = v.kind === BIKE ? BIKE_ROADS : v.kind === TRUCK ? TRUCK_ROADS : CAR_ROADS;
      const over = v.s < 0 ? -v.s : v.s - lane.len;
      const end = v.s < 0 ? lane.a : lane.b;
      const all = (junctions.get(end) ?? []).filter((i) => i !== v.lane && allowed.has(streets[i].kind));
      const majors = v.kind === BUS ? all.filter((i) => streets[i].major) : all;
      const opts = majors.length ? majors : all;
      if (!opts.length) {
        // Dead end: turn around.
        v.dir = v.dir === 1 ? -1 : 1;
        v.s = v.s < 0 ? over : lane.len - over;
        continue;
      }
      const next = opts[Math.floor(Math.random() * opts.length)];
      const nl = streets[next];
      v.lane = next;
      if (nl.a === end) {
        v.dir = 1;
        v.s = Math.min(over, nl.len);
      } else {
        v.dir = -1;
        v.s = Math.max(nl.len - over, 0);
      }
    }
  }

  /**
   * Draws the viaduct, stations and every vehicle inside the iso-space view
   * rectangle. `ctx` must already carry the camera transform for iso units.
   */
  draw(
    ctx: CanvasRenderingContext2D, r: Rotation, view: [number, number, number, number], theme: Theme, cssZoom: number,
    only: number | null = null, occluders: { depth: number; draw: () => void }[] = [], raisedApart = false,
  ) {
    const [x0, y0, x1, y1] = view;
    const inView = (x: number, y: number, z: number, pad: number) => {
      const [sx, sy] = worldToIso(r, x, y, z);
      return sx > x0 - pad && sx < x1 + pad && sy > y0 - pad && sy < y1 + pad;
    };
    const night = theme.name === "night";
    const items: { depth: number; draw: () => void }[] = [];
    this.useSprites = !!this.sprites && cssZoom >= SPRITE_ZOOM;

    const trackStyle = night ? TRACK_NIGHT : TRACK_DAY;
    for (const p of only == null && this.showViaduct ? this.track : []) {
      if (!inView(p.x, p.y, Math.max(0, p.z), 30)) continue;
      items.push({ depth: pieceDepth(r, p), draw: () => drawTrackPiece(ctx, r, p, trackStyle) });
    }
    this.raised = [];

    if (cssZoom >= 1.2 && only == null) {
      for (const st of this.stations) {
        if (!inView(st.x, st.y, 0, 20)) continue;
        items.push({ depth: depthOf(r, st.x, st.y), draw: () => this.drawStation(ctx, r, st, theme) });
      }
    }

    if (cssZoom >= MOVERS_ZOOM) {
      const { streets, metro } = this.world;
      const small = cssZoom >= PEOPLE_ZOOM; // bikes and people only once they're visible
      for (const v of only == null ? this.vehicles : [this.vehicles[only]]) {
        if (v.kind === TRAIN) {
          const l = metro[v.lane];
          for (let k = 0; k < TRAIN_CARS; k++) {
            const s = v.s - k * (TRAIN_CAR_LEN + TRAIN_GAP) - TRAIN_CAR_LEN / 2;
            if (s < 0 || s > l.len) continue;
            const p = sample(l, s);
            if (p.z <= -TRAIN_FADE || !inView(p.x, p.y, p.z, 20)) continue;
            const end = k === 0 ? "head" : k === TRAIN_CARS - 1 ? "tail" : "mid";
            const item = { depth: depthOf(r, p.x, p.y), draw: () => this.drawTrainCar(ctx, r, p, theme, end) };
            // Up on a viaduct, over the painting, which always shows it.
            (raisedApart && p.z >= 2 ? this.raised : items).push(item);
          }
          continue;
        }
        if (v.kind === BIKE && !small) continue;
        if (v.kind === BUS && v.color >= 0) {
          const line = this.transit.lines[this.busLine[v.lane]];
          if (line.night !== night) continue; // Noctilien at night, day lines by day
          const p = sample(this.busSegs[v.lane], v.s);
          // Line ways run down the street's middle; keep to the right of it.
          const x = p.x - p.ty * 2.2, y = p.y + p.tx * 2.2;
          if (!inView(x, y, 0, 15)) continue;
          items.push({ depth: depthOf(r, x, y), draw: () => this.drawBus(ctx, r, x, y, p.tx, p.ty, line.colour, theme) });
          continue;
        }
        const l = streets[v.lane];
        const p = sample(l, v.s);
        const tx = p.tx * v.dir, ty = p.ty * v.dir;
        // Keep right: offset towards the right-hand side of travel (y points south).
        const off = v.kind === BIKE ? Math.max(0.6, l.half - 1) : Math.min(l.half * 0.5, 3);
        const x = p.x - ty * off, y = p.y + tx * off;
        if (!inView(x, y, 0, 15)) continue;
        const depth = depthOf(r, x, y);
        if (v.kind === BIKE) items.push({ depth, draw: () => this.drawBike(ctx, r, x, y, tx, ty, v.color, theme) });
        else if (v.kind === TRUCK) items.push({ depth, draw: () => this.drawTruck(ctx, r, x, y, tx, ty, v, theme, small) });
        else if (v.kind === BUS) items.push({ depth, draw: () => this.drawBus(ctx, r, x, y, tx, ty, "#00a88f", theme) });
        else items.push({ depth, draw: () => this.drawCar(ctx, r, x, y, tx, ty, v.color, theme) });
      }
    }

    if (only == null) this.life.collect(items, ctx, r, inView, theme, cssZoom);
    items.push(...occluders);
    items.sort((a, b) => a.depth - b.depth);
    for (const it of items) it.draw();
  }

  /** Whether the last draw(…, raisedApart) held back any raised trains. */
  get hasRaised() {
    return this.raised.length > 0;
  }

  /**
   * The raised trains the last draw(…, raisedApart) held back, on a layer of
   * their own. A building hides them only from behind its rearmost corner:
   * sorted by its middle, a big building like the Rotonde cut trains running
   * along its front into slivers.
   */
  drawRaised(occluders: Occluder[] = []) {
    const items = [...this.raised, ...occluders.map((o) => ({ depth: o.back, draw: o.draw }))];
    items.sort((a, b) => a.depth - b.depth);
    for (const it of items) it.draw();
    this.raised = [];
  }

  private drawCar(ctx: CanvasRenderingContext2D, r: Rotation, x: number, y: number, tx: number, ty: number, color: number, theme: Theme) {
    if (this.useSprites) {
      groundShadow(ctx, r, x, y, tx, ty, 4.4, 1.9);
      if (this.sprites!.draw(ctx, r, CAR_SPRITES[color % CAR_SPRITES.length], x, y, 0, tx, ty)) {
        this.lights(ctx, r, x, y, tx, ty, 2.1, theme);
        return;
      }
    }
    const body = theme.cars[color % theme.cars.length];
    box(ctx, r, x, y, 0.15, tx, ty, 4.2, 1.8, 0.75, shade(body, 0.72), body);
    box(ctx, r, x - tx * 0.3, y - ty * 0.3, 0.9, tx, ty, 2.2, 1.55, 0.55, theme.carGlass, body);
    if (theme.headlight && theme.taillight) {
      for (const side of [-0.6, 0.6]) {
        dot(ctx, r, x + tx * 2.1 - ty * side, y + ty * 2.1 + tx * side, 0.55, theme.headlight, 0.7);
        dot(ctx, r, x - tx * 2.1 - ty * side, y - ty * 2.1 + tx * side, 0.55, theme.taillight, 0.6);
      }
    }
  }

  /** Head and tail lights at night, `half` metres ahead of and behind the centre. */
  private lights(ctx: CanvasRenderingContext2D, r: Rotation, x: number, y: number, tx: number, ty: number, half: number, theme: Theme) {
    if (!theme.headlight || !theme.taillight) return;
    for (const side of [-0.6, 0.6]) {
      dot(ctx, r, x + tx * half - ty * side, y + ty * half + tx * side, 0.55, theme.headlight, 0.7);
      dot(ctx, r, x - tx * half - ty * side, y - ty * half + tx * side, 0.55, theme.taillight, 0.6);
    }
  }

  /** RATP bus: jade skirt, glass band, white roof, line colour on the front. */
  private drawBus(ctx: CanvasRenderingContext2D, r: Rotation, x: number, y: number, tx: number, ty: number, lineColour: string, theme: Theme) {
    if (this.useSprites) {
      groundShadow(ctx, r, x, y, tx, ty, 12, 2.6);
      if (this.sprites!.draw(ctx, r, "bus", x, y, 0, tx, ty)) {
        // Line colour on the destination panel above the windscreen.
        box(ctx, r, x + tx * 5.95, y + ty * 5.95, 2.45, tx, ty, 0.1, 1.6, 0.4, lineColour, null);
        this.lights(ctx, r, x, y, tx, ty, 6, theme);
        return;
      }
    }
    const night = theme.name === "night";
    box(ctx, r, x, y, 0.3, tx, ty, 12, 2.5, 1.2, night ? "#1d6e60" : "#25a58c", null);
    box(ctx, r, x, y, 1.5, tx, ty, 12, 2.5, 1.1, night ? "#ffd98a" : "#33414f", null);
    box(ctx, r, x, y, 2.6, tx, ty, 12, 2.5, 0.45, night ? "#8f9a98" : "#e9efed", night ? "#a7b1af" : "#f5f8f7");
    // Line number panel colour above the windscreen, and a roof stripe.
    box(ctx, r, x + tx * 5.6, y + ty * 5.6, 2.3, tx, ty, 0.8, 2.52, 0.75, lineColour, lineColour);
    box(ctx, r, x - tx * 0.5, y - ty * 0.5, 3.05, tx, ty, 9, 0.6, 0.05, lineColour, lineColour);
    if (theme.headlight) dot(ctx, r, x + tx * 6, y + ty * 6, 0.8, theme.headlight, 0.9);
  }

  private drawBike(ctx: CanvasRenderingContext2D, r: Rotation, x: number, y: number, tx: number, ty: number, color: number, theme: Theme) {
    const type = Math.floor(color / 100); // 0 own bike, 1 Vélib' mechanical, 2 Vélib' electric
    const look = color % 100;
    if (this.useSprites) {
      groundShadow(ctx, r, x, y, tx, ty, 1.7, 0.5, 0.18);
      if (this.sprites!.draw(ctx, r, `${type ? "velib" : "bike"}-${look % 8}`, x, y, 0, tx, ty)) {
        if (theme.headlight) dot(ctx, r, x + tx * 0.85, y + ty * 0.85, 0.7, "#ffffff", 0.35);
        return;
      }
    }
    const frame = type === 1 ? VELIB_GREEN : type === 2 ? VELIB_BLUE : "#3a3a44";
    this.bikeFrame(ctx, r, x, y, tx, ty, frame, type > 0);
    // Rider: torso leaning forward, head.
    box(ctx, r, x - tx * 0.1, y - ty * 0.1, 0.75, tx, ty, 0.45, 0.35, 0.7, SHIRTS[look % SHIRTS.length], null);
    const [hx, hy] = worldToIso(r, x + tx * 0.05, y + ty * 0.05, 1.65);
    ctx.fillStyle = SKINS[Math.floor(look / SHIRTS.length) % SKINS.length];
    ctx.beginPath();
    ctx.arc(hx, hy, 0.18, 0, Math.PI * 2);
    ctx.fill();
    if (theme.headlight) dot(ctx, r, x + tx * 0.85, y + ty * 0.85, 0.7, "#ffffff", 0.35);
  }

  /** Two wheels and a frame, standing at (x, y) along (tx, ty). */
  private bikeFrame(ctx: CanvasRenderingContext2D, r: Rotation, x: number, y: number, tx: number, ty: number, frame: string, basket: boolean) {
    const [fx, fy] = worldToIso(r, x + tx * 0.55, y + ty * 0.55, 0.35);
    const [bx, by] = worldToIso(r, x - tx * 0.55, y - ty * 0.55, 0.35);
    const [sx, sy] = worldToIso(r, x - tx * 0.1, y - ty * 0.1, 0.75);
    ctx.strokeStyle = "#26262c";
    ctx.lineWidth = 0.13;
    for (const [wx, wy] of [[fx, fy], [bx, by]]) {
      ctx.beginPath();
      ctx.ellipse(wx, wy, 0.33, 0.33, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = frame;
    ctx.lineWidth = 0.16;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(sx, sy);
    ctx.lineTo(fx, fy);
    ctx.stroke();
    if (basket) box(ctx, r, x + tx * 0.7, y + ty * 0.7, 0.75, tx, ty, 0.3, 0.35, 0.2, frame, shade(frame === VELIB_GREEN ? "#86b817" : "#2f7fc2", 0.8));
  }

  /** Vélib' station: dock rail, totem, and the bikes currently docked. */
  private drawStation(ctx: CanvasRenderingContext2D, r: Rotation, st: Station, theme: Theme) {
    const night = theme.name === "night";
    const L = st.docks * 0.75;
    box(ctx, r, st.x, st.y, 0, st.tx, st.ty, L, 0.5, 0.12, night ? "#4b4f63" : "#a9aab0", night ? "#5b6075" : "#c4c5ca");
    // Totem at one end.
    const ex = st.x + st.tx * (L / 2 + 0.5), ey = st.y + st.ty * (L / 2 + 0.5);
    box(ctx, r, ex, ey, 0, st.tx, st.ty, 0.35, 0.3, 1.9, night ? "#2b2f3d" : "#4a4d57", null);
    box(ctx, r, ex, ey, 1.6, st.tx, st.ty, 0.36, 0.31, 0.3, VELIB_GREEN, VELIB_GREEN);
    if (night) dot(ctx, r, ex, ey, 1.4, "#cfe9a0", 0.35);
    // Docked bikes stand across the rail.
    for (let k = 0; k < st.docks; k++) {
      const b = st.bikes[k];
      if (!b) continue;
      const u = -L / 2 + 0.375 + k * 0.75;
      const bx = st.x + st.tx * u - st.ty * 0.55, by = st.y + st.ty * u + st.tx * 0.55;
      this.bikeFrame(ctx, r, bx, by, -st.ty, st.tx, b === 1 ? VELIB_GREEN : VELIB_BLUE, true);
    }
  }

  /** Propreté de Paris garbage truck with two crew in hi-vis. */
  private drawTruck(ctx: CanvasRenderingContext2D, r: Rotation, x: number, y: number, tx: number, ty: number, v: Vehicle, theme: Theme, crew: boolean) {
    const night = theme.name === "night";
    const nx = -ty, ny = tx; // to the right of travel
    if (this.useSprites) {
      groundShadow(ctx, r, x, y, tx, ty, 8, 2.6);
      if (this.sprites!.draw(ctx, r, "benne", x, y, 0, tx, ty)) {
        const cx = x + tx * 3.2, cy = y + ty * 3.2;
        if (Math.floor(this.time * 3) % 2 === 0) dot(ctx, r, cx, cy, 3.6, "#ff9a1f", 0.6);
        this.lights(ctx, r, x, y, tx, ty, 4, theme);
        if (crew) this.drawCrew(ctx, r, x, y, tx, ty, nx, ny, v);
        return;
      }
    }
    // Body behind, cab in front.
    const bx = x - tx * 1.2, by = y - ty * 1.2;
    box(ctx, r, bx, by, 0.4, tx, ty, 5.6, 2.5, 1.0, night ? "#1f5a37" : "#2f8a4f", null);
    box(ctx, r, bx, by, 1.4, tx, ty, 5.6, 2.5, 1.8, night ? "#9aa5a0" : "#e8eee9", night ? "#aab4af" : "#f4f7f5");
    const cx = x + tx * 2.8, cy = y + ty * 2.8;
    box(ctx, r, cx, cy, 0.4, tx, ty, 2.2, 2.5, 1.4, night ? "#a7b0ad" : "#f2f4f2", null);
    box(ctx, r, cx + tx * 0.2, cy + ty * 0.2, 1.8, tx, ty, 1.8, 2.45, 0.9, theme.carGlass, night ? "#b5bdba" : "#ffffff");
    // Orange beacon, flashing.
    if (Math.floor(this.time * 3) % 2 === 0) dot(ctx, r, cx, cy, 2.85, "#ff9a1f", 0.55);
    if (theme.headlight) dot(ctx, r, cx + tx * 1.1, cy + ty * 1.1, 0.8, theme.headlight, 0.7);
    if (!crew) return;

    const uniform = "#2e6b3f", vest = "#d7f23c", skin = SKINS[(v.lane >> 2) % SKINS.length];
    const rearX = bx - tx * 3, rearY = by - ty * 3;
    if (v.wait > 0) {
      // Stopped: crew walk to the kerb and roll a bin to the back.
      const reach = Math.min(1, Math.sin(Math.min(Math.PI, v.wait * 1.2)) * 1.4);
      const kx = rearX + nx * (1 + reach * 2.2), ky = rearY + ny * (1 + reach * 2.2);
      box(ctx, r, kx + tx * 0.6, ky + ty * 0.6, 0, tx, ty, 0.6, 0.6, 1.0, "#3f7a3a", "#4f8f48");
      person(ctx, r, kx, ky, 0, uniform, vest, skin);
      person(ctx, r, rearX - nx * 0.8, rearY - ny * 0.8, 0, uniform, vest, skin);
    } else {
      // Riding on the rear step.
      person(ctx, r, rearX - tx * 0.3 + nx * 0.8, rearY - ty * 0.3 + ny * 0.8, 0.4, uniform, vest, skin);
      person(ctx, r, rearX - tx * 0.3 - nx * 0.8, rearY - ty * 0.3 - ny * 0.8, 0.4, uniform, vest, skin);
    }
  }

  /** Two éboueurs in hi-vis: on the rear step while driving, fetching bins when stopped. */
  private drawCrew(ctx: CanvasRenderingContext2D, r: Rotation, x: number, y: number, tx: number, ty: number, nx: number, ny: number, v: Vehicle) {
    const rearX = x - tx * 4.3, rearY = y - ty * 4.3;
    const s = this.sprites!;
    const crew = (i: number) => `hold-${[6, 9][i]}`;
    if (v.wait > 0) {
      const reach = Math.min(1, Math.sin(Math.min(Math.PI, v.wait * 1.2)) * 1.4);
      const kx = rearX + nx * (1 + reach * 2.2), ky = rearY + ny * (1 + reach * 2.2);
      box(ctx, r, kx + tx * 0.6, ky + ty * 0.6, 0, tx, ty, 0.6, 0.6, 1.0, "#3f7a3a", "#4f8f48");
      s.draw(ctx, r, `walk-${6}`, kx, ky, 0, nx * (reach > 0.5 ? -1 : 1), ny * (reach > 0.5 ? -1 : 1), this.time * 1.4);
      s.draw(ctx, r, crew(1), rearX - nx * 0.8, rearY - ny * 0.8, 0, -tx, -ty);
    } else {
      s.draw(ctx, r, crew(0), rearX + nx * 0.8, rearY + ny * 0.8, 0.45, -tx, -ty);
      s.draw(ctx, r, crew(1), rearX - nx * 0.8, rearY - ny * 0.8, 0.45, -tx, -ty);
    }
  }

  /** One car of a train: a cab at each end (the tail's facing back), plain cars between. */
  private drawTrainCar(ctx: CanvasRenderingContext2D, r: Rotation, p: Sample, theme: Theme, end: "head" | "mid" | "tail") {
    const head = end === "head";
    if (p.z < 0) {
      // Going down into the trench: fade into its shade, then the tunnel.
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 + p.z / TRAIN_FADE);
      this.drawTrainCar(ctx, r, { ...p, z: 0 }, theme, end);
      ctx.restore();
      return;
    }
    const night = theme.name === "night";
    const z = p.z + 0.2;
    // Its shadow on the viaduct's deck, so it sits on it rather than hovering.
    if (p.z >= 4.5) trackShadow(ctx, r, p, TRAIN_CAR_LEN, 2.6);
    const back = end === "tail" ? -1 : 1;
    if (this.useSprites && this.sprites!.draw(ctx, r, end === "mid" ? "metro" : "metro-head", p.x, p.y, z, p.tx * back, p.ty * back)) {
      if (head && theme.headlight) dot(ctx, r, p.x + p.tx * 7.5, p.y + p.ty * 7.5, z + 0.8, theme.headlight, 1);
      return;
    }
    // From afar, the same car in three bands: white body, window band, roof.
    box(ctx, r, p.x, p.y, z + 0.3, p.tx, p.ty, TRAIN_CAR_LEN, 2.2, 0.7, "#2a2d32", null);
    box(ctx, r, p.x, p.y, z + 1.0, p.tx, p.ty, TRAIN_CAR_LEN, 2.4, 0.9, night ? "#9aa0ad" : "#e6e9eb", null);
    box(ctx, r, p.x, p.y, z + 1.9, p.tx, p.ty, TRAIN_CAR_LEN, 2.4, 1.1, night ? "#ffe2a0" : "#1d2530", null);
    box(ctx, r, p.x, p.y, z + 3.0, p.tx, p.ty, TRAIN_CAR_LEN, 2.4, 0.5, night ? "#9aa0ad" : "#e6e9eb", night ? "#b3b8c4" : "#d9dde0");
    if (head && theme.headlight) dot(ctx, r, p.x + p.tx * 7.5, p.y + p.ty * 7.5, z + 0.8, theme.headlight, 1);
  }
}

/** A train's shadow on its deck: the sun is south-west, so it falls north-east of it. */
function trackShadow(ctx: CanvasRenderingContext2D, r: Rotation, p: Sample, L: number, W: number) {
  const nx = -p.ty, ny = p.tx;
  const pts = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => {
    const [sx, sy] = worldToIso(r, p.x + p.tx * (L / 2) * a + nx * (W / 2) * b + 0.6, p.y + p.ty * (L / 2) * a + ny * (W / 2) * b - 0.6, p.z + 0.05);
    return [sx, sy];
  });
  ctx.fillStyle = "rgba(20, 24, 30, 0.32)";
  ctx.beginPath();
  pts.forEach(([sx, sy], i) => (i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy)));
  ctx.fill();
}
