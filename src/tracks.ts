// Métro structures along the tracks: viaducts on columns, solid ramps between
// walls where a line comes down to the street, and open trenches where it
// dives into its tunnel. Drawn live with the trains, and in the base render
// the painting follows, so both show the same thing.

import type { Lane } from "./model";
import { depthOf, worldToIso, type Rotation } from "./render";
import { box, sample, type Sample } from "./shapes";

/** Below this height a line runs on a solid ramp rather than on columns. */
const RAMP_TOP = 4.5;
/** Track this far below the street is in the tunnel: deep enough to hide a train. */
const PORTAL = -4.5;
/** Track at street level (neither bridge nor tunnel in the map data) runs in a cutting this deep: Paris has no métro on the street itself. */
const CUTTING = -3;

export interface TrackPiece extends Sample {
  /** Index of its line in world.metro. */
  lane: number;
  /** Length along the track. */
  L: number;
  kind: "viaduct" | "ramp" | "trench";
  pillar: boolean;
}

export interface TrackStyle {
  deckW: number;
  deckH: number;
  deck: [side: string, top: string];
  stone: [side: string, top: string];
  /** Columns: one in the middle, or a pair this far either side of it. */
  pillarW: number;
  pillarPair?: number;
  trench: string;
}

/** The structure under each `step` metres of every line, wherever it isn't level with the street. */
export function trackPieces(metro: Lane[], step: number, pillarEvery: number): TrackPiece[] {
  const out: TrackPiece[] = [];
  metro.forEach((l, lane) => {
    for (let s = 0; s < l.len; s += step) {
      const L = Math.min(step, l.len - s);
      const p = sample(l, s + L / 2);
      if (p.z <= PORTAL) continue;
      const kind = p.z >= RAMP_TOP ? "viaduct" : p.z > 0.3 ? "ramp" : "trench";
      out.push({ ...p, lane, L: L + 0.4, kind, pillar: Math.floor((s + step) / pillarEvery) !== Math.floor(s / pillarEvery) });
    }
  });
  return out;
}

/** Depth to sort a piece by: just behind whatever stands on it. */
export function pieceDepth(r: Rotation, p: TrackPiece) {
  return depthOf(r, p.x, p.y) - 0.5;
}

export function drawTrackPiece(ctx: CanvasRenderingContext2D, r: Rotation, p: TrackPiece, st: TrackStyle) {
  const { x, y, z, tx, ty, L } = p;
  if (p.kind === "trench") {
    // Seen through its opening in the street: the floor down at track level
    // and the inside of the walls, so it reads as a cutting, not a deck.
    const hw = st.deckW / 2 + 0.3, hl = L / 2, depth = Math.max(PORTAL, Math.min(z, CUTTING));
    const nx = -ty, ny = tx;
    ctx.save();
    ctx.beginPath();
    for (const [a, b] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
      const [sx, sy] = worldToIso(r, x + tx * hl * a + nx * hw * b, y + ty * hl * a + ny * hw * b);
      ctx.lineTo(sx, sy);
    }
    ctx.clip();
    for (const side of [-1, 1]) {
      const off = side * hw;
      box(ctx, r, x - ty * off, y + tx * off, depth, tx, ty, L, 0.4, -depth, st.stone[0], null);
    }
    box(ctx, r, x, y, depth, tx, ty, L, st.deckW, 0.02, st.trench, st.trench);
    ctx.restore();
    // Low parapets along the top.
    for (const side of [-1, 1]) {
      const off = side * hw;
      box(ctx, r, x - ty * off, y + tx * off, 0, tx, ty, L, 0.4, 0.9, st.stone[0], st.stone[1]);
    }
    return;
  }
  const bottom = Math.max(0, z - st.deckH);
  if (p.kind === "ramp") {
    // A solid embankment between retaining walls, not columns.
    if (bottom > 0) box(ctx, r, x, y, 0, tx, ty, L, st.deckW, bottom, st.stone[0], null);
  } else if (p.pillar) {
    for (const off of st.pillarPair ? [-st.pillarPair, st.pillarPair] : [0]) {
      box(ctx, r, x - ty * off, y + tx * off, 0, tx, ty, st.pillarW, st.pillarW, bottom, st.stone[0], st.stone[1]);
    }
  }
  box(ctx, r, x, y, bottom, tx, ty, L, st.deckW, z - bottom, st.deck[0], st.deck[1]);
}
