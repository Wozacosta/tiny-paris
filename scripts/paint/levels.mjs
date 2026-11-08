// Coarser copies of the painting, each from the one below: 2×2 chunks into one.
//   node scripts/paint/levels.mjs   (3-stitch.mjs runs this itself)
// Rebuilds public/painted/<1…>/ from the level-0 chunks and rewrites the
// levels in public/painted/manifest.json.

import { readdirSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { openBlankPage } from "./common.mjs";

export const OUT = "public/painted";
export const CHUNK = 1024;
/** Down to the whole map in a few chunks, for phones and the first view. */
export const LEVELS = [1, 0.5, 0.25, 0.125, 0.0625];

/** Writes levels 1… from `level0` ([col, row] chunks already in OUT/0) and returns all levels. */
export async function buildLevels(page, level0) {
  const levels = [{ scale: LEVELS[0], chunks: level0 }];
  for (let li = 1; li < LEVELS.length; li++) {
    await rm(`${OUT}/${li}`, { recursive: true, force: true });
    await mkdir(`${OUT}/${li}`, { recursive: true });
    const below = new Set(levels[li - 1].chunks.map(([c, r]) => `${c}_${r}`));
    const parents = new Set([...below].map((k) => k.split("_").map((v) => Math.floor(Number(v) / 2)).join("_")));
    const chunks = [];
    for (const key of parents) {
      const [c, r] = key.split("_").map(Number);
      const parts = [];
      for (const [dc, dr] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const k = `${c * 2 + dc}_${r * 2 + dr}`;
        if (below.has(k)) parts.push({ dc, dr, data: (await readFile(`${OUT}/${li - 1}/${k}.webp`)).toString("base64") });
      }
      const url = await page.evaluate(async ({ parts, C }) => {
        const t = document.createElement("canvas");
        t.width = t.height = C;
        const g = t.getContext("2d");
        g.imageSmoothingQuality = "high";
        for (const p of parts) {
          const img = new Image();
          img.src = `data:image/webp;base64,${p.data}`;
          await img.decode();
          g.drawImage(img, (p.dc * C) / 2, (p.dr * C) / 2, C / 2, C / 2);
        }
        return t.toDataURL("image/webp", 0.86);
      }, { parts, C: CHUNK });
      await writeFile(`${OUT}/${li}/${c}_${r}.webp`, Buffer.from(url.split(",")[1], "base64"));
      chunks.push([c, r]);
    }
    levels.push({ scale: LEVELS[li], chunks });
    console.log(`level ${li} (×${LEVELS[li]}): ${chunks.length} chunks`);
  }
  return levels;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const level0 = readdirSync(`${OUT}/0`).filter((f) => f.endsWith(".webp")).map((f) => f.slice(0, -5).split("_").map(Number));
  const { page, close } = await openBlankPage();
  try {
    const levels = await buildLevels(page, level0);
    const manifest = JSON.parse(await readFile(`${OUT}/manifest.json`, "utf8"));
    const { rotation, zoom, origin, chunk } = manifest;
    await writeFile(`${OUT}/manifest.json`, JSON.stringify({ rotation, zoom, origin, chunk, levels }));
  } finally {
    await close();
  }
}
