import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { anchors, executeSizing } from "../../src/engine/sizing";
import { boundsOf } from "../../src/engine/viewport";
import { layerTransform, type LayerNode } from "../../src/engine/document";
import { transformPoint } from "../../src/engine/affine";
import { worldTransform } from "../../src/engine/hierarchy";
import { decodeFigcraft } from "../../src/engine/file-format";

function layer(engine: EditorEngine, id: string): LayerNode {
  const node = engine.getSnapshot().document.nodes[id];
  if (node.kind === "page") throw new Error("Layer required");
  return node;
}
const make = (engine: EditorEngine, frame = false, params: Record<string, unknown> = {}) => String(engine.execute(frame ? "frame.create" : "shape.rectangle", params).id);

describe("native anchored resizing and uniform scaling", () => {
  it.each(anchors)("preserves the %s local anchor", anchor => {
    const engine = new EditorEngine(), id = make(engine, false, { x: 10, y: 20, width: 100, height: 50 });
    const index = anchors.indexOf(anchor), ax = (index % 3) / 2, ay = Math.floor(index / 3) / 2;
    engine.execute("transform.resize", { width: 200, height: 150, anchor });
    expect(layer(engine, id)).toMatchObject({ x: 10 - 100 * ax, y: 20 - 100 * ay, width: 200, height: 150 });
    engine.execute("edit.undo"); expect(layer(engine, id)).toMatchObject({ x: 10, y: 20, width: 100, height: 50 });
  });

  it("keeps a rotated and reflected layer's fixed corner in parent space", () => {
    const engine = new EditorEngine(), id = make(engine, false, { width: 100, height: 50, props: { rotation: 30 } });
    const before = layer(engine, id), matrix = layerTransform(before);
    const reflected = { ...engine.getSnapshot().document, nodes: { ...engine.getSnapshot().document.nodes, [id]: { ...before, transform: [matrix[0], matrix[1], -matrix[2], -matrix[3], matrix[4], matrix[5]] as const } } };
    const old = transformPoint(layerTransform(reflected.nodes[id] as LayerNode), { x: 100, y: 50 });
    const resized = executeSizing("transform.resize", reflected, [id], { width: 200, height: 80, anchor: " BR " });
    const node = resized.nodes[id] as LayerNode, at = transformPoint(layerTransform(node), { x: 200, y: 80 });
    expect(at.x).toBeCloseTo(old.x, 9); expect(at.y).toBeCloseTo(old.y, 9);
    expect(layerTransform(node).slice(0, 4)).toEqual(layerTransform(reflected.nodes[id] as LayerNode).slice(0, 4));
  });

  it("resizes frame constraints while retaining the anchored frame corner", () => {
    const engine = new EditorEngine(), frame = make(engine, true, { x: 40, y: 50, width: 100, height: 100 });
    const child = make(engine, false, { parent: frame, x: 10, y: 20, width: 20, height: 30, props: { constraints: { horizontal: "right", vertical: "bottom" } } });
    engine.execute("transform.resize", { ids: [frame], width: 200, height: 150, anchor: "br" });
    expect(layer(engine, frame)).toMatchObject({ x: -60, y: 0, width: 200, height: 150 });
    expect(layer(engine, child)).toMatchObject({ x: 110, y: 70 });
    expect(boundsOf(engine.getSnapshot().document, [child])).toMatchObject({ x: 50, y: 70 });
  });

  it("resizes explicit ancestor and child targets in caller order", () => {
    for (const parentFirst of [true, false]) {
      const engine = new EditorEngine(), frame = make(engine, true);
      const child = make(engine, false, { parent: frame, width: 20, props: { constraints: { horizontal: "scale" } } });
      engine.execute("transform.resize", { ids: parentFirst ? [frame, child] : [child, frame], width: 200 });
      expect(layer(engine, child).width).toBe(parentFirst ? 200 : 400);
    }
  });

  it("clamps negative sizes, defaults unknown anchors and preserves no-op history", () => {
    const engine = new EditorEngine(), id = make(engine);
    const before = engine.getSnapshot(); engine.execute("transform.resize", { width: "bad" }); expect(engine.getSnapshot()).toBe(before);
    engine.execute("transform.resize", { width: -20, anchor: "unknown" }); expect(layer(engine, id)).toMatchObject({ width: 0, height: 100, x: 0, y: 0 });
    const zero = engine.getSnapshot(); engine.execute("transform.nudgeSize", { dw: -1 }); expect(engine.getSnapshot()).toBe(zero);
  });

  it("size nudges use1/10 units on roots and preserve the local top-left", () => {
    const engine = new EditorEngine(), frame = make(engine, true), child = make(engine, false, { parent: frame, width: 20, height: 30, props: { constraints: { horizontal: "scale" } } });
    engine.execute("transform.nudgeSize", { ids: [frame, child], dw: 1, big: "on" });
    expect(layer(engine, frame).width).toBe(110); expect(layer(engine, child).width).toBeCloseTo(22);
    engine.execute("transform.nudgeSize", { ids: [child], dh: -1 }); expect(layer(engine, child)).toMatchObject({ height: 29, x: 0, y: 0 });
  });

  it("uniform scale ignores constraints and scales each descendant once", () => {
    const engine = new EditorEngine(), frame = make(engine, true, { x: 50, y: 60, width: 100, height: 80 });
    const child = make(engine, false, { parent: frame, x: 20, y: 10, width: 30, height: 20, props: { constraints: { horizontal: "right", vertical: "bottom" } } });
    engine.execute("transform.scale", { ids: [frame, child], factor: 2 });
    expect(layer(engine, frame)).toMatchObject({ x: 50, y: 60, width: 200, height: 160 });
    expect(layer(engine, child)).toMatchObject({ x: 40, y: 20, width: 60, height: 40 });
    engine.execute("edit.undo"); expect(layer(engine, child)).toMatchObject({ x: 20, y: 10, width: 30, height: 20 });
  });

  it("scales rotated group subtrees around an explicit page pivot without changing linear transforms", () => {
    const engine = new EditorEngine(), a = make(engine, false, { x: 20, y: 30, width: 30, height: 20 }), b = make(engine, false, { x: 100, y: 80, width: 40, height: 30 });
    const group = String(engine.execute("object.group", { ids: [a, b] }).id);
    engine.execute("node.set", { id: group, props: { rotation: 30 } });
    const before = boundsOf(engine.getSnapshot().document, [group])!, linear = worldTransform(engine.getSnapshot().document, a).slice(0, 4);
    engine.execute("transform.scale", { factor: 1.5, cx: 10, cy: -10 });
    const after = boundsOf(engine.getSnapshot().document, [group])!;
    expect(after.x).toBeCloseTo(10 + (before.x - 10) * 1.5, 8); expect(after.y).toBeCloseTo(-10 + (before.y + 10) * 1.5, 8);
    expect(after.width).toBeCloseTo(before.width * 1.5, 8); expect(after.height).toBeCloseTo(before.height * 1.5, 8);
    expect(worldTransform(engine.getSnapshot().document, a).slice(0, 4)).toEqual(linear);
    expect(layer(engine, a)).toMatchObject({ width: 45, height: 30 });
  });

  it("rejects invalid factors and overflowing geometry atomically", () => {
    const engine = new EditorEngine(), a = make(engine), b = make(engine, false, { width: 1e308 });
    const before = engine.getSnapshot();
    for (const factor of [0, -1, "bad", Infinity]) {
      expect(() => engine.execute("transform.scale", { ids: [a, b], factor })).toThrow(); expect(engine.getSnapshot()).toBe(before);
    }
    expect(() => engine.execute("transform.scale", { ids: [a, b], factor: 2 })).toThrow(); expect(engine.getSnapshot()).toBe(before);
    expect(() => engine.execute("transform.resize", { ids: [a, b], height: 1e308, anchor: "br" })).not.toThrow();
    engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(before.document);
    engine.execute("transform.scale", { ids: [a], factor: 1 }); expect(engine.getSnapshot().document).toBe(before.document);
    const far = make(engine, false, { x: 1e308, width: 1 });
    const positioned = engine.getSnapshot();
    expect(() => engine.execute("transform.resize", { ids: [a, far], width: 1e308 })).toThrow();
    expect(engine.getSnapshot()).toBe(positioned);
  });

  it("round-trips scaled frame contents and anchored dimensions through native save", async () => {
    const engine = new EditorEngine(), frame = make(engine, true), child = make(engine, false, { parent: frame, x: 10, y: 20, width: 20, height: 10 });
    engine.execute("transform.scale", { ids: [frame], factor: 2 });
    engine.execute("transform.resize", { ids: [child], width: 50, anchor: "c" });
    const decoded = await decodeFigcraft(await engine.nativeSnapshot());
    expect(decoded.document.nodes[child]).toMatchObject({ x: 15, y: 40, width: 50, height: 20 });
    expect(decoded.document.nodes[frame]).toMatchObject({ width: 200, height: 200 });
  });
});
