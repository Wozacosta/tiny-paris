import { inject } from "@vercel/analytics";
import { loadTransit, loadWorld, type Building, type World } from "./model";
import { LANDMARKS } from "./landmarks";
import { buildRotView, drawGround, drawHighlight, drawStructures, occluders, pick, worldToIso, type Camera, type Rotation, type RotView } from "./render";
import { DAY, NIGHT, type Theme } from "./theme";
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
const views: RotView[] = [];
// The one view angle, the one the AI painting was made for (north to the upper left).
const rotation: Rotation = 3;
let painted: PaintedLayer | null = null;
let showPainted = true;
let theme: Theme = DAY;
let res = 1;
/** Camera with zoom in CSS pixels per iso unit; converted to canvas pixels on draw. */
const cam: Camera = { cx: 0, cy: 0, zoom: 1 };
const state = { hover: null as number | null, selected: null as number | null };
let minZoom = 0.1;
const MAX_ZOOM = 14;
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
const buildCtx = buildSnap.getContext("2d")!;
const SNAP_MARGIN = 0.2;
let snapCam: Camera | null = null;
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
  const k = cam.zoom / s.zoom;
  if (k > 1.8 || k < 0.75) return true;
  const dx = Math.abs(s.cx - cam.cx) * cam.zoom;
  const dy = Math.abs(s.cy - cam.cy) * cam.zoom;
  return dx > innerWidth * SNAP_MARGIN * k || dy > innerHeight * SNAP_MARGIN * k;
}

function fullRender() {
  const w = Math.round(canvas.width * (1 + 2 * SNAP_MARGIN));
  const h = Math.round(canvas.height * (1 + 2 * SNAP_MARGIN));
  for (const c of [groundSnap, buildSnap]) {
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
  }
  const t = performance.now();
  const c = { ...cam, zoom: cam.zoom * res };
  drawGround(groundCtx, world, view(), c, theme, res);
  drawStructures(buildCtx, world, view(), c, theme, res);
  lastFullMs = performance.now() - t;
  snapCam = { ...cam };
}

function present() {
  const s = snapCam;
  if (!s) return;
  const k = cam.zoom / s.zoom;
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
  blit(ctx, buildSnap);
  if (painted && showPainted) painted.draw(ctx, { ...cam, zoom: z }, rotation);
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
  if (cam.zoom >= OCCLUDE_ZOOM) {
    // Close up, buildings and trees are sorted in with the movers, so each
    // hides only what is behind it.
    traffic.draw(moversCtx, rotation, rect, theme, cam.zoom, null, occluders(moversCtx, world, view(), rect, 0.6));
  } else {
    // From afar a single cut by the whole building layer is close enough, and cheap.
    traffic.draw(moversCtx, rotation, rect, theme, cam.zoom);
    moversCtx.globalCompositeOperation = "destination-out";
    blit(moversCtx, buildSnap);
    moversCtx.globalCompositeOperation = "source-over";
  }
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
  for (const l of LANDMARKS) {
    const [x, y] = world.project(l.lon, l.lat);
    pin(x, y, l.top ?? 26, l.name.toUpperCase(), placed, theme.label, theme.labelText);
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
  traffic.step(dt);
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
  } else if (cam.zoom >= 0.55 && !frameQueued && !document.hidden) present();
  requestAnimationFrame(tick);
}

let following: number | null = null;
let followZoom: number | null = null;

function follow(kind: "bus" | "velib" | "truck" | null) {
  following = kind ? traffic.pickToFollow(kind, theme === NIGHT) : null;
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
  const ring = world.boundary;
  const pts = Array.from({ length: ring.length / 2 }, (_, k) => worldToIso(rotation, ring[k * 2], ring[k * 2 + 1]));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const bw = Math.max(...xs) - Math.min(...xs);
  const bh = Math.max(...ys) - Math.min(...ys) + 120;
  minZoom = Math.min(innerWidth / bw, innerHeight / bh) * 0.9;
  return { cx: (Math.max(...xs) + Math.min(...xs)) / 2, cy: (Math.max(...ys) + Math.min(...ys)) / 2 + 20, zoom: minZoom };
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

const screenToIso = (sx: number, sy: number): [number, number] => [
  cam.cx + (sx - innerWidth / 2) / cam.zoom,
  cam.cy + (sy - innerHeight / 2) / cam.zoom,
];

let flight = 0;
function flyTo(target: Camera, ms = 1100) {
  const from = { ...cam };
  const start = performance.now();
  const id = ++flight;
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
    const [x, y] = world.project(lon, lat);
    [cam.cx, cam.cy] = worldToIso(rotation, x, y);
    cam.zoom = clampZoom(zoom);
    requestRender();
  };
  (window as unknown as { __select: unknown }).__select = (name: string) => showInfo(world.buildings.findIndex((b) => b.info?.name === name));
}

function setTheme(t: Theme) {
  theme = t;
  document.body.classList.toggle("night", t === NIGHT);
  $("theme").setAttribute("aria-pressed", String(t === NIGHT));
  requestRender();
}

function togglePainted() {
  showPainted = !showPainted;
  $("painted").setAttribute("aria-pressed", String(showPainted));
  requestPresent();
}

function showInfo(i: number | null) {
  state.selected = i;
  const card = $("info");
  if (i == null) {
    card.hidden = true;
    requestPresent();
    return;
  }
  const b: Building = world.buildings[i];
  const t = b.info ?? {};
  const kind = t.building ?? "yes";
  $("info-title").textContent = t.name ?? KIND_LABEL[kind] ?? kind.replace(/_/g, " ");
  const rows: [string, string | HTMLElement][] = [];
  if (t.name) rows.push(["Type", KIND_LABEL[kind] ?? kind.replace(/_/g, " ")]);
  if (t.addr) rows.push(["Address", t.addr]);
  rows.push(["Height", `${Math.round(b.top)} m${t.height || t["building:levels"] ? "" : " (guessed)"}`]);
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

function wander() {
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
    if (e.pointerType !== "mouse") return;
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
    if (drag && !drag.moved && e.type === "pointerup") {
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
      zoomAt(Math.exp(-delta * 0.0018), e.clientX, e.clientY);
    },
    { passive: false },
  );

  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "+" || k === "=") zoomAt(1.4);
    else if (k === "-" || k === "_") zoomAt(1 / 1.4);
    else if (k === "n") setTheme(theme === DAY ? NIGHT : DAY);
    else if (k === "a") togglePainted();
    else if (k === "w") wander();
    else if (k === "h") {
      follow(null);
      flyTo(fitBounds());
    }
    else if (k === "escape") {
      showInfo(null);
      follow(null);
    }
  });

  $("zoom-in").onclick = () => zoomAt(1.5);
  $("zoom-out").onclick = () => zoomAt(1 / 1.5);
  $("theme").onclick = () => setTheme(theme === DAY ? NIGHT : DAY);
  $("painted").onclick = togglePainted;
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
  addEventListener("resize", resize);
}

function togglePlaces(open: boolean) {
  $("places").classList.toggle("open", open);
  $("places-body").hidden = !open;
  $("places-toggle").setAttribute("aria-expanded", String(open));
}

function setupLandmarks() {
  $("places-toggle").onclick = () => togglePlaces(!$("places").classList.contains("open"));
  const ul = $("landmarks");
  for (const l of LANDMARKS) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.innerHTML = `${l.name} <small>${l.note}</small>`;
    btn.onclick = () => {
      const [x, y] = world.project(l.lon, l.lat);
      showInfo(null);
      follow(null);
      togglePlaces(false);
      flyToWorld(x, y, l.zoom, l.z ?? 10);
    };
    li.append(btn);
    ul.append(li);
  }
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

// Vercel Web Analytics: page views, no cookies.
inject();

async function main() {
  const [w, transit, pois] = await Promise.all([
    loadWorld("/data/paris.json", "/data/paris-bdtopo.json", showLoading),
    loadTransit("/data/paris-transit.json"),
    fetch("/data/paris-pois.json").then((r) => (r.ok ? r.json() : { cafes: [] })).catch(() => ({ cafes: [] })),
  ]);
  transit.cafes = (pois.cafes as [number, number, number, number][]).map(([x, y, kind, out]) => [x / 10, y / 10, kind, out]);
  world = w;
  if (new URLSearchParams(location.search).has("export")) installExport(world);
  traffic = new Traffic(world, transit);
  Sprites.load().then((sp) => traffic.setSprites(sp));
  painted = await PaintedLayer.load(() => requestPresent());
  $("painted").hidden = !painted;
  const n = traffic.count;
  const fmt = (v: number) => v.toLocaleString("en");
  $("stats").textContent =
    `${fmt(world.buildings.length)} buildings · ${fmt(n.cars)} cars · ${fmt(n.buses)} buses on ${n.lines} RATP lines · ` +
    `${fmt(n.bikes)} bikes · ${n.stations} Vélib' · ${n.trucks} bennes · ${n.trains} métros`;
  resize();
  Object.assign(cam, fitBounds());
  setupInput();
  setupLandmarks();
  // Labels are drawn on the canvas: redraw once the web fonts are in.
  document.fonts.ready.then(() => requestPresent());
  requestRender();
  requestAnimationFrame(tick);
  showLoading(null);
}

main().catch((err) => {
  $("stats").textContent = `Could not load the map: ${err.message}`;
  console.error(err);
});
