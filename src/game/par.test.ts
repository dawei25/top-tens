import { describe, expect, it } from "vitest";
import { percentile, percentileLabel } from "./par";

describe("percentiles", () => {
  const counts = [0, 0, 10, 20, 30, 20, 10, 5, 3, 1, 1]; // 100 players
  it("counts everyone below plus half the ties", () => {
    expect(percentile(counts, 4)).toBe(45);
    expect(percentile(counts, 10)).toBe(100); // 99.5, rounded
    expect(percentile(counts, 0)).toBe(0);
  });
  it("reads as top N% for strong scores and better than N% otherwise", () => {
    expect(percentileLabel(92)).toBe("top 8%");
    expect(percentileLabel(100)).toBe("top 1%");
    expect(percentileLabel(30)).toBe("better than 30%");
  });
  it("handles an empty distribution", () => {
    expect(percentile(Array(11).fill(0), 5)).toBe(0);
  });
});
