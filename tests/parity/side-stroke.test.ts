import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import type { LayerNode, RectangleNode } from "../../src/engine/document";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import { defaultStroke, hasVisibleStroke, isDefaultStroke, readStroke, setStrokeProperties, wireStroke } from "../../src/engine/stroke";
import { roundedRect, hitsPath, type PathCommand, type Radii } from "../../src/engine/corners";
import { rectSideStrokes, roundedSideStrokes, sideStrokeGeometry, type SideStrokeGeometry } from "../../src/engine/side-stroke";
import { strokeBounds } from "../../src/engine/stroke-renderer";

// Integrate x dy − y dx exactly for each cubic, avoiding flattened-area tolerance changes.
function area(path: readonly PathCommand[]): number {
  let start = [0, 0], previous = start, sum = 0;
  const line = (end: number[]) => { sum += previous[0] * end[1] - end[0] * previous[1]; previous = end; };
  for (const c of path) {
    if (c[0] === "M") { start = [c[1], c[2]]; previous = start; }
    else if (c[0] === "Z") line(start);
    else if (c[0] === "L") line([c[1], c[2]]);
    else if (c[0] === "C") {
      const coefficients = (a: number, b: number, d: number, e: number) => [a, 3 * (b - a), 3 * (a - 2 * b + d), -a + 3 * b - 3 * d + e];
      const x = coefficients(previous[0], c[1], c[3], c[5]), y = coefficients(previous[1], c[2], c[4], c[6]);
      for (let i = 0; i < 4; i++) for (let j = 1; j < 4; j++) sum += (x[i] * j * y[j] - y[i] * j * x[j]) / (i + j);
      previous = [c[5], c[6]];
    }
  }
  return Math.abs(sum / 2);
}
const ringArea = (g: SideStrokeGeometry): number => area(g.outer) - area(g.hole);
const painted = (g: SideStrokeGeometry, x: number, y: number): boolean => {
  const outer = hitsPath(g.outer, { x, y }, 0), inner = hitsPath(g.hole, { x, y }, 0);
  return g.clip ? outer && !inner : outer !== inner;
};

const rect: RectangleNode = { id: "2", parent: "1", kind: "rectangle", name: "Rectangle", x: 0, y: 0, width: 120, height: 60, fill: "#ffffff" };
describe("native per-side properties (cmd/props.rs::four and doc::StrokeProps)", () => {
  it.each([
    [3, [3, 3, 3, 3]], [[3], [3, 3, 3, 3]], [[2, 4], [2, 4, 2, 4]],
    [[-1, "2px", true, 0], [-1, 2, 1, 0]],
  ])("expands native command values %j", (value, expected) => {
    expect(setStrokeProperties(rect, { strokeSides: value }).stroke?.sides).toEqual(expected);
  });
  it("preserves raw wire sides, distinguishes default from all-zero, and omits null", () => {
    const props = readStroke({ sides: [-1, 2, 0, 4] });
    expect(readStroke(wireStroke(props))).toEqual(props);
    expect(Object.isFrozen(props.sides)).toBe(true);
    expect(isDefaultStroke(readStroke({ sides: [0, 0, 0, 0] }))).toBe(false);
    expect(readStroke({ sides: null })).toEqual(defaultStroke);
    expect(setStrokeProperties({ ...rect, stroke: props }, { strokeSides: null }).stroke).not.toHaveProperty("sides");
    expect(() => readStroke({ sides: new Array(4) })).toThrow();
    expect(() => setStrokeProperties(rect, { strokeSides: new Array(4) })).toThrow();
  });
  it.each([[], [1, 2, 3], [1, 2, 3, 4, 5], [1, "no"], [Infinity], {}])("rejects malformed commands %j", value => {
    expect(() => setStrokeProperties(rect, { strokeSides: value })).toThrow();
  });
  it.each([1, [], [1, 2, 3], [1, 2, 3, "4"], [1, 2, 3, true], [1, 2, 3, Infinity]])("requires a finite numeric four-tuple in files: %j", sides => {
    expect(() => readStroke({ sides })).toThrow();
  });
  it("initialises individual sides from weight, clamps only aliases and respects sorted precedence", () => {
    const base = { ...rect, stroke: { ...defaultStroke, weight: 5 } };
    expect(setStrokeProperties(base, { strokeLeftWeight: -2 }).stroke?.sides).toEqual([5, 5, 5, 0]);
    const result = setStrokeProperties(base, { strokeWeight: 9, strokeTopWeight: 7, strokeSides: [1, 2], strokeLeftWeight: 6 });
    expect(result.stroke).toMatchObject({ weight: 9, sides: [7, 2, 1, 2] });
    expect(base.stroke).not.toHaveProperty("sides");
    expect(setStrokeProperties(result, { strokeWeight: 3 }).stroke?.sides).toEqual([7, 2, 1, 2]);
  });
  it("retains metadata on other kinds and uses global weight for visibility", () => {
    const line: LayerNode = { ...rect, kind: "line" };
    const node = setStrokeProperties(line, { stroke: "black", strokeSides: [0, 0, 0, 0] });
    expect(node.stroke?.sides).toEqual([0, 0, 0, 0]);
    expect(hasVisibleStroke(node)).toBe(true);
    expect(hasVisibleStroke(setStrokeProperties(node, { strokeSides: 20, strokeWeight: 0 }))).toBe(false);
  });
  it("round-trips, scales, resizes and undoes as one atomic command", async () => {
    const engine = new EditorEngine(), id = String(engine.execute("shape.rectangle", { props: { stroke: "black" } }).id);
    const before = engine.getSnapshot().document;
    engine.execute("node.set", { props: { strokeSides: [-1, 2, 3, 4] } });
    const document = engine.getSnapshot().document;
    expect((await decodeFigcraft(await encodeFigcraft(document))).document).toEqual(document);
    engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(before);
    engine.execute("edit.redo"); expect(engine.getSnapshot().document).toBe(document);
    engine.execute("transform.resize", { width: 150, height: 60 });
    expect((engine.getSnapshot().document.nodes[id] as LayerNode).stroke?.sides).toEqual([-1, 2, 3, 4]);
    engine.execute("transform.scale", { factor: 2 });
    expect((engine.getSnapshot().document.nodes[id] as LayerNode).stroke?.sides).toEqual([-2, 4, 6, 8]);
    let snapshot = engine.getSnapshot();
    expect(() => engine.execute("node.set", { props: { x: 900, strokeSides: [1, 2, "bad", 4] } })).toThrow();
    expect(engine.getSnapshot()).toBe(snapshot);
    engine.execute("node.set", { props: { strokeSides: [1e308, 0, 0, 0] } });
    snapshot = engine.getSnapshot();
    expect(() => engine.execute("transform.scale", { factor: 10 })).toThrow("finite");
    expect(engine.getSnapshot()).toBe(snapshot);
  });
});

describe("pathops::rounded_side_strokes_tests paired geometry", () => {
  it("matches sharp bar areas for square corners in all alignments", () => {
    for (const align of ["inside", "center", "outside"] as const) {
      expect(ringArea(roundedSideStrokes(120, 60, [0, 0, 0, 0], 0, [1, 2, 3, 4], align))).toBeCloseTo(area(rectSideStrokes(120, 60, [1, 2, 3, 4], align)), 6);
    }
    expect(rectSideStrokes(10, 10, [8, 1, 8, 1], "inside").slice(10, 15)).toEqual([["M", -0, 8], ["L", 1, 8], ["L", 1, 2], ["L", -0, 2], ["Z"]]);
  });
  it("keeps a left border on a right-rounded box a straight bar", () => {
    const bar = roundedSideStrokes(120, 60, [0, 8, 8, 0], 0, [0, 0, 0, 4], "inside");
    expect(ringArea(bar)).toBeCloseTo(240, 6); expect(painted(bar, 2, 30)).toBe(true);
    for (const [x, y] of [[119.9, 30], [117, 1], [60, .1], [60, 59.9], [4.1, 30]]) expect(painted(bar, x, y)).toBe(false);
  });
  it("makes uniform rings with native areas, including smoothed centre/outside growth", () => {
    for (const smoothing of [0, .6]) for (const [align, out, inset] of [["inside", 0, 2], ["center", 1, 1], ["outside", 2, 0]] as const) {
      const radius = smoothing ? 16 : 8, radii: Radii = [radius, radius, radius, radius];
      const ring = roundedSideStrokes(120, 60, radii, smoothing, [2, 2, 2, 2], align);
      const outer = roundedRect(120 + 2 * out, 60 + 2 * out, { radii: radii.map(r => r + out) as unknown as Radii, smoothing });
      const hole = roundedRect(120 - 2 * inset, 60 - 2 * inset, { radii: radii.map(r => r - inset) as unknown as Radii, smoothing });
      expect(ringArea(ring)).toBeCloseTo(area(outer) - area(hole), smoothing ? 3 : 6);
      expect(painted(ring, 60, 30)).toBe(false);
    }
  });
  it("tapers a bottom border through elliptical corners and squares over-inset corners", () => {
    const bottom = roundedSideStrokes(120, 60, [8, 8, 8, 8], 0, [0, 0, 1, 0], "inside");
    for (const [x, y] of [[60, 59.5], [8, 59.5], [112, 59.5]]) expect(painted(bottom, x, y)).toBe(true);
    for (const [x, y] of [[60, .5], [.5, 30], [.5, 52], [119.5, 52], [4, 4]]) expect(painted(bottom, x, y)).toBe(false);
    const top = roundedSideStrokes(120, 60, [8, 8, 8, 8], 0, [10, 0, 0, 2], "inside");
    for (const [x, y] of [[2.2, 10.2], [119.8, 10.2]]) expect(painted(top, x, y)).toBe(false);
    for (const [x, y] of [[60, 9.8], [1.8, 30]]) expect(painted(top, x, y)).toBe(true);
  });
  it("fits narrow holes and clips their protrusions to the outer edge", () => {
    const wide = roundedSideStrokes(20, 20, [10, 10, 10, 10], 0, [0, 0, 0, 12], "inside");
    const tall = roundedSideStrokes(20, 20, [10, 10, 10, 10], 0, [12, 0, 0, 0], "inside");
    const pill = roundedSideStrokes(30, 20, [10, 10, 10, 10], 0, [0, 0, 0, 25], "inside");
    for (const [g, yes, no] of [
      [wide, [6, 10], [[16, 10], [17.5, 3], [17.5, 17]]],
      [tall, [10, 6], [[10, 16], [3, 17.5], [17, 17.5]]],
      [pill, [12, 10], [[27, 10], [24, .5], [24, 19.5]]],
    ] as const) {
      expect(g.clip).toBe(true); expect(painted(g, yes[0], yes[1])).toBe(true);
      for (const [x, y] of no) expect(painted(g, x, y)).toBe(false);
    }
  });
  it("collapses oversized holes and sanitises only render weights", () => {
    const full = roundedSideStrokes(20, 10, [4, 4, 4, 4], 0, [6, 6, 6, 6], "inside");
    expect(full.hole).toEqual([]); expect(ringArea(full)).toBeCloseTo(area(roundedRect(20, 10, { radii: [4, 4, 4, 4], smoothing: 0 })), 6);
    for (const sides of [[0, 0, 0, 0], [NaN, -4, Infinity, 0]] as const) expect(roundedSideStrokes(120, 60, [8, 8, 8, 8], 0, sides, "inside").outer).toEqual([]);
  });
  it("selects geometry only for supported rectangle kinds and includes large outside sides in culling", () => {
    const node = setStrokeProperties(rect, { stroke: "black", strokeSides: [30, 2, 3, 4], strokeAlign: "outside", dashes: [1, 1] });
    expect(sideStrokeGeometry(node)).toBeDefined();
    expect(strokeBounds(node, [1, 0, 0, 1, 0, 0])).toEqual({ x: -30, y: -30, width: 180, height: 120 });
    expect(sideStrokeGeometry({ ...node, kind: "line" })).toBeUndefined();
  });
});
