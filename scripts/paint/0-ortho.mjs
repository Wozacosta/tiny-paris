// Downloads IGN aerial photos (BD ORTHO, Etalab open licence) of the map area,
// as tiles aligned to the map's world metres, for texturing the base render.
//   node scripts/paint/0-ortho.mjs
// Writes paint/ortho/<i>_<j>.jpg and paint/ortho/index.json.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DIR } from "./common.mjs";

const SIDE = 512; // metres per tile
const PX = 2048; // pixels per tile: 25 cm per pixel

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
async function fetchTile([i, j]) {
  const file = `${out}/${i}_${j}.jpg`;
  if (existsSync(file)) return;
  const xa = x0 + i * SIDE, ya = y0 + j * SIDE;
  const lonA = lon0 + xa / kx, lonB = lon0 + (xa + SIDE) / kx;
  const latN = lat0 - ya / ky, latS = lat0 - (ya + SIDE) / ky;
  const url =
    "https://data.geopf.fr/wms-r/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=ORTHOIMAGERY.ORTHOPHOTOS&STYLES=" +
    `&CRS=EPSG:4326&BBOX=${latS},${lonA},${latN},${lonB}&WIDTH=${PX}&HEIGHT=${PX}&FORMAT=image/jpeg`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url);
    const type = res.headers.get("content-type") ?? "";
    if (res.ok && type.startsWith("image/")) {
      await writeFile(file, Buffer.from(await res.arrayBuffer()));
      break;
    }
    if (attempt === 5) throw new Error(`${i}_${j}: ${res.status} ${type}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  process.stdout.write(`\r${++done}/${jobs.length}`);
}
for (let k = 0; k < jobs.length; k += 4) await Promise.all(jobs.slice(k, k + 4).map(fetchTile));
await writeFile(`${out}/index.json`, JSON.stringify({ side: SIDE, px: PX, x0, y0, cols, rows }));
console.log(`\n${cols}×${rows} tiles in ${out}`);
