import { expect, it } from "vitest";
import { scrollOffset, scrollProgress } from "./progress";

it("tracks movement within a page and reaches 100% only at the bottom", () => {
  const metrics = { scrollHeight: 2000, clientHeight: 500, scrollTop: 0 };
  expect(scrollProgress(metrics)).toBe(0);
  expect(scrollProgress({ ...metrics, scrollTop: 750 })).toBe(0.5);
  expect(scrollProgress({ ...metrics, scrollTop: 1000 })).toBeCloseTo(2 / 3);
  expect(scrollProgress({ ...metrics, scrollTop: 1500 })).toBe(1);
});

it("seeks to the same fraction it reports across viewport sizes", () => {
  for (const clientHeight of [500, 800]) {
    const metrics = { scrollHeight: 2000, clientHeight };
    for (const fraction of [0, 0.25, 0.7, 1]) {
      expect(
        scrollProgress({ ...metrics, scrollTop: scrollOffset(fraction, metrics) }),
      ).toBeCloseTo(fraction);
    }
  }
});

it("handles a fully visible document and clamps overscroll", () => {
  expect(scrollProgress({ scrollTop: 0, scrollHeight: 400, clientHeight: 500 })).toBe(1);
  expect(scrollOffset(0.5, { scrollHeight: 400, clientHeight: 500 })).toBe(0);
  expect(scrollProgress({ scrollTop: -12, scrollHeight: 1000, clientHeight: 500 })).toBe(0);
  expect(scrollProgress({ scrollTop: 512, scrollHeight: 1000, clientHeight: 500 })).toBe(1);
});
