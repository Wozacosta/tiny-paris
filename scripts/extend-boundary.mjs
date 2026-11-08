// Grows the map beyond the périphérique: adds Neuilly-sur-Seine and La Défense,
// so the axis from the Arc de Triomphe runs on to the Grande Arche, and a few
// landmarks just outside it.
//   node scripts/extend-boundary.mjs   (after fetch-boundary.mjs)
// Reads scripts/boundary.json's Paris ring and writes its `ring` as the union.

import { readFile, writeFile } from "node:fs/promises";
import polygonClipping from "polygon-clipping";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FILE = new URL("./boundary.json", import.meta.url);
const b = JSON.parse(await readFile(FILE, "utf8"));
b.paris ??= b.ring;

// Neuilly's outline from the same OSM extract as fetch-osm.mjs.
const OSM = "paint/osm/ile-de-france.osm.pbf", TMP = mkdtempSync(join(tmpdir(), "neuilly-"));
const run = (...args) => execFileSync("osmium", args, { stdio: ["ignore", "ignore", "inherit"] });
run("tags-filter", OSM, "r/name=Neuilly-sur-Seine", "-O", "-o", `${TMP}/n.pbf`);
run("export", `${TMP}/n.pbf`, "--geometry-types=polygon", "-f", "geojsonseq", "-O", "-o", `${TMP}/n.json`);
const commune = readFileSync(`${TMP}/n.json`, "utf8").split(/[\n\x1e]/).filter(Boolean).map((l) => JSON.parse(l))
  .find((f) => f.properties.admin_level === "8" && f.properties.boundary === "administrative");
const outers = commune.geometry.type === "Polygon" ? [commune.geometry.coordinates[0]] : commune.geometry.coordinates.map((p) => p[0]);
const neuilly = outers.sort((a, b) => b.length - a.length)[0];
const eq = (p, q) => Math.abs(p[0] - q[0]) < 1e-7 && Math.abs(p[1] - q[1]) < 1e-7;

// La Défense: the business district inside the Boulevard Circulaire, the
// Puteaux and Courbevoie riverside facing Neuilly, and the Seine between them.
const defense = [
  [2.2625, 48.8885], [2.2565, 48.8935], [2.2485, 48.8985], [2.2380, 48.8992], [2.2290, 48.8962],
  [2.2248, 48.8920], [2.2268, 48.8878], [2.2350, 48.8843], [2.2470, 48.8818], [2.2580, 48.8798], [2.2640, 48.8830],
];

// The Paris ring follows the périphérique, Neuilly starts at the city limit a
// little further out: bridge the strip between them with the hull of the two
// outlines where they face each other.
const kx = 73000, ky = 111200; // metres per degree here
const near = (p, ring) => ring.some((q) => Math.hypot((p[0] - q[0]) * kx, (p[1] - q[1]) * ky) < 400);
const bridge = hull([...neuilly.filter((p) => near(p, b.paris)), ...b.paris.filter((p) => near(p, neuilly))]);

// Just past the périphérique: Parc des Princes, Stade Jean-Bouin and
// Roland-Garros at Porte d'Auteuil, and the Tours Mercuriales at Porte de Bagnolet.
const auteuil = [[2.2600, 48.8395], [2.2505, 48.8395], [2.2500, 48.8440], [2.2420, 48.8450], [2.2420, 48.8488], [2.2545, 48.8492], [2.2600, 48.8480]];
const bagnolet = [[2.4110, 48.8682], [2.4198, 48.8682], [2.4198, 48.8632], [2.4110, 48.8630]];

const close = (r) => (eq(r[0], r.at(-1)) ? r : [...r, r[0]]);
const union = polygonClipping.union([close(b.paris)], [close(neuilly)], [close(defense)], [close(bridge)], [close(auteuil)], [close(bagnolet)]);
if (union.length !== 1) throw new Error(`the areas don't join up: ${union.length} pieces`);
b.ring = union[0][0].slice(0, -1);
await writeFile(FILE, JSON.stringify(b));
console.log(`boundary: ${b.paris.length} points of Paris, ${neuilly.length} of Neuilly → ${b.ring.length}`);

/** Convex hull of [lon, lat] points (monotone chain). */
function hull(pts) {
  pts = [...pts].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const h = [];
    for (const p of list) {
      while (h.length >= 2 && cross(h.at(-2), h.at(-1), p) <= 0) h.pop();
      h.push(p);
    }
    return h.slice(0, -1);
  };
  return [...half(pts), ...half(pts.reverse())];
}
