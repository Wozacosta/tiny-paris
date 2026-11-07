// Hooks used by scripts/paint to render base tiles for AI painting.
// Only installed when the page is opened with ?export.

import type { World } from "./model";
import { buildRotView, drawGround, drawStructures, worldToIso, type Rotation, type RotView } from "./render";
import { DAY } from "./theme";

export interface TinyExport {
  /** Iso-space corners of a lon/lat box at ground level, for a view rotation. */
  corners(r: Rotation, w: number, s: number, e: number, n: number): [number, number][];
  /** PNG data URL of the day map (no traffic, labels or UI) for one camera. */
  render(r: Rotation, cx: number, cy: number, zoom: number, width: number, height: number): string;
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
    render(r, cx, cy, zoom, width, height) {
      const view = (views[r] ??= buildRotView(world, r));
      const make = () => {
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        return c;
      };
      const ground = make(), build = make(), out = make();
      const cam = { cx, cy, zoom };
      drawGround(ground.getContext("2d")!, world, view, cam, DAY, 1);
      drawStructures(build.getContext("2d")!, world, view, cam, DAY, 1);
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
