// Repaints base tiles with a Gemini image model.
//   GEMINI_API_KEY=… node scripts/paint/2-paint.mjs [options]
// Options:
//   --model <id>         default gemini-3.1-flash-image
//   --only 6_4,7_4       paint just these tiles
//   --landmarks          paint just the tiles that contain a known landmark
//   --style <png>        style reference image passed with every tile. Avoid: the
//                        model often returns the reference instead of the tile
//                        (63 of 167 tiles in one run); check with check.mjs.
//   --out <dir>          default paint/painted
//   --concurrency <n>    default 4
//   --budget <eur>       hard spending cap across all runs, default 9
// Already painted tiles are skipped, so the run can be resumed.
//
// Spending: Google budgets only alert, they never stop charges, so the cap is
// enforced here. Each call is priced from the token counts Google returns, at
// deliberately high rates with 1 USD counted as 1 EUR, and the running total is
// kept in paint/spend.json. A call is only sent if its worst case still fits.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { DIR } from "./common.mjs";
import { tileFeatures } from "./features.mjs";
import { landmarksInTile, landmarksNearTile } from "./landmarks.mjs";

const { values: opt } = parseArgs({
  options: {
    model: { type: "string", default: "gemini-3.1-flash-image" },
    only: { type: "string" },
    landmarks: { type: "boolean", default: false },
    style: { type: "string" },
    out: { type: "string", default: `${DIR}/painted` },
    concurrency: { type: "string", default: "4" },
    budget: { type: "string", default: "9" },
    size: { type: "string", default: "1K" }, // 1K, 2K or 4K output
    // Edit mode: { "<tile>": ["what to fix, where", ...] }. Sends the tile's
    // current painting (from --from) with the base, and asks for those fixes only.
    fix: { type: "string" },
    from: { type: "string", default: `${DIR}/painted` },
    base: { type: "string", default: `${DIR}/base` }, // the renders to paint from
  },
});

// Upper-bound prices in USD per million tokens (thinking tokens bill as output).
const RATES = {
  "gemini-2.5-flash-image": { input: 0.3, output: 30 },
  "gemini-3.1-flash-image": { input: 0.5, output: 60 },
  "gemini-3-pro-image": { input: 2, output: 120 },
};
const rate = RATES[opt.model];
if (!rate) throw new Error(`no known price for ${opt.model}; refusing to spend. Known: ${Object.keys(RATES).join(", ")}`);
const BUDGET = Number(opt.budget);
const WORST = (4000 * rate.input + { "1K": 3000, "2K": 4500, "4K": 6000 }[opt.size] * rate.output) / 1e6; // one call, generously
const SPEND_FILE = `${DIR}/spend.json`;
const spend = existsSync(SPEND_FILE) ? JSON.parse(await readFile(SPEND_FILE, "utf8")) : { totalEur: 0, calls: [] };
let reserved = 0;
let overBudget = false;

const costOf = (usage) => {
  if (!usage) return WORST;
  const out = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
  return ((usage.promptTokenCount ?? 0) * rate.input + out * rate.output) / 1e6;
};

async function record(id, usage) {
  const eur = costOf(usage);
  spend.totalEur += eur;
  spend.calls.push({ id, model: opt.model, eur: Number(eur.toFixed(4)), at: new Date().toISOString() });
  await writeFile(SPEND_FILE, JSON.stringify(spend, null, 2));
}

console.log(`budget €${BUDGET.toFixed(2)}, already spent ≈ €${spend.totalEur.toFixed(2)}, worst case per tile €${WORST.toFixed(3)}`);

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) throw new Error("set GEMINI_API_KEY");

const PROMPT = `Repaint this isometric 3D map tile of north-east Paris as a richly detailed isometric city illustration, like the 3D city view in Apple Maps.

Keep the geometry exactly: every building footprint, height, roof outline, street, tree, canal and park must stay in the same place and size, with the same camera angle and framing. Do not add, remove, move or resize anything, and do not change the composition at the edges of the image.

Keep each building's architectural style and colour from this image; the colours are real data, not decoration:
- Cream/beige buildings with blue-grey mansard tops are 19th-century Haussmann stone: limestone façades, tall French windows, wrought-iron balconies, cornices, zinc mansard roofs with dormers and chimneys, shopfronts at street level.
- White and light-grey buildings with horizontal window bands and flat roofs are 1950s–1980s concrete social housing towers and slabs (HLM): paint them as plain concrete with repetitive ribbon windows and loggias, flat gravel roofs with rooftop vents and lift housings. Never give them mansards, dormers, balconies with ironwork or Haussmann details.
- Red-brown buildings are brick (1900s–1930s HBM housing and workshops): red brick façades with lighter stone bands, keep them brick.
- Terracotta roofs stay terracotta tiles; dark grey roofs stay slate.
- Roofs and the ground are textured with real aerial photos: keep what they show, at the same places, painted cleanly in the illustration style — zinc and slate roofs, terracotta tiles, chimney stacks, skylights and glass courtyard roofs, rooftop terraces and gardens, solar panels, trees and gardens in courtyards, school yards and sports courts, parked cars. Make each roof as varied as the photo is. Ignore the photo's own shadows and blur.
- Streets: dark asphalt with light stone pavements and crossings; small cars stay small.
- Trees and parks: lush rounded canopies with soft light and shadow; canal water calm blue-green.
- Lighting: soft afternoon sun from the left, gentle ambient occlusion where walls meet the ground, crisp edges.

No text, labels, logos, people, watermark or border.`;

const STYLE_NOTE = `The second image is a style reference only: match its rendering style, colours, lighting and level of detail, but take all content and layout from the first image.`;

const base = JSON.parse(await readFile(`${DIR}/manifest.json`, "utf8"));
const tiles = base.tiles
  .filter((t) => !opt.landmarks || landmarksInTile(base, t.c, t.r).length || landmarksNearTile(base, t.c, t.r).length)
  .map((t) => `${t.c}_${t.r}`)
  .filter((id) => !opt.only || opt.only.split(",").includes(id));
const features = tileFeatures(base);
const fixes = opt.fix ? JSON.parse(await readFile(opt.fix, "utf8")) : null;
if (fixes) tiles.splice(0, tiles.length, ...tiles.filter((id) => id in fixes));

const FIX_PROMPT = `The first image is a painted isometric map tile of north-east Paris. The second image is the plain 3D render it was painted from: it is the ground truth for what is where (buildings, streets, parks, tracks, water in blue).

The painting has mistakes. Fix ONLY these, at the given positions (percent of the image width from the left, height from the top), by painting what the second image shows there, in the same style as the rest of the painting:`;
const style = opt.style ? (await readFile(opt.style)).toString("base64") : null;
await mkdir(opt.out, { recursive: true });

async function paint(id) {
  const out = `${opt.out}/${id}.png`;
  if (existsSync(out)) return "skip";
  const img = (await readFile(`${opt.base}/${id}.png`)).toString("base64");
  const [c, r] = id.split("_").map(Number);
  const marks = landmarksInTile(base, c, r);
  const near = landmarksNearTile(base, c, r);
  const hint =
    (marks.length
      ? `\n\nLandmarks in this tile — paint each one exactly once, as the real building, recognisably, within its footprint in the image and nowhere else:\n` +
        marks.map((l) => `- ${l.name}, ${l.where}: ${l.look}.`).join("\n")
      : "") +
    (near.length
      ? `\n\nDo NOT paint ${near.map((l) => l.avoid ?? l.name).join(", ")} anywhere in this image, even partially: they are painted separately. Where they would be, paint exactly what the base image shows there (tracks stay tracks, open ground stays open) without inventing new buildings.`
      : "") +
    (features.get(id).rail > 300
      ? `\n\nRailway tracks (bundles of parallel grey lines on the ground) are open-air rail yards: paint them as tracks on grey ballast with overhead catenary masts and trains, at ground level, exactly where the base image has them and nowhere else. Never put buildings, roofs or streets over them, and never cover them with a station roof unless the base image shows one there.`
      : `\n\nThere are no railway tracks or rail yards anywhere in this image: do not paint any.`) +
    (features.get(id).water > 0
      ? `\n\nWater: paint canals, basins and pools only exactly where the base image shows blue water. Everything else is dry land: never add canals, pools, ponds or fountains.`
      : `\n\nThere is no water anywhere in this image: no canal, river, basin, pond, pool or fountain. Parks are lawn, paths and trees; squares are paving.`);
  const parts = fixes
    ? [
        { text: `${FIX_PROMPT}\n${fixes[id].map((f) => `- ${f}`).join("\n")}\n\nEverything else must stay exactly as it is in the first image: same framing, same buildings, same colours, same landmarks. Return the whole corrected image.${hint}` },
        { inline_data: { mime_type: "image/png", data: (await readFile(`${opt.from}/${id}.png`)).toString("base64") } },
        { inline_data: { mime_type: "image/png", data: img } },
      ]
    : [
        { text: (style ? `${PROMPT}\n\n${STYLE_NOTE}` : PROMPT) + hint },
        { inline_data: { mime_type: "image/png", data: img } },
      ];
  if (style) parts.push({ inline_data: { mime_type: "image/png", data: style } });

  for (let attempt = 1; attempt <= 4; attempt++) {
    if (spend.totalEur + reserved + WORST > BUDGET) {
      overBudget = true;
      return "budget";
    }
    reserved += WORST;
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${opt.model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1", imageSize: opt.size } },
      }),
    });
    const json = await res.json().catch(() => ({}));
    reserved -= WORST;
    // Count anything that produced tokens, even if no image came back.
    if (json.usageMetadata || json.candidates) await record(id, json.usageMetadata);
    const data = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
    if (res.ok && data) {
      await writeFile(out, Buffer.from(data, "base64"));
      return "ok";
    }
    const why = json.error?.message ?? json.candidates?.[0]?.finishReason ?? res.status;
    // A zero quota (free tier, no billing) never recovers by waiting.
    if (/limit: 0\b/.test(String(why))) {
      console.error(`\nThis key has no quota for ${opt.model}. Enable billing on its Google Cloud project: https://aistudio.google.com/apikey`);
      process.exit(2);
    }
    console.warn(`\n${id}: attempt ${attempt} failed (${why})`);
    await new Promise((r) => setTimeout(r, 2000 * attempt ** 2));
  }
  return "fail";
}

const queue = [...tiles];
const counts = { ok: 0, skip: 0, fail: 0, budget: 0 };
const started = Date.now();
await Promise.all(
  Array.from({ length: Number(opt.concurrency) }, async () => {
    for (let id; !overBudget && (id = queue.shift()); ) {
      counts[await paint(id)]++;
      process.stdout.write(`\r${counts.ok} painted, ${counts.skip} skipped, ${counts.fail} failed of ${tiles.length} · spent ≈ €${spend.totalEur.toFixed(2)}`);
    }
  }),
);
console.log(`\ndone in ${Math.round((Date.now() - started) / 1000)}s, total spent ≈ €${spend.totalEur.toFixed(2)} of €${BUDGET.toFixed(2)}`);
if (overBudget) console.log(`stopped: the next tile could exceed the €${BUDGET} budget (${queue.length + counts.budget} tiles left)`);
if (counts.fail || overBudget) process.exitCode = 1;
