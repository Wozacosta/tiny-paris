// Downloads IGN aerial photos (BD ORTHO) and LiDAR HD heights above ground
// (MNH), both Etalab open licence, as tiles aligned to the map's world metres,
// for texturing and shaping the base render.
//   node scripts/paint/0-ortho.mjs
// Writes paint/ortho/<i>_<j>.jpg (25 cm), <i>_<j>.u16 (50 cm, little-endian
// decimetres above ground) and paint/ortho/index.json.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DIR } from "./common.mjs";

const SIDE = 512; // metres per tile
const PX = 2048; // photo pixels per tile: 25 cm
const HPX = 1024; // height samples per tile: 50 cm, LiDAR HD's grid

const raw = JSON.parse(await readFile("public/data/northeast.json", "utf8"));
const { s, w, n, e } = raw.bbox;
const [W, H] = raw.size;
// Same projection as the app (src/model.ts).
const lat0 = (s + n) / 2, lon0 = (w + e) / 2, R = 6378137;
const kx = (Math.PI / 180) * R * Math.cos((lat0 * Math.PI) / 180), ky = (Math.PI / 180) * R;
const x0 = -W / 2, y0 = -H / 2;
const cols = Math.ceil(W / SIDE), rows = Math.ceil(H / SIDE);

const out = `${DIR}/ortho`;
await mkdir(out, { recursive: true });
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
