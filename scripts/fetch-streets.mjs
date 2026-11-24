// What the streets need beyond their shape: which are one-way, what they're
// called, where the traffic lights are, and where buses and métros stop.
//   node scripts/fetch-streets.mjs   (after fetch-osm.mjs, from the same extract)
// Writes public/data/paris-streets.json. It's a file of its own so that adding
// to it never touches paris.json, which the painting is aligned to: roads are
// referred to by their index there, and the script checks they still match.
// Data © OpenStreetMap contributors, ODbL.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { inParis, proj } from "./geo.mjs";

const DIR = "paint/osm";
const world = JSON.parse(readFileSync("public/data/paris.json", "utf8"));

// The same walk over the extract as fetch-osm.mjs, keeping each road's tags.
const NAMED = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "pedestrian"]);
const oneway = [], onewayBack = [], names = [], nameIds = new Map(), named = [];
let ri = 0;
for (const line of readFileSync(`${DIR}/paris.geojsonseq`, "utf8").split("\x1e")) {
  if (!line.includes('"LineString"')) continue;
  const f = JSON.parse(line);
  if (f.geometry.type !== "LineString") continue;
  const t = f.properties, coords = f.geometry.coordinates;
  // (A line tagged as a building is kept by its centre, as fetch-osm.mjs does.)
  const inside = t.building
    ? inParis(coords.reduce((a, p) => a + p[0], 0) / coords.length, coords.reduce((a, p) => a + p[1], 0) / coords.length)
    : coords.some(([lon, lat]) => inParis(lon, lat));
  if (!inside || coords.length < 2) continue;
  if (t.railway === "subway") continue;
  if (t.railway) {
    if (t.tunnel !== "yes" && t.covered !== "yes") ri++;
    continue;
  }
  if (!t.highway || t.area === "yes" || t.tunnel === "yes" || t.covered === "yes") continue;
  const road = world.roads[ri];
  const [x, y] = proj(...coords[0]);
  if (!road || road.k !== t.highway || road.p[0] !== x || road.p[1] !== y || road.p.length !== coords.length * 2) {
    throw new Error(`road ${ri} no longer matches paris.json: was the extract replaced? Run fetch-osm.mjs (and repaint) first.`);
  }
  const back = t.oneway === "-1" || t.oneway === "reverse";
  if (back) onewayBack.push(ri);
  else if (t.oneway === "yes" || t.oneway === "1" || t.oneway === "true" || t.junction === "roundabout" || t.junction === "circular" || (t.highway === "motorway" && t.oneway !== "no")) oneway.push(ri);
  if (t.name && NAMED.has(t.highway)) {
    if (!nameIds.has(t.name)) nameIds.set(t.name, names.push(t.name) - 1);
    named.push(ri, nameIds.get(t.name));
  }
  ri++;
}
if (ri !== world.roads.length) throw new Error(`walked ${ri} roads, paris.json has ${world.roads.length}`);

// Points: traffic lights, and the stop positions on the street or the track.
execFileSync("osmium", ["tags-filter", "-O", "-o", `${DIR}/points.osm.pbf`, `${DIR}/paris.osm.pbf`,
  "n/highway=traffic_signals", "n/public_transport=stop_position", "n/railway=stop"], { stdio: ["ignore", "ignore", "inherit"] });
execFileSync("osmium", ["export", "-O", "-f", "geojsonseq", "--geometry-types=point", "-o", `${DIR}/points.geojsonseq`, `${DIR}/points.osm.pbf`], { stdio: ["ignore", "ignore", "inherit"] });
const signals = [], busStops = [], metroStops = [];
const m = 0.004; // stops just off the map still belong to lines that run on it
for (const line of readFileSync(`${DIR}/points.geojsonseq`, "utf8").split("\x1e")) {
  if (!line.trim()) continue;
  const f = JSON.parse(line), t = f.properties, [lon, lat] = f.geometry.coordinates;
  if (![[0, 0], [m, 0], [-m, 0], [0, m], [0, -m]].some(([a, b]) => inParis(lon + a, lat + b))) continue;
  const p = proj(lon, lat);
  if (t.highway === "traffic_signals") signals.push(...p);
  else if (t.subway === "yes" || t.station === "subway") metroStops.push(...p);
  else if (t.bus === "yes" || t.highway === "bus_stop") busStops.push(...p);
}

const out = { roads: world.roads.length, oneway, onewayBack, names, named, signals, busStops, metroStops };
const json = JSON.stringify(out);
await writeFile("public/data/paris-streets.json", json);
console.log(
  `wrote public/data/paris-streets.json (${(json.length / 1e6).toFixed(1)} MB): ${oneway.length + onewayBack.length} one-way roads, ` +
    `${names.length} street names on ${named.length / 2} roads, ${signals.length / 2} traffic lights, ` +
    `${busStops.length / 2} bus stops, ${metroStops.length / 2} métro stops`,
);
