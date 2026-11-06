import { describe, expect, it } from "vitest";
import { flattenContours, type PathCommand } from "../../src/engine/corners";
import { parseSvgPath, pathNetwork, pointsNetwork, vectorScale } from "../../src/engine/svg-path";
import { networkBounds, pathBounds } from "../../src/engine/vector-path";

function area(path: readonly PathCommand[]): number {
  let result = 0; for (const contour of flattenContours(path)) for (let i = 0; i < contour.length; i++) { const a = contour[i], b = contour[(i + 1) % contour.length]; result += a.x * b.y - a.y * b.x; } return result / 2;
}
describe("native SVG path reader examples", () => {
  it("reads implicit relative lines, scientific notation and signed/decimal pairs", () => {
    expect(parseSvgPath("m10 10 100 0 0 100 -100 0z")).toEqual([["M", 10, 10], ["L", 110, 10], ["L", 110, 110], ["L", 10, 110], ["Z"]]);
    expect(parseSvgPath("M 0 0 L 1e-123 -4E+5")).toEqual([["M", 0, 0], ["L", 1e-123, -4e5]]);
    expect(parseSvgPath("M.5-.25h10v20H5V+7")).toEqual([["M", .5, -.25], ["L", 10.5, -.25], ["L", 10.5, 19.75], ["L", 5, 19.75], ["L", 5, 7]]);
  });
  it("normalises quadratic curves and reflects the native shared last control", () => {
    const path = parseSvgPath("M0 0 Q3 6 6 0 T12 0 C13 1 14 2 15 3 S20 5 21 6");
    expect(path).toEqual([["M", 0, 0], ["C", 2, 4, 4, 4, 6, 0], ["C", 8, -4, 10, -4, 12, 0], ["C", 13, 1, 14, 2, 15, 3], ["C", 16, 4, 20, 5, 21, 6]]);
    // Native Kurbo shares the control between Q/C families, so S after Q also reflects it.
    expect(parseSvgPath("M0 0 Q3 6 6 0 S9 0 12 0").at(-1)).toEqual(["C", 9, -6, 9, 0, 12, 0]);
    expect(parseSvgPath("m2 3 c1 2 3 4 5 6 s3 4 5 6").at(-1)).toEqual(["C", 9, 11, 10, 13, 12, 15]);
  });
  it("adds the native implicit move after close and retains best-effort trailing termination", () => {
    expect(parseSvgPath("M2 3 L4 5 Z l1 2")).toEqual([["M", 2, 3], ["L", 4, 5], ["Z"], ["M", 2, 3], ["L", 3, 5]]);
    expect(parseSvgPath("M0 0 L10 10\0ignored")).toEqual([["M", 0, 0], ["L", 10, 10]]);
    // '+' is accepted inside a command but does not start an implicit repetition.
    expect(parseSvgPath("M0 0 +2 2")).toEqual([["M", 0, 0]]);
    for (const invalid of ["L10 10", "M", "M0 0 L10", "M0 0 Q5 5", "M0 0 L1e+ 0", "M0 0 X1 1", "M0 0 A1 1 0 2 0 3 3"]) expect(() => parseSvgPath(invalid), invalid).toThrow(/valid SVG/);
  });
  it("reads compact arc flags and the pinned native arc/pie fixtures", () => {
    const compact = parseSvgPath("M3.5 8a.5.5 0 01.5-.5h8a.5.5 0 010 1H4a.5.5 0 01-.5-.5z");
    expect(compact.filter(c => c[0] === "C" || c[0] === "L")).toHaveLength(6);
    const arc = parseSvgPath("M100 100 A25 25 0 1 0 -25 25 z"); expect(arc.filter(c => c[0] === "C")).toHaveLength(2);
    expect(Math.round(area(parseSvgPath("M100 100 h25 a25 25 0 1 0 -25 25 z")))).toBe(-1473);
    expect(parseSvgPath("M0 0 A0 0 0 0 0 10 10")).toEqual([["M", 0, 0], ["L", 10, 10]]);
    expect(parseSvgPath("M0 0 A10 20 0 0 0 0 0")).toEqual([["M", 0, 0], ["L", 0, 0]]);
    const rotated = parseSvgPath("M0 0 A30 10 45 0 1 40 20"), end = rotated.at(-1)!;
    expect(end[0]).toBe("C"); expect(end[5]).toBeCloseTo(40, 10); expect(end[6]).toBeCloseTo(20, 10);
    expect(() => parseSvgPath("M0 0 A1e308 1e308 0 1 1 10 10")).toThrow(/too large/);
  });
});
describe("cmd::path_network/vector_scale paired geometry", () => {
  it("keeps the unscaled box offset and scales one dimension proportionally", () => {
    const rows = [[undefined, undefined, 10, 20], [30, 10, 30, 10], [20, undefined, 20, 40], [undefined, 10, 5, 10], [20, 10, 20, 10]] as const;
    for (const [width, height, expectedWidth, expectedHeight] of rows) {
      const shape = pathNetwork("M5 5 L15 5 L15 25 Z", width, height); expect(shape.offset).toEqual({ x: 5, y: 5 }); expect([shape.width, shape.height]).toEqual([expectedWidth, expectedHeight]);
      expect(shape.network.vertices[0]).toMatchObject({ x: 0, y: 0 }); expect(shape.network.regions[0].loops[0]).toHaveLength(3);
    }
  });
  it("refuses empty, degenerate, oversized and impossible dimension requests", () => {
    for (const d of ["", "M5 5", "M5 5 L5 5 Z"]) expect(() => pathNetwork(d)).toThrow(/draws nothing/);
    expect(() => pathNetwork("M0 0 L1e308 0 L-1e308 0")).toThrow(/too large/);
    for (const width of [0, -4, Infinity, NaN]) expect(() => pathNetwork("M0 0 L10 10", width)).toThrow(/positive/);
    expect(() => pathNetwork("M0 0 L10 0", undefined, 5)).toThrow(/no vertical extent/);
    expect(pathNetwork("M0 0 L10 0", undefined, 0)).toMatchObject({ width: 10, height: 0 });
    expect(vectorScale(20, undefined, 10, 0)).toEqual([2, 2]);
  });
  it("uses curve extrema and ignores isolated moves when determining the box", () => {
    const shape = pathNetwork("M0 0 C0 -80 120 -80 120 0 M999 999");
    expect(shape.offset).toEqual({ x: 0, y: -60 }); expect([shape.width, shape.height]).toEqual([120, 60]);
    expect(pathBounds(parseSvgPath("M10 20 M30 40"))).toBeUndefined();
    expect(networkBounds(shape.network)).toEqual({ x: 0, y: 0, width: 120, height: 60 });
  });
  it("merges endpoints after requested scaling, as native creation does", () => {
    const data = "M0 0 L10 0 L10 10 L0 .0000001";
    expect(pathNetwork(data).network.regions).toHaveLength(1);
    // The same endpoint is no longer within1e-6 after scaling by1000.
    expect(pathNetwork(data, 10000).network.regions).toHaveLength(0);
  });
  it("normalises point sets without argument spreads or silently flattening an axis", () => {
    const shape = pointsNetwork([{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 25 }], true, 20);
    expect(shape).toMatchObject({ width: 20, height: 40, offset: { x: 5, y: 5 } }); expect(shape.network.regions).toHaveLength(1);
    expect(() => pointsNetwork([{ x: 0, y: 0 }], false)).toThrow(/two/);
    expect(() => pointsNetwork([{ x: 0, y: 0 }, { x: 0, y: 0 }], false)).toThrow(/nothing/);
    expect(() => pointsNetwork([{ x: -1e308, y: 0 }, { x: 1e308, y: 0 }], false)).toThrow(/too large/);
    expect(pathNetwork("M0 0 " + "L1 1 ".repeat(5000)).network.segments).toHaveLength(5000);
  });
});
