// Packs public/data/paris.json into public/data/paris.bin for the app: every
// coordinate goes into one stream of 32-bit integers, each line or ring as its
// length then its points, the first absolute and the rest as steps from the
// one before (small numbers, which compress well). The rest rides in a JSON
// header: heights, road kinds, building tags, and what is worked out here once
// instead of on every visitor's phone (the BD TOPO survey row matched to each
// building, the roads that run through buildings).
//   node scripts/pack.mjs   (fetch-osm.mjs runs it after writing paris.json)
//
// Layout: "TPB1", header length (u32), header JSON, padding to 4 bytes, ints.
// src/model.ts (unpack) reads it back in the same order as written here.

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { matchBdTopo, throughBuildings } from "../src/model.ts";

const BDTOPO = "public/data/paris-bdtopo.json";

export async function pack(world, file = "public/data/paris.bin") {
  const ints = [];
  const line = (p) => {
    ints.push(p.length);
    for (let i = 0; i < p.length; i++) ints.push(i < 2 ? p[i] : p[i] - p[i - 2]);
  };
  const rings = (rs) => {
    ints.push(rs.length);
    rs.forEach(line);
  };
  const roadKinds = [...new Set(world.roads.map((r) => r.k))];
  const roadWidths = [...new Set(world.roads.map((r) => r.w))];
  const parkKinds = [...new Set(world.parks.map((p) => p.k))];

  for (const b of world.buildings) rings(b.r);
  for (const w of world.water) rings(w);
  for (const p of world.parks) { ints.push(parkKinds.indexOf(p.k)); rings(p.r); }
  for (const b of world.bridges) rings(b);
  for (const r of world.roads) { ints.push(roadKinds.indexOf(r.k), roadWidths.indexOf(r.w)); line(r.p); }
  line(world.trees.flat());

  // Worked out here once rather than on every visitor's phone.
  const k = world.scale;
  const footprints = world.buildings.map((b) => b.r.map((r) => Float64Array.from(r, (v) => v / k)));
  // The app never reads a row's position, so it goes as 0 and compresses away.
  const bd = (existsSync(BDTOPO) ? matchBdTopo(JSON.parse(await readFile(BDTOPO, "utf8")).rows, footprints, k) : world.buildings.map(() => null))
    .map((r) => r && [0, 0, ...r.slice(2)]);
  const flags = throughBuildings(footprints.map((r) => r[0]), world.roads, k);
  const through = [];
  flags.forEach((f, i) => f && through.push(i));

  const header = Buffer.from(JSON.stringify({
    bbox: world.bbox, origin: world.origin, bounds: world.bounds, boundary: world.boundary, scale: world.scale, metro: world.metro,
    counts: { buildings: world.buildings.length, water: world.water.length, parks: world.parks.length, bridges: world.bridges.length, roads: world.roads.length },
    heights: world.buildings.map((b) => b.h ?? null),
    info: world.buildings.map((b) => b.i ?? null),
    roadKinds, roadWidths, parkKinds, bd, through,
  }));
  const pad = (4 - ((8 + header.length) % 4)) % 4;
  const head = Buffer.alloc(8 + header.length + pad, 0x20);
  head.write("TPB1", 0, "latin1");
  head.writeUInt32LE(header.length + pad, 4);
  header.copy(head, 8);
  const body = Buffer.from(Int32Array.from(ints).buffer);
  await writeFile(file, Buffer.concat([head, body]));
  return head.length + body.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bytes = await pack(JSON.parse(await readFile("public/data/paris.json", "utf8")));
  console.log(`wrote public/data/paris.bin (${(bytes / 1e6).toFixed(1)} MB)`);
}
