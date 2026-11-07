// Pre-rendered 3D sprites (scripts/sprites/bake.mjs): each sheet has one
// column per heading and one row per animation frame, drawn with the map's
// own isometric projection, so they drop straight into iso space.

import { worldToIso, type Rotation } from "./render";

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

// x' = a·x + b·y, y' = c·x + d·y (same table as render.ts).
const ROT: [number, number, number, number][] = [
  [1, 0, 0, 1],
  [0, -1, 1, 0],
  [-1, 0, 0, -1],
  [0, 1, -1, 0],
];

export class Sprites {
  private meta: Record<string, Meta> = {};
  private images = new Map<string, HTMLImageElement>();

  static async load(): Promise<Sprites> {
    const s = new Sprites();
    const res = await fetch("/sprites/sprites.json");
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
      img.src = `/sprites/${id}.webp`;
      this.images.set(id, img);
    }
    return img.complete && img.naturalWidth ? img : null;
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
    ctx.drawImage(img, col * m.cellW, row * m.cellH, m.cellW, m.cellH, sx - m.anchorX * k, sy - m.anchorY * k, m.cellW * k, m.cellH * k);
    return true;
  }
}
