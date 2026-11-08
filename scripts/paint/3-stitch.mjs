// Blends painted tiles into one mosaic, cuts it to the area outline and writes
// web-ready chunks the app draws in place of the live map.
//   node scripts/paint/3-stitch.mjs [--from paint/painted-p]
// Writes public/painted/<level>/<col>_<row>.webp and public/painted/manifest.json.

import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { DIR, openBlankPage } from "./common.mjs";
import { LANDMARKS, landmarkPixel, ownerTile } from "./landmarks.mjs";

const { values: opt } = parseArgs({ options: { from: { type: "string", default: `${DIR}/painted-p` } } });
const OUT = "public/painted";
const CHUNK = 1024;
const LEVELS = [1, 0.5, 0.25];

const m = JSON.parse(await readFile(`${DIR}/manifest.json`, "utf8"));
const have = new Set(m.tiles.map((t) => `${t.c}_${t.r}`).filter((id) => existsSync(`${opt.from}/${id}.png`)));
if (!have.size) throw new Error(`no tiles in ${opt.from}`);
console.log(`${have.size}/${m.tiles.length} tiles from ${opt.from}`);

const { page, close } = await openBlankPage();
try {
  await page.evaluate(() => {
    // The mosaic is drawn in bands (a canvas for all of Paris is over
    // Chrome's size limit): window.mosaic holds global rows from window.OY.
    window.newBand = (w, h, oy) => {
      if (window.mosaic) window.mosaic.width = window.mosaic.height = 0;
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      window.mosaic = c;
      window.OY = oy;
    };

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
      window.mosaic.getContext("2d").drawImage(t, x, y - window.OY);
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
      if (!left && !top) return window.mosaic.getContext("2d").drawImage(t, x, y - window.OY);
      const a = t.getContext("2d").getImageData(0, 0, T, T).data;
      const b = window.mosaic.getContext("2d", { willReadFrequently: true }).getImageData(x, y - window.OY, T, T).data;
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
      const b = window.mosaic.getContext("2d", { willReadFrequently: true }).getImageData(x, y - window.OY, T, T).data;
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
  });

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
  const landmarks = LANDMARKS.map((l) => ({ l, o: ownerTile(m, l) })).filter(({ o }) => o && have.has(`${o.c}_${o.r}`));
  const patches = existsSync(`${DIR}/patches.json`) ? JSON.parse(await readFile(`${DIR}/patches.json`, "utf8")) : [];
  const spots = existsSync(`${DIR}/spots.json`) ? JSON.parse(await readFile(`${DIR}/spots.json`, "utf8")) : [];

  await rm(OUT, { recursive: true, force: true });
  await mkdir(`${OUT}/0`, { recursive: true });
  const level0 = [];
  let recoloured = 0;

  // Bands of BAND rows of the mosaic. Each also draws the two tile rows above
  // it (which its top row is cut and tone-matched against) and one below
  // (which draws over its bottom overlap), but keeps only its own rows.
  const BAND = 2 * CHUNK;
  for (let Y0 = 0; Y0 < m.height; Y0 += BAND) {
    const Y1 = Math.min(m.height, Y0 + BAND);
    const rFirst = Math.max(0, Math.floor(Y0 / m.step) - 2);
    const rLast = Math.floor((Y1 - 1) / m.step) + 1;
    const OYb = rFirst * m.step, Hb = Math.min(m.height, (rLast + 1) * m.step + m.overlap) - OYb;
    await page.evaluate(({ w, h, oy }) => window.newBand(w, h, oy), { w: m.width, h: Hb, oy: OYb });

    for (const [c, r] of order) {
      if (r < rFirst || r > rLast) continue;
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
    const touches = (yTop, yBottom) => yBottom > OYb && yTop < OYb + Hb;

    // Each landmark comes from its owner tile only: redraw that tile over the
    // landmark's surroundings so a neighbour's version can't ghost through.
    for (const { l, o } of landmarks) {
      if (!touches(o.r * m.step, o.r * m.step + m.tile)) continue;
      const [gx, gy] = landmarkPixel(m, l);
      // A landmark can have its own repaint of the owner tile (paint/landmarks/<slug>.png),
      // used only around it, so fixing one landmark doesn't disturb its neighbours.
      const own = l.slug && existsSync(`${DIR}/landmarks/${l.slug}.png`) ? `${DIR}/landmarks/${l.slug}.png` : `${opt.from}/${o.c}_${o.r}.png`;
      const data = (await readFile(own)).toString("base64");
      await page.evaluate((args) => window.placeLandmark(args), { data, x: o.c * m.step, y: o.r * m.step, T: m.tile, cx: gx, cy: gy, R: l.radius ?? 260 });
    }

    // Spot fixes (paint/patches.json): a corrected repaint of one tile, used only
    // in a cut-out around each mistake it fixes, so the rest keeps the original.
    for (const p of patches) {
      const [c, r] = p.tile.split("_").map(Number);
      const x = c * m.step, y = r * m.step;
      if (!touches(y, y + m.tile)) continue;
      const data = (await readFile(`${DIR}/${p.from}/${p.tile}.png`)).toString("base64");
      await page.evaluate((args) => window.placeLandmark(args), {
        data, x, y, T: m.tile, cx: x + (p.x / 100) * m.tile, cy: y + (p.y / 100) * m.tile, R: p.r,
      });
    }

    // Spot repaints (paint/spots.json, from spot.mjs): crops of the painting
    // centred on one thing, pasted last.
    for (const sp of spots) {
      if (!touches(sp.y - sp.size / 2, sp.y + sp.size / 2)) continue;
      const data = (await readFile(`${DIR}/spots/${sp.name}.png`)).toString("base64");
      await page.evaluate((args) => window.placeLandmark(args), {
        // `dy` moves the cut's centre off the crop's, for tall things.
        data, x: sp.x - sp.size / 2, y: sp.y - sp.size / 2, T: sp.size, cx: sp.x, cy: sp.y + (sp.dy ?? 0), R: sp.r,
      });
    }

  // Brick that shouldn't be: red walls on buildings the data says aren't
  // brick (paint/stonemask, from 1-base.mjs --mask) become cream stone,
  // keeping the painting's shading and windows. Roofs aren't touched.
  // Tile by tile: a mosaic-sized mask canvas doesn't fit in memory for all
  // of Paris. Overlaps are recoloured twice, which changes nothing the
  // second time since the brick is gone.
  if (existsSync(`${DIR}/stonemask`)) {
    let n = 0;
    for (const { c, r } of m.tiles) {
      if (r < rFirst || r > rLast) continue;
      const file = `${DIR}/stonemask/${c}_${r}.png`;
      if (!existsSync(file)) continue;
      const data = (await readFile(file)).toString("base64");
      n += await page.evaluate(async ({ data, x, y, T }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const kc = document.createElement("canvas");
        kc.width = kc.height = T;
        const kg = kc.getContext("2d", { willReadFrequently: true });
        kg.drawImage(img, 0, 0);
        const k = kg.getImageData(0, 0, T, T).data;
        const mg = window.mosaic.getContext("2d", { willReadFrequently: true });
        const ly = y - window.OY;
        if (ly >= window.mosaic.height || ly + T <= 0) return 0;
        const bw = Math.min(T, window.mosaic.width - x), bh = T;
        const im = mg.getImageData(x, ly, bw, bh), a = im.data;
        // Cream stone, lit and shaded faces averaged; brick's own brightness maps onto it.
        const STONE = [236, 222, 193], BRICK_LUM = 118;
        let changed = 0;
        for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++) {
          const i = (yy * bw + xx) * 4, q = (yy * T + xx) * 4;
          if (k[q] < 128 || !a[i + 3]) continue;
          const R = a[i], G = a[i + 1], Bl = a[i + 2];
          // Brick red to brown: red well above green, green above or near blue.
          if (!(R - G > 28 && R - Bl > 40 && G >= Bl - 12 && R > 70)) continue;
          const lum = 0.3 * R + 0.59 * G + 0.11 * Bl;
          const f = Math.min(1.08, Math.max(0.55, lum / BRICK_LUM));
          a[i] = STONE[0] * f; a[i + 1] = STONE[1] * f; a[i + 2] = STONE[2] * f;
          changed++;
        }
        mg.putImageData(im, x, ly);
        return changed;
      }, { data, x: c * m.step, y: r * m.step, T: m.tile });
    }
    recoloured += n;
  }

  // Keep only the area itself, fading out over the last stretch of its edge
  // so it blends into the live map around it. Applied in bands, with a
  // margin for the blur, since a mosaic-sized mask doesn't fit in memory.
  await page.evaluate(({ poly, ox, oy, Z, FEATHER }) => {
    const W = window.mosaic.width, H = window.mosaic.height, BAND = 2048, M = FEATHER;
    // Shrink the outline toward its centre so the fade stays inside it.
    const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length, cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
    const pts = poly.map(([x, y]) => {
      const d = Math.hypot(x - cx, y - cy), k = Math.max(0, 1 - FEATHER / Z / d);
      return [(cx + (x - cx) * k - ox) * Z, (cy + (y - cy) * k - oy) * Z - window.OY];
    });
    const g = window.mosaic.getContext("2d");
    for (let y0 = 0; y0 < H; y0 += BAND) {
      const bh = Math.min(BAND, H - y0);
      const mask = document.createElement("canvas");
      mask.width = W;
      mask.height = bh + 2 * M;
      const mg = mask.getContext("2d");
      mg.filter = `blur(${FEATHER / 2}px)`;
      mg.beginPath();
      pts.forEach(([x, y], i) => (i ? mg.lineTo : mg.moveTo).call(mg, x, y - y0 + M));
      mg.closePath();
      mg.fill();
      g.save();
      g.beginPath();
      g.rect(0, y0, W, bh);
      g.clip();
      g.globalCompositeOperation = "destination-in";
      g.drawImage(mask, 0, y0 - M);
      g.restore();
    }
  }, { poly: m.polygon, ox: m.origin[0], oy: m.origin[1], Z: m.zoom, FEATHER: 160 });

    // This band's own chunks.
    for (let r = Y0 / CHUNK; r < Math.ceil(Y1 / CHUNK); r++) {
      for (let c = 0; c < Math.ceil(m.width / CHUNK); c++) {
        const url = await page.evaluate(({ c, r, C }) => {
          const t = document.createElement("canvas");
          t.width = t.height = C;
          const g = t.getContext("2d");
          g.drawImage(window.mosaic, c * C, r * C - window.OY, C, C, 0, 0, C, C);
          // Skip chunks with nothing in them.
          const a = g.getImageData(0, 0, C, C).data;
          for (let i = 3; i < a.length; i += 64) if (a[i]) return t.toDataURL("image/webp", 0.86);
          return null;
        }, { c, r, C: CHUNK });
        if (!url) continue;
        await writeFile(`${OUT}/0/${c}_${r}.webp`, Buffer.from(url.split(",")[1], "base64"));
        level0.push([c, r]);
      }
    }
    console.log(`\nband ${Y0}–${Y1}: ${level0.length} chunks so far`);
  }
  if (patches.length) console.log(`${patches.length} spot fixes`);
  if (spots.length) console.log(`${spots.length} spot repaints`);
  console.log(`${(recoloured / 1e6).toFixed(1)} Mpx of brick recoloured to stone`);

  // Coarser levels, each from the one below: 2×2 chunks into one.
  const levels = [{ scale: LEVELS[0], chunks: level0 }];
  for (let li = 1; li < LEVELS.length; li++) {
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

  const manifest = { rotation: m.rotation, zoom: m.zoom, origin: m.origin, chunk: CHUNK, levels, polygon: m.polygon, area: m.area };
  await writeFile(`${OUT}/manifest.json`, JSON.stringify(manifest));
} finally {
  await close();
}
