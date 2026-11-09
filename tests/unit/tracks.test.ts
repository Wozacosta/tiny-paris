import { describe, expect, it } from "vitest";
import { makeLane } from "../../src/model";
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
