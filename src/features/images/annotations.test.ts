import { expect, it } from "vitest";
import { arrowHead, imagePoint } from "./annotations";
it("maps zoomed and panned screen positions to original pixels, clamping outside drags", () => {
  const bounds = { left: -200, top: 100, width: 2000, height: 1000 };
  expect(imagePoint({ x: 800, y: 600 }, bounds, 1000, 500)).toEqual({ x: 500, y: 250 });
  expect(imagePoint({ x: -400, y: 2000 }, bounds, 1000, 500)).toEqual({ x: 0, y: 500 });
});
it("keeps arrowheads behind the tip in both drag directions", () => {
  const right = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 10);
  expect(right.every((p) => p.x < 100)).toBe(true);
  expect(right[0].y).toBeCloseTo(-right[1].y);
  expect(arrowHead({ x: 100, y: 0 }, { x: 0, y: 0 }, 10).every((p) => p.x > 0)).toBe(true);
});
