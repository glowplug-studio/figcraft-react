import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import { frameRelative, worldTransform } from "../../src/engine/hierarchy";
import { transformBounds } from "../../src/engine/affine";
import { hitRectangle } from "../../src/engine/selection";
import type { LayerNode, NodeId } from "../../src/engine/document";

// Inspection-derived fixtures: frames_behaviour_tests::resizing_a_frame_applies_constraints_and_a_group_scales,
// cmd/structure::{wrap,convert,ungroup}, layout::{apply_constraints,axis_factors}, doc::geometry::level_target.
function create(engine: EditorEngine, frame = false, params: Record<string, unknown> = {}): NodeId {
  return String(engine.execute(frame ? "frame.create" : "shape.rectangle", params).id);
}
function layer(engine: EditorEngine, id: NodeId): LayerNode {
  const node = engine.getSnapshot().document.nodes[id];
  if (!node || node.kind === "page") throw new Error("Expected layer");
  return node;
}
function box(engine: EditorEngine, id: NodeId) {
  const node = layer(engine, id);
  return transformBounds(worldTransform(engine.getSnapshot().document, id), node.width, node.height);
}
describe("native Frame containers", () => {
  it("reads explicit native frame clipping and rejects malformed constraints without dropping fields", async () => {
    const native = JSON.parse(readFileSync(new URL("../fixtures/native-rectangle.json", import.meta.url), "utf8")) as { nodes: Record<string, Record<string, unknown>>; next_id: number };
    native.nodes["1"].children = [3]; native.nodes["2"].parent = 3;
    native.nodes["3"] = { id: 3, type: "frame", name: "Native frame", parent: 1, children: [2], width: 100, height: 80,
      transform: [0, -1, 1, 0, 40, 130], clip: true, fills: [{ type: "solid", color: [1, 1, 1, 1], opacity: 1, visible: true, blend: "normal", colorAlpha: 1 }] };
    native.next_id = 4;
    const bytes = () => new TextEncoder().encode(JSON.stringify(native));
    expect((await decodeFigcraft(bytes())).document.nodes["3"]).toMatchObject({ kind: "frame", clip: true, transform: [0, -1, 1, 0, 40, 130] });
    for (const constraints of [null, { horizontal: "unknown" }, { vertical: false }, { extra: true }]) {
      native.nodes["2"].constraints = constraints;
      await expect(decodeFigcraft(bytes())).rejects.toThrow();
    }
    delete native.nodes["2"].constraints;
    native.nodes["3"].clip = "false";
    await expect(decodeFigcraft(bytes())).rejects.toThrow("clip must be boolean");
  });
  it("creates a persistent empty frame with white fill, clip and native naming", () => {
    const engine = new EditorEngine(), first = create(engine, true), second = create(engine, true);
    expect(layer(engine, first)).toMatchObject({ kind: "frame", name: "Frame 1", fill: "#ffffff", clip: true, blend: "passThrough", width: 100, height: 100, children: [] });
    expect(layer(engine, second).name).toBe("Frame 2");
    engine.execute("edit.undo"); expect(engine.getSnapshot().document.nodes[second]).toBeUndefined();
    engine.execute("edit.redo"); expect(layer(engine, second).kind).toBe("frame");
  });

  it.each([["left", 10, 20], ["right", 110, 20], ["leftRight", 10, 120], ["center", 60, 20], ["scale", 20, 40]] as const)("applies %s horizontal constraint and one-step undo", (horizontal, x, width) => {
    const engine = new EditorEngine(), frame = create(engine, true);
    const child = create(engine, false, { parent: frame, x: 10, y: 10, width: 20, height: 20, props: { constraints: { horizontal } } });
    const before = engine.getSnapshot().document;
    engine.execute("node.set", { id: frame, width: 200 });
    expect(box(engine, child)).toMatchObject({ x, width, y: 10, height: 20 });
    engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(before);
  });

  it.each([["top", 10, 20], ["bottom", 110, 20], ["topBottom", 10, 120], ["center", 60, 20], ["scale", 20, 40]] as const)("applies %s vertical constraint", (vertical, y, height) => {
    const engine = new EditorEngine(), frame = create(engine, true);
    const child = create(engine, false, { parent: frame, x: 10, y: 10, width: 20, height: 20, props: { constraints: { vertical } } });
    engine.execute("node.set", { id: frame, height: 200 });
    expect(box(engine, child)).toMatchObject({ y, height, x: 10, width: 20 });
  });

  it("propagates nested frame constraints iteratively and preserves rotation axes", () => {
    const engine = new EditorEngine(), frame = create(engine, true);
    let parent = frame;
    for (let depth = 0; depth < 80; depth++) parent = create(engine, true, { parent, props: { constraints: { horizontal: "leftRight", vertical: "topBottom" } } });
    const child = create(engine, false, { parent, x: 10, y: 20, width: 20, height: 10, props: { rotation: 90, constraints: { horizontal: "scale", vertical: "top" } } });
    const old = box(engine, child);
    engine.execute("node.set", { id: frame, width: 200 });
    expect(layer(engine, parent).width).toBe(200);
    expect(layer(engine, child).width).toBeCloseTo(20, 9);
    expect(layer(engine, child).height).toBeCloseTo(20, 9);
    expect(box(engine, child).x).toBeCloseTo(old.x * 2, 9);
    expect(box(engine, child).y).toBeCloseTo(old.y, 9);
  });

  it("scales a frame inside a group then applies its children's constraints", () => {
    const engine = new EditorEngine(), frame = create(engine, true);
    const child = create(engine, false, { parent: frame, x: 10, width: 20, props: { constraints: { horizontal: "right" } } });
    const group = String(engine.execute("object.group", { ids: [frame] }).id);
    engine.execute("node.set", { id: group, width: 200 });
    expect(layer(engine, frame).width).toBe(200);
    expect(box(engine, child)).toMatchObject({ x: 110, width: 20 });
  });

  it("uses frame coordinates for descendants, including children created in groups", () => {
    const engine = new EditorEngine(), frame = create(engine, true, { x: 100, y: 200 });
    const child = create(engine, false, { parent: frame, x: 10, y: 20, width: 20, height: 20 });
    const group = String(engine.execute("object.group", { ids: [child] }).id);
    const second = create(engine, false, { parent: group, x: 50, y: 60 });
    expect(box(engine, second)).toMatchObject({ x: 150, y: 260 });
    expect(frameRelative(engine.getSnapshot().document, second).slice(4)).toEqual([50, 60]);
    engine.execute("node.set", { id: second, x: 70 });
    expect(box(engine, second).x).toBe(170);
  });

  it("wraps, converts and removes rotated frames preserving child world transforms", () => {
    const engine = new EditorEngine(), a = create(engine, false, { x: 30, y: 40, width: 20, height: 10 });
    const before = worldTransform(engine.getSnapshot().document, a);
    const frame = String(engine.execute("object.frameSelection", { ids: [a] }).id);
    expect(layer(engine, frame)).toMatchObject({ kind: "frame", clip: true, fill: "#ffffff" });
    expect(worldTransform(engine.getSnapshot().document, a)).toEqual(before);
    engine.execute("node.set", { id: frame, rotation: 30 });
    const rotated = worldTransform(engine.getSnapshot().document, a);
    engine.execute("object.convertToGroup", { ids: [frame] });
    expect(layer(engine, frame)).toMatchObject({ kind: "group", fills: [] });
    engine.execute("object.convertToFrame", { ids: [frame] });
    expect(layer(engine, frame)).toMatchObject({ kind: "frame", clip: false, fills: [] });
    engine.execute("object.removeFrame", { ids: [frame] });
    expect(engine.getSnapshot().document.nodes[frame]).toBeUndefined();
    worldTransform(engine.getSnapshot().document, a).forEach((v, i) => expect(v).toBeCloseTo(rotated[i], 9));
  });

  it("refuses empty-frame conversion and invalid mixed conversions atomically", () => {
    const engine = new EditorEngine(), frame = create(engine, true), rect = create(engine);
    const before = engine.getSnapshot();
    expect(() => engine.execute("object.convertToGroup", { ids: [frame] })).toThrow("empty");
    expect(() => engine.execute("object.convertToFrame", { ids: [frame, rect] })).toThrow("neither");
    expect(() => engine.execute("node.set", { ids: [frame, rect], clip: false })).toThrow("frame");
    for (const constraints of [{ horizontal: "bogus" }, { vertical: null }, { unknown: true }]) expect(() => engine.execute("node.set", { id: rect, constraints })).toThrow();
    expect(engine.getSnapshot()).toBe(before);
  });

  it("clips hits, picks empty frames and lets a top-level frame pass through to direct children", () => {
    const engine = new EditorEngine(), frame = create(engine, true, { x: 100, y: 100 });
    const child = create(engine, false, { parent: frame, x: 80, y: 10, width: 50, height: 20 });
    let document = engine.getSnapshot().document;
    expect(hitRectangle(document, { x: 110, y: 150 })).toBe(frame);
    expect(hitRectangle(document, { x: 190, y: 120 })).toBe(child);
    expect(hitRectangle(document, { x: 220, y: 120 }, true)).toBeUndefined();
    engine.execute("node.set", { id: frame, clip: false }); document = engine.getSnapshot().document;
    expect(hitRectangle(document, { x: 220, y: 120 })).toBe(child);
    const nested = create(engine, true, { parent: frame, x: 20, y: 40, width: 40, height: 40 });
    const leaf = create(engine, false, { parent: nested, x: 5, y: 5, width: 10, height: 10 }); document = engine.getSnapshot().document;
    expect(hitRectangle(document, { x: 130, y: 150 })).toBe(nested);
    expect(hitRectangle(document, { x: 130, y: 150 }, true)).toBe(leaf);
  });

  it("preserves frame clipping, constraints and nested subtrees in native files and page copies", async () => {
    const engine = new EditorEngine(), frame = create(engine, true, { props: { clip: false } });
    const child = create(engine, false, { parent: frame, x: 120, props: { constraints: { horizontal: "right", vertical: "scale" } } });
    const decoded = await decodeFigcraft(await engine.nativeSnapshot());
    expect(decoded.document.nodes[frame]).toMatchObject({ kind: "frame", clip: false, children: [child], fill: "#ffffff" });
    expect(decoded.document.nodes[child]).toMatchObject({ constraints: { horizontal: "right", vertical: "scale" } });
    expect(await decodeFigcraft(await encodeFigcraft(decoded.document, decoded.nextId))).toEqual(decoded);
    engine.execute("page.duplicate", { id: "1" });
    expect(Object.values(engine.getSnapshot().document.nodes).filter(node => node.kind === "frame")).toHaveLength(2);
    engine.execute("page.delete");
    expect(engine.getSnapshot().document.nodes[child]).toBeDefined();
    expect(Object.values(engine.getSnapshot().document.nodes).filter(node => node.kind === "frame")).toHaveLength(1);
  });
});
