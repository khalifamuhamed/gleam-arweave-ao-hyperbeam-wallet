import { describe, expect, it } from "vitest";
import { changeSinceYesterday, parsePriceSnapshots, recordPriceSample } from "./snapshots";

const HOUR = 60 * 60 * 1000;
const NOW = 1_000 * HOUR;

describe("changeSinceYesterday", () => {
  it("compares with a sample about a day old", () => {
    expect(changeSinceYesterday([{ at: NOW - 24 * HOUR, usd: 2 }], 3, NOW)).toBeCloseTo(0.5);
  });

  it("prefers the sample closest to 24 hours", () => {
    const samples = [
      { at: NOW - 21 * HOUR, usd: 10 },
      { at: NOW - 26 * HOUR, usd: 4 },
      { at: NOW - 23 * HOUR, usd: 2 },
    ];
    expect(changeSinceYesterday(samples, 3, NOW)).toBeCloseTo(0.5);
  });

  it("shows no change without a sample 20 to 28 hours old", () => {
    expect(changeSinceYesterday([], 3, NOW)).toBeNull();
    expect(changeSinceYesterday([{ at: NOW - 6 * HOUR, usd: 2 }], 3, NOW)).toBeNull();
    expect(changeSinceYesterday([{ at: NOW - 40 * HOUR, usd: 2 }], 3, NOW)).toBeNull();
  });
});

describe("recordPriceSample", () => {
  it("adds a first sample", () => {
    expect(recordPriceSample([], 2, NOW)).toEqual([{ at: NOW, usd: 2 }]);
  });

  it("keeps one sample per spacing window", () => {
    const samples = [{ at: NOW - HOUR, usd: 2 }];
    expect(recordPriceSample(samples, 3, NOW)).toEqual(samples);
  });

  it("adds another once the spacing has passed and drops what is too old", () => {
    const samples = [
      { at: NOW - 40 * HOUR, usd: 1 },
      { at: NOW - 5 * HOUR, usd: 2 },
    ];
    expect(recordPriceSample(samples, 3, NOW)).toEqual([
      { at: NOW - 5 * HOUR, usd: 2 },
      { at: NOW, usd: 3 },
    ]);
  });
});

describe("parsePriceSnapshots", () => {
  it("drops malformed stored data", () => {
    expect(parsePriceSnapshots(null)).toEqual({});
    expect(parsePriceSnapshots([1])).toEqual({});
    expect(parsePriceSnapshots({ a: [{ at: 1, usd: 2 }, { at: "x", usd: 2 }, { at: 1, usd: -1 }], b: "no" })).toEqual({ a: [{ at: 1, usd: 2 }] });
  });
});
