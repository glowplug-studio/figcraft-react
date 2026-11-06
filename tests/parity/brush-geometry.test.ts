import { describe, expect, it } from "vitest";
import { brushOutline, brushRandom, brushShape, MAX_BRUSH_COPIES } from "../../src/engine/brush-geometry";
import { brushPresets, defaultBrush, type Brush } from "../../src/engine/brush";
import { flattenContours, hitsPath, type PathCommand } from "../../src/engine/corners";
import { defaultStroke, type StrokeProps } from "../../src/engine/stroke";
import { parseWidthProfile } from "../../src/engine/width-profile";

const line = (length: number): PathCommand[] => [["M", 0, 0], ["L", length, 0]];
const brush = (preset: string, extra: Partial<Brush> = {}): Brush => ({ ...defaultBrush, preset, ...extra });
const outline = (path: readonly PathCommand[], width: number, b: Brush, props: Partial<StrokeProps> = {}) => brushOutline(path, width, { ...defaultStroke, ...props }, b)!;
const moves = (path: readonly PathCommand[]) => path.filter(c => c[0] === "M").length;
function bounds(path: readonly PathCommand[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const contour of flattenContours(path)) for (const p of contour) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x0, y0, x1, y1, width: x1 - x0, height: y1 - y0 };
}
describe("pathops::brush_tests paired procedural brushes", () => {
  it("draws every preset inside the native reach bounds", () => {
    for (const p of brushPresets) {
      const path = outline(line(200), 10, brush(p.id)), box = bounds(path);
      expect(path.length, p.id).toBeGreaterThan(0); expect(box.y0, p.id).toBeGreaterThanOrEqual(-5.5); expect(box.y1, p.id).toBeLessThanOrEqual(5.5);
      expect(box.x0, p.id).toBeGreaterThanOrEqual(-5.5); expect(box.x1, p.id).toBeLessThanOrEqual(205.5);
    }
    expect(brushOutline(line(10), 1, defaultStroke, brush("nope"))).toBeUndefined();
    expect(brushShape("nope")).toBeUndefined(); expect(Object.isFrozen(brushShape("taper"))).toBe(true);
  });
  it("bends a stretched shape with the path and retains pointed ends", () => {
    const path = outline([["M", 0, 0], ["L", 0, 100]], 20, brush("taper")), box = bounds(path);
    expect(Math.abs(box.height - 100)).toBeLessThan(1); expect(Math.abs(box.width - 15)).toBeLessThan(1.5);
    expect(hitsPath(path, { x: 0, y: 50 }, 0)).toBe(true); expect(hitsPath(path, { x: 6, y: 2 }, 0)).toBe(false);
    expect(outline(line(100), 10, brush("ink"), { dashes: [2, 2], capStart: "square", capEnd: "round", join: "bevel" })).toEqual(outline(line(100), 10, brush("ink")));
  });
  it("spaces scatter copies with repeatable seed, jitter and native dense spacing", () => {
    const b = brush("dots", { spacing: 2, sizeJitter: .5, rotationJitter: 1, scatter: 1, seed: 7 });
    const path = outline(line(200), 10, b); expect(outline(line(200), 10, b)).toEqual(path);
    expect(outline(line(200), 10, { ...b, seed: 8 })).not.toEqual(path); expect(moves(path)).toBe(10);
    expect(moves(outline(line(1e6), 1, brush("dots", { spacing: 0 })))).toBeLessThanOrEqual(MAX_BRUSH_COPIES + 1);
    const dots = outline(line(200), 10, brush("dots", { spacing: 2 }));
    expect(hitsPath(dots, { x: 10, y: 0 }, 0)).toBe(true); expect(hitsPath(dots, { x: 20, y: 0 }, 0)).toBe(false);
  });
  it("scales brush size by profile mean and retains the native first/last ratio", () => {
    const out = outline(line(300), 10, brush("dots"), { widthProfile: parseWidthProfile([[0, .2], [1, 2]]) });
    const contours = flattenContours(out), width = (points: readonly { x: number }[]) => Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x));
    expect(width(contours.at(-1)!)).toBeGreaterThan(width(contours[0]) * 3);
    const sided = outline(line(100), 10, brush("dots"), { widthProfile: parseWidthProfile([[0, 1, 3], [1, 1, 3]]) });
    expect(sided).toEqual(outline(line(100), 10, brush("dots"), { widthProfile: parseWidthProfile([[0, 2], [1, 2]]) }));
  });
  it("sanitises a100000-point raw profile before sampling", () => {
    const widthProfile = { points: Array.from({ length: 100000 }, (_, i) => ({ t: i, scale: 1e300, bias: 0 })) };
    expect(bounds(outline(line(50), 1, brush("taper"), { widthProfile })).height).toBeLessThanOrEqual(2000);
  });
  it("preserves native per-subpath copy counting rather than imposing a new hard cap", () => {
    const subpaths: PathCommand[] = [];
    for (let i = 0; i < 3000; i++) subpaths.push(["M", 0, i], ["L", 1, i]);
    expect(moves(outline(subpaths, 1, brush("confetti", { spacing: .1 })))).toBe(6000);
  });
  it("rejects invalid measured paths and bounds empty/zero-width output", () => {
    expect(brushOutline([["M", 0, 0], ["L", 1e9, 0]], 1, defaultStroke, brush("taper"))).toBeUndefined();
    expect(outline([], 1, brush("dots"))).toEqual([]); expect(outline(line(10), 0, brush("taper"))).toEqual([]);
    const excessive: PathCommand[] = Array.from({ length: 40001 }, (_, i) => ["M", i, 0]);
    expect(brushOutline(excessive, 1, defaultStroke, brush("dots"))).toBeUndefined();
  });
  it("matches independent unsigned64-bit arithmetic fixtures for every random channel", () => {
    // Calculated with masked arbitrary-precision integer arithmetic from the source constants.
    const fixtures = [[0, 0, 0, 0], [7, 0, 0, .0729703985808493], [7, 0, 1, .5436960876561825], [7, 0, 2, .7927527764122952], [7, 9, 2, .6658832259360743], [4294967295, 4999, 2, .2824438982059887]];
    for (const [seed, index, channel, expected] of fixtures) expect(brushRandom(seed, index, channel)).toBe(expected);
  });
});
