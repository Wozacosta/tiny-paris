// Blends painted tiles into one mosaic, cuts it to the area outline and writes
// web-ready chunks the app draws in place of the live map.
//   node scripts/paint/3-stitch.mjs [--from paint/painted]
// Writes public/painted/<level>/<col>_<row>.webp and public/painted/manifest.json.

import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { DIR, openBlankPage } from "./common.mjs";
import { LANDMARKS, landmarkPixel, ownerTile } from "./landmarks.mjs";

const { values: opt } = parseArgs({ options: { from: { type: "string", default: `${DIR}/painted` } } });
const OUT = "public/painted";
const CHUNK = 1024;
const LEVELS = [1, 0.5, 0.25];

const m = JSON.parse(await readFile(`${DIR}/manifest.json`, "utf8"));
const have = new Set(m.tiles.map((t) => `${t.c}_${t.r}`).filter((id) => existsSync(`${opt.from}/${id}.png`)));
if (!have.size) throw new Error(`no tiles in ${opt.from}`);
console.log(`${have.size}/${m.tiles.length} tiles from ${opt.from}`);

const { page, close } = await openBlankPage();
try {
  await page.evaluate(({ w, h }) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    window.mosaic = c;

    // Seams. Where two paintings overlap they rarely agree, and a crossfade
    // shows both at half strength (a ghost building inside another). Instead
    // each overlap is cut along the path where the two differ least, usually
    // a street, with only a couple of pixels of feathering.
    const load = async (data, T) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const t = document.createElement("canvas");
      t.width = t.height = T;
      t.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0, T, T); // models may return a different size
      return t;
    };
    // Cost of cutting at each pixel: how much the new image and the mosaic
    // differ there, plus how busy both are, so cuts run along streets, lawns
    // and squares rather than through buildings (windows, roofs, trees).
    const diff = (a, b, T, hasOld) => {
      const n = T * T, d = new Float32Array(n);
      const lum = (p, j) => p[j] * 0.3 + p[j + 1] * 0.59 + p[j + 2] * 0.11;
      for (let i = 0; i < n; i++) {
        const j = i * 4;
        if (hasOld && !b[j + 3]) continue;
        const r = (i % T) < T - 1 ? 4 : 0, dn = i < n - T ? T * 4 : 0;
        const busy = Math.abs(lum(a, j) - lum(a, j + r)) + Math.abs(lum(a, j) - lum(a, j + dn)) + Math.abs(lum(b, j) - lum(b, j + r)) + Math.abs(lum(b, j) - lum(b, j + dn));
        d[i] = Math.abs(a[j] - b[j]) + Math.abs(a[j + 1] - b[j + 1]) + Math.abs(a[j + 2] - b[j + 2]) + 1.5 * busy;
      }
      return d;
    };
    // Cheapest top-to-bottom path through a W×H cost grid (one x per row),
    // with a small pull toward the middle so it doesn't hug either edge.
    const seam = (cost, W, H) => {
      const E = new Float32Array(W * H), from = new Int8Array(W * H);
      const pull = (x) => 40 * ((x - (W - 1) / 2) / (W / 2)) ** 2;
      for (let x = 0; x < W; x++) E[x] = cost[x] + pull(x);
      for (let y = 1; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let best = E[(y - 1) * W + x], k = 0;
          if (x > 0 && E[(y - 1) * W + x - 1] < best) { best = E[(y - 1) * W + x - 1]; k = -1; }
          if (x < W - 1 && E[(y - 1) * W + x + 1] < best) { best = E[(y - 1) * W + x + 1]; k = 1; }
          E[y * W + x] = best + cost[y * W + x] + pull(x);
          from[y * W + x] = k;
        }
      }
      let x = 0;
      for (let i = 1; i < W; i++) if (E[(H - 1) * W + i] < E[(H - 1) * W + x]) x = i;
      const out = new Int16Array(H);
      for (let y = H - 1; y >= 0; y--) { out[y] = x; x += from[y * W + x]; }
      return out;
    };
    // Turns a 0/1 alpha array into a slightly feathered mask canvas.
    const maskCanvas = (alpha, T, F = 2) => {
      const P = 8, S = T + 2 * P;
      const c = document.createElement("canvas");
      c.width = c.height = S;
      const g = c.getContext("2d");
      const id = g.createImageData(S, S);
      for (let y = 0; y < S; y++) {
        const yy = Math.min(T - 1, Math.max(0, y - P));
        for (let x = 0; x < S; x++) {
          const xx = Math.min(T - 1, Math.max(0, x - P));
          id.data[(y * S + x) * 4 + 3] = alpha[yy * T + xx] ? 255 : 0;
        }
      }
      g.putImageData(id, 0, 0);
      const out = document.createElement("canvas");
      out.width = out.height = T;
      const og = out.getContext("2d");
      og.filter = `blur(${F}px)`;
      og.drawImage(c, -P, -P);
      return out;
    };
    const place = (t, mask, x, y) => {
      const g = t.getContext("2d");
      g.globalCompositeOperation = "destination-in";
      g.drawImage(mask, 0, 0);
      window.mosaic.getContext("2d").drawImage(t, x, y);
    };

    // Tone matching. Each painting comes back a little lighter, darker or
    // warmer than its neighbours, which a hard cut shows as square patches.
    // So before cutting, shift the new tile's colours to agree with what's
    // already drawn along the shared edge, fading the shift out across the
    // tile. Only the smooth tone is blended, never detail, so nothing ghosts.
    const MAXSHIFT = 45;
    // Lighter or darker is a tone drift; a big hue shift means the overlap
    // shows different things (trees against roofs), and matching it tints a
    // whole area pink or green. So brightness may shift far, hue only a little.
    const MAXHUE = 8;
    const limit = (v, o) => {
      const mean = (v[o] + v[o + 1] + v[o + 2]) / 3, m = Math.max(-MAXSHIFT, Math.min(MAXSHIFT, mean));
      for (let c = 0; c < 3; c++) v[o + c] = m + Math.max(-MAXHUE, Math.min(MAXHUE, v[o + c] - mean));
    };
    // Per position along one edge: the mean (old - new) colour over the overlap strip, smoothed.
    const edgeShift = (a, b, T, O, vertical) => {
      const sum = new Float64Array((T + 1) * 3), cnt = new Float64Array(T + 1);
      for (let i = 0; i < T; i++) {
        let r = 0, g = 0, bl = 0, n = 0;
        for (let j = 0; j < O; j++) {
          const k = (vertical ? i * T + j : j * T + i) * 4;
          if (!b[k + 3]) continue;
          r += b[k] - a[k]; g += b[k + 1] - a[k + 1]; bl += b[k + 2] - a[k + 2]; n++;
        }
        sum[(i + 1) * 3] = sum[i * 3] + r; sum[(i + 1) * 3 + 1] = sum[i * 3 + 1] + g; sum[(i + 1) * 3 + 2] = sum[i * 3 + 2] + bl;
        cnt[i + 1] = cnt[i] + n;
      }
      const S = 96, out = new Float32Array(T * 3);
      for (let i = 0; i < T; i++) {
        const lo = Math.max(0, i - S), hi = Math.min(T, i + S), n = cnt[hi] - cnt[lo];
        for (let c = 0; c < 3; c++) out[i * 3 + c] = n ? (sum[hi * 3 + c] - sum[lo * 3 + c]) / n : 0;
        limit(out, i * 3);
      }
      return out;
    };
    const ease = (u) => (u <= 0 ? 1 : u >= 1 ? 0 : 1 - u * u * (3 - 2 * u));
    const matchTone = (t, a, b, T, O, left, top) => {
      const dL = left ? edgeShift(a, b, T, O, true) : null, dT = top ? edgeShift(a, b, T, O, false) : null;
      const D = 420; // how far into the tile the shift fades out
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
        const cL = dL ? ease((x - O) / D) : 0, cT = dT ? ease((y - O) / D) : 0;
        if (!cL && !cT) continue;
        const w = Math.max(1, cL + cT), k = (y * T + x) * 4;
        for (let c = 0; c < 3; c++) a[k + c] += ((dL ? cL * dL[y * 3 + c] : 0) + (dT ? cT * dT[x * 3 + c] : 0)) / w;
      }
      t.getContext("2d").putImageData(new ImageData(a, T, T), 0, 0);
    };

    // A tile cut against its left and top neighbours, which are already drawn.
    window.placeTile = async ({ data, x, y, T, O, left, top }) => {
      const t = await load(data, T);
      if (!left && !top) return window.mosaic.getContext("2d").drawImage(t, x, y);
      const a = t.getContext("2d").getImageData(0, 0, T, T).data;
      const b = window.mosaic.getContext("2d", { willReadFrequently: true }).getImageData(x, y, T, T).data;
      matchTone(t, a, b, T, O, left, top);
      const d = diff(a, b, T, true);
      const strip = (vertical) => {
        const c = new Float32Array(O * T);
        for (let i = 0; i < T; i++) for (let j = 0; j < O; j++) c[i * O + j] = vertical ? d[i * T + j] : d[j * T + i];
        return seam(c, O, T);
      };
      const sx = left ? strip(true) : null, sy = top ? strip(false) : null;
      const alpha = new Uint8Array(T * T);
      for (let yy = 0; yy < T; yy++) for (let xx = 0; xx < T; xx++) {
        alpha[yy * T + xx] = (!sx || xx > sx[yy]) && (!sy || yy > sy[xx]) ? 1 : 0;
      }
      place(t, maskCanvas(alpha, T), x, y);
    };

    // A landmark's owner tile redrawn around it, cut along a closed loop in the
    // ring between rIn and R where it differs least from what's there.
    window.placeLandmark = async ({ data, x, y, T, cx, cy, R }) => {
      const t = await load(data, T);
      const a = t.getContext("2d").getImageData(0, 0, T, T).data;
      const b = window.mosaic.getContext("2d", { willReadFrequently: true }).getImageData(x, y, T, T).data;
      const px = cx - x, py = cy - y, rIn = Math.round(R * 0.55);
      // Match its tone to the surroundings: mean colour difference over the ring it's cut in.
      {
        const m = [0, 0, 0];
        let n = 0;
        for (let yy = Math.max(0, py - R); yy < Math.min(T, py + R); yy += 2) for (let xx = Math.max(0, px - R); xx < Math.min(T, px + R); xx += 2) {
          const rr = Math.hypot(xx - px, yy - py), k = (Math.round(yy) * T + Math.round(xx)) * 4;
          if (rr < rIn || rr > R || !b[k + 3]) continue;
          for (let c = 0; c < 3; c++) m[c] += b[k + c] - a[k + c];
          n++;
        }
        if (n) {
          for (let c = 0; c < 3; c++) m[c] /= n;
          limit(m, 0);
          for (let k = 0; k < a.length; k += 4) for (let c = 0; c < 3; c++) a[k + c] += m[c];
          t.getContext("2d").putImageData(new ImageData(a, T, T), 0, 0);
        }
      }
      const d = diff(a, b, T, false);
      const N = Math.ceil(2 * Math.PI * R / 2); // angle steps, ~2px apart on the outside
      const W = R - rIn + 1;
      // Unwrap the ring: rows are angles, columns radii. Outside the tile costs a lot,
      // so the loop stays inside it.
      const cost = new Float32Array(N * W);
      for (let k = 0; k < N; k++) {
        const th = (k / N) * 2 * Math.PI, ux = Math.cos(th), uy = Math.sin(th);
        for (let j = 0; j < W; j++) {
          const qx = Math.round(px + ux * (rIn + j)), qy = Math.round(py + uy * (rIn + j));
          cost[k * W + j] = qx < 4 || qy < 4 || qx >= T - 4 || qy >= T - 4 ? 5000 : d[qy * T + qx];
        }
      }
      // Close the loop: try a few starting radii, force the path to end where it began.
      let best = null, bestCost = Infinity;
      for (let s = 0; s < 6; s++) {
        const j0 = Math.round(((s + 0.5) / 6) * (W - 1));
        const E = new Float32Array(N * W).fill(Infinity), from = new Int8Array(N * W);
        E[j0] = cost[j0];
        for (let k = 1; k < N; k++) for (let j = 0; j < W; j++) {
          let v = E[(k - 1) * W + j], f = 0;
          if (j > 0 && E[(k - 1) * W + j - 1] < v) { v = E[(k - 1) * W + j - 1]; f = -1; }
          if (j < W - 1 && E[(k - 1) * W + j + 1] < v) { v = E[(k - 1) * W + j + 1]; f = 1; }
          E[k * W + j] = v + cost[k * W + j];
          from[k * W + j] = f;
        }
        let jEnd = j0, v = E[(N - 1) * W + j0];
        for (const j of [j0 - 1, j0 + 1]) if (j >= 0 && j < W && E[(N - 1) * W + j] < v) { v = E[(N - 1) * W + j]; jEnd = j; }
        if (v < bestCost) {
          bestCost = v;
          const path = new Int16Array(N);
          for (let k = N - 1, j = jEnd; k >= 0; k--) { path[k] = j; j += from[k * W + j]; }
          best = path;
        }
      }
      const m = document.createElement("canvas");
      m.width = m.height = T;
      const g = m.getContext("2d");
      g.beginPath();
      for (let k = 0; k < N; k++) {
        const th = (k / N) * 2 * Math.PI, r = rIn + best[k];
        (k ? g.lineTo : g.moveTo).call(g, px + Math.cos(th) * r, py + Math.sin(th) * r);
      }
      g.closePath();
      g.filter = "blur(2px)";
      g.fill();
      place(t, m, x, y);
    };
  }, { w: m.width, h: m.height });

  // How much of each tile's base is actual map (not plain off-map ground).
  const coverage = new Map();
  for (const id of have) {
    const data = (await readFile(`${DIR}/base/${id}.png`)).toString("base64");
    coverage.set(id, await page.evaluate(async (data) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const c = new OffscreenCanvas(64, 64);
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0, 64, 64);
      const d = g.getImageData(0, 0, 64, 64).data;
      let on = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]) > 12) on++;
      return on / (64 * 64);
    }, data));
  }
  // Edge tiles (mostly off-map) go first and without fades: the model invents
  // city where their base is empty, so neighbours with real content cover them.
  const EDGE = 0.35;
  const isEdge = (id) => (coverage.get(id) ?? 1) < EDGE;
  const core = new Set([...have].filter((id) => !isEdge(id)));
  // Then raster order, so each tile is only cut against its left and top
  // neighbours, which are already fully drawn.
  const byRaster = (a, b) => a[1] - b[1] || a[0] - b[0];
  const ids = (set) => [...set].map((id) => id.split("_").map(Number)).sort(byRaster);
  const order = [...ids(new Set([...have].filter(isEdge))), ...ids(core)];
  for (const [c, r] of order) {
    const edge = isEdge(`${c}_${r}`);
    const data = (await readFile(`${opt.from}/${c}_${r}.png`)).toString("base64");
    await page.evaluate(
      (args) => window.placeTile(args),
      {
        data, x: c * m.step, y: r * m.step, T: m.tile, O: m.overlap,
        left: !edge && core.has(`${c - 1}_${r}`), top: !edge && core.has(`${c}_${r - 1}`),
      },
    );
    process.stdout.write(".");
  }

  // Each landmark comes from its owner tile only: redraw that tile over the
  // landmark's surroundings so a neighbour's version can't ghost through.
  for (const l of LANDMARKS) {
    const o = ownerTile(m, l);
    if (!o || !have.has(`${o.c}_${o.r}`)) continue;
    const [gx, gy] = landmarkPixel(m, l);
    // A landmark can have its own repaint of the owner tile (paint/landmarks/<slug>.png),
    // used only around it, so fixing one landmark doesn't disturb its neighbours.
    const own = l.slug && existsSync(`${DIR}/landmarks/${l.slug}.png`) ? `${DIR}/landmarks/${l.slug}.png` : `${opt.from}/${o.c}_${o.r}.png`;
    const data = (await readFile(own)).toString("base64");
    await page.evaluate((args) => window.placeLandmark(args), { data, x: o.c * m.step, y: o.r * m.step, T: m.tile, cx: gx, cy: gy, R: l.radius ?? 260 });
  }

  // Spot fixes (paint/patches.json): a corrected repaint of one tile, used only
  // in a cut-out around each mistake it fixes, so the rest keeps the original.
  const patches = existsSync(`${DIR}/patches.json`) ? JSON.parse(await readFile(`${DIR}/patches.json`, "utf8")) : [];
  for (const p of patches) {
    const [c, r] = p.tile.split("_").map(Number);
    const data = (await readFile(`${DIR}/${p.from}/${p.tile}.png`)).toString("base64");
    const x = c * m.step, y = r * m.step;
    await page.evaluate((args) => window.placeLandmark(args), {
      data, x, y, T: m.tile, cx: x + (p.x / 100) * m.tile, cy: y + (p.y / 100) * m.tile, R: p.r,
    });
  }
  if (patches.length) console.log(`\n${patches.length} spot fixes`);

  // Spot repaints (paint/spots.json, from spot.mjs): crops of the painting
  // centred on one thing, pasted last.
  const spots = existsSync(`${DIR}/spots.json`) ? JSON.parse(await readFile(`${DIR}/spots.json`, "utf8")) : [];
  for (const s of spots) {
    const data = (await readFile(`${DIR}/spots/${s.name}.png`)).toString("base64");
    await page.evaluate((args) => window.placeLandmark(args), {
      data, x: s.x - s.size / 2, y: s.y - s.size / 2, T: s.size, cx: s.x, cy: s.y, R: s.r,
    });
  }
  if (spots.length) console.log(`${spots.length} spot repaints`);

  // Keep only the area itself, fading out over the last stretch of its edge
  // so it blends into the live map around it.
  await page.evaluate(({ poly, ox, oy, Z, FEATHER }) => {
    const mask = document.createElement("canvas");
    mask.width = window.mosaic.width;
    mask.height = window.mosaic.height;
    const mg = mask.getContext("2d");
    mg.filter = `blur(${FEATHER / 2}px)`;
    // Shrink the outline toward its centre so the fade stays inside it.
    const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length, cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
    mg.beginPath();
    poly.forEach(([x, y], i) => {
      const d = Math.hypot(x - cx, y - cy), k = Math.max(0, 1 - FEATHER / Z / d);
      (i ? mg.lineTo : mg.moveTo).call(mg, (cx + (x - cx) * k - ox) * Z, (cy + (y - cy) * k - oy) * Z);
    });
    mg.closePath();
    mg.fill();
    const g = window.mosaic.getContext("2d");
    g.globalCompositeOperation = "destination-in";
    g.drawImage(mask, 0, 0);
  }, { poly: m.polygon, ox: m.origin[0], oy: m.origin[1], Z: m.zoom, FEATHER: 160 });

  await rm(OUT, { recursive: true, force: true });
  const levels = [];
  for (const [li, scale] of LEVELS.entries()) {
    await mkdir(`${OUT}/${li}`, { recursive: true });
    const w = Math.ceil(m.width * scale), h = Math.ceil(m.height * scale);
    const cols = Math.ceil(w / CHUNK), rows = Math.ceil(h / CHUNK);
    const chunks = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const url = await page.evaluate(({ c, r, s, C }) => {
          const t = document.createElement("canvas");
          t.width = t.height = C;
          const g = t.getContext("2d");
          g.imageSmoothingQuality = "high";
          g.drawImage(window.mosaic, (c * C) / s, (r * C) / s, C / s, C / s, 0, 0, C, C);
          // Skip chunks with nothing in them.
          const a = g.getImageData(0, 0, C, C).data;
          for (let i = 3; i < a.length; i += 64) if (a[i]) return t.toDataURL("image/webp", 0.86);
          return null;
        }, { c, r, s: scale, C: CHUNK });
        if (!url) continue;
        await writeFile(`${OUT}/${li}/${c}_${r}.webp`, Buffer.from(url.split(",")[1], "base64"));
        chunks.push([c, r]);
      }
    }
    levels.push({ scale, chunks });
    console.log(`\nlevel ${li} (×${scale}): ${chunks.length} chunks`);
  }

  const manifest = { rotation: m.rotation, zoom: m.zoom, origin: m.origin, chunk: CHUNK, levels, polygon: m.polygon, area: m.area };
  await writeFile(`${OUT}/manifest.json`, JSON.stringify(manifest));
} finally {
  await close();
}
