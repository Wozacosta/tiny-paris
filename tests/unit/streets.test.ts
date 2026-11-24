// paris-streets.json names roads by their index in the city file: it must
// have been made from the same one (`node scripts/fetch-streets.mjs`).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LIGHT_CYCLE, makeLane, markLane, pointSet, type Streets } from "../../src/model";

const streets: Streets = JSON.parse(readFileSync("public/data/paris-streets.json", "utf8"));
const city = JSON.parse(readFileSync("public/data/paris.json", "utf8"));

describe("paris-streets.json", () => {
  it("was made from this city file", () => {
    expect(streets.roads).toBe(city.roads.length);
    for (const i of [...streets.oneway, ...streets.onewayBack]) expect(i).toBeLessThan(city.roads.length);
  });

  it("knows the one-way streets, by name", () => {
    const nameOf = new Map<number, string>();
    for (let i = 0; i < streets.named.length; i += 2) nameOf.set(streets.named[i], streets.names[streets.named[i + 1]]);
    const oneway = new Set(streets.oneway.map((i) => nameOf.get(i)));
    // The Étoile and the ring road go one way round; a small two-way street doesn't.
    expect(oneway.has("Place Charles de Gaulle")).toBe(true);
    expect(oneway.has("Boulevard Périphérique Intérieur")).toBe(true);
    expect(streets.names).toContain("Rue Dénoyez");
  });

  it("has lights and stops in their thousands", () => {
    expect(streets.signals.length / 2).toBeGreaterThan(3000);
    expect(streets.busStops.length / 2).toBeGreaterThan(1500);
    expect(streets.metroStops.length / 2).toBeGreaterThan(300);
  });
});

describe("markLane", () => {
  // A street 300 m long running east, a vertex every 100 m, in decimetres.
  const p = [0, 0, 1000, 0, 2000, 0, 3000, 0];
  const lane = () => makeLane(Float64Array.from(p, (v) => v / 10), 4, true, "bus");

  it("finds the stops and lights that are vertices of the lane", () => {
    const l = lane();
    markLane(l, p, pointSet([1000, 0, 3000, 0]), pointSet([2000, 0]));
    expect([...l.stops!]).toEqual([100, 300]);
    expect(l.lights![0]).toBe(200);
    expect(l.lights![1]).toBeGreaterThanOrEqual(0);
    expect(l.lights![1]).toBeLessThan(LIGHT_CYCLE);
    expect(l.lights![2]).toBe(0); // east-west
  });

  it("takes stops closer than 120 m as one", () => {
    const l = lane();
    markLane(l, p, pointSet([0, 0, 1000, 0, 3000, 0]), null);
    expect([...l.stops!]).toEqual([0, 300]);
  });

  it("gives crossing streets the same light, on opposite phases", () => {
    const across = [2000, -1000, 2000, 0, 2000, 1000];
    const a = lane(), b = makeLane(Float64Array.from(across, (v) => v / 10), 4, true, "bus");
    markLane(a, p, null, pointSet([2000, 0]));
    markLane(b, across, null, pointSet([2000, 0]));
    expect(b.lights![1]).toBe(a.lights![1]);
    expect(b.lights![2]).toBe(1);
  });
});
