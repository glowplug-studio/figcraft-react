import { describe, expect, it } from "vitest";
import { flattenContours, hitsPath, type PathCommand } from "../../src/engine/corners";
import { ellipticalArcPath, TAU } from "../../src/engine/ellipse";
import { MAX_PATH_SAMPLES } from "../../src/engine/path-measure";
import { defaultStroke, type StrokeProps } from "../../src/engine/stroke";
import { variableStrokeOutline } from "../../src/engine/variable-stroke";
import { parseWidthProfile, widthPresetProfile, type WidthProfile } from "../../src/engine/width-profile";

const line = (x: number): PathCommand[] => [["M", 0, 0], ["L", x, 0]];
const uniform = parseWidthProfile([[0, 1], [1, 1]])!;
const props = (weight: number, extra: Partial<StrokeProps> = {}): StrokeProps => ({ ...defaultStroke, weight, align: "center", ...extra });
const outline = (path: readonly PathCommand[], weight: number, profile = uniform, extra: Partial<StrokeProps> = {}): readonly PathCommand[] => variableStrokeOutline(path, weight, props(weight, extra), profile)!;
const covers = (path: readonly PathCommand[], x: number, y: number): boolean => hitsPath(path, { x, y }, 0);
function area(path: readonly PathCommand[]): number {
  let sum = 0;
  for (const points of flattenContours(path)) for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; sum += a.x * b.y - b.x * a.y; }
  return Math.abs(sum / 2);
}
function bounds(path: readonly PathCommand[]) {
  const points = flattenContours(path).flat();
  return { x0: Math.min(...points.map(p => p.x)), y0: Math.min(...points.map(p => p.y)), x1: Math.max(...points.map(p => p.x)), y1: Math.max(...points.map(p => p.y)) };
}
describe("pathops::width_tests variable outline fixtures", () => {
  it("draws the native wedge area and holds wider profile points", () => {
    const wedge = outline(line(100), 10, widthPresetProfile("wedge")!);
    expect(Math.abs(area(wedge) - 500)).toBeLessThan(2); expect(covers(wedge, 5, 4)).toBe(true); expect(covers(wedge, 95, 4)).toBe(false);
    const wide = outline(line(100), 10, parseWidthProfile([[0, 1], [.5, 3], [1, 1]])!); expect(bounds(wide).y1).toBeCloseTo(15, 2);
  });
  it("matches plain uniform band areas and bounds with butt, round and square caps", () => {
    for (const cap of ["none", "round", "square"] as const) {
      const path = outline(line(100), 10, uniform, { capStart: cap, capEnd: cap });
      const expectedArea = 1000 + (cap === "round" ? Math.PI * 25 : cap === "square" ? 100 : 0);
      expect(Math.abs(area(path) - expectedArea)).toBeLessThan(1);
      const b = bounds(path); expect(b.x0).toBeCloseTo(cap === "none" ? 0 : -5, 1); expect(b.x1).toBeCloseTo(cap === "none" ? 100 : 105, 1); expect(b.y1).toBe(5);
    }
  });
  it("keeps closed ring holes and varies independently around each subpath", () => {
    const circle: PathCommand[] = [...ellipticalArcPath(50, 50, 40, 40, 0, TAU), ["Z"]], path = outline(circle, 10, widthPresetProfile("eye")!);
    expect(covers(path, 50, 50)).toBe(false);
    for (const x of [14, 6]) expect(covers(path, x, 50)).toBe(true);
    for (const x of [94, 86]) expect(covers(path, x, 50)).toBe(false);
    const two = outline([...line(100), ["M", 0, 50], ["L", 100, 50]], 10, widthPresetProfile("wedge")!);
    expect(covers(two, 5, 54)).toBe(true); expect(covers(two, 95, 54)).toBe(false);
  });
  it("preserves miter, bevel and round corners, including inner winding", () => {
    const corner: PathCommand[] = [["M", 0, 0], ["L", 100, 0], ["L", 100, 100]];
    const miter = outline(corner, 20), bevel = outline(corner, 20, uniform, { join: "bevel" }), round = outline(corner, 20, uniform, { join: "round" });
    expect(covers(miter, 109, -9)).toBe(true); expect(covers(bevel, 109, -9)).toBe(false); expect(covers(round, 109, -9)).toBe(false);
    expect(covers(round, 106, -6)).toBe(true); expect(covers(bevel, 106, -6)).toBe(false);
    expect(covers(bevel, 95, 5)).toBe(true); expect(covers(bevel, 91, 9)).toBe(true);
    expect(covers(outline(corner, 20, uniform, { miterLimit: 1 }), 109, -9)).toBe(false);
  });
  it("fits open dashes, retains sampled width and emits zero-length round dots", () => {
    const dashed = outline(line(100), 2, uniform, { dashes: [10, 10] }); expect(Math.abs(area(dashed) - 100)).toBeLessThan(1);
    expect(covers(dashed, 2, 0)).toBe(true); expect(covers(dashed, 10, 0)).toBe(false); expect(covers(dashed, 20, 0)).toBe(true);
    const tapered = outline(line(100), 10, widthPresetProfile("wedge")!, { dashes: [10, 10] });
    expect(covers(tapered, 2, 4)).toBe(true); expect(covers(tapered, 80, 4)).toBe(false);
    const dots = outline(line(100), 4, uniform, { dashes: [0, 10], capStart: "round", capEnd: "round" });
    expect(covers(dots, 10, 1)).toBe(true); expect(covers(dots, 5, 0)).toBe(false);
  });
  it("keeps asymmetric widths on their native screen sides and centres lopsided caps", () => {
    const profile = parseWidthProfile([[0, 0, 2], [1, 0, 2]])!;
    const path = outline(line(100), 10, profile); expect(bounds(path)).toEqual({ x0: 0, y0: 0, x1: 100, y1: 10 });
    expect(covers(path, 50, 9)).toBe(true); expect(covers(path, 50, -1)).toBe(false);
    const round = outline(line(100), 10, profile, { capStart: "round", capEnd: "round" });
    expect(covers(round, -4, 5)).toBe(true); expect(covers(round, -4, -1)).toBe(false);
  });
  it("bounds invalid geometry, samples, zero-width paths and tiny-dash work", () => {
    expect(variableStrokeOutline([["M", NaN, 0], ["L", 1, 1]], 4, props(4), uniform)).toBeUndefined();
    const long: PathCommand[] = [["M", 0, 0], ...Array.from({ length: MAX_PATH_SAMPLES + 10 }, (_, i): PathCommand => ["L", i, i % 2 * 5])];
    expect(variableStrokeOutline(long, 2, props(2), uniform)).toBeUndefined();
    for (const path of [[], [["M", 5, 5], ["L", 5, 5]]] as readonly PathCommand[][]) expect(outline(path, 2)).toEqual([]);
    expect(outline(line(10), 0)).toEqual([]); expect(outline(line(10), 2, uniform, { dashes: [0, 0] }).length).toBeGreaterThan(0);
    const tiny = outline(line(1e6), 2, uniform, { dashes: [.01, .01] }); expect(tiny.length).toBeLessThan(1000); expect(covers(tiny, 500000, 0)).toBe(true);
    const many: PathCommand[] = []; for (let i = 0; i < 400; i++) many.push(["M", 0, i * 10], ["L", 100, i * 10]);
    expect(variableStrokeOutline(many, 2, props(2), uniform)).toBeUndefined();
  });
  it("constructs accepted large joined paths without JavaScript argument-stack overflow", () => {
    const zigzag: PathCommand[] = [["M", 0, 0], ...Array.from({ length: 10000 }, (_, i): PathCommand => ["L", i + 1, i % 2 ? 0 : 100])];
    const path = outline(zigzag, 10000, uniform, { join: "round" });
    expect(path.length).toBeGreaterThan(200000); expect(path.at(-1)).toEqual(["Z"]);
  });
});
