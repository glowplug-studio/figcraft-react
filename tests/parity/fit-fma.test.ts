import { describe, expect, it } from "vitest";
import { fitMultiplyAdd } from "../../src/engine/fit-fma";

describe("single-rounded fitting arithmetic", () => {
  it("retains the exact residual lost by multiplying before cancellation", () => {
    const delta = 2 ** -27;
    expect((1 + delta) * (1 - delta) - 1).toBe(0);
    expect(fitMultiplyAdd(1 + delta, 1 - delta, -1)).toBe(-(2 ** -54));
  });
  it("rounds ties to even on either side of a representable value", () => {
    expect(fitMultiplyAdd(1, 2 ** -53, 1)).toBe(1);
    expect(fitMultiplyAdd(1, 2 ** -53, 1 + 2 ** -52)).toBe(1 + 2 ** -51);
    expect(fitMultiplyAdd(-1, 2 ** -53, -1)).toBe(-1);
  });
  it("rounds subnormal products once including underflow and negative zero", () => {
    expect(fitMultiplyAdd(Number.MIN_VALUE, .5, Number.MIN_VALUE)).toBe(2 * Number.MIN_VALUE);
    expect(fitMultiplyAdd(Number.MIN_VALUE, .5, 0)).toBe(0);
    expect(Object.is(fitMultiplyAdd(-Number.MIN_VALUE, .5, 0), -0)).toBe(true);
    expect(fitMultiplyAdd(Number.MIN_VALUE, 1, Number.MIN_VALUE)).toBe(2 * Number.MIN_VALUE);
  });
  it("retains a finite result when an intermediate separate product would overflow", () => {
    expect(fitMultiplyAdd(Number.MAX_VALUE, 2, -Number.MAX_VALUE)).toBe(Number.MAX_VALUE);
    expect(fitMultiplyAdd(Number.MAX_VALUE, 2, 0)).toBe(Infinity);
  });
  it("preserves exact cancellation, zero signs and non-finite IEEE results", () => {
    expect(fitMultiplyAdd(3, 7, -21)).toBe(0);
    expect(Object.is(fitMultiplyAdd(-0, 2, -0), -0)).toBe(true);
    expect(fitMultiplyAdd(Infinity, 0, 1)).toBeNaN(); expect(fitMultiplyAdd(Infinity, 2, -Infinity)).toBeNaN();
    expect(fitMultiplyAdd(Number.MAX_VALUE, 2, -Infinity)).toBe(-Infinity);
    expect(fitMultiplyAdd(-Number.MAX_VALUE, 2, Infinity)).toBe(Infinity);
  });
});
