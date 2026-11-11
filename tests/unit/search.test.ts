import { describe, expect, it } from "vitest";
import { fold, placeNote, queryWords, rank } from "../../src/search";

describe("search", () => {
  it("ignores accents, case and punctuation", () => {
    expect(fold("Saint-Jean de l'Île")).toBe("saint jean de l ile");
    expect(rank(fold("Théâtre des Champs-Élysées"), queryWords("champs elysees"))).not.toBeNull();
  });

  it("matches words from their start, in any order", () => {
    const text = fold("Carreau du Temple 4 Rue Eugène Spuller");
    expect(rank(text, queryWords("temple carreau"))).not.toBeNull();
    expect(rank(text, queryWords("spul"))).not.toBeNull();
    expect(rank(text, queryWords("emple"))).toBeNull();
  });

  it("reads the usual abbreviations", () => {
    expect(rank(fold("Saint-Eustache"), queryWords("st eustache"))).not.toBeNull();
    expect(rank(fold("12 Boulevard Voltaire"), queryWords("bd voltaire"))).not.toBeNull();
  });

  it("puts names that start with the query first", () => {
    const words = queryWords("louvre");
    expect(rank(fold("Louvre"), words)!).toBeLessThan(rank(fold("Palais du Louvre"), words)!);
  });

  it("names arrondissements from postcodes", () => {
    expect(placeNote("75001", "Paris")).toBe("1er");
    expect(placeNote("75003", "Paris")).toBe("3e");
    expect(placeNote("75116", "Paris")).toBe("16e");
    expect(placeNote("92800", "Puteaux")).toBe("Puteaux");
  });
});

describe("search numbers", () => {
  it("matches house numbers whole", () => {
    expect(rank(fold("126 Rue de Rivoli"), queryWords("12 rue de rivoli"))).toBeNull();
    expect(rank(fold("12 Rue de Rivoli"), queryWords("12 rivoli"))).not.toBeNull();
  });
});
