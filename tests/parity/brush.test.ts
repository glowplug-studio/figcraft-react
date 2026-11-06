import { describe, expect, it } from "vitest";
import { brushPresets, brushReachFactor, defaultBrush, parseBrush, readBrush, sanitiseBrush, wireBrush } from "../../src/engine/brush";
import { EditorEngine } from "../../src/engine/editor";
import type { LayerNode } from "../../src/engine/document";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import { defaultStroke, isDefaultStroke, readStroke, strokeMaxWeight, wireStroke } from "../../src/engine/stroke";

describe("doc::Brush and cmd::brush_of", () => {
  it("retains raw serde defaults, unknown presets and finite out-of-range values", () => {
    expect(readBrush({})).toEqual(defaultBrush); expect(readBrush(null)).toBeUndefined();
    const raw = { preset: "future", spacing: -7, size_jitter: 8, rotation_jitter: -2, scatter: 9, seed: 0xffffffff };
    expect(wireBrush(readBrush(raw)!)).toEqual(raw);
    const stroke = readStroke({ brush: raw }); expect(readStroke(wireStroke(stroke))).toEqual(stroke); expect(isDefaultStroke(stroke)).toBe(false);
    expect(wireStroke(defaultStroke)).not.toHaveProperty("brush");
  });
  it("sanitises native ranges, finite defaults and conservative reach", () => {
    expect(sanitiseBrush({ ...defaultBrush, spacing: NaN, sizeJitter: Infinity, rotationJitter: -4, scatter: 8 })).toEqual({ ...defaultBrush, scatter: 4 });
    const b = parseBrush({ preset: "dots", spacing: 0, sizeJitter: 8, rotationJitter: 4, scatter: 9 })!;
    expect(b).toEqual({ preset: "dots", spacing: .1, sizeJitter: 1, rotationJitter: 1, scatter: 4, seed: 0 });
    expect(brushReachFactor(b)).toBe(10); expect(strokeMaxWeight({ ...defaultStroke, weight: 2, brush: b })).toBe(20);
    expect(parseBrush({ preset: "dots", spacing: 1000 })?.spacing).toBe(100);
    expect(Object.isFrozen(b)).toBe(true);
  });
  it("uses exact preset ids, strict numeric serde and sorted snake-key precedence", () => {
    for (const p of brushPresets) expect(parseBrush(p.id)?.preset).toBe(p.id);
    expect(parseBrush(null)).toBeUndefined();
    expect(parseBrush({ preset: "dots", sizeJitter: .2, size_jitter: .7 })?.sizeJitter).toBe(.7);
    expect(parseBrush({ preset: "dots", sizeJitter: .3, rotationJitter: .4, ignored: true })).toMatchObject({ sizeJitter: .3, rotationJitter: .4 });
    for (const value of [undefined, [], {}, "Dots", "glitter", { preset: null }, { preset: "dots", spacing: "2" }, { preset: "dots", scatter: true }, { preset: "dots", spacing: null }, { preset: "dots", seed: -1 }, { preset: "dots", seed: 2 ** 32 }, { preset: "dots", seed: .5 }]) expect(() => parseBrush(value)).toThrow();
    for (const value of [[], "dots", { spacing: NaN }, { size_jitter: Infinity }, { seed: "7" }]) expect(() => readBrush(value)).toThrow();
  });
});

describe("stroke.brush transactions, aliases and native persistence", () => {
  it("adds black only for the brush command and restores painting with undo/redo", () => {
    const engine = new EditorEngine(), id = String(engine.execute("shape.rectangle").id);
    engine.execute("node.set", { props: { brush: "ink", strokeBrush: "dots" } });
    const before = engine.getSnapshot().document, node = before.nodes[id] as LayerNode;
    expect(node.stroke?.brush?.preset).toBe("dots"); expect(node.strokes ?? []).toEqual([]);
    engine.execute("stroke.brush", { preset: "taper" });
    const next = engine.getSnapshot().document.nodes[id] as LayerNode;
    expect(next.strokes).toHaveLength(1); expect(next.strokes?.[0].color).toMatchObject({ r: 0, g: 0, b: 0, a: 1 });
    engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(before); engine.execute("edit.redo");
    engine.execute("stroke.brush"); expect((engine.getSnapshot().document.nodes[id] as LayerNode).stroke?.brush).toBeUndefined();
    expect((engine.getSnapshot().document.nodes[id] as LayerNode).strokes).toHaveLength(1);
  });
  it("preserves existing paint, dimensions, profile and brush fields across scale/files", async () => {
    const engine = new EditorEngine(), id = String(engine.execute("shape.line", { props: { stroke: "red", widthProfile: "eye" } }).id);
    const paint = (engine.getSnapshot().document.nodes[id] as LayerNode).strokes;
    engine.execute("stroke.brush", { preset: "dots", spacing: 2, sizeJitter: .5, rotationJitter: .75, scatter: 1, seed: 7 });
    const original = engine.getSnapshot().document.nodes[id] as LayerNode;
    expect(original.strokes).toBe(paint);
    engine.execute("transform.scale", { factor: 2 }); const doc = engine.getSnapshot().document, node = doc.nodes[id] as LayerNode;
    expect(node.stroke?.weight).toBe(2); expect(node.stroke?.brush).toBe(original.stroke?.brush); expect(node.stroke?.widthProfile).toBe(original.stroke?.widthProfile);
    expect((await decodeFigcraft(await encodeFigcraft(doc))).document).toEqual(doc);
  });
  it("rejects invalid presets and targets atomically, and null ignores invalid scatter fields", () => {
    const engine = new EditorEngine(), id = String(engine.execute("shape.rectangle").id), snapshot = engine.getSnapshot();
    for (const params of [{ preset: "glitter" }, { ids: [id, "999"], preset: "dots" }, { preset: "dots", spacing: "2" }]) {
      expect(() => engine.execute("stroke.brush", params)).toThrow(); expect(engine.getSnapshot()).toBe(snapshot);
    }
    engine.execute("stroke.brush", { preset: null, spacing: "ignored" });
    expect((engine.getSnapshot().document.nodes[id] as LayerNode).stroke?.brush).toBeUndefined();
  });
});
