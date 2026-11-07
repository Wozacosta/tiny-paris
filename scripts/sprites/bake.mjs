// Bakes vehicle, boat and people sprites for the map from 3D models.
//   node scripts/sprites/bake.mjs [--only name,name]
// Writes public/sprites/<name>.webp and public/sprites/sprites.json.
// Models: Kenney Car Kit and Mini Characters (CC0), plus procedural ones in bake.html.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createServer } from "vite";
import { chromium } from "playwright-core";

const { values: opt } = parseArgs({ options: { only: { type: "string" } } });

const CARS = [
  // Paris traffic is mostly small hatchbacks and saloons in white, grey and black.
  ["car-white", "sedan", 4.2, [["auto", "#f2f2ef"]]],
  ["car-black", "sedan", 4.2, [["auto", "#2a2c31"]]],
  ["car-grey", "hatchback-sports", 4.0, [["auto", "#8d939b"]]],
  ["car-silver", "sedan-sports", 4.3, [["auto", "#c7ccd2"]]],
  ["car-blue", "hatchback-sports", 4.0, [["auto", "#2f5d9e"]]],
  ["car-red", "sedan", 4.2, [["auto", "#b8352e"]]],
  ["suv-dark", "suv", 4.6, [["auto", "#3b4048"]]],
  ["suv-white", "suv-luxury", 4.8, [["auto", "#ecebe6"]]],
  ["van-white", "van", 5.0, [["auto", "#f4f4f1"]]],
  ["delivery", "delivery", 5.6, null],
  ["taxi", "taxi", 4.6, [["auto", "#2a2c31"]]],
  ["police", "police", 4.6, null],
  ["ambulance", "ambulance", 5.8, null],
  ["firetruck", "firetruck", 8.5, null],
  ["benne", "garbage-truck", 8.0, [["auto", "#eef1ee"]]],
];
const PEOPLE = [
  "character-female-a", "character-female-b", "character-female-c", "character-female-d", "character-female-e", "character-female-f",
  "character-male-a", "character-male-b", "character-male-c", "character-male-d", "character-male-e", "character-male-f",
];

const specs = [
  ...CARS.map(([id, name, length, swaps]) => ({ id, kind: "glb", name, length, swaps, dirs: 16, P: 24 })),
  { id: "bus", kind: "bus", dirs: 16, P: 20 },
  { id: "metro", kind: "metro", dirs: 16, P: 20 },
  { id: "rer", kind: "rail", style: "rer", dirs: 16, P: 16 },
  { id: "intercity", kind: "rail", style: "intercity", dirs: 16, P: 16 },
  { id: "peniche", kind: "peniche", dirs: 16, P: 12 },
  { id: "mouche", kind: "mouche", dirs: 16, P: 12 },
  ...["#d7261e", "#2a62b8", "#f2c230", "#1f9e5a"].map((canopy, i) => ({ id: `boat-${i}`, kind: "smallboat", canopy, dirs: 16, P: 24 })),
  ...PEOPLE.flatMap((name, i) => [
    { id: `walk-${i}`, kind: "person", name, anim: "walk", frames: 6, dirs: 8, P: 32 },
    { id: `sit-${i}`, kind: "person", name, anim: "sit", dirs: 8, P: 32 },
    { id: `cheer-${i}`, kind: "person", name, anim: "emote-yes", frames: 4, dirs: 8, P: 32 },
    { id: `hold-${i}`, kind: "person", name, anim: "holding-both", dirs: 8, P: 32 },
  ]),
  ...PEOPLE.slice(0, 8).flatMap((name, i) => [
    { id: `bike-${i}`, kind: "cyclist", name, frame: 0x2d2d34, velib: false, dirs: 16, P: 32 },
    { id: `velib-${i}`, kind: "cyclist", name, frame: i % 3 === 2 ? 0x2f7fc2 : 0x86b817, velib: true, dirs: 16, P: 32 },
  ]),
];

const server = await createServer({ server: { port: 0 }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ channel: "chrome", args: ["--use-angle=metal", "--enable-gpu"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(`${server.resolvedUrls.local[0]}scripts/sprites/bake.html`);
await page.waitForFunction(() => window.ready, null, { timeout: 60_000 });

await mkdir("public/sprites", { recursive: true });
// With --only, update just those entries of the existing manifest.
const manifest = opt.only && existsSync("public/sprites/sprites.json") ? JSON.parse(await readFile("public/sprites/sprites.json", "utf8")) : {};
for (const spec of specs) {
  if (opt.only && !opt.only.split(",").includes(spec.id)) continue;
  const { png, meta } = await page.evaluate((s) => window.bake(s), spec);
  // Re-encode as WebP in the page.
  const webp = await page.evaluate(async (png) => {
    const img = new Image();
    img.src = png;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    c.getContext("2d").drawImage(img, 0, 0);
    return c.toDataURL("image/webp", 0.9);
  }, png);
  await writeFile(`public/sprites/${spec.id}.webp`, Buffer.from(webp.split(",")[1], "base64"));
  manifest[spec.id] = meta;
  process.stdout.write(`${spec.id} `);
}
await writeFile("public/sprites/sprites.json", JSON.stringify(manifest));
console.log(`\n${Object.keys(manifest).length} sprites`);
await browser.close();
await server.close();
