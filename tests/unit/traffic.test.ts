// Traffic on a toy town: a square of four one-way streets, 200 m a side.
import { describe, expect, it } from "vitest";
import { makeLane, type Lane, type Transit, type World } from "../../src/model";
import { Traffic } from "../../src/traffic";

function town(): World {
  const corners = [[0, 0], [200, 0], [200, 200], [0, 200]];
  const streets: Lane[] = corners.map((c, i) => {
    const d = corners[(i + 1) % 4];
    const lane = makeLane(Float64Array.from([...c, ...d]), 3, false, "residential");
    lane.oneway = 1;
    return lane;
  });
  const junctions = new Map<string, number[]>();
  streets.forEach((l, i) => {
    for (const e of [l.a, l.b]) junctions.set(e, [...(junctions.get(e) ?? []), i]);
  });
  return {
    streets, junctions, metro: [], walks: [], walkJunctions: new Map(), rails: [], greens: [], buildings: [],
    trees: new Float64Array(0), boundary: new Float64Array(0), bounds: [0, 0, 200, 200],
    onMap: () => true, onWater: () => false, project: (x: number, y: number) => [x, y], unproject: (x: number, y: number) => [x, y],
  } as unknown as World;
}
const nothing: Transit = { lines: [], velib: [], waterways: [], squares: [] };

interface V { kind: number; lane: number; s: number; dir: 1 | -1; room: number; sub: number; wait: number; ramp: number }
const inside = (t: Traffic) => t as unknown as { vehicles: V[]; time: number; findRoom(): void; redAhead(l: Lane, s: number, dir: 1 | -1, d: number): number | null };

describe("traffic", () => {
  it("never drives a car the wrong way up a one-way street", () => {
    const t = new Traffic(town(), nothing);
    const cars = inside(t).vehicles.filter((v) => v.kind === 0);
    expect(cars.length).toBeGreaterThan(10);
    for (let i = 0; i < 1200; i++) {
      t.step(0.1, 5);
      for (const v of cars) expect(v.dir).toBe(1);
    }
  });

  it("gives the car behind only the room up to the car in front", () => {
    const t = new Traffic(town(), nothing);
    const [a, b, ...rest] = inside(t).vehicles.filter((v) => v.kind === 0);
    for (const v of rest) v.lane = 3;
    Object.assign(a, { lane: 0, s: 100, dir: 1, sub: 0 });
    Object.assign(b, { lane: 0, s: 80, dir: 1, sub: 0 });
    inside(t).findRoom();
    expect(a.room).toBe(Infinity);
    // 20 m apart centre to centre, less a car's length and a gap.
    expect(b.room).toBeCloseTo(20 - 4.4 - 1.5);
  });

  it("stops at a red light and goes on green", () => {
    const t = new Traffic(town(), nothing);
    const lane = makeLane(Float64Array.from([0, 0, 300, 0]), 3, false, "residential");
    // A light 100 m along, east-west street, no phase offset: red for the first half of the cycle.
    lane.lights = Float64Array.from([100, 0, 0]);
    inside(t).time = 1;
    expect(inside(t).redAhead(lane, 92, 1, 2)).toBe(93); // the stop line, 7 m before the crossing
    expect(inside(t).redAhead(lane, 50, 1, 2)).toBeNull(); // not there yet
    expect(inside(t).redAhead(lane, 95, 1, 2)).toBeNull(); // already past the line
    inside(t).time = 23;
    expect(inside(t).redAhead(lane, 92, 1, 2)).toBeNull(); // green
  });
});
