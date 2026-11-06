import { describe, expect, it } from "vitest";
import { defaultStroke, readStroke, wireStroke, setStrokeProperties, strokeEnum, strokeCaps, bandCaps, capShape, dashPattern, lineDashes, renderDashes, miterAngle, miterLimitFor } from "../../src/engine/stroke";
import type { RectangleNode } from "../../src/engine/document";
import { flattenContours, hitsPath, type PathCommand } from "../../src/engine/corners";
import { lineArrowhead, lineStrokeBand, lineStrokePath } from "../../src/engine/line-stroke";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import { closedStrokeRing } from "../../src/engine/stroke-geometry";

const rect: RectangleNode = Object.freeze({ id: "2", parent: "1", kind: "rectangle", name: "Rectangle", x: 0, y: 0, width: 100, height: 100, fill: "#ffffff" });
describe("stroke command, history, native persistence and scaling", () => {
  it("round-trips solid stroke stacks independently from fills and undoes the whole edit", async () => {
    const engine = new EditorEngine(), id = String(engine.execute("shape.rectangle").id), before = engine.getSnapshot().document;
    engine.execute("node.set", { props: { stroke: "#ff000080", strokeWeight: 7, strokeAlign: "outside", startCap: "circleFilled", endCap: "diamondFilled", dashes: [3, 2], dashCap: "square", miterAngle: 45 } });
    const document = engine.getSnapshot().document, node = document.nodes[id] as RectangleNode;
    expect(node.fill).toBe("#d9d9d9"); expect(node.strokes?.[0].opacity).toBeCloseTo(128 / 255);
    const opened = await decodeFigcraft(await encodeFigcraft(document)); expect(opened.document).toEqual(document);
    engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(before);
    engine.execute("edit.redo"); expect(engine.getSnapshot().document).toBe(document);
    const snapshot = engine.getSnapshot(); expect(() => engine.execute("node.set", { props: { x: 500, strokeWeight: 4, dashes: [false] } })).toThrow(); expect(engine.getSnapshot()).toBe(snapshot);
  });
  it("scales weight and dash lengths while ordinary resizing preserves both", () => {
    const engine = new EditorEngine(), id = String(engine.execute("shape.rectangle", { props: { stroke: "black", strokeWeight: 3, dashes: [2, 4] } }).id);
    engine.execute("transform.resize", { width: 200, height: 300 });
    expect((engine.getSnapshot().document.nodes[id] as RectangleNode).stroke).toMatchObject({ weight: 3, dashes: [2, 4] });
    engine.execute("transform.scale", { factor: 2 });
    expect((engine.getSnapshot().document.nodes[id] as RectangleNode).stroke).toMatchObject({ weight: 6, dashes: [4, 8] });
    const snapshot = engine.getSnapshot();
    engine.execute("node.set", { props: { strokeWeight: 1e308 } });
    const huge = engine.getSnapshot(); expect(() => engine.execute("transform.scale", { factor: 10 })).toThrow("finite"); expect(engine.getSnapshot()).toBe(huge);
    engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(snapshot.document);
  });
});
describe("native uniform stroke contracts (doc/props.rs and cmd/props.rs)", () => {
  it("preserves wire defaults, finite out-of-range floats and endpoint metadata", () => {
    expect(readStroke({})).toEqual(defaultStroke);
    const stroke = readStroke({ weight: -3, miter_limit: -8, dashes: [-2, 0, 5], dash_cap: "triangleArrow" });
    expect(readStroke(wireStroke(stroke))).toEqual(stroke);
    expect(stroke.weight).toBe(-3); expect(stroke.miterLimit).toBe(-8); expect(stroke.dashes).toEqual([-2, 0, 5]);
    expect(wireStroke(defaultStroke)).not.toHaveProperty("dash_cap");
    expect(Object.isFrozen(stroke.dashes)).toBe(true);
  });
  it.each([null, [], { weight: "4" }, { weight: Infinity }, { dashes: null }, { dashes: [true] }, { align: "INSIDE" }, { cap_end: "triangle_arrow" }, { sides: [1, 2, 3] }, { width_profile: {} }, { brush: {} }])("refuses unsupported or malformed wire data: %j", value => {
    expect(() => readStroke(value)).toThrow();
  });
  it("normalises command enums exactly, while retaining camel-case spellings", () => {
    for (const value of ["lineArrow", "LineArrow", "LINE_ARROW", "Line arrow", "line-arrow", "  lineArrow  "]) expect(strokeEnum(value, strokeCaps)).toBe("lineArrow");
    expect(strokeEnum("ROUND", strokeCaps)).toBe("round");
    for (const value of ["LINEARROW", "_round", 1]) expect(() => strokeEnum(value, strokeCaps)).toThrow();
  });
  it("sorts competing aliases, parses numeric strings and clamps commands without mutating the node", () => {
    const out = setStrokeProperties(rect, { stroke: "red", strokes: ["blue"], strokeWeight: "-2px", startCap: "round", endCap: "square", strokeCap: "TRIANGLE_ARROW", miterAngle: 90, miterLimit: 12, dashes: ["3px", -2, "5"] });
    expect(out.stroke).toMatchObject({ weight: 0, capStart: "triangleArrow", capEnd: "triangleArrow", miterLimit: 12, dashes: [3, 0, 5] });
    expect(out.strokes?.[0].color.b).toBe(1); expect(out.strokes?.[0].color.r).toBe(0); expect(rect.stroke).toBeUndefined();
    expect(setStrokeProperties(rect, { name: "ignored" })).toBe(rect);
    expect(setStrokeProperties(out, { stroke: "NONE", dashes: null, dashCap: null, miterLimit: "invalid" })).toMatchObject({ strokes: [], stroke: { dashes: [], dashCap: null, miterLimit: 4 } });
  });
  it("rejects invalid command values atomically, including booleans in dash arrays", () => {
    for (const props of [{ stroke: " none " }, { strokeWeight: NaN }, { dashes: [2, true] }, { dashCap: "triangleArrow" }, { miterAngle: "invalid" }]) {
      expect(() => setStrokeProperties(rect, { stroke: "red", ...props })).toThrow(); expect(rect.strokes).toBeUndefined();
    }
  });
  it("converts miter angles with native ranges and fallback", () => {
    expect(miterAngle(4)).toBeCloseTo(28.95502437); expect(miterLimitFor(90)).toBeCloseTo(Math.SQRT2);
    expect(miterLimitFor(0)).toBe(100); expect(miterLimitFor(200)).toBe(1); expect(miterLimitFor(NaN)).toBeCloseTo(4, 4);
    expect(miterAngle(0)).toBe(180);
  });
  it("maps arrow band shapes and overrides both ends only when raw dashes are present", () => {
    expect(strokeCaps.map(capShape)).toEqual(["none", "round", "square", "none", "none", "none", "round", "square"]);
    const props = { ...defaultStroke, capStart: "round", capEnd: "square", dashCap: "none" } as const;
    expect(bandCaps(props)).toEqual(["round", "square"]);
    expect(bandCaps({ ...props, dashes: [0] })).toEqual(["none", "none"]);
  });
});

describe("native render::stroke_area inset/outset rings", () => {
  it("keeps square corners square and shrinks only positive corner radii", () => {
    const node = { ...rect, width: 100, height: 80, stroke: { ...defaultStroke, weight: 10 } };
    expect(closedStrokeRing(node)).toEqual([["M", 0, 0], ["L", 100, 0], ["L", 100, 80], ["L", 0, 80], ["Z"], ["M", 10, 10], ["L", 90, 10], ["L", 90, 70], ["L", 10, 70], ["Z"]]);
    const outside = closedStrokeRing({ ...node, stroke: { ...node.stroke, align: "outside" } })!;
    expect(outside[0]).toEqual(["M", -10, -10]); expect(outside[2]).toEqual(["L", 110, 90]);
    const round = closedStrokeRing({ ...node, corners: { radii: [20, 0, 20, 0], smoothing: 0 } })!;
    expect(round.filter(c => c[0] === "M")[1]).toEqual(["M", 20, 10]);
    expect(closedStrokeRing({ ...node, stroke: { ...node.stroke, weight: 100 } })?.filter(c => c[0] === "M")).toHaveLength(1);
  });
  it("insets whole ellipses by their bounding box and falls back for rings, arcs and smoothing", () => {
    const ellipse = { ...rect, kind: "ellipse" as const, width: 100, height: 60, start: 2, sweep: 2 * Math.PI, inner: 0, stroke: { ...defaultStroke, weight: 10 } };
    const path = closedStrokeRing(ellipse)!;
    const contours = flattenContours(path); expect(contours).toHaveLength(2);
    const inner = contours[1]; expect(Math.min(...inner.map(p => p.x))).toBeCloseTo(10); expect(Math.max(...inner.map(p => p.x))).toBeCloseTo(90);
    expect(Math.min(...inner.map(p => p.y))).toBeCloseTo(10); expect(Math.max(...inner.map(p => p.y))).toBeCloseTo(50);
    expect(closedStrokeRing({ ...ellipse, inner: .5 })).toBeUndefined(); expect(closedStrokeRing({ ...ellipse, sweep: Math.PI })).toBeUndefined();
    expect(closedStrokeRing({ ...rect, corners: { radii: [10, 10, 10, 10], smoothing: .6 } })).toBeUndefined();
    expect(closedStrokeRing({ ...rect, stroke: { ...defaultStroke, align: "outside", join: "round" } })).toBeUndefined();
  });
});

describe("native dash_ends and dash_cap fixtures", () => {
  it("filters invalid dash entries, rejects near-zero totals and doubles odd patterns", () => {
    expect(dashPattern([4, 2, 1])).toEqual([4, 2, 1, 4, 2, 1]);
    expect(dashPattern([-1, NaN, 4, Infinity, 2])).toEqual([4, 2]);
    expect(dashPattern([0, .01])).toBeNull(); expect(dashPattern([])).toBeNull();
  });
  it("fits open ends to half the first dash, including short and already fitted patterns", () => {
    const fitted = lineDashes(107, false, [10, 10]);
    expect(fitted.pattern[0]).toBeCloseTo(10.7); expect(fitted.offset).toBeCloseTo(5.35);
    expect(lineDashes(5, false, [10, 10])).toEqual({ pattern: [2.5, 2.5], offset: 1.25 });
    expect(lineDashes(.45, false, [.1, .05]).pattern[0]).toBeCloseTo(.1);
    const example = lineDashes(19, false, [1, 2]); expect(example.pattern[0]).toBeCloseTo(1.055556, 5); expect(example.pattern[1]).toBeCloseTo(2.111111, 5); expect(example.offset).toBeCloseTo(.527778, 5);
  });
  it("leaves closed, empty and zero-total fitting unchanged", () => {
    expect(lineDashes(300, true, [10, 7])).toEqual({ pattern: [10, 7], offset: 0 });
    expect(lineDashes(0, false, [10, 10])).toEqual({ pattern: [10, 10], offset: 0 });
    expect(lineDashes(100, false, [0, 0])).toEqual({ pattern: [0, 0], offset: 0 });
  });
  it("replaces zero dots before fitting and bounds tiny-dash work with a solid fallback", () => {
    const props = { ...defaultStroke, dashes: [0, 20] };
    expect(renderDashes(200, false, props)?.pattern[0]).toBe(0);
    expect(renderDashes(200, false, { ...props, dashCap: "square" })?.pattern[0]).toBeGreaterThan(0);
    expect(renderDashes(200, false, { ...props, capEnd: "circleFilled" })?.pattern[0]).toBeGreaterThan(0);
    expect(renderDashes(200, false, { ...props, capEnd: "square" })?.pattern[0]).toBe(0);
    expect(renderDashes(1e6, false, { ...props, dashes: [.01, .01] })).toBeNull();
  });
});

const area = (path: readonly PathCommand[]): number => Math.abs(flattenContours(path).reduce((sum, points) => sum + points.reduce((a, p, i) => { const q = points[(i + 1) % points.length]; return a + p.x * q.y - q.x * p.y; }, 0) / 2, 0));
const covers = (path: readonly PathCommand[], xs: readonly number[]): boolean[] => xs.map(x => hitsPath(path, { x, y: 0 }, 0));
describe("native straight stroke geometry fixtures", () => {
  const dashed = { ...defaultStroke, weight: 2, dashes: [10, 10] };
  it("matches the native half-dash coverage and area", () => {
    const path = lineStrokeBand(100, dashed);
    expect(covers(path, [2, 7, 13, 16, 24, 26, 84, 86, 94, 98])).toEqual([true, false, false, true, true, false, true, false, false, true]);
    expect(area(path)).toBeCloseTo(100, 6);
    expect(covers(lineStrokeBand(107, dashed), [5, 6, 101, 102])).toEqual([true, false, false, true]);
  });
  it("fits custom and odd-length patterns without losing the last half dash", () => {
    expect(covers(lineStrokeBand(100, { ...dashed, dashes: [12, 4, 2, 2] }), [3, 8, 11, 13, 20, 97, 93])).toEqual([true, false, true, false, true, true, false]);
    expect(covers(lineStrokeBand(70, { ...dashed, dashes: [4, 2, 1] }), [1, 3, 67.5, 69])).toEqual([true, false, false, true]);
  });
  it("matches native dash-cap areas and legacy asymmetric endpoints", () => {
    const props = { ...dashed, weight: 4 }, band = area(lineStrokeBand(200, props));
    expect(band).toBeCloseTo(400, 6);
    expect(area(lineStrokeBand(200, { ...props, dashCap: "square" })) - band).toBeCloseTo(176, 6);
    expect(Math.abs(area(lineStrokeBand(200, { ...props, dashCap: "round" })) - band - 11 * Math.PI * 4)).toBeLessThan(1);
    const legacy = { ...props, capStart: "round", capEnd: "square" } as const;
    expect(area(lineStrokeBand(200, legacy))).toBeGreaterThan(band);
    expect(area(lineStrokeBand(200, { ...legacy, dashCap: "none" }))).toBe(band);
  });
  it("draws zero-length dots only for the native cap cases", () => {
    const props = { ...dashed, weight: 4, dashes: [0, 20] };
    expect(area(lineStrokeBand(200, { ...props, dashCap: "round" }))).toBeGreaterThan(100);
    expect(Math.abs(area(lineStrokeBand(200, { ...props, dashCap: "square" })) - 176)).toBeLessThan(.1);
    expect(area(lineStrokeBand(200, props))).toBeLessThan(1e-6);
    expect(area(lineStrokeBand(200, { ...props, capStart: "square", capEnd: "square" }))).toBeLessThan(1e-6);
  });
  it("ignores dash caps for solid lines and bounds huge weights and dash counts", () => {
    const props = { ...defaultStroke, weight: 4, capEnd: "square" } as const;
    expect(lineStrokeBand(200, { ...props, dashCap: "round" })).toEqual(lineStrokeBand(200, props));
    expect(lineStrokeBand(100, { ...props, weight: 1e100 })).toEqual(lineStrokeBand(100, { ...props, weight: 1e6 }));
    expect(lineStrokeBand(1e6, { ...props, dashes: [.01, .01] })).toEqual(lineStrokeBand(1e6, props));
    for (const length of [0, -1, NaN, Infinity]) expect(lineStrokePath(length, props)).toEqual([]);
  });
  it("uses source arrowhead vertices and mirrors start/end directions", () => {
    expect(lineArrowhead(100, 2, "triangleArrow", true)).toEqual([["M", 101, 0], ["L", 94, 3.5999999999999996], ["L", 94, -3.5999999999999996], ["Z"]]);
    expect(lineArrowhead(100, 4, "reversedTriangle", true)).toEqual([["M", 88, 0], ["L", 100, 7.199999999999999], ["L", 100, -7.199999999999999], ["Z"]]);
    for (const cap of ["triangleArrow", "reversedTriangle", "diamondFilled"] as const) {
      const end = lineArrowhead(100, 4, cap, true), start = lineArrowhead(100, 4, cap, false);
      expect(start).toEqual(end.map(c => c[0] === "Z" ? c : [c[0], 100 - c[1], -c[2]]));
    }
  });
  it("retains arrowheads on overall path ends independently of dash caps", () => {
    const props = { ...dashed, weight: 4, capEnd: "triangleArrow", dashCap: "round" } as const;
    const path = lineStrokePath(200, props), band = lineStrokeBand(200, props);
    expect(hitsPath(path, { x: 189, y: 6 }, 0)).toBe(true); expect(hitsPath(band, { x: 189, y: 6 }, 0)).toBe(false);
    expect(hitsPath(path, { x: 89, y: 6 }, 0)).toBe(false);
    expect(area(lineArrowhead(200, 4, "circleFilled", true))).toBeCloseTo(Math.PI * 4.8 ** 2, 1);
    expect(hitsPath(lineArrowhead(200, 4, "lineArrow", true), { x: 190, y: 7 }, 0)).toBe(true);
  });
  it("preserves the source reversed-triangle winding where it overlaps the positive band", () => {
    const props = { ...defaultStroke, weight: 4, capEnd: "reversedTriangle" } as const;
    expect(hitsPath(lineStrokePath(100, props), { x: 95, y: .5 }, 0)).toBe(false);
    expect(hitsPath(lineStrokePath(100, props), { x: 95, y: 3 }, 0)).toBe(true);
    expect(hitsPath(lineStrokePath(100, { ...props, capEnd: "triangleArrow" }), { x: 95, y: .5 }, 0)).toBe(true);
  });
});
