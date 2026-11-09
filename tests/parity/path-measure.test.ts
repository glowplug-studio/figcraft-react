import { describe, expect, it } from "vitest";
import type { PathCommand } from "../../src/engine/corners";
import { ellipticalArcPath, TAU } from "../../src/engine/ellipse";
import { MAX_PATH_SAMPLES, measurePath, nearestOnPolylines, polylineAt, polylineLength } from "../../src/engine/path-measure";

describe("geom::measure and pathops::width::measures_paths_by_length", () => {
  it("measures open subpaths, endpoint normals and stable nearest positions", () => {
    const lines = measurePath([["M", 0, 0], ["L", 100, 0], ["M", 0, 50], ["L", 0, 150]])!;
    expect(lines).toHaveLength(2); expect(polylineLength(lines[0])).toBe(100); expect(lines[0].closed).toBe(false);
    const at = polylineAt(lines[0], .25)!; expect(at.point).toEqual({ x: 25, y: 0 }); expect(at.normal.x).toBeCloseTo(0); expect(at.normal.y).toBe(1);
    expect(polylineAt(lines[0], 1)?.point).toEqual({ x: 100, y: 0 }); expect(polylineAt(lines[0], NaN)).toBeUndefined();
    expect(nearestOnPolylines(lines, { x: 30, y: 5 })).toEqual({ subpath: 0, t: .3, distance: 5 });
    expect(nearestOnPolylines(lines, { x: -3, y: 100 })).toEqual({ subpath: 1, t: .5, distance: 3 });
  });
  it("closes square and circle paths while retaining source length tolerances", () => {
    const square = measurePath([["M", 0, 0], ["L", 10, 0], ["L", 10, 10], ["L", 0, 10], ["Z"]])![0];
    expect(square.closed).toBe(true); expect(polylineLength(square)).toBe(40);
    const circlePath = ellipticalArcPath(0, 0, 10, 10, 0, TAU), last = circlePath.at(-1)!;
    // Native Circle (unlike generic Arc trigonometry) ends exactly at its start.
    if (last[0] === "C") circlePath[circlePath.length - 1] = ["C", last[1], last[2], last[3], last[4], 10, 0];
    const circle = measurePath([...circlePath, ["Z"]])![0];
    expect(circle.closed).toBe(true); expect(circle.points[0]).toEqual(circle.points.at(-1)); expect(Math.abs(polylineLength(circle) - TAU * 10)).toBeLessThan(.1);
  });
  it("refuses over-budget curves during flattening and invalid coordinates before allocation", () => {
    const curve: PathCommand[] = [["M", 0, 0], ["C", 0, 1000, 1000, 1000, 1000, 0]];
    expect(measurePath(curve, 8)).toBeUndefined(); expect(measurePath(curve)).toBeDefined();
    const lines: PathCommand[] = [["M", 0, 0], ...Array.from({ length: MAX_PATH_SAMPLES + 10 }, (_, i): PathCommand => ["L", i, i % 2 * 5])];
    expect(measurePath(lines)).toBeUndefined();
    for (const x of [NaN, Infinity, 1.5e9+1, -1.5e9-1]) expect(measurePath([["M", x, 0], ["L", 1, 1]])).toBeUndefined();
    expect(measurePath([["M", 1.5e9, 0], ["L", 1e9, 1]])?.[0].points).toHaveLength(2);
    expect(measurePath([["M", 0, 0], ["L", 1, 1]], 2)).toHaveLength(1);
  });
  it("preserves curve endpoints, deduplicates tiny segments and omits empty subpaths", () => {
    const curve = measurePath([["M", 0, 0], ["C", 0, 100, 100, 100, 100, 0]])![0];
    expect(curve.points[0]).toEqual({ x: 0, y: 0 }); expect(curve.points.at(-1)).toEqual({ x: 100, y: 0 });
    expect(polylineLength(curve)).toBeGreaterThan(100); expect(polylineLength(curve)).toBeLessThan(300);
    expect(measurePath([["M", 5, 5], ["L", 5, 5], ["M", 0, 0], ["L", 1e-10, 0], ["L", 2, 0]])?.[0].points).toEqual([{ x: 0, y: 0 }, { x: 2, y: 0 }]);
    expect(measurePath([])).toEqual([]); expect(nearestOnPolylines([], { x: 0, y: 0 })).toBeUndefined();
  });
});
