// Exports base | painted side-by-side sheets of the whole mosaic for review.
//   node scripts/paint/review.mjs
// Writes paint/review/<col>_<row>.jpg at half resolution (one per level-1 chunk).

import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { DIR, openBlankPage } from "./common.mjs";

const m = JSON.parse(await readFile(`${DIR}/manifest.json`, "utf8"));
const pm = JSON.parse(await readFile("public/painted/manifest.json", "utf8"));
const lvl = pm.levels.findIndex((l) => l.scale === 0.5);
const OUT = `${DIR}/review`;
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const { page, close } = await openBlankPage();
try {
  // Base mosaic at half scale.
  await page.evaluate(({ w, h }) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    window.base = c;
  }, { w: Math.ceil(m.width / 2), h: Math.ceil(m.height / 2) });
  for (const { c, r } of m.tiles) {
    const data = (await readFile(`${DIR}/base/${c}_${r}.png`)).toString("base64");
    await page.evaluate(async ({ data, x, y, T }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      window.base.getContext("2d").drawImage(img, x, y, T, T);
    }, { data, x: (c * m.step) / 2, y: (r * m.step) / 2, T: m.tile / 2 });
  }
  for (const [c, r] of pm.levels[lvl].chunks) {
    const f = `public/painted/${lvl}/${c}_${r}.webp`;
    if (!existsSync(f)) continue;
    const data = (await readFile(f)).toString("base64");
    const url = await page.evaluate(async ({ data, c, r, C }) => {
      const img = new Image();
      img.src = `data:image/webp;base64,${data}`;
      await img.decode();
      const t = document.createElement("canvas");
      t.width = 2 * C + 16; t.height = C;
      const g = t.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, t.width, t.height);
      g.drawImage(window.base, c * C, r * C, C, C, 0, 0, C, C);
      g.drawImage(img, C + 16, 0);
      return t.toDataURL("image/jpeg", 0.85);
    }, { data, c, r, C: pm.chunk });
    await writeFile(`${OUT}/${c}_${r}.jpg`, Buffer.from(url.split(",")[1], "base64"));
    process.stdout.write(".");
  }
  console.log();
} finally {
  await close();
}
