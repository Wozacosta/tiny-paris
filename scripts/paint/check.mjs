// Flags painted tiles that don't match their own base render — e.g. where the
// model copied the style reference instead of repainting the tile.
//   node scripts/paint/check.mjs [--from paint/painted-v2] [--ref paint/test-v2/8_1.png]
// Compares coarse edge maps: a good tile correlates with its base far more
// than with the reference or with other tiles.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { DIR, openBlankPage } from "./common.mjs";

const { values: opt } = parseArgs({
  options: {
    from: { type: "string", default: `${DIR}/painted-v2` },
    ref: { type: "string", default: `${DIR}/test-v2/8_1.png` },
    min: { type: "string", default: "0.35" },
  },
});

const m = JSON.parse(await readFile(`${DIR}/manifest.json`, "utf8"));
const ids = m.tiles.map((t) => `${t.c}_${t.r}`).filter((id) => existsSync(`${opt.from}/${id}.png`));
const b64 = async (p) => `data:image/png;base64,${(await readFile(p)).toString("base64")}`;

const { page, close } = await openBlankPage();
try {
  await page.evaluate(() => {
    const N = 48;
    // Gradient-magnitude map of a downscaled, blurred grey image, normalised.
    window.sig = async (url) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = new OffscreenCanvas(N, N);
      const g = c.getContext("2d");
      g.filter = "blur(1px)";
      g.drawImage(img, 0, 0, N, N);
      const d = g.getImageData(0, 0, N, N).data;
      const lum = new Float32Array(N * N);
      for (let i = 0; i < N * N; i++) lum[i] = 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2];
      const e = new Float32Array(N * N);
      for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
        const i = y * N + x;
        e[i] = Math.hypot(lum[i + 1] - lum[i - 1], lum[i + N] - lum[i - N]);
      }
      // Cells that aren't the plain off-map ground (judged from the top-left corner).
      const bg = lum[0];
      const on = Array.from(lum, (v, i) => Math.abs(v - bg) > 4 || e[i] > 2);
      return { e: Array.from(e), on };
    };
    // Pearson correlation of edge maps over the cells `mask` marks as on the map.
    window.corr = (a, b, mask) => {
      const idx = mask.map((m, i) => (m ? i : -1)).filter((i) => i >= 0);
      if (idx.length < 50) return null;
      const stats = (v) => {
        const mean = idx.reduce((s, i) => s + v[i], 0) / idx.length;
        const sd = Math.sqrt(idx.reduce((s, i) => s + (v[i] - mean) ** 2, 0) / idx.length) || 1;
        return [mean, sd];
      };
      const [ma, sa] = stats(a), [mb, sb] = stats(b);
      return idx.reduce((s, i) => s + ((a[i] - ma) / sa) * ((b[i] - mb) / sb), 0) / idx.length;
    };
  });

  const ref = await page.evaluate((u) => window.sig(u), await b64(opt.ref));
  const bad = [];
  for (const id of ids) {
    const [base, painted] = await Promise.all([
      page.evaluate((u) => window.sig(u), await b64(`${DIR}/base/${id}.png`)),
      page.evaluate((u) => window.sig(u), await b64(`${opt.from}/${id}.png`)),
    ]);
    const own = await page.evaluate(([a, b, m]) => window.corr(a, b, m), [painted.e, base.e, base.on]);
    const copy = await page.evaluate(([a, b, m]) => window.corr(a, b, m), [painted.e, ref.e, base.on]);
    if (own == null) continue; // hardly any map in this tile
    if (own < Number(opt.min) || copy > own) bad.push({ id, own: own.toFixed(2), copy: copy.toFixed(2) });
    process.stdout.write(".");
  }
  console.log(`\n${bad.length} of ${ids.length} tiles don't match their base:`);
  for (const b of bad) console.log(`  ${b.id}  own ${b.own}  reference ${b.copy}`);
  console.log(bad.map((b) => b.id).join(","));
} finally {
  await close();
}
