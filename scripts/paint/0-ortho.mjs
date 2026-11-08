// Downloads IGN aerial photos (BD ORTHO) and LiDAR HD heights above ground
// (MNH), both Etalab open licence, as tiles aligned to the map's world metres,
// for texturing and shaping the base render.
//   node scripts/paint/0-ortho.mjs
// Writes paint/ortho/<i>_<j>.jpg (25 cm), <i>_<j>.u16 (50 cm, little-endian
// decimetres above ground) and paint/ortho/index.json.

import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { DIR } from "./common.mjs";

const SIDE = 512; // metres per tile
const PX = 2048; // photo pixels per tile: 25 cm
const HPX = 1024; // height samples per tile: 50 cm, LiDAR HD's grid

const raw = JSON.parse(await readFile("public/data/paris.json", "utf8"));
// Same projection as the app (src/model.ts).
const lat0 = raw.origin.lat, lon0 = raw.origin.lon, R = 6378137;
const kx = (Math.PI / 180) * R * Math.cos((lat0 * Math.PI) / 180), ky = (Math.PI / 180) * R;
// The tile grid stays aligned to the first map's, whose corner was
// (-2562.5, -2226.5) m, so tiles already downloaded keep their place.
const [bx0, by0, bx1, by1] = raw.bounds;
const AX = -2562.5, AY = -2226.5;
const x0 = AX - Math.ceil((AX - bx0) / SIDE) * SIDE, y0 = AY - Math.ceil((AY - by0) / SIDE) * SIDE;
const cols = Math.ceil((bx1 - x0) / SIDE), rows = Math.ceil((by1 - y0) / SIDE);
// Tiles of the first map, named from its corner, renamed to this grid.
const shiftI = Math.round((AX - x0) / SIDE), shiftJ = Math.round((AY - y0) / SIDE);
const out = `${DIR}/ortho`;
await mkdir(out, { recursive: true });
const prev = existsSync(`${out}/index.json`) ? JSON.parse(await readFile(`${out}/index.json`, "utf8")) : null;
if (prev && (prev.x0 !== x0 || prev.y0 !== y0)) {
  if (prev.x0 !== AX || prev.y0 !== AY) throw new Error("paint/ortho has an unexpected grid; delete it to start over");
  // Highest first, so a rename never lands on a tile not yet moved.
  const old = [];
  for (let j = 0; j < prev.rows; j++) for (let i = 0; i < prev.cols; i++) old.push([i, j]);
  old.sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  for (const [i, j] of old) for (const ext of ["jpg", "u16"]) {
    if (existsSync(`${out}/${i}_${j}.${ext}`)) await rename(`${out}/${i}_${j}.${ext}`, `${out}/${i + shiftI}_${j + shiftJ}.${ext}`);
  }
  await writeFile(`${out}/index.json`, JSON.stringify({ ...prev, x0, y0, cols, rows }));
  console.log(`moved the first map's tiles by ${shiftI}, ${shiftJ}`);
}
let done = 0;
const jobs = [];
for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) jobs.push([i, j]);
const WMS = "https://data.geopf.fr/wms-r/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&STYLES=&CRS=EPSG:4326";

async function get(url, type) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url);
    const got = res.headers.get("content-type") ?? "";
    if (res.ok && got.startsWith(type)) return Buffer.from(await res.arrayBuffer());
    if (attempt === 5) throw new Error(`${res.status} ${got}: ${url}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

async function fetchTile([i, j]) {
  const xa = x0 + i * SIDE, ya = y0 + j * SIDE;
  const lonA = lon0 + xa / kx, lonB = lon0 + (xa + SIDE) / kx;
  const latN = lat0 - ya / ky, latS = lat0 - (ya + SIDE) / ky;
  const box = `&BBOX=${latS},${lonA},${latN},${lonB}`;
  const photo = `${out}/${i}_${j}.jpg`;
  if (!existsSync(photo)) {
    await writeFile(photo, await get(`${WMS}&LAYERS=ORTHOIMAGERY.ORTHOPHOTOS${box}&WIDTH=${PX}&HEIGHT=${PX}&FORMAT=image/jpeg`, "image/"));
  }
  const height = `${out}/${i}_${j}.u16`;
  if (!existsSync(height)) {
    const raw = await get(
      `${WMS}&LAYERS=IGNF_LIDAR-HD_MNH_ELEVATION.ELEVATIONGRIDCOVERAGE.WGS84G${box}&WIDTH=${HPX}&HEIGHT=${HPX}&FORMAT=image/x-bil;bits=32`,
      "image/x-bil",
    );
    const f = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
    const dm = new Uint16Array(f.length);
    for (let k = 0; k < f.length; k++) dm[k] = Number.isFinite(f[k]) ? Math.max(0, Math.min(65535, Math.round(f[k] * 10))) : 0;
    await writeFile(height, Buffer.from(dm.buffer));
  }
  process.stdout.write(`\r${++done}/${jobs.length}`);
}
for (let k = 0; k < jobs.length; k += 4) await Promise.all(jobs.slice(k, k + 4).map(fetchTile));
await writeFile(`${out}/index.json`, JSON.stringify({ side: SIDE, px: PX, hpx: HPX, x0, y0, cols, rows }));
console.log(`\n${cols}×${rows} tiles in ${out}`);
