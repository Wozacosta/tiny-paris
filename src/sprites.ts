// Pre-rendered 3D sprites (scripts/sprites/bake.mjs): each sheet has one
// column per heading and one row per animation frame, drawn with the map's
// own isometric projection, so they drop straight into iso space.

import { asset } from "./assets";
import { ROT, worldToIso, type Rotation } from "./render";

interface Meta {
  cellW: number;
  cellH: number;
  anchorX: number;
  anchorY: number;
  /** Sprite pixels per iso unit. */
  P: number;
  dirs: number;
  frames: number;
}


export class Sprites {
  private meta: Record<string, Meta> = {};
  private images = new Map<string, HTMLImageElement>();
  /** Each sheet halved again and again, so small sprites aren't shrunk from full size every frame. */
  private mips = new Map<string, ImageBitmap[]>();

  static async load(): Promise<Sprites> {
    const s = new Sprites();
    const res = await fetch(asset("/sprites/sprites.json"));
    if (res.ok && res.headers.get("content-type")?.includes("json")) s.meta = await res.json();
    return s;
  }

  has(id: string) {
    return id in this.meta;
  }

  private image(id: string) {
    let img = this.images.get(id);
    if (!img) {
      img = new Image();
      img.onload = () => this.shrink(id, img!);
      img.src = asset(`/sprites/${id}.webp`);
      this.images.set(id, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  private async shrink(id: string, img: HTMLImageElement) {
    const levels: ImageBitmap[] = [];
    let src: CanvasImageSource = img;
    for (let w = img.naturalWidth, h = img.naturalHeight, k = 0; k < 4; k++) {
      w = Math.max(1, Math.round(w / 2));
      h = Math.max(1, Math.round(h / 2));
      src = await createImageBitmap(src, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
      levels.push(src);
    }
    this.mips.set(id, levels);
  }

  /**
   * Draws sprite `id` standing at world (x, y, z), heading (tx, ty) in world
   * axes. `t` picks the animation frame (cycles). Returns false if not ready.
   * The context must carry the camera transform for iso units.
   */
  draw(ctx: CanvasRenderingContext2D, r: Rotation, id: string, x: number, y: number, z: number, tx: number, ty: number, t = 0, scale = 1) {
    const m = this.meta[id];
    const img = m && this.image(id);
    if (!m || !img) return false;
    const [a, b, c, d] = ROT[r];
    const hx = a * tx + b * ty, hy = c * tx + d * ty;
    const theta = Math.atan2(hy, hx);
    const col = ((Math.round((theta / (Math.PI * 2)) * m.dirs) % m.dirs) + m.dirs) % m.dirs;
    const row = m.frames > 1 ? Math.floor(((t % 1) + 1) % 1 * m.frames) : 0;
    const [sx, sy] = worldToIso(r, x, y, z);
    const k = scale / m.P;
    // The smallest level still at least as sharp as the screen needs.
    const mips = this.mips.get(id);
    const level = mips ? Math.max(0, Math.min(mips.length, Math.floor(-Math.log2(ctx.getTransform().a * k)))) : 0;
    const src = level ? mips![level - 1] : img;
    const f = level ? src.width / img.naturalWidth : 1;
    ctx.drawImage(src, col * m.cellW * f, row * m.cellH * f, m.cellW * f, m.cellH * f, sx - m.anchorX * k, sy - m.anchorY * k, m.cellW * k, m.cellH * k);
    return true;
  }
}
