import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { rectangleTransform } from "../../src/engine/document";
import { rotationDegrees, transformPoint } from "../../src/engine/affine";

describe("rectangle transform transactions", () => {
  it("rotates about centre with one undo step, retains native data and permits selection after open", async () => {
    const engine = new EditorEngine();
    const id = String(engine.execute("shape.rectangle", { x: 100, y: 100, width: 100, height: 50 }).id);
    const before = engine.getSnapshot().document;
    engine.execute("node.set", { props: { rotation: 90 } });
    const rotated = engine.getSnapshot().document;
    const node = rotated.nodes[id];
    if (node.kind !== "rectangle") throw new Error("Expected rectangle");
    expect(transformPoint(rectangleTransform(node), { x: 50, y: 25 })).toEqual({ x: 150, y: 125 });
    expect(rotationDegrees(rectangleTransform(node))).toBeCloseTo(90);
    engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(before);
    engine.execute("edit.redo"); expect(engine.getSnapshot().document).toBe(rotated);
    const saved = await engine.executeAsync("file.saveAs", { data: true });
    await engine.executeAsync("file.open", { data: saved.data });
    expect(engine.getSnapshot().document).toEqual(rotated);
    engine.execute("select.set", { ids: [id] });
    expect(engine.getSnapshot().selection).toEqual([id]);
    expect(engine.getSnapshot().canUndo).toBe(false);
  });
  it("selection is non-undoable and does not dirty saved content", () => {
    const engine = new EditorEngine(); engine.execute("shape.rectangle"); engine.execute("file.markSaved");
    engine.execute("select.none"); engine.execute("select.all");
    expect(engine.getSnapshot().dirty).toBe(false);
    engine.execute("edit.undo");
    expect(Object.keys(engine.getSnapshot().document.nodes)).toEqual(["1"]);
  });
  it("invalid multi-target edits and overflow preserve the published snapshot and history", () => {
    const engine = new EditorEngine(); engine.execute("shape.rectangle");
    const before = engine.getSnapshot();
    expect(() => engine.execute("node.set", { ids: ["2", "999"], props: { x: 9 } })).toThrow();
    expect(() => engine.execute("node.set", { props: { width: 1e308, x: 1e308 } })).toThrow();
    expect(() => engine.execute("shape.rectangle", { width: 1e308, x: 1e308 })).toThrow();
    expect(engine.getSnapshot()).toBe(before);
    expect(engine.execute("edit.undo")).toEqual({ undone: true });
  });
});
