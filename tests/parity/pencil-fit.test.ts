import { describe, expect, it } from "vitest";
import { cubicPoint, type Cubic } from "../../src/engine/cubic";
import { nearestCubic } from "../../src/engine/cubic-nearest";
import { cubicFitCandidates } from "../../src/engine/fit-candidates";
import { FittingPolyline, lineMoments } from "../../src/engine/fit-polyline";
import { fitPencilRun, simplifyPencil } from "../../src/engine/pencil-fit";
import type { Point } from "../../src/engine/geometry";

const p = (x: number, y = 0): Point => ({ x, y });
function multiply(a: number[], b: number[]) { const values = Array<number>(a.length + b.length - 1).fill(0); a.forEach((x, i) => b.forEach((y, j) => values[i + j] += x * y)); return values; }
const integrate = (values: number[]) => values.reduce((sum, value, i) => sum + value / (i + 1), 0);
function cubicMoments(c: Cubic) {
  const coefficients = (axis: "x" | "y") => { const [a, b, d, e] = c.map(p => p[axis]); return [a, 3 * (b - a), 3 * (a - 2 * b + d), e - 3 * d + 3 * b - a]; };
  const x = coefficients("x"), y = coefficients("y"), dx = x.slice(1).map((value, i) => value * (i + 1));
  return [integrate(multiply(y, dx)), integrate(multiply(multiply(x, y), dx))];
}
function verifyFit(points: Point[], accuracy: number) {
  const curves = fitPencilRun(points, accuracy); expect(curves.length).toBeGreaterThan(0);
  expect(curves[0][0]).toEqual(points[0]); expect(curves.at(-1)![3].x).toBeCloseTo(points.at(-1)!.x, 10); expect(curves.at(-1)![3].y).toBeCloseTo(points.at(-1)!.y, 10);
  curves.forEach((c, i) => { expect(c.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true); if (i) expect(Math.hypot(c[0].x - curves[i - 1][3].x, c[0].y - curves[i - 1][3].y)).toBeLessThan(1e-9); });
  const source = new FittingPolyline(points);
  for (let i = 0; i <= 100; i++) {
    const sample = source.sample(i / 100).point;
    expect(Math.min(...curves.map(c => nearestCubic(c, sample)!.distance))).toBeLessThan(accuracy + 1e-8);
  }
  return curves;
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
  it("computes directed analytical moments and partial equal-parameter spans", () => {
    const m = lineMoments(p(2, 3), p(6, 7)); expect(m[0]).toBe(20); expect(m[1]).toBeCloseTo(256 / 3, 12); expect(m[2]).toBeCloseTo(316 / 3, 12);
    const source = new FittingPolyline([p(0), p(10), p(10, 10), p(0, 10)]);
    expect(source.moments(0, 1)).toEqual([-100, -500, -1000]); expect(source.sample(1 / 3).tangent).toEqual(p(0, 10));
    const whole = source.moments(0, 1), first = source.moments(0, .4), second = source.moments(.4, 1);
    whole.forEach((v, i) => expect(first[i] + second[i]).toBeCloseTo(v, 12));
  });
  it("does not retain mutable source points", () => {
    const points = [p(0), p(10)], source = new FittingPolyline(points); points[1].x = 20;
    expect(source.sample(1).point).toEqual(p(10)); expect(source.sample(.5).derivative).toEqual(p(10));
  });
  it("recovers known cubic candidates from independently integrated area and moment", () => {
    for (const curve of [[p(0), p(.3, .3), p(.7, .3), p(1)], [p(0), p(.2, .1), p(.6, .5), p(1)]] as Cubic[]) {
      const [area, moment] = cubicMoments(curve), candidates = cubicFitCandidates(Math.atan2(curve[1].y, curve[1].x), Math.atan2(curve[2].y, 1 - curve[2].x), area, moment);
      expect(candidates.length).toBeGreaterThan(0);
      const error = (c: Cubic) => Math.max(...c.map((p, i) => Math.hypot(p.x - curve[i].x, p.y - curve[i].y)));
      expect(Math.min(...candidates.map(c => error(c.curve)))).toBeLessThan(1e-7);
    }
  });
  it("preserves exact reversals within smooth runs and terminates by subdivision", () => {
    const curves = verifyFit([p(0), p(20), p(0)], .75); expect(curves.length).toBeGreaterThan(1);
    expect(simplifyPencil([p(0), p(20), p(0)]).every(c => c[0] === "M" || c[0] === "C")).toBe(true);
  });
  it("fits curved and inflected source runs within the independent dense-sample tolerance", () => {
    verifyFit(Array.from({ length: 41 }, (_, i) => p(i * 2, 10 * Math.sin(i / 8))), .2);
    verifyFit(Array.from({ length: 81 }, (_, i) => p(100 * Math.cos(i * Math.PI / 160), 100 * Math.sin(i * Math.PI / 160))), .2);
  });
  it("handles a closed-endpoint loop through the short-chord and arc-distance branches", () => {
    const points = Array.from({ length: 81 }, (_, i) => p(20 * Math.cos(i * Math.PI / 40), 20 * Math.sin(i * Math.PI / 40)));
    points[points.length - 1] = p(20); verifyFit(points, .5);
  });
  it("rejects non-finite or overflowing geometry and invalid accuracy before unbounded subdivision", () => {
    expect(() => simplifyPencil([p(0), p(Infinity)])).toThrow(/finite/);
    expect(() => simplifyPencil([p(-1e308), p(1e308)])).toThrow(/overflow/);
    expect(() => fitPencilRun([p(1e150, 1e150), p(2e150, 2e150)])).toThrow(/overflow/);
    expect(() => fitPencilRun([p(0), p(1)], 0)).toThrow(/accuracy/);
  });
});
