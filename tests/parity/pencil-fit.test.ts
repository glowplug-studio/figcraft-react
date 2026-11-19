import { describe, expect, it } from "vitest";
import type { Cubic } from "../../src/engine/cubic";
import { cubicFitCandidates } from "../../src/engine/fit-candidates";
import { CubicFitSource } from "../../src/engine/fit-cubic-source";
import { lineMoments } from "../../src/engine/fit-polyline";
import { fitSource } from "../../src/engine/pencil-fit";
import { simplifyPencil } from "../../src/engine/simplify-path";
import type { Point } from "../../src/engine/geometry";

const p = (x: number, y = 0): Point => ({ x, y });
function multiply(a: number[], b: number[]) { const values = Array<number>(a.length + b.length - 1).fill(0); a.forEach((x, i) => b.forEach((y, j) => values[i + j] += x * y)); return values; }
const integrate = (values: number[]) => values.reduce((sum, value, i) => sum + value / (i + 1), 0);
function cubicMoments(c: Cubic) {
  const coefficients = (axis: "x" | "y") => { const [a, b, d, e] = c.map(p => p[axis]); return [a, 3 * (b - a), 3 * (a - 2 * b + d), e - 3 * d + 3 * b - a]; };
  const x = coefficients("x"), y = coefficients("y"), dx = x.slice(1).map((value, i) => value * (i + 1));
  return [integrate(multiply(y, dx)), integrate(multiply(multiply(x, y), dx))];
}
describe("Pencil native simplifier and fitting", () => {
  it("matches Kurbo simplify_lines_corner exactly", () => {
    expect(simplifyPencil([p(1, 2), p(3, 4), p(10, 5)])).toEqual([["M", 1, 2], ["L", 3, 4], ["L", 10, 5]]);
  });
  it("discards duplicate samples without adding empty segments or paths", () => {
    expect(simplifyPencil([])).toEqual([]); expect(simplifyPencil([p(0), p(0)])).toEqual([]);
    expect(simplifyPencil([p(0), p(0), p(10), p(10), p(10, 10)])).toEqual([["M", 0, 0], ["L", 10, 0], ["L", 10, 10]]);
  });
  it("fits a collinear multi-segment run to the native unit-chord cubic", () => {
    const path = simplifyPencil([p(0), p(30), p(90)]); expect(path).toHaveLength(2); expect(path[1][0]).toBe("C");
    for (const [actual, expected] of (path[1].slice(1) as number[]).map((value, i) => [value, [30, 0, 60, 0, 90, 0][i]])) expect(actual).toBeCloseTo(expected, 12);
  });
  it("preserves the default one-milliradian corner threshold", () => {
    expect(simplifyPencil([p(0), p(100), p(200, .100001)]).map(c => c[0])).toEqual(["M", "L", "L"]);
    expect(simplifyPencil([p(0), p(100), p(200, .099999)]).some(c => c[0] === "C")).toBe(true);
  });
  it("computes directed analytical moments of a line", () => {
    const m = lineMoments(p(2, 3), p(6, 7)); expect(m[0]).toBe(20); expect(m[1]).toBeCloseTo(256 / 3, 12); expect(m[2]).toBeCloseTo(316 / 3, 12);
  });
  it("recovers known cubic candidates from independently integrated area and moment", () => {
    for (const curve of [[p(0), p(.3, .3), p(.7, .3), p(1)], [p(0), p(.2, .1), p(.6, .5), p(1)]] as Cubic[]) {
      const [area, moment] = cubicMoments(curve), candidates = cubicFitCandidates(Math.atan2(curve[1].y, curve[1].x), Math.atan2(curve[2].y, 1 - curve[2].x), area, moment);
      expect(candidates.length).toBeGreaterThan(0);
      const error = (c: Cubic) => Math.max(...c.map((p, i) => Math.hypot(p.x - curve[i].x, p.y - curve[i].y)));
      expect(Math.min(...candidates.map(c => error(c.curve)))).toBeLessThan(1e-7);
    }
  });
  it("keeps an exact reversal as a corner of the stroke", () => {
    // Native cuts the path where it turns straight back (upstream #1741); Kurbo alone rounds the turn into two curves.
    expect(simplifyPencil([p(0), p(20), p(0)])).toEqual([["M", 0, 0], ["L", 20, 0], ["L", 0, 0]]);
  });
  it("rejects non-finite or overflowing geometry and invalid accuracy before unbounded subdivision", () => {
    expect(() => simplifyPencil([p(0), p(Infinity)])).toThrow(/finite/);
    expect(() => simplifyPencil([p(-1e308), p(1e308)])).toThrow(/overflow/);
    const line = (a: ReturnType<typeof p>, b: ReturnType<typeof p>): Cubic => [a, a, b, b];
    expect(() => new CubicFitSource([line(p(1e150, 1e150), p(2e150, 2e150))])).toThrow(/overflow/);
    expect(() => fitSource(new CubicFitSource([line(p(0), p(1)), line(p(1), p(2))]), 0)).toThrow(/accuracy/);
  });
});
