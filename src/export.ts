// Hooks used by scripts/paint to render base tiles for AI painting.
// Only installed when the page is opened with ?export.

import type { World } from "./model";
import { buildRotView, drawGround, drawStructures, isoToWorld, worldToIso, type Photo, type Rotation, type RotView } from "./render";
import { DAY } from "./theme";

export interface TinyExport {
  /** Iso-space corners of a lon/lat box at ground level, for a view rotation. */
  corners(r: Rotation, w: number, s: number, e: number, n: number): [number, number][];
  /**
   * PNG data URL of the day map (no traffic, labels or UI) for one camera,
   * with roofs and ground textured from the aerial photos if they're downloaded.
   */
  render(r: Rotation, cx: number, cy: number, zoom: number, width: number, height: number, photo?: boolean): Promise<string>;
}

/** paint/ortho/index.json, from scripts/paint/0-ortho.mjs. */
interface OrthoIndex { side: number; px: number; x0: number; y0: number; cols: number; rows: number }

/** Tallest roof worth texturing, in metres: how far below the view a roof can come from. */
const MAX_H = 120;

let orthoIndex: Promise<OrthoIndex | null> | null = null;
const orthoTiles = new Map<string, Promise<HTMLImageElement | null>>();

function orthoTile(i: number, j: number) {
  const key = `${i}_${j}`;
  let p = orthoTiles.get(key);
  if (!p) {
    const img = new Image();
    img.src = `/paint/ortho/${key}.jpg`;
    orthoTiles.set(key, (p = img.decode().then(() => img, () => null)));
  }
  return p;
}

/** The aerial photo under a view, as one canvas in world metres. */
async function photoFor(r: Rotation, cx: number, cy: number, zoom: number, width: number, height: number): Promise<Photo | undefined> {
  orthoIndex ??= fetch("/paint/ortho/index.json").then((res) => (res.ok ? res.json() : null), () => null);
  const ix = await orthoIndex;
  if (!ix) return undefined;
  const hw = width / 2 / zoom, hh = height / 2 / zoom;
  const corners = [[cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh + MAX_H * 1.15], [cx - hw, cy + hh + MAX_H * 1.15]]
    .map(([sx, sy]) => isoToWorld(r, sx, sy));
  const k = ix.px / ix.side;
  const i0 = Math.max(0, Math.floor((Math.min(...corners.map((p) => p[0])) - ix.x0) / ix.side));
  const i1 = Math.min(ix.cols - 1, Math.floor((Math.max(...corners.map((p) => p[0])) - ix.x0) / ix.side));
  const j0 = Math.max(0, Math.floor((Math.min(...corners.map((p) => p[1])) - ix.y0) / ix.side));
  const j1 = Math.min(ix.rows - 1, Math.floor((Math.max(...corners.map((p) => p[1])) - ix.y0) / ix.side));
  if (i1 < i0 || j1 < j0) return undefined;
  const c = document.createElement("canvas");
  c.width = (i1 - i0 + 1) * ix.px;
  c.height = (j1 - j0 + 1) * ix.px;
  const g = c.getContext("2d")!;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const img = await orthoTile(i, j);
    if (img) g.drawImage(img, (i - i0) * ix.px, (j - j0) * ix.px);
  }
  const wx = ix.x0 + i0 * ix.side, wy = ix.y0 + j0 * ix.side;
  return (ctx) => ctx.drawImage(c, wx, wy, c.width / k, c.height / k);
}

export function installExport(world: World) {
  const views: RotView[] = [];
  const api: TinyExport = {
    corners(r, w, s, e, n) {
      return [[w, n], [e, n], [e, s], [w, s]].map(([lon, lat]) => {
        const [x, y] = world.project(lon, lat);
        return worldToIso(r, x, y);
      });
    },
    async render(r, cx, cy, zoom, width, height, photo = true) {
      const view = (views[r] ??= buildRotView(world, r));
      const make = () => {
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        return c;
      };
      const ground = make(), build = make(), out = make();
      const cam = { cx, cy, zoom };
      const ph = photo ? await photoFor(r, cx, cy, zoom, width, height) : undefined;
      drawGround(ground.getContext("2d")!, world, view, cam, DAY, 1, ph);
      drawStructures(build.getContext("2d")!, world, view, cam, DAY, 1, ph);
      const ctx = out.getContext("2d")!;
      ctx.fillStyle = DAY.ground;
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(ground, 0, 0);
      ctx.drawImage(build, 0, 0);
      return out.toDataURL("image/png");
    },
  };
  (window as unknown as { tinyExport: TinyExport }).tinyExport = api;
}
