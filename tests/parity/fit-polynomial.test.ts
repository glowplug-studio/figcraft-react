import { describe, expect, it } from "vitest";
import { fitCubicRoots, fitQuadratic, fitQuarticFactors } from "../../src/engine/fit-polynomial";

function checkRoots(actual: number[], expected: readonly number[], tolerance = 1e-12) {
  expect(actual).toHaveLength(expected.length); actual.sort((a, b) => a - b);
  expected.forEach((root, i) => expect(Math.abs(actual[i] - root)).toBeLessThan(tolerance));
}
function coefficients(roots: readonly number[]): number[] {
  let values = [1];
  for (const root of roots) { const next = Array<number>(values.length + 1).fill(0); values.forEach((value, i) => { next[i] -= root * value; next[i + 1] += value; }); values = next; }
  return values;
}
describe("Pencil fitting polynomial methods", () => {
  it("matches Kurbo common::test_solve_quadratic", () => {
    checkRoots(fitQuadratic(-5, 0, 1), [-Math.sqrt(5), Math.sqrt(5)]);
    checkRoots(fitQuadratic(5, 0, 1), []); checkRoots(fitQuadratic(5, 1, 0), [-5]); checkRoots(fitQuadratic(1, 2, 1), [-1]);
  });
  it("retains quadratic tiny roots, linear fallback and constant degeneracy", () => {
    expect(fitQuadratic(0, 0, 0)).toEqual([0]); expect(fitQuadratic(1, 0, 0)).toEqual([]);
    const roots = fitQuadratic(1, 1e200, 1); expect(roots[0]).toBe(-1e200); expect(roots[1]).toBe(-1e-200);
    expect(fitQuadratic(5, 1, 1e-320)).toEqual([-5]);
  });
  it("matches Kurbo common::test_solve_cubic", () => {
    checkRoots(fitCubicRoots(-5, 0, 0, 1), [Math.cbrt(5)]);
    checkRoots(fitCubicRoots(-5, -1, 0, 1), [1.90416085913492]);
    checkRoots(fitCubicRoots(0, -1, 0, 1), [-1, 0, 1]);
    checkRoots(fitCubicRoots(-2, -3, 0, 1), [-1, 2]); checkRoots(fitCubicRoots(2, -3, 0, 1), [-2, 1]);
    checkRoots(fitCubicRoots(2 - 1e-12, 5, 4, 1), [-1.9999999999989995, -1.0000010000848456, -.9999989999161546]);
    checkRoots(fitCubicRoots(2 + 1e-12, 5, 4, 1), [-2]);
  });
  it("preserves native cubic candidate ordering and falls back when the leading coefficient vanishes", () => {
    const roots = fitCubicRoots(0, -1, 0, 1); expect(roots[0]).toBeCloseTo(1, 14); expect(roots[1]).toBeCloseTo(0, 14); expect(roots[2]).toBeCloseTo(-1, 14);
    expect(fitCubicRoots(5, 1, 0, 0)).toEqual([-5]); expect(fitCubicRoots(0, 0, 0, 0)).toEqual([0]);
  });
  it("matches the finite unscaled quartic examples in Kurbo common::test_solve_quartic", () => {
    for (const [roots, tolerance] of [ [[1, 1e3, 1e6, 1e9], 1e-14], [[2, 2.001, 2.002, 2.003], 1e-6], [[-1, 1, 2, 1e14], 1e-14], [[-2e7, -1, 1, 1e7], 1e-14], [[10000, 10001, 10010, 10100], 1e-6]] as const) {
      const [d, c, b, a] = coefficients(roots), factors = fitQuarticFactors(a, b, c, d)!; expect(factors).toBeDefined();
      const actual = factors.flatMap(([alpha, beta]) => fitQuadratic(beta, alpha, 1)).sort((x, y) => x - y);
      expect(actual).toHaveLength(4); roots.forEach((root, i) => expect(Math.abs((actual[i] - root) / root)).toBeLessThan(tolerance));
    }
  });
  it("retains real factors for a complex-conjugate pair rather than discarding its real part", () => {
    // (x² - 2x + 5)(x² - 5x + 6): 1±2i,2,3.
    const factors = fitQuarticFactors(-7, 21, -37, 30)!; expect(factors).toBeDefined();
    const roots = factors.flatMap(([a, b]) => fitQuadratic(b, a, 1)); checkRoots(roots, [2, 3]);
    const conjugate = factors.find(([a, b]) => a * a - 4 * b < 0)!; expect(-conjugate[0] / 2).toBeCloseTo(1, 12);
  });
  it("reconstructs coefficients for independently generated quartics", () => {
    for (let i = 1; i <= 60; i++) {
      const roots = [-i / 7, (i + 3) / 11, (i + 17) / 5, -(i + 2) / 3];
      const [d, c, b, a] = coefficients(roots), [[a1, b1], [a2, b2]] = fitQuarticFactors(a, b, c, d)!;
      const rebuilt = [b1 * b2, b1 * a2 + a1 * b2, b1 + a1 * a2 + b2, a1 + a2];
      [d, c, b, a].forEach((value, j) => expect(Math.abs(rebuilt[j] - value) / Math.max(1, Math.abs(value))).toBeLessThan(1e-13));
    }
  });
  it("reports overflowing factors without inventing fitted candidates", () => {
    expect(fitQuarticFactors(1e308, 1e308, 1e308, 1e308)).toBeUndefined();
  });
});
