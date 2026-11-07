// Repaints one spot of the stitched painting with Gemini, centred on it.
//   node scripts/paint/spot.mjs --name <slug> --lon <lon> --lat <lat> [--lift px] [--size px] --text "<what to paint in the centre>" --budget <eur>
// Asked about "the centre of the image", the model gets placement right far more
// often than with percentages over a whole tile. Sends a crop of the current
// painting (public/painted level 0) and the same crop of the base render, writes
// paint/spots/<slug>.png and adds it to paint/spots.json, which 3-stitch.mjs
// pastes over everything else.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { DIR, ROTATION, ZOOM, openExportPage } from "./common.mjs";
import { landmarkPixel } from "./landmarks.mjs";

const { values: opt } = parseArgs({
  options: {
    name: { type: "string" },
    lon: { type: "string" },
    lat: { type: "string" },
    lift: { type: "string", default: "0" }, // move the centre up, for tall buildings
    size: { type: "string", default: "320" },
    radius: { type: "string" }, // cut-out radius in the stitch, default 0.4 × size
    text: { type: "string" },
    budget: { type: "string", default: "9" },
    model: { type: "string", default: "gemini-3.1-flash-image" },
    dry: { type: "boolean", default: false }, // only write the two crops
  },
});
if (!opt.name || !opt.lon || !opt.lat || !opt.text) throw new Error("need --name, --lon, --lat and --text");

const RATE = { input: 0.5, output: 60 }; // USD per million tokens, gemini-3.1-flash-image
const WORST = (4000 * RATE.input + 3000 * RATE.output) / 1e6;
const SPEND_FILE = `${DIR}/spend.json`;
const spend = JSON.parse(await readFile(SPEND_FILE, "utf8"));
if (!opt.dry && spend.totalEur + WORST > Number(opt.budget)) throw new Error(`over budget: spent €${spend.totalEur.toFixed(2)} of €${opt.budget}`);
const KEY = process.env.GEMINI_API_KEY;
if (!KEY && !opt.dry) throw new Error("set GEMINI_API_KEY");

const m = JSON.parse(await readFile(`${DIR}/manifest.json`, "utf8"));
const S = Number(opt.size);
const [gx, gy0] = landmarkPixel(m, { lon: Number(opt.lon), lat: Number(opt.lat) });
const x = Math.round(gx), y = Math.round(gy0 - Number(opt.lift));

const { page, close } = await openExportPage();
let painted, base;
try {
  // The painting around the spot, from the level-0 chunks.
  painted = await page.evaluate(async ({ x, y, S }) => {
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d");
    const x0 = x - S / 2, y0 = y - S / 2;
    for (let cy = Math.floor(y0 / 1024); cy <= Math.floor((y0 + S) / 1024); cy++) {
      for (let cx = Math.floor(x0 / 1024); cx <= Math.floor((x0 + S) / 1024); cx++) {
        const img = new Image();
        img.src = `/painted/0/${cx}_${cy}.webp`;
        try { await img.decode(); } catch { continue; }
        g.drawImage(img, cx * 1024 - x0, cy * 1024 - y0);
      }
    }
    return c.toDataURL("image/png").split(",")[1];
  }, { x, y, S });
  // The base render of the same spot, from the current map data.
  base = await page.evaluate(
    ({ R, cx, cy, Z, S }) => window.tinyExport.render(R, cx, cy, Z, S, S),
    { R: ROTATION, cx: m.origin[0] + x / ZOOM, cy: m.origin[1] + y / ZOOM, Z: ZOOM, S },
  );
  base = base.split(",")[1];
} finally {
  await close();
}
await mkdir(`${DIR}/spots`, { recursive: true });
await writeFile(`${DIR}/spots/${opt.name}-before.png`, Buffer.from(painted, "base64"));
await writeFile(`${DIR}/spots/${opt.name}-base.png`, Buffer.from(base, "base64"));
if (opt.dry) process.exit(0);

const prompt = `The first image is a crop of a painted isometric map of Paris. The second image is the plain 3D render of exactly the same area: it is the ground truth for what is where.

In the exact centre of the image: ${opt.text}

Change only that. Everything else must stay exactly as it is in the first image: same framing, same buildings, same streets, same painted style, colours and lighting. No text or labels. Return the whole image.`;

const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${opt.model}:generateContent`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-goog-api-key": KEY },
  body: JSON.stringify({
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: "image/png", data: painted } }, { inline_data: { mime_type: "image/png", data: base } }] }],
    generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1", imageSize: "1K" } },
  }),
});
const json = await res.json().catch(() => ({}));
const u = json.usageMetadata;
const eur = u ? ((u.promptTokenCount ?? 0) * RATE.input + ((u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0)) * RATE.output) / 1e6 : WORST;
spend.totalEur += eur;
spend.calls.push({ id: `spot:${opt.name}`, model: opt.model, eur: Number(eur.toFixed(4)), at: new Date().toISOString() });
await writeFile(SPEND_FILE, JSON.stringify(spend, null, 2));

const data = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
if (!res.ok || !data) throw new Error(`no image: ${json.error?.message ?? json.candidates?.[0]?.finishReason ?? res.status}`);
await writeFile(`${DIR}/spots/${opt.name}.png`, Buffer.from(data, "base64"));

const file = `${DIR}/spots.json`;
const spots = existsSync(file) ? JSON.parse(await readFile(file, "utf8")) : [];
const spot = { name: opt.name, x, y, size: S, r: Number(opt.radius ?? Math.round(S * 0.4)) };
const i = spots.findIndex((s) => s.name === opt.name);
if (i >= 0) spots[i] = spot;
else spots.push(spot);
await writeFile(file, JSON.stringify(spots, null, 1));
console.log(`${DIR}/spots/${opt.name}.png · ≈ €${eur.toFixed(3)}, total ≈ €${spend.totalEur.toFixed(2)}`);
