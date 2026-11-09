// paris.bin (what the app loads) must say exactly what paris.json (what the
// paint scripts read) says: re-run `node scripts/pack.mjs` after changing it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { unpack } from "../../src/model";

const json = JSON.parse(readFileSync("public/data/paris.json", "utf8"));
const file = readFileSync("public/data/paris.bin");
const bin = unpack(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));

const same = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.prototype.every.call(a, (v: number, i: number) => v === b[i]);

describe("paris.bin", () => {
  it("has the same frame", () => {
    expect(bin.origin).toEqual(json.origin);
    expect(bin.bounds).toEqual(json.bounds);
    expect(bin.scale).toBe(json.scale);
    expect(bin.boundary).toEqual(json.boundary);
    expect(bin.metro).toEqual(json.metro);
  });

  it("has every building, with its outline, height and tags", () => {
    expect(bin.buildings).toHaveLength(json.buildings.length);
    json.buildings.forEach((b: { r: number[][]; h?: number; i?: object }, i: number) => {
      const got = bin.buildings[i];
      if (got.r.length !== b.r.length || !b.r.every((ring, k) => same(got.r[k], ring)) || got.h !== b.h) {
        throw new Error(`building ${i} differs`);
      }
      expect(got.i).toEqual(b.i);
    });
  });

  it("has every road, park, water body, bridge and tree", () => {
    expect(bin.roads).toHaveLength(json.roads.length);
    json.roads.forEach((r: { k: string; w: number; p: number[] }, i: number) => {
      const got = bin.roads[i];
      if (got.k !== r.k || got.w !== r.w || !same(got.p, r.p)) throw new Error(`road ${i} differs`);
    });
    expect(bin.parks.map((p) => p.k)).toEqual(json.parks.map((p: { k: string }) => p.k));
    expect(bin.parks.every((p, i) => p.r.every((ring, k) => same(ring, json.parks[i].r[k])))).toBe(true);
    expect(bin.water.every((w, i) => w.every((ring, k) => same(ring, json.water[i][k])))).toBe(true);
    expect(bin.bridges.every((b, i) => b.every((ring, k) => same(ring, json.bridges[i][k])))).toBe(true);
    expect(same(bin.trees, json.trees.flat())).toBe(true);
  });

  it("carries what pack works out, one entry per building and road", () => {
    expect(bin.bd).toHaveLength(json.buildings.length);
    expect(bin.bd.filter(Boolean).length).toBeGreaterThan(json.buildings.length / 2);
    expect(bin.through).toHaveLength(json.roads.length);
  });
});
