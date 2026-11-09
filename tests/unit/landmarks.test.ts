import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LANDMARKS, TOP, slug } from "../../src/landmarks";

describe("landmarks", () => {
  it("slugs names to plain file names", () => {
    expect(slug("Sacré-Cœur")).toBe("sacre-coeur");
    expect(slug("Musée d'Orsay")).toBe("musee-d-orsay");
    expect(slug("Notre-Dame")).toBe("notre-dame");
    expect(slug("  Tour Eiffel ")).toBe("tour-eiffel");
  });

  it("has unique names, all inside the map", () => {
    expect(new Set(LANDMARKS.map((l) => l.name)).size).toBe(LANDMARKS.length);
    for (const l of LANDMARKS) {
      expect(l.lon, l.name).toBeGreaterThan(2.2);
      expect(l.lon, l.name).toBeLessThan(2.42);
      expect(l.lat, l.name).toBeGreaterThan(48.81);
      expect(l.lat, l.name).toBeLessThan(48.91);
    }
  });

  it("has the ten for the strip, each with its picture", () => {
    expect(TOP).toHaveLength(10);
    for (const l of TOP) {
      expect(l, "a TOP name missing from LANDMARKS").toBeDefined();
      expect(existsSync(`public/thumbs/${slug(l.name)}.webp`), l.name).toBe(true);
    }
  });
});
