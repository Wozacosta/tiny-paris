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

export class PaintedLayer {
  private images = new Map<string, HTMLImageElement>();

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
    let img = this.images.get(key);
    if (!img) {
      img = new Image();
      img.onload = this.onLoad;
      img.src = `/painted/${key}.webp`;
      this.images.set(key, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  /** `cam.zoom` is canvas pixels per iso unit; the context must be untransformed. */
  draw(ctx: CanvasRenderingContext2D, cam: Camera, rotation: Rotation) {
    if (rotation !== this.m.rotation) return;
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
      const out: { x: number; y: number; size: number; img: HTMLImageElement | null }[] = [];
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
