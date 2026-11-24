import { inject } from "@vercel/analytics";
import { asset } from "./assets";
import { loadFrame, loadStreets, loadTransit, loadWorld, pacer, pointInRing, type Building, type MapFrame, type World } from "./model";
import { findAddresses, fold, queryWords, rank, type Address } from "./search";
import { LANDMARKS, TOP, slug, type Landmark } from "./landmarks";
import { buildRotView, buildRotViewPaced, drawGround, drawHighlight, drawLights, drawSlab, drawStructures, isoToWorld, occluders, pick, worldToIso, type Camera, type Glow, type Rotation, type RotView } from "./render";
import { DAY, NIGHT, type Theme } from "./theme";
import { ARRONDISSEMENTS, STREET_NAMES_ZOOM, drawStreetNames, streetNames, type StreetName } from "./labels";
import { parisNight } from "./sun";
import type { Box } from "./shapes";
import { MOVERS_ZOOM } from "./streetlife";
import { Traffic } from "./traffic";
import { Sprites } from "./sprites";
import { installExport } from "./export";
import { PaintedLayer } from "./painted";

const KIND_LABEL: Record<string, string> = {
  yes: "Building", apartments: "Apartments", church: "Church", cathedral: "Cathedral", chapel: "Chapel",
  hotel: "Hotel", office: "Offices", retail: "Shops", school: "School", university: "University",
  government: "Government", civic: "Civic building", palace: "Palace", train_station: "Former station",
  kiosk: "Kiosk", houseboat: "Houseboat", museum: "Museum",
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("map");
const ctx = canvas.getContext("2d")!;

let world: World;
/** Where things are and the outline: known within a second, long before `world`. */
let frame0: MapFrame;
/** True once `world` and `traffic` exist; until then only the painting and labels show. */
let ready = false;
const views: RotView[] = [];
// The one view angle, the one the AI painting was made for (north to the upper left).
const rotation: Rotation = 3;
let painted: PaintedLayer | null = null;
let showPainted = true;
/** Day or night: night when it's dark in Paris, unless the Night switch says otherwise. */
let theme: Theme = DAY;
const isNight = () => theme.name === "night";
let res = 1;
/** Camera with zoom in CSS pixels per iso unit; converted to canvas pixels on draw. */
const cam: Camera = { cx: 0, cy: 0, zoom: 1 };
const state = { hover: null as number | null, selected: null as number | null };
let minZoom = 0.1;
/** The painting has 2 pixels to the metre: much closer than this and it is all blur under sharp little cars. */
const MAX_ZOOM = 6;
/** Zoom from which movers are occluded building by building, in depth order. */
const OCCLUDE_ZOOM = 2;

const view = () => (views[rotation] ??= buildRotView(world, rotation));
let traffic: Traffic;

// Ground and buildings render into two oversized snapshots. Each frame blits
// the ground, draws the live layer (viaduct, cars, buses, trains), then blits
// the buildings on top so they hide vehicles behind them. While the camera
// moves and full renders are slow, the snapshots are just scaled and shifted,
// and redrawn properly once things settle.
const groundSnap = document.createElement("canvas");
const buildSnap = document.createElement("canvas");
const groundCtx = groundSnap.getContext("2d")!;
const movers = document.createElement("canvas");
const moversCtx = movers.getContext("2d")!;
const raisedLayer = document.createElement("canvas");
const raisedCtx = raisedLayer.getContext("2d")!;
const buildCtx = buildSnap.getContext("2d")!;
// At night, a third snapshot: what shines (street lamps, windows), added over the darkened painting.
const lightSnap = document.createElement("canvas");
const lightCtx = lightSnap.getContext("2d")!;
let glow: Glow | null = null;
/** The streets as two paths for their glow, built the first night. */
function nightGlow(): Glow {
  if (glow) return glow;
  glow = { major: new Path2D(), minor: new Path2D() };
  for (const l of world.streets) {
    if (l.kind === "cycleway" || l.kind === "service") continue;
    const path = l.major ? glow.major : glow.minor;
    path.moveTo(l.pts[0], l.pts[1]);
    for (let i = 2; i < l.pts.length; i += 2) path.lineTo(l.pts[i], l.pts[i + 1]);
  }
  return glow;
}

/** Turns what's on a canvas into its night self: dimmed, then tinted blue. Only where something is drawn. */
function dusk(g: CanvasRenderingContext2D, dim: number, tint: number) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = "source-atop";
  g.fillStyle = `rgba(0, 0, 0, ${dim})`;
  g.fillRect(0, 0, g.canvas.width, g.canvas.height);
  g.fillStyle = `rgba(28, 44, 130, ${tint})`;
  g.fillRect(0, 0, g.canvas.width, g.canvas.height);
  g.globalCompositeOperation = "source-over";
}

/** Street names by where they are (see labels.ts), once the city is in. */
let namesIn: ((box: Box) => StreetName[]) | null = null;
const SNAP_MARGIN = 0.2;
let snapCam: Camera | null = null;
/** Snapshot pixels per canvas pixel: under the painting the vector map is hidden, so half will do. */
let snapScale = 1;
let lastFullMs = 0;
let lastMove = 0;
let settleTimer = 0;

let frameQueued = false;
/** `camera`: only the camera moved, so a stale snapshot is acceptable for a moment. */
function requestRender(camera = false) {
  if (camera) lastMove = performance.now();
  else snapCam = null;
  if (frameQueued) return;
  frameQueued = true;
  requestAnimationFrame(frame);
}

function frame() {
  frameQueued = false;
  if (!ready) return preview();
  const moving = performance.now() - lastMove < 150;
  if (!snapCam || !moving || lastFullMs < 25 || snapshotStale(snapCam)) {
    fullRender();
  } else {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      lastMove = 0;
      requestRender(true);
    }, 160);
  }
  present();
}

/** True once the snapshot is too blurry or no longer covers the screen. */
function snapshotStale(s: Camera) {
  if (needsBuildings(cam.zoom) !== needsBuildings(s.zoom)) return true;
  // The night's lights are drawn differently from afar (see fullRender).
  if (isNight() && cam.zoom >= MOVERS_ZOOM !== s.zoom >= MOVERS_ZOOM) return true;
  const k = cam.zoom / s.zoom;
  if (k > 1.8 || k < 0.75) return true;
  const dx = Math.abs(s.cx - cam.cx) * cam.zoom;
  const dy = Math.abs(s.cy - cam.cy) * cam.zoom;
  return dx > innerWidth * SNAP_MARGIN * k || dy > innerHeight * SNAP_MARGIN * k;
}

/**
 * Under the painting, the vector buildings only cut vehicles out where they pass
 * behind one, and close up the occluders do that instead.
 */
function needsBuildings(zoom: number) {
  return !(painted && showPainted) || (zoom >= MOVERS_ZOOM && zoom < OCCLUDE_ZOOM);
}

function fullRender() {
  snapScale = painted && showPainted ? 0.5 : 1;
  const w = Math.round(canvas.width * (1 + 2 * SNAP_MARGIN) * snapScale);
  const h = Math.round(canvas.height * (1 + 2 * SNAP_MARGIN) * snapScale);
  const lights = isNight() && !!painted && showPainted;
  for (const c of lights ? [groundSnap, buildSnap, lightSnap] : [groundSnap, buildSnap]) {
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
  }
  const t = performance.now();
  const c = { ...cam, zoom: cam.zoom * res * snapScale };
  // Under the painting only the slab shows: its edges, and between the tiles.
  if (painted && showPainted) drawSlab(groundCtx, world, view(), c, theme);
  else drawGround(groundCtx, world, view(), c, theme, res * snapScale);
  if (needsBuildings(cam.zoom)) drawStructures(buildCtx, world, view(), c, theme, res * snapScale);
  else {
    buildCtx.setTransform(1, 0, 0, 1, 0, 0);
    buildCtx.clearRect(0, 0, w, h);
  }
  if (lights) drawLights(lightCtx, world, view(), c, res * snapScale, nightGlow(), cam.zoom >= MOVERS_ZOOM);
  lastFullMs = performance.now() - t;
  snapCam = { ...cam };
}

function present() {
  const s = snapCam;
  if (!s) return;
  const k = cam.zoom / s.zoom / snapScale;
  const z = cam.zoom * res;
  const blit = (g: CanvasRenderingContext2D, img: HTMLCanvasElement) => {
    g.setTransform(
      k, 0, 0, k,
      canvas.width / 2 + (s.cx - cam.cx) * z - (img.width / 2) * k,
      canvas.height / 2 + (s.cy - cam.cy) * z - (img.height / 2) * k,
    );
    g.drawImage(img, 0, 0);
  };
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  blit(ctx, groundSnap);
  // The painting covers every building; the layer still masks the movers below.
  if (!(painted && showPainted)) blit(ctx, buildSnap);
  else {
    painted.draw(ctx, { ...cam, zoom: z }, rotation);
    if (isNight()) {
      dusk(ctx, 0.56, 0.3);
      ctx.globalCompositeOperation = "lighter";
      blit(ctx, lightSnap);
      ctx.globalCompositeOperation = "source-over";
    }
  }
  traffic.showViaduct = !(painted && showPainted);

  // Moving things go on their own layer, cut away wherever the live building
  // layer has something in front of them, then on top of everything. That
  // hides them behind buildings and lets them drive over the painted area.
  if (movers.width !== canvas.width || movers.height !== canvas.height) {
    movers.width = canvas.width;
    movers.height = canvas.height;
  }
  moversCtx.setTransform(1, 0, 0, 1, 0, 0);
  moversCtx.clearRect(0, 0, movers.width, movers.height);
  const ox = canvas.width / 2 - cam.cx * z, oy = canvas.height / 2 - cam.cy * z;
  moversCtx.setTransform(z, 0, 0, z, ox, oy);
  const hw = canvas.width / 2 / z, hh = canvas.height / 2 / z;
  const rect: [number, number, number, number] = [cam.cx - hw, cam.cy - hh, cam.cx + hw, cam.cy + hh];
  const overPainting = !!painted && showPainted;
  if (cam.zoom >= OCCLUDE_ZOOM) {
    // Street names lie on the ground, under everything: every building in
    // front of a street then hides its name, and the traffic drives over it.
    if (showNames && cam.zoom >= STREET_NAMES_ZOOM && namesIn) {
      const corners = [[rect[0], rect[1]], [rect[2], rect[1]], [rect[0], rect[3]], [rect[2], rect[3]]].map(([sx, sy]) => isoToWorld(rotation, sx, sy));
      const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
      drawStreetNames(moversCtx, rotation, z, ox, oy, namesIn([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]));
      moversCtx.setTransform(z, 0, 0, z, ox, oy);
    }
    // Close up, buildings and trees are sorted in with the movers, so each
    // hides only what is behind it.
    traffic.draw(moversCtx, rotation, rect, theme, cam.zoom, null, occluders(moversCtx, world, view(), rect, 0.6), overPainting);
  } else {
    // From afar a single cut by the whole building layer is close enough, and cheap.
    traffic.draw(moversCtx, rotation, rect, theme, cam.zoom, null, [], overPainting);
    moversCtx.globalCompositeOperation = "destination-out";
    blit(moversCtx, buildSnap);
    moversCtx.globalCompositeOperation = "source-over";
  }
  if (traffic.hasRaised) {
    // Raised trains on their own layer, so the buildings that hide them don't
    // also cut what's already on the movers' layer.
    if (raisedLayer.width !== canvas.width || raisedLayer.height !== canvas.height) {
      raisedLayer.width = canvas.width;
      raisedLayer.height = canvas.height;
    }
    raisedCtx.setTransform(1, 0, 0, 1, 0, 0);
    raisedCtx.clearRect(0, 0, raisedLayer.width, raisedLayer.height);
    raisedCtx.setTransform(z, 0, 0, z, ox, oy);
    traffic.drawRaised(cam.zoom >= OCCLUDE_ZOOM ? occluders(raisedCtx, world, view(), rect, 0.6) : []);
    moversCtx.setTransform(1, 0, 0, 1, 0, 0);
    moversCtx.drawImage(raisedLayer, 0, 0);
  }
  // At night the vehicles dim with the city; their lights are bright enough to show through.
  if (isNight() && overPainting) dusk(moversCtx, 0.3, 0.12);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(movers, 0, 0);
  // The followed vehicle stays visible even behind buildings.
  if (following != null) {
    ctx.setTransform(z, 0, 0, z, ox, oy);
    traffic.draw(ctx, rotation, [cam.cx - hw, cam.cy - hh, cam.cx + hw, cam.cy + hh], theme, cam.zoom, following);
  }

  const c = { ...cam, zoom: z };
  // Over the painting, the map data's block rarely matches the painted
  // building, so tint it instead of covering it.
  const blend = painted && showPainted ? "soft-light" : "source-over";
  if (state.hover != null && state.hover !== state.selected) drawHighlight(ctx, view(), c, state.hover, theme.hover, painted && showPainted ? 0.35 : 0.4, blend);
  if (state.selected != null) drawHighlight(ctx, view(), c, state.selected, theme.selected, painted && showPainted ? 0.6 : 0.75, blend);
  drawLabels();
}

/** Before the city's data is in: just the painting and the labels. */
function preview() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (painted && showPainted) {
    painted.draw(ctx, { ...cam, zoom: cam.zoom * res }, rotation);
    if (isNight()) dusk(ctx, 0.56, 0.3);
  }
  drawLabels();
}

/** Map pins for landmarks, like the labels on a 3D map. */
function drawLabels() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `600 ${13 * res}px "Barlow Condensed", system-ui, sans-serif`;
  ctx.letterSpacing = `${0.6 * res}px`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  // The followed vehicle's tag wins; then earlier landmarks over later ones.
  const placed: [number, number, number, number][] = [];
  if (following != null) {
    const p = traffic.where(following);
    pin(p.x, p.y, p.z + 5, p.label, placed, theme.label, "#ffd27a");
  }
  for (const l of showNames ? LANDMARKS : []) {
    const [x, y] = frame0.project(l.lon, l.lat);
    pin(x, y, l.top ?? 26, l.name.toUpperCase(), placed, theme.label, theme.labelText);
  }
  // From a little way up, the arrondissements, wherever the landmarks leave them room
  // (the whole map at once is all landmarks: three numbers squeezed in between look lost).
  if (showNames && cam.zoom >= 0.3 && cam.zoom < 1.1) {
    ctx.font = `700 ${17 * res}px "Barlow Condensed", system-ui, sans-serif`;
    ctx.lineJoin = "round";
    for (const [name, lon, lat] of ARRONDISSEMENTS) {
      const [ix, iy] = worldToIso(rotation, ...frame0.project(lon, lat));
      const sx = (ix - cam.cx) * cam.zoom * res + canvas.width / 2, sy = (iy - cam.cy) * cam.zoom * res + canvas.height / 2;
      const w = ctx.measureText(name).width + 10 * res, h = 20 * res;
      const box: [number, number, number, number] = [sx - w / 2, sy - h / 2, sx + w / 2, sy + h / 2];
      if (sx < 0 || sy < 0 || sx > canvas.width || sy > canvas.height) continue;
      if (placed.some((p) => box[0] < p[2] + 4 && box[2] > p[0] - 4 && box[1] < p[3] + 4 && box[3] > p[1] - 4)) continue;
      placed.push(box);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = 3.5 * res;
      ctx.strokeText(name, sx, sy);
      ctx.fillStyle = DAY.label;
      ctx.fillText(name, sx, sy);
    }
  }
  ctx.letterSpacing = "0px";
}

/** One map pin, skipped if it would overlap a pin already placed. */
function pin(x: number, y: number, h0: number, text: string, placed: [number, number, number, number][], bg: string, fg: string) {
  const z = cam.zoom * res;
  const [ix, iy] = worldToIso(rotation, x, y, h0);
  const sx = (ix - cam.cx) * z + canvas.width / 2;
  const sy = (iy - cam.cy) * z + canvas.height / 2;
  if (sx < -100 || sy < -40 || sx > canvas.width + 100 || sy > canvas.height + 40) return;
  const w = ctx.measureText(text).width + 18 * res;
  const h = 22 * res;
  const top = sy - h - 6 * res;
  const box: [number, number, number, number] = [sx - w / 2, top, sx + w / 2, top + h];
  if (placed.some((p) => box[0] < p[2] + 4 && box[2] > p[0] - 4 && box[1] < p[3] + 4 && box[3] > p[1] - 4)) return;
  placed.push(box);
  // An enamel station plate: dark blue, a thin white line inside its edge.
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(sx - w / 2, top, w, h, 3 * res);
  ctx.moveTo(sx - 4 * res, top + h);
  ctx.lineTo(sx, top + h + 6 * res);
  ctx.lineTo(sx + 4 * res, top + h);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.lineWidth = res;
  ctx.beginPath();
  ctx.roundRect(sx - w / 2 + 2.5 * res, top + 2.5 * res, w - 5 * res, h - 5 * res, 1.5 * res);
  ctx.stroke();
  ctx.fillStyle = fg;
  ctx.fillText(text, sx, top + h / 2 + 0.5 * res);
}

let presentQueued = false;
/** Redraw highlights only, reusing the current snapshot. */
function requestPresent() {
  if (!ready) return requestRender();
  if (presentQueued || frameQueued || !snapCam) return;
  presentQueued = true;
  requestAnimationFrame(() => {
    presentQueued = false;
    present();
  });
}

/** Keeps vehicles moving. Only redraws when they are big enough to see. */
let lastTick = 0;
function tick(now: number) {
  const dt = Math.min(0.1, (now - (lastTick || now)) / 1000);
  lastTick = now;
  traffic.step(dt, following != null ? Infinity : cam.zoom);
  if (following != null) {
    // Glide after the vehicle; ease in to street-level zoom when starting.
    const p = traffic.where(following);
    const [ix, iy] = worldToIso(rotation, p.x, p.y, p.z);
    const t = Math.min(1, dt * 4);
    cam.cx += (ix - cam.cx) * t;
    cam.cy += (iy - cam.cy) * t;
    if (followZoom != null) {
      cam.zoom = Math.exp(Math.log(cam.zoom) + (Math.log(followZoom) - Math.log(cam.zoom)) * Math.min(1, dt * 2.5));
      if (Math.abs(cam.zoom / followZoom - 1) < 0.02) followZoom = null;
    }
    requestRender(true);
  } else if (cam.zoom >= MOVERS_ZOOM && !frameQueued && !document.hidden) present();
  requestAnimationFrame(tick);
}

let following: number | null = null;
let followZoom: number | null = null;

function follow(kind: "bus" | "velib" | "truck" | null) {
  if (!ready) return;
  following = kind ? traffic.pickToFollow(kind, isNight()) : null;
  followZoom = following != null ? Math.max(cam.zoom, kind === "velib" ? 5 : 4) : null;
  if (following != null) flight++;
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-follow]")) {
    b.setAttribute("aria-pressed", String(following != null && b.dataset.follow === kind));
  }
  requestPresent();
}

function resize() {
  res = Math.min(devicePixelRatio, 2);
  canvas.width = Math.round(innerWidth * res);
  canvas.height = Math.round(innerHeight * res);
  fitBounds();
  requestRender();
}

function fitBounds() {
  const ring = frame0.boundary;
  const pts = Array.from({ length: ring.length / 2 }, (_, k) => worldToIso(rotation, ring[k * 2], ring[k * 2 + 1]));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const bw = Math.max(...xs) - Math.min(...xs);
  const bh = Math.max(...ys) - Math.min(...ys) + 120;
  // On desktop the line of landmarks covers the bottom: fit the map above it.
  const below = $("line").offsetHeight ? $("line").offsetHeight + 40 : 0;
  minZoom = Math.min(innerWidth / bw, (innerHeight - below) / bh) * 0.9;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2 + 20 + below / 2 / minZoom;
  return { cx: (Math.max(...xs) + Math.min(...xs)) / 2, cy, zoom: minZoom };
}

/** The first view. A phone held upright would show the whole map as a thin
 *  strip, so it opens closer in, on central Paris. */
function startView() {
  const whole = fitBounds();
  if (innerWidth > innerHeight * 0.8) return whole;
  const [x, y] = frame0.project(2.3488, 48.8589);
  const [cx, cy] = worldToIso(rotation, x, y);
  return { cx, cy, zoom: whole.zoom * 2 };
}

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(minZoom * 0.8, z));

function zoomAt(factor: number, sx = innerWidth / 2, sy = innerHeight / 2) {
  const z = clampZoom(cam.zoom * factor);
  // Keep the iso point under the cursor fixed.
  const ix = cam.cx + (sx - innerWidth / 2) / cam.zoom;
  const iy = cam.cy + (sy - innerHeight / 2) / cam.zoom;
  cam.cx = ix - (sx - innerWidth / 2) / z;
  cam.cy = iy - (sy - innerHeight / 2) / z;
  cam.zoom = z;
  requestRender(true);
}

/** Where an eased zoom is heading, and the screen point it stays anchored at. */
let zoomGoal: { zoom: number; sx: number; sy: number } | null = null;
let zoomLast = 0;

/**
 * Zooms by `factor` over a few frames instead of in one jump: a mouse wheel's
 * notches and the zoom buttons otherwise move in visible steps. Steps taken
 * before it gets there add up.
 */
function glideZoom(factor: number, sx = innerWidth / 2, sy = innerHeight / 2) {
  flight++;
  const first = !zoomGoal;
  zoomGoal = { zoom: clampZoom((zoomGoal?.zoom ?? cam.zoom) * factor), sx, sy };
  if (!first) return;
  zoomLast = performance.now();
  const step = (now: number) => {
    if (!zoomGoal) return;
    // A fixed share of the way per 16 ms, whatever the frame rate.
    const k = zoomGoal.zoom / cam.zoom;
    const t = 1 - Math.pow(0.78, (now - zoomLast) / 16);
    zoomLast = now;
    if (Math.abs(Math.log(k)) < 0.003) {
      zoomAt(k, zoomGoal.sx, zoomGoal.sy);
      zoomGoal = null;
      return;
    }
    zoomAt(Math.pow(k, t), zoomGoal.sx, zoomGoal.sy);
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const screenToIso = (sx: number, sy: number): [number, number] => [
  cam.cx + (sx - innerWidth / 2) / cam.zoom,
  cam.cy + (sy - innerHeight / 2) / cam.zoom,
];

let flight = 0;
function flyTo(target: Camera, ms = 1100) {
  const from = { ...cam };
  const start = performance.now();
  const id = ++flight;
  zoomGoal = null;
  const step = (now: number) => {
    if (id !== flight) return;
    const t = Math.min(1, (now - start) / ms);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    cam.cx = from.cx + (target.cx - from.cx) * e;
    cam.cy = from.cy + (target.cy - from.cy) * e;
    cam.zoom = Math.exp(Math.log(from.zoom) + (Math.log(target.zoom) - Math.log(from.zoom)) * e);
    requestRender(true);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function flyToWorld(x: number, y: number, zoom: number, z = 0) {
  const [cx, cy] = worldToIso(rotation, x, y, z);
  flyTo({ cx, cy, zoom: clampZoom(zoom) });
}

if (import.meta.env.DEV) {
  // For screenshots from scripts: jump straight to a place.
  (window as unknown as { __goto: unknown }).__goto = (lon: number, lat: number, zoom: number) => {
    const [x, y] = frame0.project(lon, lat);
    [cam.cx, cam.cy] = worldToIso(rotation, x, y);
    cam.zoom = clampZoom(zoom);
    requestRender();
  };
  (window as unknown as { __train: unknown }).__train = (lon: number, lat: number, stop = true) => traffic.placeTrain(...frame0.project(lon, lat), stop);
  (window as unknown as { __select: unknown }).__select = (name: string) => showInfo(world.buildings.findIndex((b) => b.info?.name === name));
}

/** Place names on the map; the choice is remembered. */
let showNames = localStorage.getItem("tp-names") !== "off";

function toggleNames() {
  showNames = !showNames;
  localStorage.setItem("tp-names", showNames ? "on" : "off");
  $("names").setAttribute("aria-pressed", String(showNames));
  requestPresent();
}

/** "on" or "off" once the Night switch has been used, for this visit; otherwise night follows the sun over Paris. */
let nightChoice = sessionStorage.getItem("tp-night");

function applyNight() {
  const night = nightChoice ? nightChoice === "on" : parisNight(Date.now());
  $("night").setAttribute("aria-pressed", String(night));
  if (night === isNight()) return;
  theme = night ? NIGHT : DAY;
  document.body.classList.toggle("night", night);
  // A followed day bus isn't running at night, nor a Noctilien by day.
  if (following != null) follow(null);
  requestRender();
}

function toggleNight() {
  nightChoice = isNight() ? "off" : "on";
  sessionStorage.setItem("tp-night", nightChoice);
  applyNight();
}

function togglePainted() {
  showPainted = !showPainted;
  requestRender(); // the vector map underneath is drawn differently with and without it
}

/** Opens a building's card; `addr` is the address searched for, for buildings the map has none for. */
function showInfo(i: number | null, addr?: string) {
  state.selected = i;
  const card = $("info");
  if (i == null) {
    card.hidden = true;
    showPicture(undefined);
    requestPresent();
    return;
  }
  const b: Building = world.buildings[i];
  const t = b.info ?? {};
  const kind = t.building ?? "yes";
  $("info-title").textContent = t.name ?? KIND_LABEL[kind] ?? kind.replace(/_/g, " ");
  const rows: [string, string | HTMLElement][] = [];
  if (t.name) rows.push(["Type", KIND_LABEL[kind] ?? kind.replace(/_/g, " ")]);
  if (t.addr || addr) rows.push(["Address", t.addr ?? addr!]);
  // A tagged height first: some landmarks are drawn flat for the painter (the Eiffel Tower, the Grande Arche).
  const tagged = parseFloat(t.height ?? "");
  rows.push(["Height", `${Math.round(tagged || b.top)} m${t.height || t["building:levels"] ? "" : " (guessed)"}`]);
  if (t["building:levels"]) rows.push(["Floors", t["building:levels"]]);
  if (t.start_date) rows.push(["Built", t.start_date]);
  if (t.wikipedia) {
    const [lang, ...rest] = t.wikipedia.split(":");
    const a = document.createElement("a");
    a.href = `https://${rest.length ? lang : "fr"}.wikipedia.org/wiki/${encodeURIComponent(rest.length ? rest.join(":") : lang)}`;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "Wikipedia ↗";
    rows.push(["Read", a]);
  }
  showPicture(t.wikipedia);
  const dl = $("info-body");
  dl.replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.append(v);
      return [dt, dd];
    }),
  );
  card.hidden = false;
  requestPresent();
}

/** The building card's photo: its Wikipedia article's lead picture, where it has one. */
let pictureOf = "";
function showPicture(article: string | undefined) {
  const img = $<HTMLImageElement>("info-img");
  if (article === pictureOf) return;
  pictureOf = article ?? "";
  img.hidden = true;
  img.removeAttribute("src");
  if (!article) return;
  const [lang, ...rest] = article.split(":");
  const title = (rest.length ? rest.join(":") : lang).replace(/ /g, "_");
  fetch(`https://${rest.length ? lang : "fr"}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((page: { thumbnail?: { source: string; width: number; height: number } } | null) => {
      // Another building may have been opened meanwhile.
      if (pictureOf !== article || !page?.thumbnail) return;
      img.onload = () => (img.hidden = false);
      img.src = page.thumbnail.source;
    })
    .catch(() => {});
}

/** What a report is about: a building, or wherever the view is. */
let reporting: { building: string | null; lon: number; lat: number; zoom: number } | null = null;

function openReport(building: number | null) {
  const [x, y] = building != null ? [world.buildings[building].cx, world.buildings[building].cy] : isoToWorld(rotation, cam.cx, cam.cy);
  const [lon, lat] = frame0.unproject(x, y);
  const name = building != null ? $("info-title").textContent : null;
  reporting = { building: name, lon, lat, zoom: cam.zoom };
  const form = $("report") as HTMLFormElement;
  form.reset();
  $("report-about").textContent = name ? `About ${name}` : "About what's in the middle of the screen";
  $("report-status").textContent = "";
  (form.querySelector(".send") as HTMLButtonElement).disabled = false;
  $("info").hidden = true;
  form.hidden = false;
}

async function sendReport(e: SubmitEvent) {
  e.preventDefault();
  const form = e.target as HTMLFormElement, data = new FormData(form);
  const send = form.querySelector(".send") as HTMLButtonElement, status = $("report-status");
  if (data.get("kind") === "other" && !String(data.get("note")).trim()) {
    status.textContent = "Tell me what's wrong.";
    return;
  }
  send.disabled = true;
  status.textContent = "Sending…";
  const res = await fetch("/api/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...reporting, kind: data.get("kind"), note: data.get("note"), website: data.get("website") }),
  }).catch(() => null);
  if (res?.ok) {
    status.textContent = "Thanks! I'll fix it.";
    setTimeout(() => (form.hidden = true), 1600);
    return;
  }
  status.textContent = res?.status === 429 ? "Too many reports for now, try again later." : "Couldn't send it, try again.";
  send.disabled = false;
}

function wander() {
  if (!ready) return;
  const named = world.buildings.map((b, i) => (b.info?.name ? i : -1)).filter((i) => i >= 0);
  const i = named[Math.floor(Math.random() * named.length)];
  const b = world.buildings[i];
  flyToWorld(b.cx, b.cy, 4, b.h / 2);
  showInfo(i);
}

function setupInput() {
  let drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; zoom: number } | null = null;

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    flight++;
    zoomGoal = null;
    if (pointers.size === 2) {
      const [p, q] = [...pointers.values()];
      pinch = { d: Math.hypot(p.x - q.x, p.y - q.y), zoom: cam.zoom };
      drag = null;
    } else {
      drag = { x: e.clientX, y: e.clientY, cx: cam.cx, cy: cam.cy, moved: false };
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [p, q] = [...pointers.values()];
      const target = pinch.zoom * (Math.hypot(p.x - q.x, p.y - q.y) / pinch.d);
      zoomAt(target / cam.zoom, (p.x + q.x) / 2, (p.y + q.y) / 2);
      return;
    }
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      if (drag.moved) {
        if (following != null) follow(null);
        canvas.classList.add("dragging");
        cam.cx = drag.cx - dx / cam.zoom;
        cam.cy = drag.cy - dy / cam.zoom;
        requestRender(true);
      }
      return;
    }
    if (e.pointerType !== "mouse" || !ready) return;
    const hit = pick(ctx, view(), ...screenToIso(e.clientX, e.clientY));
    canvas.classList.toggle("pointing", hit != null);
    if (hit !== state.hover) {
      state.hover = hit;
      requestPresent();
    }
  });

  const end = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (drag && !drag.moved && e.type === "pointerup" && ready) {
      showInfo(pick(ctx, view(), ...screenToIso(e.clientX, e.clientY)));
    }
    drag = null;
    canvas.classList.remove("dragging");
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("pointerleave", () => {
    if (state.hover != null) {
      state.hover = null;
      requestPresent();
    }
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      flight++;
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      // A wheel's notches are big steps: ease through them. A trackpad's
      // stream of small ones is smooth already, and easing would lag it.
      if (Math.abs(delta) >= 40 || zoomGoal) glideZoom(Math.exp(-delta * 0.0018), e.clientX, e.clientY);
      else zoomAt(Math.exp(-delta * 0.0018), e.clientX, e.clientY);
    },
    { passive: false },
  );

  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Typing in the search or the report form isn't a shortcut.
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const k = e.key.toLowerCase();
    if (k === "+" || k === "=") glideZoom(1.4);
    else if (k === "-" || k === "_") glideZoom(1 / 1.4);
    // Dev only: the plain 3D map the painting was made from, to check alignment.
    else if (k === "a" && import.meta.env.DEV) togglePainted();
    else if (k === "w") wander();
    else if (k === "n") toggleNames();
    else if (k === "l") toggleNight();
    else if (k === "h") {
      follow(null);
      flyTo(fitBounds());
    }
    else if (k === "escape") {
      showInfo(null);
      follow(null);
    }
  });

  $("names").setAttribute("aria-pressed", String(showNames));
  $("names").onclick = toggleNames;
  $("night").onclick = toggleNight;
  $("zoom-in").onclick = () => glideZoom(1.5);
  $("zoom-out").onclick = () => glideZoom(1 / 1.5);
  $("home").onclick = () => {
    follow(null);
    flyTo(fitBounds());
  };
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-follow]")) {
    const kind = b.dataset.follow as "bus" | "velib" | "truck";
    b.onclick = () => follow(b.getAttribute("aria-pressed") === "true" ? null : kind);
  }
  $("wander").onclick = wander;
  $("info-close").onclick = () => showInfo(null);
  $("info-report").onclick = () => openReport(state.selected);
  $("report-view").onclick = () => openReport(null);
  $("report-close").onclick = () => ($("report").hidden = true);
  ($("report") as HTMLFormElement).onsubmit = sendReport;
  // Phones show only the plaque; it opens the ticket.
  $("title-more").onclick = () => {
    const open = $("title-more").getAttribute("aria-expanded") !== "true";
    $("title-more").setAttribute("aria-expanded", String(open));
    document.querySelector(".title")!.classList.toggle("open", open);
  };
  addEventListener("resize", resize);
}

function togglePlaces(open: boolean) {
  $("places").classList.toggle("open", open);
  $("places-body").hidden = !open;
  $("places-toggle").setAttribute("aria-expanded", String(open));
  // Straight into the search box, except on touch screens, where it would pop the keyboard up over the list.
  if (open && matchMedia("(pointer: fine)").matches) $("search").focus();
}

function goTo(l: Landmark) {
  const [x, y] = frame0.project(l.lon, l.lat);
  showInfo(null);
  follow(null);
  togglePlaces(false);
  flyToWorld(x, y, l.zoom, l.z ?? 10);
  for (const b of document.querySelectorAll(".line-track button")) b.toggleAttribute("aria-current", b.getAttribute("data-name") === l.name);
}

/** Flies to a building and opens its card. */
function goToBuilding(i: number) {
  const b = world.buildings[i];
  follow(null);
  togglePlaces(false);
  flyToWorld(b.cx, b.cy, 4, b.h / 2);
  showInfo(i);
}

/** Flies to an address, and opens the card of the building it's in, if any. */
function goToAddress(a: Address) {
  const [x, y] = frame0.project(a.lon, a.lat);
  follow(null);
  togglePlaces(false);
  const i = ready ? world.buildings.findIndex((b) => Math.abs(b.cx - x) < 150 && Math.abs(b.cy - y) < 150 && pointInRing(x, y, b.rings[0])) : -1;
  flyToWorld(x, y, a.zoom, i >= 0 ? world.buildings[i].h / 2 : 0);
  showInfo(i >= 0 ? i : null, a.house ? a.label : undefined);
}

interface Hit {
  label: string;
  note: string;
  go: () => void;
}

/** The buildings with a name or an address, folded for search; built on the first search after the city loads. */
let named: { i: number; text: string }[] | null = null;

function searchMap(words: string[]): Hit[] {
  const landmarks = LANDMARKS.map((l) => ({ l, r: rank(fold(l.name), words) })).filter((h) => h.r != null).sort((a, b) => a.r! - b.r!);
  const hits: Hit[] = landmarks.map(({ l }) => ({ label: l.name, note: l.note, go: () => goTo(l) }));
  if (!ready) return hits;
  named ??= world.buildings.flatMap((b, i) => (b.info?.name || b.info?.addr ? [{ i, text: fold(`${b.info.name ?? ""} ${b.info.addr ?? ""}`) }] : []));
  const shown = new Set(landmarks.map(({ l }) => fold(l.name)));
  const buildings = named.map((n) => ({ i: n.i, r: rank(n.text, words) })).filter((h) => h.r != null).sort((a, b) => a.r! - b.r!);
  for (const { i } of buildings) {
    const t = world.buildings[i].info!;
    const label = t.name ?? t.addr!;
    if (shown.has(fold(label))) continue;
    shown.add(fold(label));
    hits.push({ label, note: (t.name && t.addr) || (KIND_LABEL[t.building ?? "yes"] ?? ""), go: () => goToBuilding(i) });
    if (hits.length >= 12) break;
  }
  return hits;
}

/** Fills the Go to list: every landmark, or what matches the search. */
function showHits(hits: Hit[] | null, searching = false) {
  const ul = $("landmarks");
  const items = (hits ?? LANDMARKS.map((l) => ({ label: l.name, note: l.note, go: () => goTo(l) }))).map((h) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    const note = document.createElement("small");
    note.textContent = h.note;
    btn.append(h.label, " ", note);
    btn.onclick = h.go;
    li.append(btn);
    return li;
  });
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "none";
    li.textContent = searching ? "Searching…" : ready ? "Nothing here by that name" : "Still loading the city…";
    items.push(li);
  }
  ul.replaceChildren(...items);
}

function setupSearch() {
  const input = $<HTMLInputElement>("search");
  let asked: AbortController | null = null;
  let timer = 0;
  const update = () => {
    const q = input.value.trim(), words = queryWords(q);
    asked?.abort();
    clearTimeout(timer);
    if (!words.length) return showHits(null);
    const local = searchMap(words);
    // Addresses need a few letters, and a pause in the typing.
    const lookUp = q.length >= 3;
    showHits(local, lookUp);
    if (!lookUp) return;
    const ask = (asked = new AbortController());
    timer = setTimeout(async () => {
      const near = frame0.unproject(...isoToWorld(rotation, cam.cx, cam.cy));
      const found = await findAddresses(q, near, ask.signal).catch(() => []);
      if (ask.signal.aborted) return;
      const shown = new Set(local.map((h) => fold(h.label)));
      const addresses = found.filter((a) => {
        const [x, y] = frame0.project(a.lon, a.lat);
        if (!pointInRing(x, y, frame0.boundary) || shown.has(fold(a.label))) return false;
        shown.add(fold(a.label));
        return true;
      });
      showHits([...local.slice(0, addresses.length ? 8 : 12), ...addresses.map((a) => ({ label: a.label, note: a.note, go: () => goToAddress(a) }))]);
    }, 250);
  };
  input.addEventListener("input", update);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") ($("landmarks").querySelector("button") as HTMLButtonElement | null)?.click();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      ($("landmarks").querySelector("button") as HTMLButtonElement | null)?.focus();
    } else if (e.key === "Escape") {
      if (input.value) {
        input.value = "";
        update();
      } else togglePlaces(false);
    }
  });
  // Up and down through the results; up from the first goes back to the box.
  $("landmarks").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = [...$("landmarks").querySelectorAll("button")];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement) + (e.key === "ArrowDown" ? 1 : -1);
    (at < 0 ? input : buttons[Math.min(at, buttons.length - 1)]).focus();
  });
}

function setupLandmarks() {
  $("places-toggle").onclick = () => togglePlaces(!$("places").classList.contains("open"));
  showHits(null);
  setupSearch();
  setupLine();
}

/** The desktop strip: a picture of each of the ten best-known landmarks. */
function setupLine() {
  const track = $("line-track");
  for (const l of TOP) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.dataset.name = l.name;
    const img = document.createElement("img");
    Object.assign(img, { src: asset(`/thumbs/${slug(l.name)}.webp`), alt: "", width: 104, height: 70, decoding: "async" });
    const name = document.createElement("span");
    name.textContent = l.name;
    btn.append(img, name);
    btn.onclick = () => goTo(l);
    li.append(btn);
    track.append(li);
  }
  // On narrower screens it scrolls; a mouse wheel scrolls it sideways.
  track.addEventListener(
    "wheel",
    (e) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      track.scrollLeft += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    },
    { passive: false },
  );
}

/** The loading plaque: download progress, then the build step, then gone. */
function showLoading(f: number | null) {
  const el = $("loading");
  if (f == null) {
    el.classList.add("done");
    setTimeout(() => (el.hidden = true), 400);
    return;
  }
  (el.querySelector(".bar i") as HTMLElement).style.width = `${Math.round(f * 100)}%`;
  el.querySelector(".what")!.textContent = f < 1 ? `Downloading the city · ${Math.round(f * 100)}%` : "Building 100,000 buildings…";
}

/**
 * The pill shown while the city loads behind the painting: download progress
 * (0–1), then building (1), then starting the traffic (2), then gone (null).
 */
function showStreets(f: number | null) {
  const el = $("streets");
  if (f == null) {
    el.classList.add("done");
    setTimeout(() => (el.hidden = true), 400);
    return;
  }
  el.hidden = false;
  el.querySelector(".t")!.textContent = f < 1 ? "Loading streets & traffic" : f < 2 ? "Building the city" : "Starting the traffic";
  el.querySelector(".pct")!.textContent = f < 1 ? `${Math.round(f * 100)}%` : "";
}

// Vercel Web Analytics: page views, no cookies.
inject();

async function main() {
  // The painting first: its manifest and the outline are a few kB, so the map
  // shows in a second; the city's data (13 MB) follows for traffic and clicks.
  [frame0, painted] = await Promise.all([loadFrame(asset("/data/paris-meta.json")), PaintedLayer.load(() => requestPresent())]);
  applyNight();
  setInterval(applyNight, 60_000);
  resize();
  Object.assign(cam, startView());
  setupInput();
  setupLandmarks();
  // Labels are drawn on the canvas: redraw once the web fonts are in.
  document.fonts.ready.then(() => requestPresent());
  requestRender();
  if (painted) {
    // Let the first view's chunks have the connection to themselves.
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    await Promise.race([painted.settled(), new Promise((r) => setTimeout(r, 4000))]);
    showLoading(null);
  }

  // One-way streets, names, lights and stops: small, and both loaders want it.
  const streets = loadStreets(asset("/data/paris-streets.json"));
  const [w, transit, pois] = await Promise.all([
    streets.then((st) => loadWorld(asset("/data/paris.bin"), (f) => (painted ? showStreets(f) : showLoading(f)), st)),
    streets.then((st) => loadTransit(asset("/data/paris-transit.json"), st)),
    fetch(asset("/data/paris-pois.json")).then((r) => (r.ok ? r.json() : { cafes: [] })).catch(() => ({ cafes: [] })),
  ]);
  transit.cafes = (pois.cafes as [number, number, number, number][]).map(([x, y, kind, out]) => [x / 10, y / 10, kind, out]);
  world = w;
  if (new URLSearchParams(location.search).has("export")) installExport(world);
  showStreets(2);
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  // What's left is a second of work on a phone: in slices, so the map never freezes.
  const pace = pacer();
  traffic = new Traffic(world, transit);
  await traffic.build(pace);
  views[rotation] = await buildRotViewPaced(world, rotation, pace);
  namesIn = streetNames(world);
  Sprites.load().then((sp) => traffic.setSprites(sp));
  const n = traffic.count;
  const fmt = (v: number) => v.toLocaleString("en");
  $("stats").textContent =
    `${fmt(world.buildings.length)} buildings · ${fmt(n.cars)} cars · ${fmt(n.buses)} buses on ${n.lines} RATP lines · ` +
    `${fmt(n.bikes)} bikes · ${fmt(n.stations)} Vélib' stations · ${n.trucks} garbage trucks · ${n.trains} métros`;
  ready = true;
  // A search typed while the city loaded can now find its buildings.
  if ($<HTMLInputElement>("search").value) $("search").dispatchEvent(new Event("input"));
  requestRender();
  requestAnimationFrame(tick);
  showLoading(null);
  showStreets(null);
}

main().catch((err) => {
  $("stats").textContent = `Could not load the map: ${err.message}`;
  console.error(err);
});
