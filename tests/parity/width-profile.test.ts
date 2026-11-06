import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import type { LayerNode } from "../../src/engine/document";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import { defaultStroke, isDefaultStroke, readStroke, strokeMaxWeight, wireStroke } from "../../src/engine/stroke";
import { parseWidthProfile, readWidthProfile, sanitiseWidthProfile, widthPointFromSides, widthPointSides, widthPresetFromId, widthPresetIds, widthPresetLabels, widthPresetProfile, widthProfileMaxScale, widthProfilePoints, widthProfilePreset, widthProfileSidesAt, wireWidthProfile, type WidthProfile } from "../../src/engine/width-profile";
import { hitRectangle } from "../../src/engine/selection";
import { closedStrokeRing } from "../../src/engine/stroke-geometry";

describe("doc width_tests and width_sides_tests paired profiles", () => {
  it("interpolates native presets monotonically, symmetrically and without overshoot", () => {
    const eye = widthPresetProfile("eye")!;
    expect([0, .5, 1].map(t => widthProfileSidesAt(eye, t)[0])).toEqual([0, 1, 0]);
    expect(widthProfileSidesAt(eye, .25)[0]).toBe(.625);
    expect(widthProfileSidesAt(eye, .75)[0]).toBe(.625);
    for (let i = 0; i <= 100; i++) { const [l, r] = widthProfileSidesAt(eye, i / 100); expect(l).toBe(r); expect(l).toBeGreaterThanOrEqual(0); expect(l).toBeLessThanOrEqual(1); }
    expect(widthProfileSidesAt(widthPresetProfile("wedge")!, .3)[0]).toBeCloseTo(.7, 12);
    const held = parseWidthProfile([[.25, 2], [.75, 4]])!;
    expect(widthProfileSidesAt(held, 0)).toEqual([2, 2]); expect(widthProfileSidesAt(held, 1)).toEqual([4, 4]); expect(widthProfileMaxScale(held)).toBe(4);
    const rise = parseWidthProfile([[0, 0], [.1, 3], [.2, 3.1], [1, 8]])!; let previous = -1;
    for (let i = 0; i <= 200; i++) { const scale = widthProfileSidesAt(rise, i / 200)[0]; expect(scale).toBeGreaterThanOrEqual(previous - 1e-12); previous = scale; }
    expect(widthProfileSidesAt({ points: [] }, .4)).toEqual([1, 1]); expect(widthProfileSidesAt(parseWidthProfile([[.5, 3]])!, .1)).toEqual([3, 3]);
  });
  it("sanitises before sorting and keeps only the first64 finite points", () => {
    const profile = sanitiseWidthProfile({ points: [
      { t: NaN, scale: 1, bias: 0 }, { t: 2, scale: -5, bias: 7 }, { t: -1, scale: 1e9, bias: NaN },
      { t: .5, scale: Infinity, bias: 0 }, { t: .5, scale: .5, bias: -1e9 }, { t: .5, scale: .7, bias: 0 },
    ] });
    expect(profile.points).toEqual([{ t: 0, scale: 1000, bias: 0 }, { t: .5, scale: .5, bias: -1 }, { t: .5, scale: .7, bias: 0 }, { t: 1, scale: 0, bias: 1 }]);
    expect(widthProfileSidesAt(profile, .5).every(Number.isFinite)).toBe(true); expect(widthProfileSidesAt(profile, NaN).every(Number.isFinite)).toBe(true);
    const many = parseWidthProfile(Array.from({ length: 500 }, (_, i) => [1 - i / 500, 1]))!;
    expect(many.points).toHaveLength(64); expect(many.points[0].t).toBe(1 - 63 / 500);
    expect(Object.isFrozen(many.points[0])).toBe(true);
  });
  it("preserves native signed-zero sort order and stable duplicate positions", () => {
    const profile = sanitiseWidthProfile({ points: [{ t: 0, scale: 1, bias: 0 }, { t: -0, scale: 2, bias: 0 }, { t: 0, scale: 3, bias: 0 }] });
    expect(profile.points.map(p => p.scale)).toEqual([2, 1, 3]); expect(Object.is(profile.points[0].t, -0)).toBe(true);
  });
  it("constructs and independently interpolates asymmetric sides", () => {
    const point = widthPointFromSides(.5, 1, 3); expect(point).toEqual({ t: .5, scale: 2, bias: .5 }); expect(widthPointSides(point)).toEqual([1, 3]);
    expect(widthPointSides(widthPointFromSides(0, 0, 2))).toEqual([0, 2]); expect(widthPointFromSides(0, NaN, -4)).toEqual({ t: 0, scale: 0, bias: 0 });
    const profile = parseWidthProfile([[0, 1], [.5, 1, 3], [1, 1]])!;
    for (let i = 0; i <= 20; i++) { const [l, r] = widthProfileSidesAt(profile, i / 20); expect(l).toBeCloseTo(1, 9); expect(r).toBeGreaterThanOrEqual(1); expect(r).toBeLessThanOrEqual(3 + 1e-9); }
    expect(widthProfileMaxScale(profile)).toBe(3);
    expect(parseWidthProfile([[0, 1e308, 1e308]])).toBeUndefined();
  });
  it("recognises all presets, labels and native normalised aliases", () => {
    widthPresetIds.forEach((id, i) => {
      expect(widthPresetFromId(id)).toBe(id); expect(widthPresetFromId(widthPresetLabels[i])).toBe(id);
      const profile = widthPresetProfile(id); if (profile) expect(widthProfilePreset(profile)).toBe(id);
    });
    expect(widthPresetFromId(" TaPer--both_ends!")).toBe("taper"); expect(widthPresetFromId("BULGE")).toBe("eye");
    expect(widthPresetFromId("nope")).toBeUndefined(); expect(widthProfilePreset(parseWidthProfile([[0, 1], [.3, 2]])!)).toBeUndefined();
  });
  it("keeps native raw wire profiles and omits symmetric bias", () => {
    const raw = { points: [{ t: 2, scale: -3 }, { t: -.5, scale: 4, bias: 8 }] }, profile = readWidthProfile(raw)!;
    expect(wireWidthProfile(profile)).toEqual(raw); expect(readWidthProfile(wireWidthProfile(profile))).toEqual(profile);
    expect(readWidthProfile({})).toEqual({ points: [] }); expect(readWidthProfile(null)).toBeUndefined();
    expect(wireStroke(defaultStroke)).not.toHaveProperty("width_profile");
    const empty = readStroke({ width_profile: {} }); expect(isDefaultStroke(empty)).toBe(false); expect(strokeMaxWeight(empty)).toBe(1);
    expect(readStroke(wireStroke(empty))).toEqual(empty);
    expect(strokeMaxWeight({ ...defaultStroke, weight: 2, widthProfile: parseWidthProfile([[0, 1], [1, 1, 3]]) })).toBe(6);
    const many = readWidthProfile({ points: Array.from({ length: 70 }, (_, i) => ({ t: i, scale: i })) }); expect(many?.points).toHaveLength(70);
  });
  it("rejects malformed wire profiles without applying command coercion", () => {
    for (const value of ["eye", [], { points: null }, { points: [null] }, { points: [[0, 1]] }, { points: [{ t: "0", scale: 1 }] }, { points: [{ t: 0, scale: 1, bias: null }] }, { points: [{ t: 0, scale: Infinity }] }, { points: new Array(2) }]) expect(() => readWidthProfile(value)).toThrow();
  });
});

describe("cmd::width_profile_of and stroke.widthProfile", () => {
  it("uses the widest side for native hit bands and bypasses uniform closed rings", () => {
    const engine = new EditorEngine(), id = String(engine.execute("shape.line", { x: 10, y: 30, width: 100, props: { strokeWeight: 10, widthProfile: [[0, 1, 4], [1, 1, 4]] } }).id);
    expect(hitRectangle(engine.getSnapshot().document, { x: 50, y: 49 })).toBe(id);
    expect(hitRectangle(engine.getSnapshot().document, { x: 50, y: 51 })).toBeUndefined();
    const rect = String(engine.execute("shape.rectangle", { x: 200, y: 200, width: 100, height: 100, props: { fill: null, stroke: "black", strokeWeight: 10, widthProfile: [[0, 3]] } }).id);
    expect(hitRectangle(engine.getSnapshot().document, { x: 190, y: 240 })).toBe(rect);
    expect(closedStrokeRing(engine.getSnapshot().document.nodes[rect] as LayerNode)).toBeUndefined();
    engine.execute("stroke.widthProfile", { preset: "uniform" });
    expect(closedStrokeRing(engine.getSnapshot().document.nodes[rect] as LayerNode)).toBeDefined();
  });
  it("accepts native shapes and preserves unusual optional-number fallback", () => {
    expect(widthProfilePoints(parseWidthProfile([[1, 2], [0, .5]])!)).toEqual([[0, .5], [1, 2]]);
    expect(widthProfilePoints(parseWidthProfile([[0, "1px", "bad"], { t: true, width: 3 }])!)).toEqual([[0, 1], [1, 3]]);
    expect(widthProfilePoints(parseWidthProfile([[0, 0, 2], { t: 1, left: 0, right: 2 }])!)).toEqual([[0, 0, 2], [1, 0, 2]]);
    expect(parseWidthProfile({ points: null, preset: "eye" })).toBeUndefined();
    expect(parseWidthProfile({ points: { points: { preset: "eye" } } })).toEqual(widthPresetProfile("eye"));
    expect(parseWidthProfile([])).toBeUndefined(); expect(parseWidthProfile("uniform")).toBeUndefined();
    for (const value of [7, {}, [[0, "x"]], [{ t: 0, left: 1 }], [{ t: 0, scale: null, width: 3 }], new Array(2)]) expect(() => parseWidthProfile(value)).toThrow();
    const cycle: { points?: unknown } = {}; cycle.points = cycle; expect(() => parseWidthProfile(cycle)).toThrow("nesting");
  });
  it("applies presets and point arrays atomically, preserves paint stacks and clears without a value", async () => {
    const engine = new EditorEngine(), id = String(engine.execute("shape.rectangle").id), before = engine.getSnapshot().document;
    engine.execute("stroke.widthProfile", { preset: "eye", points: [[0, 3]] });
    let node = engine.getSnapshot().document.nodes[id] as LayerNode;
    expect(node.stroke?.widthProfile).toEqual(widthPresetProfile("eye")); expect(node.strokes ?? []).toEqual([]);
    engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(before); engine.execute("edit.redo");
    engine.execute("stroke.widthProfile", { preset: null, points: [[0, 0, 2], [1, 0, 2]] });
    const document = engine.getSnapshot().document; expect((await decodeFigcraft(await encodeFigcraft(document))).document).toEqual(document);
    const profile = (document.nodes[id] as LayerNode).stroke?.widthProfile;
    engine.execute("transform.scale", { factor: 2 }); node = engine.getSnapshot().document.nodes[id] as LayerNode;
    expect(node.stroke?.widthProfile).toBe(profile); expect(node.stroke?.weight).toBe(2);
    const snapshot = engine.getSnapshot(); expect(() => engine.execute("stroke.widthProfile", { ids: [id, "999"], preset: "eye" })).toThrow(); expect(engine.getSnapshot()).toBe(snapshot);
    expect(() => engine.execute("node.set", { props: { x: 999, widthProfile: 7 } })).toThrow(); expect(engine.getSnapshot()).toBe(snapshot);
    engine.execute("stroke.widthProfile"); expect((engine.getSnapshot().document.nodes[id] as LayerNode).stroke).not.toHaveProperty("widthProfile");
    engine.execute("edit.undo"); expect((engine.getSnapshot().document.nodes[id] as LayerNode).stroke?.widthProfile).toEqual(profile);
  });
  it("flips positions in reverse order without swapping left/right scales", () => {
    const profile = parseWidthProfile([[0, 1, 3], [1, 2, 4]])!;
    const flipped: WidthProfile = { points: [...profile.points].reverse().map(p => ({ ...p, t: 1 - p.t })) };
    expect(widthProfilePoints(flipped)).toEqual([[0, 2, 4], [1, 1, 3]]);
  });
});
