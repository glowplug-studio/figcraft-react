import { describe, expect, it } from "vitest";
import { identity } from "../../src/engine/affine";
import { cornerPath, flattenContours, type PathCommand } from "../../src/engine/corners";
import { cubicBounds, cubicDerivative, cubicLength, cubicLengthParameter, cubicPart, cubicPoint, type Cubic } from "../../src/engine/cubic";
import { freezeNetwork, networkCubic, networkFromPath, networkFromPoints, networkMirroring, regionPaintFrame, sanitiseNetwork, transformNetwork, vectorLine, vectorVertex, type VectorNetwork } from "../../src/engine/vector-network";
import { networkBounds, pathWinding, vectorFillContains, vectorFillPath, vectorLoopWalk, vectorRegionContains, vectorRegionPath, vectorStrokePath, vectorStrokeRuns } from "../../src/engine/vector-path";
import { roundedNetwork } from "../../src/engine/vector-rounded";

const p = (x: number, y: number) => ({ x, y });
const triangle = [p(0, 0), p(10, 0), p(10, 10)];
const square = (x: number, y: number, size: number): PathCommand[] => [["M", x, y], ["L", x + size, y], ["L", x + size, y + size], ["L", x, y + size], ["Z"]];
function area(path: readonly PathCommand[]): number {
  let sum = 0;
  for (const contour of flattenContours(path)) for (let i = 0; i < contour.length; i++) { const a = contour[i], b = contour[(i + 1) % contour.length]; sum += a.x * b.y - a.y * b.x; }
  return sum / 2;
}
describe("doc::VectorNetwork construction and linear traversal", () => {
  it("distinguishes empty networks from move-only runs with missing endpoints", () => {
    const net = freezeNetwork({ vertices: [vectorVertex(40, 60)], segments: [vectorLine(0, 4)], regions: [] });
    expect(vectorStrokePath(net)).toEqual([["M", 40, 60]]);
    expect(networkBounds(net)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(networkBounds(freezeNetwork({ ...net, segments: [] }))).toBeUndefined();
  });
  it("retains native triangle area50 and unfilled open chains", () => {
    const closed = networkFromPoints(triangle, true), open = networkFromPoints(triangle, false);
    expect(area(vectorFillPath(closed))).toBe(50); expect(vectorFillPath(open)).toEqual([]);
    expect(vectorStrokePath(open)).toEqual([["M", 0, 0], ["L", 10, 0], ["L", 10, 10]]);
    expect(vectorStrokeRuns(closed)[0]).toMatchObject({ start: 0, end: 0, closed: true });
    expect(networkFromPoints(triangle.slice(0, 2), true).regions).toEqual([]);
    expect(Object.isFrozen(closed.vertices[0])).toBe(true); expect(Object.isFrozen(closed.segments[0].ta)).toBe(true);
    expect(vectorStrokePath(closed)).toBe(vectorStrokePath(closed)); expect(vectorFillPath(closed)).toBe(vectorFillPath(closed));
  });
  it("round-trips rounded-rectangle curves with relative handles", () => {
    const path = cornerPath({ kind: "rectangle", id: "2", name: "R", parent: "1", x: 0, y: 0, width: 40, height: 20, fill: "red", corners: { radii: [5, 5, 5, 5], smoothing: 0 } });
    const net = networkFromPath(path); expect(area(vectorFillPath(net))).toBeCloseTo(area(path), 6);
    expect(net.segments.some(s => s.ta.some(v => v !== 0))).toBe(true);
    const box = networkBounds(net)!; expect(box.x).toBeCloseTo(0, 12); expect(box.y).toBeCloseTo(0, 12); expect(box.width).toBe(40); expect(box.height).toBe(20);
  });
  it("merges near-coincident explicit and implicit closures into one region", () => {
    for (const close of [false, true]) {
      const path: PathCommand[] = [["M", 0, 0], ["L", 10, 0], ["L", 10, 10], ["L", 0, 1e-7], ...(close ? [["Z"] as const] : [])];
      const net = networkFromPath(path); expect(net.vertices).toHaveLength(3); expect(net.segments.at(-1)?.b).toBe(0); expect(net.regions[0].loops).toEqual([[0, 1, 2]]);
    }
    expect(networkFromPath([["M", 0, 0], ["L", 0, 0]]).regions).toEqual([]);
    const multi = networkFromPath([...square(0, 0, 10), ...square(3, 3, 4)]); expect(multi.regions).toHaveLength(1); expect(multi.regions[0].loops).toHaveLength(2);
  });
  it("repairs references while retaining empty regions, explicit paint metadata and remapped loops", () => {
    const net = freezeNetwork({ vertices: triangle.map(v => vectorVertex(v.x, v.y)), segments: [vectorLine(0, 9), vectorLine(0, 1), vectorLine(1, 2), vectorLine(2, 0)], regions: [{ loops: [[0, 1], [1, 2, 3], [99], []], winding: "evenOdd", fills: [] }] });
    const repaired = sanitiseNetwork(net); expect(repaired.segments).toHaveLength(3); expect(repaired.regions[0]).toEqual({ loops: [[0, 1, 2], []], winding: "evenOdd", fills: [] });
    const allBad = sanitiseNetwork({ ...net, segments: [vectorLine(0, 9)] }); expect(allBad.segments).toEqual([]); expect(allBad.regions).toHaveLength(1);
  });
  it("starts runs at junctions and counts a self-loop twice without duplicating it", () => {
    const net = freezeNetwork({ vertices: [vectorVertex(0, 0), vectorVertex(10, 0), vectorVertex(20, 0), vectorVertex(10, 10)], segments: [vectorLine(0, 1), vectorLine(1, 2), vectorLine(1, 3), { a: 3, b: 3, ta: [20, 0], tb: [0, 20] }], regions: [] });
    const runs = vectorStrokeRuns(net); expect(runs).toHaveLength(4); expect(runs.filter(r => r.closed)).toHaveLength(1);
    expect(runs.reduce((n, r) => n + r.path.filter(c => c[0] === "L" || c[0] === "C").length, 0)).toBe(4);
    const joins = freezeNetwork({ ...networkFromPoints(triangle, false), vertices: triangle.map((v, i) => ({ ...vectorVertex(v.x, v.y), ...(i === 1 ? { join: "bevel" as const } : {}) })) });
    expect(vectorStrokeRuns(joins)).toHaveLength(1); expect(vectorStrokeRuns(joins, true)).toHaveLength(2);
  });
  it("handles3000 duplicate-closed subpaths and a20000-point chain without global rescans", () => {
    const path: PathCommand[] = []; for (let i = 0; i < 3000; i++) path.push(["M", i * 10, 0], ["L", i * 10 + 5, 0], ["L", i * 10 + 5, 5], ["L", i * 10, 0], ["Z"]);
    const net = networkFromPath(path); expect(net.vertices).toHaveLength(9000); expect(net.regions[0].loops).toHaveLength(3000); expect(vectorStrokeRuns(net)).toHaveLength(3000);
    const chain = networkFromPoints(Array.from({ length: 20000 }, (_, i) => p(i, i % 7)), false); expect(vectorStrokeRuns(chain)).toHaveLength(1); expect(vectorStrokeRuns(chain)[0].closed).toBe(false);
  });
  it("transforms vertices, relative handles and region frames while retaining radii", () => {
    const net = freezeNetwork({ vertices: [{ ...vectorVertex(2, 3), radius: 7 }, vectorVertex(10, 20)], segments: [{ a: 0, b: 1, ta: [4, 5], tb: [-3, 1] }], regions: [{ loops: [], winding: "nonZero", fills: [], paintSpace: { width: 30, height: 20, transform: [1, 0, 0, 1, 4, 8] } }] });
    const scaled = transformNetwork(net, [2, 0, 0, 3, 7, 9]); expect(scaled.vertices[0]).toMatchObject({ x: 11, y: 18, radius: 7 }); expect(scaled.segments[0].ta).toEqual([8, 15]); expect(scaled.regions[0].paintSpace?.transform).toEqual([2, 0, 0, 3, 15, 33]);
    expect(regionPaintFrame(net.regions[0], 100, 40)).toBe(net.regions[0].paintSpace);
    expect(regionPaintFrame({ ...net.regions[0], paintSpace: { width: 30, height: 20, transform: [1e-320, 0, 0, 1, 0, 0] } }, 100, 40)).toEqual({ width: 100, height: 40, transform: identity });
    expect(() => transformNetwork(net, [1e308, 0, 0, 1, 0, 0])).toThrow();
  });
  it("infers mirroring only from two opposite handles and retains explicit overrides", () => {
    const base = networkFromPoints(triangle, false), segments = [{ ...base.segments[0], tb: [-5, 0] as const }, { ...base.segments[1], ta: [5, 0] as const }];
    expect(networkMirroring({ ...base, segments }, 1)).toBe("angleAndLength");
    expect(networkMirroring({ ...base, segments: [segments[0], { ...segments[1], ta: [10, 0] }] }, 1)).toBe("angle");
    expect(networkMirroring({ ...base, segments: [segments[0], { ...segments[1], ta: [5, 1] }] }, 1)).toBe("none");
    expect(networkMirroring({ ...base, segments, vertices: base.vertices.map(v => ({ ...v, mirror: "none" })) }, 1)).toBe("none");
  });
});
describe("doc::vector_regions paired fill rules and damaged loops", () => {
  const nested = () => networkFromPath([...square(0, 0, 200), ...square(60, 60, 80)]);
  it("distinguishes non-zero and even-odd holes and each region's own rule", () => {
    const net = nested(), region = net.regions[0], even = { ...region, winding: "evenOdd" as const };
    expect(pathWinding(vectorFillPath(net), p(100, 100))).toBe(2); expect(vectorFillContains(net, p(100, 100))).toBe(true);
    const mixed = { ...net, regions: [region, even] }; expect(vectorRegionContains(mixed, 0, p(100, 100))).toBe(true); expect(vectorRegionContains(mixed, 1, p(100, 100))).toBe(false);
    expect(vectorRegionContains(mixed, 1, p(20, 100))).toBe(true); expect(vectorRegionContains(mixed, 1, p(300, 100))).toBe(false);
    const justEven = { ...net, regions: [even] }; expect(vectorFillContains(justEven, p(100, 100))).toBe(false);
    const reversed = { ...net, segments: net.segments.map((s, i) => i < 4 ? s : { ...s, a: s.b, b: s.a }), regions: [{ ...region, loops: [region.loops[0], [...region.loops[1]].reverse()] }] };
    expect(pathWinding(vectorFillPath(reversed), p(100, 100))).toBe(0); expect(vectorRegionContains(reversed, 0, p(20, 100))).toBe(true);
  });
  it("walks reversed, missing and unclosed segments in native ring order", () => {
    const net = networkFromPath(square(0, 0, 200)), segments = net.segments.map((s, i) => i % 2 ? { ...s, a: s.b, b: s.a } : s), reversed = { ...net, segments };
    expect(vectorLoopWalk(reversed, [0, 1, 2, 3])).toEqual([[0, false], [1, true], [2, false], [3, true]]);
    expect(area(vectorRegionPath(reversed, 0)!)).toBe(40000);
    for (const loop of [[0, 1, 2], [99, 0, 1, 2], [0, 99, 1, 2]]) {
      const partial = { ...net, regions: [{ loops: [loop], winding: "nonZero" as const }] };
      expect(vectorRegionContains(partial, 0, p(100, 100))).toBe(true); expect(area(vectorRegionPath(partial, 0)!)).toBe(40000);
    }
    expect(vectorRegionPath({ ...net, regions: [{ loops: [[99]], winding: "nonZero" }] }, 0)).toBeUndefined();
  });
  it("counts curved bulges and single-segment loops where their curves run", () => {
    const net = freezeNetwork({ vertices: [vectorVertex(0, 0), vectorVertex(120, 0)], segments: [{ a: 0, b: 1, ta: [0, -80], tb: [0, -80] }, vectorLine(1, 0)], regions: [{ loops: [[0, 1]], winding: "nonZero" }] });
    for (const [y, hit] of [[-40, true], [20, false], [-70, false], [-58, true]] as const) expect(vectorRegionContains(net, 0, p(60, y))).toBe(hit);
    expect(networkBounds(net)).toEqual({ x: 0, y: -60, width: 120, height: 60 });
    const edge = cubicPoint(networkCubic(net, 0)!, .3);
    expect(vectorRegionContains(net, 0, p(edge.x, edge.y + 1e-7))).toBe(true); expect(vectorRegionContains(net, 0, p(edge.x, edge.y - 1e-7))).toBe(false);
    const loop = freezeNetwork({ vertices: [vectorVertex(0, 0)], segments: [{ a: 0, b: 0, ta: [100, -100], tb: [-100, -100] }], regions: [{ loops: [[0]], winding: "nonZero" }] });
    expect(vectorRegionContains(loop, 0, p(0, -40))).toBe(true); expect(vectorRegionContains(loop, 0, p(0, 40))).toBe(false);
    expect(vectorRegionContains(net, 0, p(NaN, 0))).toBe(false);
  });
});
describe("independent cubic mathematics and native rounded networks", () => {
  it("integrates exact straight/quadratic-derived lengths and preserves split endpoints/tangents", () => {
    const line: Cubic = [p(0, 0), p(0, 0), p(3, 4), p(3, 4)]; expect(cubicLength(line)).toBe(5); expect(cubicLength(line, .5)).toBeCloseTo(2.5, 6);
    // Quadratic (t,t²) converted to a cubic: integral sqrt(1+4t²) from0 to1.
    const curve: Cubic = [p(0, 0), p(1 / 3, 0), p(2 / 3, 1 / 3), p(1, 1)];
    expect(cubicLength(curve)).toBeCloseTo(Math.sqrt(5) / 2 + Math.asinh(2) / 4, 6);
    const t = cubicLengthParameter(curve, .5); expect(cubicLength(curve, t)).toBeCloseTo(.5, 5);
    const part = cubicPart(curve, .2, .8); expect(part[0].x).toBeCloseTo(cubicPoint(curve, .2).x, 12); expect(part[3].y).toBeCloseTo(cubicPoint(curve, .8).y, 12);
    expect(cubicBounds([p(0, 0), p(0, -80), p(120, -80), p(120, 0)])).toEqual({ x: 0, y: -60, width: 120, height: 60 });
  });
  it("rounds only the requested square corner, preserving authored vertices", () => {
    const base = networkFromPoints([p(0, 0), p(100, 0), p(100, 100), p(0, 100)], true), net = freezeNetwork({ ...base, vertices: base.vertices.map((v, i) => ({ ...v, radius: i === 0 ? 20 : 0 })) });
    const rounded = roundedNetwork(net)!; expect(rounded.vertices).toHaveLength(5); expect(rounded.regions[0].loops[0]).toHaveLength(5); expect(roundedNetwork(net)).toBe(rounded);
    expect(net.vertices[0]).toMatchObject({ x: 0, y: 0, radius: 20 });
    for (const [point, hit] of [[p(2, 2), false], [p(98, 2), true], [p(20, 2), true], [p(50, 50), true]] as const) expect(vectorFillContains(net, point)).toBe(hit);
  });
  it("inserts both corner arcs in a two-segment closed lens", () => {
    const net = freezeNetwork({ vertices: [{ ...vectorVertex(0, 0), radius: 2 }, { ...vectorVertex(10, 0), radius: 2 }], segments: [vectorLine(0, 1), { a: 1, b: 0, ta: [0, 5], tb: [0, -5] }], regions: [{ loops: [[0, 1]], winding: "nonZero" }] });
    const rounded = roundedNetwork(net)!; expect(rounded.regions[0].loops[0]).toHaveLength(4); expect(vectorFillPath(net).length).toBeGreaterThan(0);
    for (let i = net.segments.length; i < rounded.segments.length; i++) {
      const arc = networkCubic(rounded, i)!;
      for (const [end, t] of [[arc[0], 0], [arc[3], 1]] as const) {
        const neighbour = rounded.segments.slice(0, 2).map((_, j) => networkCubic(rounded, j)!).find(c => Math.hypot(c[0].x - end.x, c[0].y - end.y) < 1e-6 || Math.hypot(c[3].x - end.x, c[3].y - end.y) < 1e-6)!;
        const atStart = Math.hypot(neighbour[0].x - end.x, neighbour[0].y - end.y) < 1e-6, a = cubicDerivative(arc, t), b = cubicDerivative(neighbour, atStart ? 0 : 1);
        if (Math.hypot(b.x, b.y) > 1e-9) expect(Math.abs(a.x * b.y - a.y * b.x) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y))).toBeLessThan(1e-5);
      }
    }
  });
  it("leaves smooth curved joins unrounded and rebuilds4000 corner loops linearly", () => {
    const base = networkFromPath([["M", 0, 0], ["C", 0, -40, 100, -40, 100, 0], ["C", 100, 40, 200, 40, 200, 0]]), smooth = freezeNetwork({ ...base, vertices: base.vertices.map(v => ({ ...v, radius: 20 })) });
    expect(roundedNetwork(smooth)?.segments).toHaveLength(2);
    const ring = networkFromPoints(Array.from({ length: 4000 }, (_, i) => { const t = i / 4000 * 2 * Math.PI; return p(1000 * Math.cos(t), 1000 * Math.sin(t) * (i % 2 ? .9 : 1)); }), true);
    const rounded = roundedNetwork(freezeNetwork({ ...ring, vertices: ring.vertices.map(v => ({ ...v, radius: .5 })) }))!;
    expect(rounded.regions[0].loops[0].length).toBeGreaterThan(4000); expect(rounded.regions[0].loops[0]).toHaveLength(rounded.segments.length);
  });
  it("rounds a straight-to-curve corner while retaining the curved remainder", () => {
    const base = networkFromPath([["M", 0, 0], ["L", 100, 0], ["C", 100, 60, 60, 100, 0, 100], ["Z"]]);
    const net = freezeNetwork({ ...base, vertices: base.vertices.map(v => ({ ...v, radius: v.x === 100 && v.y === 0 ? 20 : 0 })) }), rounded = roundedNetwork(net)!;
    expect(rounded.segments).toHaveLength(4); const arc = networkCubic(rounded, 3)!;
    // The source meets a20-unit trim along the straight edge and along the original cubic.
    expect(arc[0].x).toBeCloseTo(80, 6); expect(arc[0].y).toBe(0);
    const original = networkCubic(net, 1)!, at = cubicLengthParameter(original, 20), expected = cubicPoint(original, at);
    expect(arc[3].x).toBeCloseTo(expected.x, 6); expect(arc[3].y).toBeCloseTo(expected.y, 6);
    const remainder = networkCubic(rounded, 1)!, a = cubicDerivative(arc, 1), b = cubicDerivative(remainder, 0);
    expect(Math.abs(a.x * b.y - a.y * b.x) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y))).toBeLessThan(1e-6);
    expect(remainder[3]).toMatchObject({ x: 0, y: 100 });
  });
});
