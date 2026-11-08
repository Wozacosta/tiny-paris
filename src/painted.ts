// The AI-painted part of the map (see scripts/paint). It was rendered for one
// view rotation; in that rotation it is drawn over the live map, aligned
// pixel for pixel, at whichever resolution level suits the current zoom.

import type { Camera, Rotation } from "./render";

interface Manifest {
  rotation: Rotation;
  /** Mosaic pixels per iso unit at level scale 1. */
  zoom: number;
  origin: [number, number];
  chunk: number;
  levels: { scale: number; chunks: [number, number][] }[];
}

/** Decoded chunks kept at most, about 4 MB each. */
const KEEP = 64;

export class PaintedLayer {
  // Chunks are decoded off the main thread (createImageBitmap) before they are
  // drawn: an <img> decodes on its first draw, which stalls zooming.
  private chunks = new Map<string, ImageBitmap | "loading">();
  private used = new Map<string, number>();
  private frame = 0;

  private constructor(private m: Manifest, private onLoad: () => void) {}

  static async load(onLoad: () => void): Promise<PaintedLayer | null> {
    const res = await fetch("/painted/manifest.json");
    if (!res.ok || !res.headers.get("content-type")?.includes("json")) return null;
    return new PaintedLayer(await res.json(), onLoad);
  }

  get rotation() {
    return this.m.rotation;
  }

  private image(level: number, c: number, r: number) {
    const key = `${level}/${c}_${r}`;
    const got = this.chunks.get(key);
    if (got === undefined) {
      this.chunks.set(key, "loading");
      fetch(`/painted/${key}.webp`)
        .then((res) => res.blob())
        .then((blob) => createImageBitmap(blob))
        .then((bitmap) => {
          this.chunks.set(key, bitmap);
          this.used.set(key, this.frame);
          this.evict();
          this.onLoad();
        })
        .catch(() => this.chunks.delete(key));
      return null;
    }
    if (got === "loading") return null;
    this.used.set(key, this.frame);
    return got;
  }

  /** Resolves once every chunk asked for so far has arrived. */
  settled(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => ([...this.chunks.values()].includes("loading") ? setTimeout(check, 50) : resolve());
      check();
    });
  }

  /** Frees the chunks unused for longest, past KEEP, never those of this frame. */
  private evict() {
    const loaded = [...this.used].filter(([, f]) => f < this.frame).sort((a, b) => a[1] - b[1]);
    for (let n = this.used.size - KEEP, i = 0; n > 0 && i < loaded.length; n--, i++) {
      const [key] = loaded[i];
      const b = this.chunks.get(key);
      if (b && b !== "loading") b.close();
      this.chunks.delete(key);
      this.used.delete(key);
    }
  }

  /** `cam.zoom` is canvas pixels per iso unit; the context must be untransformed. */
  draw(ctx: CanvasRenderingContext2D, cam: Camera, rotation: Rotation) {
    if (rotation !== this.m.rotation) return;
    this.frame++;
    const { width: cw, height: ch } = ctx.canvas;
    const z = cam.zoom;
    ctx.setTransform(z, 0, 0, z, cw / 2 - cam.cx * z, ch / 2 - cam.cy * z);
    ctx.imageSmoothingEnabled = true;
    const vx0 = cam.cx - cw / 2 / z, vx1 = cam.cx + cw / 2 / z;
    const vy0 = cam.cy - ch / 2 / z, vy1 = cam.cy + ch / 2 / z;

    // Finest level that still has at least one mosaic pixel per screen pixel.
    const want = z / this.m.zoom;
    let target = 0;
    this.m.levels.forEach((l, i) => {
      if (l.scale >= want) target = i;
    });
    // Chunks of a level in view, with their images where loaded.
    const inView = (li: number) => {
      const { scale, chunks } = this.m.levels[li];
      const size = this.m.chunk / scale / this.m.zoom; // chunk size in iso units
      const out: { x: number; y: number; size: number; img: ImageBitmap | null }[] = [];
      for (const [c, r] of chunks) {
        const x = this.m.origin[0] + c * size, y = this.m.origin[1] + r * size;
        if (x > vx1 || y > vy1 || x + size < vx0 || y + size < vy0) continue;
        out.push({ x, y, size, img: this.image(li, c, r) });
      }
      return out;
    };
    const sharp = inView(target);
    // The coarsest level as a backdrop, only while sharper chunks load.
    const last = this.m.levels.length - 1;
    const layers = target !== last && sharp.some((t) => !t.img) ? [inView(last), sharp] : [sharp];
    for (const layer of layers) for (const t of layer) if (t.img) ctx.drawImage(t.img, t.x, t.y, t.size, t.size);
  }
}
