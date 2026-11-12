import { describe, expect, it } from "vitest";
import { makeLane, rampHeights } from "../../src/model";
import { trackPieces } from "../../src/tracks";

/** A straight line 400 m long whose height changes every 100 m. */
function line(heights: number[]) {
  const n = heights.length * 10 + 1;
  const flat = new Float64Array(n * 2), zs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    flat[i * 2] = i * 10;
    zs[i] = heights[Math.min(heights.length - 1, Math.floor(i / 10))];
  }
  return makeLane(flat, 0, true, "metro", zs);
}

describe("métro structures", () => {
  const pieces = trackPieces([line([7, 2, 0, -12])], 8, 14);
  const at = (x: number) => pieces.find((p) => Math.abs(p.x - x) <= 4);

  it("puts a viaduct on columns where the line is high", () => {
    expect(at(50)?.kind).toBe("viaduct");
    expect(pieces.filter((p) => p.kind === "viaduct").some((p) => p.pillar)).toBe(true);
  });

  it("brings it down on a ramp, then into a trench at street level", () => {
    expect(at(150)?.kind).toBe("ramp");
    expect(at(250)?.kind).toBe("trench");
  });

  it("builds nothing in the tunnel", () => {
    expect(at(350)).toBeUndefined();
  });

  it("covers the line without gaps above the tunnel", () => {
    const xs = pieces.map((p) => p.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeLessThanOrEqual(8.01);
  });
});

describe("ramps", () => {
  // A line in metres (scale 1): viaduct, 200 m untagged, tunnel, in two ways meeting at x = 100.
  const way = (line: string, xs: number[], z: number[]) => ({ line, p: xs.flatMap((x) => [x, 0]), z });
  it("slopes the untagged stretch from the viaduct down to the tunnel mouth, across ways", () => {
    const [viaduct, rest] = rampHeights([way("2", [0, 50, 100], [7, 7, 7]), way("2", [100, 200, 300, 400], [0, 0, -12, -12])], 1);
    expect(viaduct).toEqual([7, 7, 7]);
    expect(rest[0]).toBe(7);
    expect(rest[1]).toBeCloseTo(1);
    expect(rest[2]).toBe(-5);
    expect(rest[3]).toBe(-12);
  });
  it("leaves line 1, and long street-level stretches, alone", () => {
    expect(rampHeights([way("1", [0, 100, 200], [7, 0, -12])], 1)[0]).toEqual([7, 0, -12]);
    expect(rampHeights([way("6", [0, 300, 600], [7, 0, -12])], 1)[0]).toEqual([7, 0, -12]);
  });
});
