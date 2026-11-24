import { describe, expect, it } from "vitest";
import { parisNight, parisSun } from "../../src/sun";

const near = (ms: number, iso: string) => expect(Math.abs(ms - Date.parse(iso)) / 60000).toBeLessThan(6);

describe("the sun over Paris", () => {
  it("rises and sets when the almanac says, to a few minutes", () => {
    const june = parisSun(Date.parse("2026-06-21T12:00:00Z"));
    near(june.rise, "2026-06-21T03:47:00Z");
    near(june.set, "2026-06-21T19:58:00Z");
    const december = parisSun(Date.parse("2026-12-21T12:00:00Z"));
    near(december.rise, "2026-12-21T07:41:00Z");
    near(december.set, "2026-12-21T15:56:00Z");
  });

  it("makes it night at midnight and day at noon, whatever the hour asked at", () => {
    expect(parisNight(Date.parse("2026-11-24T23:30:00Z"))).toBe(true);
    expect(parisNight(Date.parse("2026-11-25T00:30:00Z"))).toBe(true);
    expect(parisNight(Date.parse("2026-11-24T11:00:00Z"))).toBe(false);
    expect(parisNight(Date.parse("2026-06-21T19:00:00Z"))).toBe(false);
  });
});
