// Loads the OSM-derived dataset and turns it into world geometry in metres.
// World axes: x = east, y = south, in metres from a fixed origin (raw.origin).

export interface Info {
  name?: string;
  building?: string;
  amenity?: string;
  tourism?: string;
  historic?: string;
  start_date?: string;
  "building:levels"?: string;
  height?: string;
  wikipedia?: string;
  addr?: string;
}

interface RawBuilding {
  r: number[][];
  h?: number;
  i?: Info;
}

interface Raw {
  bbox: { s: number; w: number; n: number; e: number };
  origin: { lon: number; lat: number };
  /** World extent in metres: [x0, y0, x1, y1]. */
  bounds: [number, number, number, number];
  /** The map's outline, flat [x, y, ...] in world units (×scale). */
  boundary: number[];
  scale: number;
  buildings: RawBuilding[];
  water: number[][][];
  parks: { k: string; r: number[][] }[];
  bridges: number[][][];
  roads: { w: number; k: string; p: number[] }[];
  trees: number[][];
  metro?: { line: string; p: number[]; z: number[] }[];
}

/** A polyline vehicles can follow, with cumulative lengths for sampling. */
export interface Lane {
  pts: Float64Array;
  /** Height of each vertex (metro only). */
  zs?: Float64Array;
  cum: Float64Array;
  len: number;
  /** Half the carriageway width, used to keep to the right. */
  half: number;
  major: boolean;
  /** OSM highway class (or "metro"/"bus"), deciding which vehicles use it. */
  kind: string;
  /** Endpoint keys, for hopping to the next lane at a junction. */
  a: string;
  b: string;
}

export interface Building {
  /** Rings in metres, outer first, as flat [x0, y0, x1, y1, …]. */
  rings: Float64Array[];
  h: number;
  /** Height of the zinc mansard band at the top of the walls. */
  mansard: number;
  cx: number;
  cy: number;
  /** Pale stone monuments drawn in white instead of Haussmann cream. */
  white: boolean;
  /** Stable per-building noise in [0, 1), picks façade and roof tones. */
  tone: number;
  /** Architectural family, from IGN BD TOPO where known. */
  style: Style;
  /** Roof covering, from BD TOPO where known. */
  roof: RoofKind;
  kind: string;
  domes: Dome[];
  /** Highest point including domes. */
  top: number;
  info?: Info;
}

/** A drum topped by a dome, centred `dx`/`dy` metres from the footprint centroid. */
export interface Dome {
  dx: number;
  dy: number;
  r: number;
  base: number;
  drum: number;
  dome: number;
  /** Glass-and-iron dome (Galeries Lafayette) instead of stone. */
  glass?: boolean;
  /** Only on the building with this name whose centroid is near here (lon, lat). */
  near?: [number, number];
}

export interface World {
  /** World extent in metres: [x0, y0, x1, y1]. */
  bounds: [number, number, number, number];
  /** The map's outline in metres, flat [x, y, ...]. */
  boundary: Float64Array;
  /** Whether a point is inside the outline (`margin` metres in, if given). */
  onMap(x: number, y: number, margin?: number): boolean;
  /** Whether a point is on open water (rivers, canals, basins), on a 4 m grid. */
  onWater(x: number, y: number): boolean;
  buildings: Building[];
  trees: Float64Array;
  ground: {
    slab: Path2D; parks: Path2D; pitches: Path2D; cemeteries: Path2D; water: Path2D; bridges: Path2D;
    treeShadows: Path2D;
    /** Building shadows per 500 m cell (one huge Path2D gets very slow to build). */
    shadows: { x: number; y: number; path: Path2D }[];
  };
  roads: { width: number; color: RoadColor; path: Path2D }[];
  streets: Lane[];
  junctions: Map<string, number[]>;
  metro: Lane[];
  /** Footways, sidewalks and pedestrian streets, for people walking. */
  walks: Lane[];
  walkJunctions: Map<string, number[]>;
  /** Railway track pieces (unjoined, as mapped). */
  rails: Lane[];
  /** Park and cemetery outlines in metres, for picnics. */
  greens: { kind: string; ring: Float64Array }[];
  project(lon: number, lat: number): [number, number];
}

export type RoadColor = "road" | "path" | "rail";

const WHITE = new Set(["Basilique du Sacré-Cœur"]);

const DOMES: Record<string, Dome[]> = {
  // The Coupole of the Galeries Lafayette Haussmann store, rising out of the roof.
  "Galeries Lafayette": [{ dx: 0, dy: 0, r: 14, base: 30, drum: 2, dome: 9, glass: true, near: [2.3322, 48.87366] }],
  "Basilique du Sacré-Cœur": [
    { dx: 0, dy: 0, r: 13, base: 30, drum: 18, dome: 30 },
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => ({ dx: sx * 17, dy: sy * 17, r: 5, base: 30, drum: 6, dome: 9 })),
  ],
};

// OSM heights are patchy for landmarks; these read better.
const HEIGHT_OVERRIDES: Record<string, number> = {
  "Gare du Nord": 30,
  // A low glass plinth: the painter draws the pyramid itself.
  "Pyramide du Louvre": 1,
  "Basilique du Sacré-Cœur": 30,
  "Rotonde de la Villette": 16,
  "Philharmonie de Paris": 52,
  "Église Saint-Vincent-de-Paul": 36,
  // The painting draws the whole mill with its sails over this little base.
  "Moulin de la Galette": 14,
  // An open lattice, not a 330 m block: the base render draws its shape
  // (export.ts) and the painting the tower; this is just its footprint.
  "Tour Eiffel": 2,
};

/** Sun from the south-west: shadow offset in metres per metre of height. */
const SUN = [0.55, -0.5];

const DRIVABLE = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "service"]);
/** Street network classes: everything cars use plus cycle paths for bikes. */
const STREETS = new Set([...DRIVABLE, "cycleway"]);
export const CAR_ROADS = DRIVABLE;
export const BIKE_ROADS = new Set(["cycleway", "secondary", "tertiary", "unclassified", "residential", "living_street"]);
export const TRUCK_ROADS = new Set(["residential", "living_street", "unclassified", "tertiary"]);
const WALKS = new Set(["footway", "pedestrian", "path", "living_street"]);
const MAJOR = new Set(["motorway", "trunk", "primary", "secondary", "tertiary"]);

function pointInRing(x: number, y: number, r: Float64Array) {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function makeLane(flat: Float64Array, half: number, major: boolean, kind: string, zs?: Float64Array): Lane {
  const n = flat.length / 2;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(flat[i * 2] - flat[i * 2 - 2], flat[i * 2 + 1] - flat[i * 2 - 1]);
  const key = (i: number) => `${Math.round(flat[i * 2] * 10)},${Math.round(flat[i * 2 + 1] * 10)}`;
  return { pts: flat, zs, cum, len: cum[n - 1], half, major, kind, a: key(0), b: key(n - 1) };
}

/** Ramps between tunnel, ground and viaduct heights over ~60 m. */
function smoothHeights(flat: Float64Array, zs: number[]) {
  const lane = makeLane(flat, 0, false, "metro");
  const out = new Float64Array(zs.length);
  const R = 60;
  for (let i = 0; i < zs.length; i++) {
    let sum = 0, wsum = 0;
    for (let j = 0; j < zs.length; j++) {
      const d = Math.abs(lane.cum[j] - lane.cum[i]);
      if (d > R) continue;
      const w = 1 - d / R;
      sum += zs[j] * w;
      wsum += w;
    }
    out[i] = sum / wsum;
  }
  return out;
}

/**
 * Convex hull of a footprint and its copy shifted by the sun vector: the
 * building's cast shadow (exact for convex footprints, close enough otherwise).
 * Hulls all wind the same way, so one nonzero fill unions overlapping shadows.
 */
function addShadow(path: Path2D, ring: Float64Array, sx: number, sy: number) {
  const pts: [number, number][] = [];
  for (let i = 0; i < ring.length; i += 2) pts.push([ring[i], ring[i + 1]], [ring[i] + sx, ring[i + 1] + sy]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) upper.pop();
    upper.push(pts[i]);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  path.moveTo(hull[0][0], hull[0][1]);
  for (let i = 1; i < hull.length; i++) path.lineTo(hull[i][0], hull[i][1]);
  path.closePath();
}

const LOW_KINDS = new Set(["kiosk", "toilets", "shed", "boat", "houseboat", "hut", "cabin", "container", "garage", "garages", "bandstand", "guardhouse", "elevator", "greenhouse", "roof"]);
const MANSARD_KINDS = new Set(["yes", "apartments", "residential", "hotel", "office", "commercial", "retail", "government", "public"]);
const CHURCH_KINDS = new Set(["church", "chapel", "cathedral", "basilica", "religious", "temple"]);

/**
 * - stone: pre-1914 Paris, cream limestone/render, zinc or slate mansard
 * - brick: brick façades, mostly 1900–1940 social housing (HBM) and workshops
 * - modern: 1950–1989 towers and slabs, concrete, flat roofs
 * - recent: 1990 onwards, light render, flat roofs
 */
export type Style = "stone" | "brick" | "modern" | "recent";
export type RoofKind = "zinc" | "slate" | "tile" | "flat" | "glass";

/** One BD TOPO building: centroid (decimetres), height, floors, materials, year. */
type BdRow = [number, number, number, number, string, string, number];

// BD TOPO material codes are two digits, one material per digit.
// Walls: 1 stone, 2 millstone, 3 concrete, 4 brick, 5 breeze block, 6 wood, 9 other.
// Roofs: 1 tiles, 2 slate, 3 zinc/aluminium, 4 concrete, 9 other.
const has = (code: string, d: string) => code.length === 2 && code !== "00" && code.includes(d);

/** Monuments are tall without being tower blocks; their age decides, not their height. */
const MONUMENT_KINDS = new Set([
  "church", "cathedral", "chapel", "basilica", "religious", "temple", "train_station", "civic", "government",
  "townhall", "public", "palace", "castle", "museum", "theatre", "hospital", "triumphal_arch", "city_gate",
]);

/** Landmarks whose data would mislead the classifier. */
const STYLE_OVERRIDES: Record<string, { style: Style; roof: RoofKind }> = {
  "Gare du Nord": { style: "stone", roof: "glass" },
  "Cité des Sciences et de l'Industrie": { style: "recent", roof: "glass" },
  "La Géode": { style: "recent", roof: "flat" },
  "Philharmonie de Paris": { style: "recent", roof: "slate" },
  "Pyramide du Louvre": { style: "recent", roof: "glass" },
  "Palais du Louvre": { style: "stone", roof: "slate" },
};

function classify(bd: BdRow | undefined, kind: string, h: number, area: number, name: string, notable: boolean): { style: Style; roof: RoofKind } {
  if (STYLE_OVERRIDES[name]) return STYLE_OVERRIDES[name];
  const [, , , floors = 0, walls = "", roofCode = "", year = 0] = bd ?? [];
  // Monuments and buildings with a Wikipedia article are tall without being
  // tower blocks; only a post-1950 date makes them modern.
  const monument = notable || MONUMENT_KINDS.has(kind);
  // Floor counts tell towers apart from tall old buildings; height alone only when they're missing.
  const tall = !monument && (floors ? floors >= 9 : h >= 32);
  if (monument && (!year || year < 1950) && !(has(walls, "4") && !has(walls, "1"))) {
    return { style: "stone", roof: roofCode[0] === "2" ? "slate" : roofCode[0] === "1" ? "tile" : "zinc" };
  }
  // Big station halls are iron-and-glass sheds.
  if (kind === "train_station" && area > 2500) return { style: "stone", roof: "glass" };
  let style: Style;
  // Brick walls before 1905 are almost always rendered over in cream plaster;
  // exposed red brick is the 1905–1949 social housing and workshops.
  if (has(walls, "4") && !has(walls, "1") && year >= 1905 && year < 1950) style = "brick";
  else if (tall || (year >= 1950 && year < 1990) || (has(walls, "3") && !has(walls, "1"))) style = year >= 1990 ? "recent" : "modern";
  else if (year >= 1990) style = "recent";
  else style = "stone";
  if (["retail", "commercial", "industrial", "warehouse", "train_station", "parking", "sports_centre"].includes(kind) && style === "stone" && h < 12) {
    style = year >= 1950 ? "modern" : style;
  }
  let roof: RoofKind;
  if (style === "modern" || style === "recent" || has(roofCode, "4")) roof = "flat";
  else if (roofCode[0] === "1") roof = "tile";
  else if (roofCode[0] === "2") roof = "slate";
  else roof = "zinc";
  if (style === "brick" && roofCode === "") roof = "flat";
  return { style, roof };
}

/** Finds, for each building, the BD TOPO record whose centroid lies inside it (tallest wins). */
function matchBdTopo(rows: BdRow[], rings: Float64Array[][], k: number): (BdRow | undefined)[] {
  const CELL = 40;
  const grid = new Map<string, BdRow[]>();
  for (const r of rows) {
    const key = `${Math.floor(r[0] / k / CELL)},${Math.floor(r[1] / k / CELL)}`;
    let list = grid.get(key);
    if (!list) grid.set(key, (list = []));
    list.push(r);
  }
  return rings.map((rs) => {
    const o = rs[0];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < o.length; i += 2) {
      x0 = Math.min(x0, o[i]); x1 = Math.max(x1, o[i]);
      y0 = Math.min(y0, o[i + 1]); y1 = Math.max(y1, o[i + 1]);
    }
    let best: BdRow | undefined;
    for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++) {
      for (let gy = Math.floor(y0 / CELL); gy <= Math.floor(y1 / CELL); gy++) {
        for (const r of grid.get(`${gx},${gy}`) ?? []) {
          const px = r[0] / k, py = r[1] / k;
          if (px < x0 || px > x1 || py < y0 || py > y1 || !inRing(px, py, o)) continue;
          if (!best || r[2] > best[2]) best = r;
        }
      }
    }
    return best;
  });
}

function inRing(x: number, y: number, r: Float64Array) {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Cheap deterministic noise from a point, in [0, 1). */
function hash(x: number, y: number) {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function heightOf(b: RawBuilding, cx: number, cy: number, area: number) {
  const kind = b.i?.building ?? "yes";
  const name = b.i?.name;
  if (name && HEIGHT_OVERRIDES[name]) return HEIGHT_OVERRIDES[name];
  let h = b.h;
  if (LOW_KINDS.has(kind)) return Math.min(h ?? 3.5, 5);
  // Untagged specks (viaduct supports, kiosks, sheds) shouldn't become towers.
  if (h == null) h = area < 25 ? 4 : area < 80 ? 9 : 15 + hash(cx, cy) * 8; // else a typical Haussmann block
  if (CHURCH_KINDS.has(kind)) h = Math.max(h, kind === "cathedral" ? 30 : 22);
  return h;
}

/** A point-on-water test over the map, from the water polygons filled row by row (even-odd, so islands stay dry). */
function waterGrid(polys: number[][][], k: number, [bx0, by0, bx1, by1]: [number, number, number, number]) {
  const G = 4, gw = Math.ceil((bx1 - bx0) / G), gh = Math.ceil((by1 - by0) / G);
  const grid = new Uint8Array(gw * gh);
  const rings = polys.flat().map((r) => Float64Array.from(r, (v) => v / k));
  for (const r of rings) {
    let y0 = Infinity, y1 = -Infinity;
    for (let i = 1; i < r.length; i += 2) { y0 = Math.min(y0, r[i]); y1 = Math.max(y1, r[i]); }
    for (let j = Math.max(0, Math.floor((y0 - by0) / G)); j <= Math.min(gh - 1, Math.ceil((y1 - by0) / G)); j++) {
      const y = by0 + (j + 0.5) * G, xs: number[] = [];
      for (let i = 0, p = r.length - 2; i < r.length; p = i, i += 2) {
        const ya = r[p + 1], yb = r[i + 1];
        if (ya > y !== yb > y) xs.push(r[p] + ((y - ya) / (yb - ya)) * (r[i] - r[p]));
      }
      xs.sort((a, b) => a - b);
      for (let q = 0; q + 1 < xs.length; q += 2) {
        const a = Math.max(0, Math.ceil((xs[q] - bx0) / G - 0.5)), b = Math.min(gw - 1, Math.floor((xs[q + 1] - bx0) / G - 0.5));
        for (let i = a; i <= b; i++) grid[j * gw + i] ^= 1;
      }
    }
  }
  return (x: number, y: number) => {
    const i = Math.floor((x - bx0) / G), j = Math.floor((y - by0) / G);
    return i >= 0 && j >= 0 && i < gw && j < gh && grid[j * gw + i] === 1;
  };
}

function ringsToPath(path: Path2D, rings: number[][], k: number) {
  for (const r of rings) {
    if (r.length < 6) continue;
    path.moveTo(r[0] / k, r[1] / k);
    for (let i = 2; i < r.length; i += 2) path.lineTo(r[i] / k, r[i + 1] / k);
    path.closePath();
  }
}

/**
 * Fetches JSON, reporting progress as a fraction. Compressed responses don't
 * say their unpacked size, so `expected` bytes stand in for it.
 */
async function fetchJson(url: string, expected: number, onProgress?: (f: number) => void) {
  const res = await fetch(url);
  if (!onProgress || !res.body) return res.json();
  const len = Number(res.headers.get("content-length"));
  const total = len && !res.headers.get("content-encoding") ? len : expected;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onProgress(Math.min(0.99, got / total));
  }
  const all = new Uint8Array(got);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.length; }
  return JSON.parse(new TextDecoder().decode(all));
}

export async function loadWorld(url: string, bdtopoUrl?: string, onProgress?: (f: number) => void): Promise<World> {
  const [raw, bdRaw]: [Raw, { rows: BdRow[] } | null] = await Promise.all([
    fetchJson(url, 36.6e6, onProgress),
    bdtopoUrl ? fetch(bdtopoUrl).then((r) => (r.ok && r.headers.get("content-type")?.includes("json") ? r.json() : null)) : null,
  ]);
  // Let the page show "building" before the long synchronous work below.
  onProgress?.(1);
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const k = raw.scale;
  const lat0 = raw.origin.lat;
  const lon0 = raw.origin.lon;
  const R = 6378137;
  const kx = (Math.PI / 180) * R * Math.cos((lat0 * Math.PI) / 180);
  const ky = (Math.PI / 180) * R;
  const project = (lon: number, lat: number): [number, number] => [(lon - lon0) * kx, -(lat - lat0) * ky];

  const allRings = raw.buildings.map((b) => b.r.map((r) => Float64Array.from(r, (v) => v / k)));
  const bdMatch = bdRaw ? matchBdTopo(bdRaw.rows, allRings, k) : [];

  const buildings: Building[] = raw.buildings.map((b, bi) => {
    const rings = allRings[bi];
    const bd = bdMatch[bi];
    // BD TOPO surveyed heights beat our guesses; OSM-tagged heights win over both.
    // For a church BD TOPO gives the spire's height, far above the nave the
    // footprint mostly is, so cap it there.
    if (b.h == null && bd && bd[2] > 2) b = { ...b, h: CHURCH_KINDS.has(b.i?.building ?? "") ? Math.min(bd[2], 28) : bd[2] };
    const o = rings[0];
    let cx = 0, cy = 0;
    for (let i = 0; i < o.length; i += 2) { cx += o[i]; cy += o[i + 1]; }
    cx /= o.length / 2;
    cy /= o.length / 2;
    let area = 0;
    for (let i = 0, j = o.length - 2; i < o.length; j = i, i += 2) area += o[j] * o[i + 1] - o[i] * o[j + 1];
    const h = heightOf(b, cx, cy, Math.abs(area) / 2);
    const kind = b.i?.building ?? "yes";
    const notable = !!(b.i?.wikipedia || b.i?.historic);
    const { style, roof } = classify(bd, kind, h, Math.abs(area) / 2, b.i?.name ?? "", notable);
    // Mansards belong to the old stone city; modern blocks end in a flat roof.
    const mansard = style === "stone" && roof !== "tile" && MANSARD_KINDS.has(kind) && h > 11 ? Math.min(4.5, h * 0.22) : 0;
    const name = b.i?.name ?? "";
    const domes = (DOMES[name] ?? []).filter((d) => {
      if (!d.near) return true;
      const [nx, ny] = project(d.near[0], d.near[1]);
      return Math.hypot(nx - cx, ny - cy) < 40;
    });
    const top = Math.max(h, ...domes.map((d) => d.base + d.drum + d.dome * 1.25));
    const info = bd && bd[6] && !b.i?.start_date ? { ...b.i, start_date: String(bd[6]) } : b.i;
    return { rings, h, mansard, cx, cy, white: WHITE.has(name), tone: hash(cy * 0.37, cx * 1.91), style, roof, kind, domes, top, info };
  });

  const boundary = Float64Array.from(raw.boundary, (v) => v / k);
  const slab = new Path2D();
  ringsToPath(slab, [raw.boundary], k);
  // Distance-to-edge test on a coarse grid, so per-frame checks stay cheap.
  const [bx0, by0, bx1, by1] = raw.bounds;
  const GRID = 20, gw = Math.ceil((bx1 - bx0) / GRID), gh = Math.ceil((by1 - by0) / GRID);
  const inside = new Uint8Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    // Where this row of cell centres crosses the outline, filled in pairs.
    const y = by0 + (j + 0.5) * GRID, xs: number[] = [];
    for (let i = 0, p = boundary.length - 2; i < boundary.length; p = i, i += 2) {
      const ya = boundary[p + 1], yb = boundary[i + 1];
      if (ya > y !== yb > y) xs.push(boundary[p] + ((y - ya) / (yb - ya)) * (boundary[i] - boundary[p]));
    }
    xs.sort((a, b) => a - b);
    for (let q = 0; q + 1 < xs.length; q += 2) {
      const a = Math.max(0, Math.ceil((xs[q] - bx0) / GRID - 0.5)), b = Math.min(gw - 1, Math.floor((xs[q + 1] - bx0) / GRID - 0.5));
      inside.fill(1, j * gw + a, j * gw + b + 1);
    }
  }
  const onMap = (x: number, y: number, margin = 0) => {
    const cell = (px: number, py: number) => {
      const i = Math.floor((px - bx0) / GRID), j = Math.floor((py - by0) / GRID);
      return i >= 0 && j >= 0 && i < gw && j < gh && inside[j * gw + i] === 1;
    };
    if (!cell(x, y)) return false;
    return !margin || (cell(x - margin, y) && cell(x + margin, y) && cell(x, y - margin) && cell(x, y + margin));
  };

  const parks = new Path2D();
  const pitches = new Path2D();
  const cemeteries = new Path2D();
  for (const p of raw.parks) ringsToPath(p.k === "pitch" ? pitches : p.k === "cemetery" ? cemeteries : parks, p.r, k);
  const water = new Path2D();
  for (const w of raw.water) ringsToPath(water, w, k);
  const onWater = waterGrid(raw.water, k, raw.bounds);
  const bridges = new Path2D();
  for (const b of raw.bridges) ringsToPath(bridges, b, k);

  // One stroked path per width so the whole network is a handful of calls.
  const byWidth = new Map<string, { width: number; color: RoadColor; path: Path2D }>();
  for (const r of raw.roads) {
    const color: RoadColor = r.k === "rail" ? "rail" : ["footway", "path", "cycleway", "pedestrian"].includes(r.k) ? "path" : "road";
    const key = `${r.w}:${color}`;
    let g = byWidth.get(key);
    if (!g) byWidth.set(key, (g = { width: r.w, color, path: new Path2D() }));
    g.path.moveTo(r.p[0] / k, r.p[1] / k);
    for (let i = 2; i < r.p.length; i += 2) g.path.lineTo(r.p[i] / k, r.p[i + 1] / k);
  }
  // Rails go on top of the street network, wide roads under narrow ones.
  const roads = [...byWidth.values()].sort((a, b) => Number(a.color === "rail") - Number(b.color === "rail") || b.width - a.width);

  const SHADOW_CELL = 500;
  const shadowCells = new Map<string, { x: number; y: number; path: Path2D }>();
  for (const b of buildings) {
    const x = Math.floor(b.cx / SHADOW_CELL), y = Math.floor(b.cy / SHADOW_CELL), key = `${x},${y}`;
    let cell = shadowCells.get(key);
    if (!cell) shadowCells.set(key, (cell = { x: x * SHADOW_CELL, y: y * SHADOW_CELL, path: new Path2D() }));
    addShadow(cell.path, b.rings[0], SUN[0] * b.h, SUN[1] * b.h);
  }
  const shadows = [...shadowCells.values()];

  // Footpaths and service roads mapped through passages and courtyards would
  // put people and cars on top of the painted roofs: drop any whose middle is
  // inside a building.
  const CELL = 50;
  const cells = new Map<string, number[]>();
  buildings.forEach((b, i) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const r0 = b.rings[0];
    for (let j = 0; j < r0.length; j += 2) {
      x0 = Math.min(x0, r0[j]); x1 = Math.max(x1, r0[j]); y0 = Math.min(y0, r0[j + 1]); y1 = Math.max(y1, r0[j + 1]);
    }
    for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++) {
      for (let gy = Math.floor(y0 / CELL); gy <= Math.floor(y1 / CELL); gy++) {
        const key = `${gx},${gy}`;
        const list = cells.get(key);
        if (list) list.push(i);
        else cells.set(key, [i]);
      }
    }
  });
  const indoors = (x: number, y: number) =>
    (cells.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`) ?? []).some((i) => pointInRing(x, y, buildings[i].rings[0]));
  const throughBuilding = (flat: Float64Array) => {
    const lane = makeLane(flat, 0, false, "");
    return [0.25, 0.5, 0.75].some((f) => {
      let i = 1;
      while (i < lane.cum.length - 1 && lane.cum[i] < lane.len * f) i++;
      const t = (lane.len * f - lane.cum[i - 1]) / (lane.cum[i] - lane.cum[i - 1] || 1);
      return indoors(flat[i * 2 - 2] + (flat[i * 2] - flat[i * 2 - 2]) * t, flat[i * 2 - 1] + (flat[i * 2 + 1] - flat[i * 2 - 1]) * t);
    });
  };

  const streets: Lane[] = [];
  const junctions = new Map<string, number[]>();
  for (const r of raw.roads) {
    if (!STREETS.has(r.k)) continue;
    const flat = Float64Array.from(r.p, (v) => v / k);
    if (r.k === "service" && throughBuilding(flat)) continue;
    const lane = makeLane(flat, r.w / 2, MAJOR.has(r.k), r.k);
    if (lane.len < 1) continue;
    const id = streets.push(lane) - 1;
    for (const e of [lane.a, lane.b]) junctions.set(e, [...(junctions.get(e) ?? []), id]);
  }
  const walks: Lane[] = [];
  const walkJunctions = new Map<string, number[]>();
  const rails: Lane[] = [];
  for (const r of raw.roads) {
    const walk = WALKS.has(r.k);
    if (!walk && r.k !== "rail") continue;
    const flat = Float64Array.from(r.p, (v) => v / k);
    if (walk && throughBuilding(flat)) continue;
    const lane = makeLane(flat, r.w / 2, false, r.k);
    if (lane.len < 2) continue;
    if (!walk) {
      rails.push(lane);
      continue;
    }
    const id = walks.push(lane) - 1;
    for (const e of [lane.a, lane.b]) walkJunctions.set(e, [...(walkJunctions.get(e) ?? []), id]);
  }
  const greens = raw.parks.flatMap((p) => p.r.slice(0, 1).map((ring) => ({ kind: p.k, ring: Float64Array.from(ring, (v) => v / k) })));
  const metro = (raw.metro ?? []).map((m) => {
    const flat = Float64Array.from(m.p, (v) => v / k);
    return makeLane(flat, 0, true, "metro", smoothHeights(flat, m.z));
  });

  const trees = new Float64Array(raw.trees.length * 2);
  const treeShadows = new Path2D();
  raw.trees.forEach(([x, y], i) => {
    trees[i * 2] = x / k;
    trees[i * 2 + 1] = y / k;
    treeShadows.moveTo(x / k + 4.5, y / k + 1);
    treeShadows.ellipse(x / k + 1, y / k + 1, 3.5, 3.5, 0, 0, Math.PI * 2);
  });


  return {
    bounds: raw.bounds, boundary, onMap, onWater, buildings, trees, roads, streets, junctions, metro, walks, walkJunctions, rails, greens,
    ground: { slab, parks, pitches, cemeteries, water, bridges, treeShadows, shadows },
    project,
  };
}

export interface BusLine {
  ref: string;
  colour: string;
  /** Noctilien night bus. */
  night: boolean;
  /** The line's route as continuous stretches, in driving order. */
  segs: Lane[];
}

export interface VelibStation {
  x: number;
  y: number;
  capacity: number;
  name: string;
}

export interface Waterway {
  name: string;
  kind: "river" | "canal";
  lane: Lane;
}

export interface Square {
  name: string;
  /** Outline in metres, flat [x0, y0, …]. */
  ring: Float64Array;
  /** Fountains and pools nobody should stand in. */
  holes: Float64Array[];
}

export interface Transit {
  lines: BusLine[];
  velib: VelibStation[];
  waterways: Waterway[];
  squares: Square[];
  /** Cafés, bars and restaurants: [x, y, kind (0 café, 1 bar, 2 restaurant), outdoor seating (1 yes, -1 no, 0 unknown)], metres. */
  cafes?: [number, number, number, number][];
}

/** Bus lines and Vélib' stations from scripts/fetch-transit.mjs; empty if missing. */
export async function loadTransit(url: string): Promise<Transit> {
  const res = await fetch(url);
  if (!res.ok || !res.headers.get("content-type")?.includes("json")) return { lines: [], velib: [], waterways: [], squares: [] };
  const raw: {
    ways: Record<string, number[]>;
    lines: { ref: string; colour: string; night: boolean; ways: number[] }[];
    velib: { p: [number, number]; cap: number; name: string }[];
    waterways?: { name: string; kind: "river" | "canal"; p: number[] }[];
    squares?: { name: string; p: number[]; holes?: number[][] }[];
  } = await res.json();
  const k = 10;
  const same = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 30; // 3 m, in decimetres

  const lines = raw.lines.map((l) => {
    // Chain the route's ways in member order, flipping each to meet the last.
    // A chain's first way may be stored backwards; that only shows once the
    // second way meets its start, so flip it then.
    const chains: number[][][] = [];
    let cur: number[][] = [];
    let single = false;
    for (const id of l.ways) {
      const flat = raw.ways[id];
      if (!flat) continue;
      const pts: number[][] = [];
      for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
      if (cur.length && single && !same(cur.at(-1)!, pts[0]) && !same(cur.at(-1)!, pts.at(-1)!) &&
          (same(cur[0], pts[0]) || same(cur[0], pts.at(-1)!))) cur.reverse();
      if (cur.length && same(cur.at(-1)!, pts[0])) cur.push(...pts.slice(1));
      else if (cur.length && same(cur.at(-1)!, pts.at(-1)!)) cur.push(...pts.reverse().slice(1));
      else {
        if (cur.length) chains.push(cur);
        cur = pts;
        single = true;
        continue;
      }
      single = false;
    }
    if (cur.length) chains.push(cur);
    const segs = chains
      .map((c) => makeLane(Float64Array.from(c.flat(), (v) => v / k), 4, true, "bus"))
      .filter((lane) => lane.len > 80);
    return { ref: l.ref, colour: l.colour, night: l.night, segs };
  }).filter((l) => l.segs.length);

  const velib = raw.velib.map((v) => ({ x: v.p[0] / k, y: v.p[1] / k, capacity: v.cap, name: v.name }));
  const waterways = (raw.waterways ?? [])
    .map((w) => ({ name: w.name, kind: w.kind, lane: makeLane(Float64Array.from(w.p, (v) => v / k), 0, false, w.kind) }))
    .filter((w) => w.lane.len > 40);
  const squares = (raw.squares ?? []).map((q) => ({
    name: q.name,
    ring: Float64Array.from(q.p, (v) => v / k),
    holes: (q.holes ?? []).map((h) => Float64Array.from(h, (v) => v / k)),
  }));
  return { lines, velib, waterways, squares };
}
