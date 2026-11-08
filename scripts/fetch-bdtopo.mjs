// Fetches IGN BD TOPO buildings (height, floors, wall/roof materials, year)
// for the map area into public/data/paris-bdtopo.json, keyed by footprint
// centroid so the client can match them to OSM buildings.
//
//   node scripts/fetch-bdtopo.mjs
//
// Source: IGN BD TOPO®, Licence Ouverte Etalab 2.0.

import { writeFile } from "node:fs/promises";
import { BBOX, inParis, proj } from "./geo.mjs";

const WFS = "https://data.geopf.fr/wfs/ows";
const PROPS = ["nombre_d_etages", "hauteur", "materiaux_des_murs", "materiaux_de_la_toiture", "date_d_apparition", "usage_1", "geometrie"];
const PAGE = 5000;

const out = [];
for (let start = 0; ; start += PAGE) {
  const url = new URL(WFS);
  Object.entries({
    SERVICE: "WFS", VERSION: "2.0.0", REQUEST: "GetFeature",
    TYPENAMES: "BDTOPO_V3:batiment", OUTPUTFORMAT: "application/json", SRSNAME: "EPSG:4326",
    BBOX: `${BBOX.w},${BBOX.s},${BBOX.e},${BBOX.n},EPSG:4326`,
    PROPERTYNAME: PROPS.join(","), COUNT: String(PAGE), STARTINDEX: String(start), SORTBY: "cleabs",
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`wfs ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const page = await res.json();
  for (const f of page.features) {
    const p = f.properties;
    const ring = f.geometry?.coordinates?.[0]?.[0];
    if (!ring?.length) continue;
    let lon = 0, lat = 0;
    for (const [x, y] of ring) { lon += x; lat += y; }
    if (!inParis(lon / ring.length, lat / ring.length)) continue;
    const [x, y] = proj(lon / ring.length, lat / ring.length);
    const year = parseInt(p.date_d_apparition) || 0;
    out.push([x, y, p.hauteur ?? 0, p.nombre_d_etages ?? 0, p.materiaux_des_murs ?? "", p.materiaux_de_la_toiture ?? "", year]);
  }
  process.stdout.write(`\r${out.length} buildings`);
  if (page.features.length < PAGE) break;
}

const json = JSON.stringify({ fields: ["x", "y", "height", "floors", "walls", "roof", "year"], rows: out });
await writeFile("public/data/paris-bdtopo.json", json);
const has = (i, ok) => out.filter((r) => ok(r[i])).length;
console.log(
  `\nwrote public/data/paris-bdtopo.json (${(json.length / 1e6).toFixed(1)} MB): ` +
    `height ${has(2, (v) => v > 0)}, floors ${has(3, (v) => v > 0)}, walls ${has(4, (v) => v && v !== "00")}, ` +
    `roof ${has(5, (v) => v && v !== "00")}, year ${has(6, (v) => v > 0)} of ${out.length}`,
);
