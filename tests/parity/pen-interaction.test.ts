import { describe, expect, it } from "vitest";
import type { VectorNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft } from "../../src/engine/file-format";
import { transformPoint } from "../../src/engine/affine";
import { worldTransform } from "../../src/engine/hierarchy";
import { VectorInteraction } from "../../src/engine/vector-interaction";

const plain = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
function setup() {
  const e = new EditorEngine(); e.execute("tool.pen");
  const click = (x: number, y: number) => { e.pen.down({ x, y }, plain); e.pen.up(); };
  const drag = (x: number, y: number, toX: number, toY: number) => { e.pen.down({ x, y }, plain); e.pen.move({ x: toX, y: toY }); e.pen.up(); };
  const node = () => e.getRenderDocument().nodes[e.getRenderSelection()[0]] as VectorNode;
  return { e, click, drag, node };
}
describe("native new Pen path lifetime", () => {
  it("keeps one transaction across clicks and finishes as one undo with no root preview notifications", () => {
    const { e, click, node } = setup(), before = e.getSnapshot().document; let root = 0, panel = 0;
    e.subscribe(() => root++); e.subscribeVectorEdit(() => panel++);
    click(100, 100); expect(Object.keys(e.getRenderDocument().nodes)).toHaveLength(1); expect(e.interacting).toBe(false);
    click(200, 100); const id = node().id; expect(e.interacting).toBe(true); expect(e.getSnapshot().document).toBe(before);
    click(200, 200); expect(node().id).toBe(id); expect(node().network.segments).toHaveLength(2); expect(root).toBe(0); expect(panel).toBe(0);
    expect(node()).toMatchObject({ fill: "transparent", stroke: { align: "center", weight: 1 } });
    e.pen.finish("move"); expect(e.getUndoDepth()).toBe(1); expect(e.getVectorEdit()).toMatchObject({ id, tool: "move", anchor: undefined });
    e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(before); e.execute("edit.redo"); expect(e.getSnapshot().document.nodes[id]).toBeDefined();
  });
  it("matches undo_while_drawing_takes_back_one_anchor and preserves the preceding rectangle", () => {
    const { e, click, node } = setup(); e.execute("shape.rectangle", { x: 400, y: 400, width: 50, height: 50 }); e.execute("tool.pen");
    const rectangle = e.getSnapshot().document; click(100, 100); click(200, 100); click(200, 200);
    const undo = () => expect(e.execute("edit.undo")).toEqual({ undone: true }), redo = () => expect(e.execute("edit.redo")).toEqual({ redone: true });
    expect(node().network.vertices).toHaveLength(3); undo(); expect(e.pen.overlay.points).toHaveLength(2); expect(node().network.segments).toHaveLength(1);
    undo(); expect(e.pen.overlay.points).toHaveLength(1); expect(e.getRenderDocument()).toBe(rectangle); expect(e.interacting).toBe(false);
    redo(); expect(node().network.segments).toHaveLength(1); redo(); expect(node().network.segments).toHaveLength(2);
    expect(e.pen.overlay.points).toEqual([{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }]);
    undo(); undo(); undo(); expect(e.pen.open).toBe(false); expect(e.getSnapshot().document).toBe(rectangle); expect(e.getUndoDepth()).toBe(1);
    expect(e.execute("edit.redo")).toEqual({ redone: false }); undo(); expect(Object.keys(e.getSnapshot().document.nodes)).toHaveLength(1);
  });
  it("restores dragged handles, ends held gestures and clears the old redo branch only on a new anchor", () => {
    const { e, drag, click, node } = setup(); drag(100, 100, 130, 100); click(200, 100);
    e.pen.down({ x: 250, y: 200 }, plain); e.pen.move({ x: 270, y: 220 }); const before = node().network;
    e.pen.hover({ x: 300, y: 210 }, plain); e.execute("edit.undo"); expect(e.pen.active).toBe(false);
    expect(e.pen.overlay.rubber).toBeUndefined(); expect(e.pen.overlay.rubberHandle).toBeUndefined();
    e.pen.move({ x: 650, y: 650 }); e.pen.up(); click(200, 100); expect(e.pen.getHistory()).toBe(3);
    e.execute("edit.redo"); expect(node().network).toEqual(before); e.execute("edit.undo"); click(320, 280);
    expect(e.pen.getHistory()).toBe(1); expect(e.execute("edit.redo")).toEqual({ redone: false }); expect(e.pen.open).toBe(true);
    e.pen.finish(); expect(e.getUndoDepth()).toBe(1); expect(e.pen.getHistory()).toBe(0);
  });
  it("notifies only history availability transitions without publishing the root snapshot", () => {
    const { e, click } = setup(); let roots = 0; const flags: number[] = []; e.subscribe(() => roots++); e.pen.subscribeHistory(() => flags.push(e.pen.getHistory()));
    click(100, 100); click(200, 100); e.pen.down({ x: 200, y: 200 }, plain);
    for (let i = 0; i < 100; i++) e.pen.move({ x: 201 + i, y: 220 }); e.pen.up(); e.execute("edit.undo"); e.execute("edit.undo");
    e.execute("edit.redo"); e.execute("edit.redo"); e.pen.cancel(); expect(flags).toEqual([1, 3, 1, 0]); expect(roots).toBe(0);
  });
  it("falls back to a real document redo when an open path has no removed anchors", () => {
    const { e, click, node } = setup(); const id = String(e.execute("shape.rectangle", { x: 500, y: 500 }).id); e.execute("edit.undo");
    click(100, 100); click(200, 100); const previewId = node().id; expect(e.execute("edit.redo")).toEqual({ redone: true });
    expect(e.getSnapshot().document.nodes[id]).toBeDefined(); expect(e.pen.overlay.points).toHaveLength(2); expect(e.getSnapshot().document.nodes[previewId]).toBeUndefined();
    click(200, 200); e.pen.finish(); expect(Object.values(e.getSnapshot().document.nodes).filter(n => n.kind === "vector")).toHaveLength(1); expect(e.getSnapshot().document.nodes[id]).toBeDefined();
  });
  it("Escape keeps Pen in edit mode and the next path belongs to the same layer", () => {
    const { e, click, node } = setup(); click(100, 100); click(200, 100); const id = node().id;
    e.pen.finish("pen"); expect(e.getVectorEdit()).toMatchObject({ id, tool: "pen", anchor: undefined });
    const errors: string[] = [], edit = new VectorInteraction(e, error => errors.push(error));
    for (const p of [{ x: 100, y: 300 }, { x: 200, y: 300 }]) { edit.down(p, plain); edit.up(p); }
    expect((e.getSnapshot().document.nodes[id] as VectorNode).network).toMatchObject({ vertices: expect.any(Array) });
    expect((e.getSnapshot().document.nodes[id] as VectorNode).network.vertices).toHaveLength(4);
    expect(e.getSnapshot().document.pages).toHaveLength(1); expect(Object.keys(e.getSnapshot().document.nodes)).toHaveLength(2); expect(errors).toEqual([]);
  });
  it("finishes a lone anchor without a layer and cancels uncommitted paths exactly", () => {
    const { e, click } = setup(), before = e.getSnapshot(); click(100, 100); e.pen.finish("pen");
    expect(e.getSnapshot()).toBe(before); expect(e.getVectorEdit()).toBeUndefined();
    click(100, 100); click(200, 200); e.pen.cancel(); expect(e.getSnapshot()).toBe(before); expect(e.interacting).toBe(false); expect(e.pen.overlay.points).toEqual([]);
  });
  it("closes after three anchors with a fill and keeps Pen selected", () => {
    const { e, click } = setup(); click(100, 100); click(200, 100); click(200, 200); click(100, 100);
    const node = e.getSnapshot().document.nodes[e.getSnapshot().selection[0]] as VectorNode;
    expect(node.network.vertices).toHaveLength(3); expect(node.network.segments).toHaveLength(3); expect(node.network.regions).toHaveLength(1);
    expect(node.fill).toBe("#d9d9d9"); expect(e.getSnapshot().tool).toBe("pen"); expect(e.pen.open).toBe(false); expect(e.getUndoDepth()).toBe(1);
  });
  it("mirrors dragged handles, suppresses click wobble and shows the cubic rubber handle", () => {
    const { e, drag, node } = setup(); drag(100, 100, 140, 100); drag(200, 200, 200, 240);
    expect(node().network.segments[0]).toMatchObject({ ta: [40, 0], tb: [0, -40] });
    e.pen.hover({ x: 300, y: 200 }, plain); expect(e.pen.overlay.rubberHandle).toEqual({ x: 200, y: 240 }); expect(e.pen.overlay.handles).toHaveLength(3);
    e.pen.finish(); expect(e.pen.overlay.rubberHandle).toBeUndefined();
    drag(400, 400, 401, 400); expect(e.pen.overlay.handles).toEqual([]);
  });
  it("ignores the second double-click press and edits the final path with Move", () => {
    const { e, click, node } = setup(); click(100, 100); click(200, 100); click(200, 200); click(200, 200); const id = node().id;
    e.pen.doubleClick({ x: 200, y: 200 }); expect(e.getVectorEdit()).toMatchObject({ id, tool: "move" }); expect(node().network.vertices).toHaveLength(3); expect(e.getUndoDepth()).toBe(1);
  });
  it("double-click on an existing shape leaves no stray vector", () => {
    const { e, click } = setup(); const id = String(e.execute("shape.rectangle", { x: 100, y: 100, width: 100, height: 100 }).id);
    e.execute("tool.pen"); click(150, 100); click(150, 100); e.pen.doubleClick({ x: 150, y: 100 });
    expect(Object.keys(e.getSnapshot().document.nodes)).toHaveLength(2); expect(e.getVectorEdit()).toMatchObject({ id, tool: "move" });
  });
  it("resumes a selected open endpoint without adding or replacing a layer", () => {
    const { e, click, node } = setup(); click(100, 100); click(200, 100); const id = node().id; e.pen.finish();
    click(200, 100); expect(e.getVectorEdit()).toMatchObject({ id, tool: "pen", anchor: 1 }); expect(e.pen.open).toBe(false); expect(e.getUndoDepth()).toBe(1);
  });
  it("chooses the frame on the first anchor and preserves page coordinates beneath rotation", () => {
    const { e, click, node } = setup(); const parent = String(e.execute("frame.create", { x: 300, y: 200, width: 300, height: 300, props: { rotation: 30 } }).id);
    const w = worldTransform(e.getSnapshot().document, parent), a = transformPoint(w, { x: 50, y: 50 }), b = transformPoint(w, { x: 150, y: 100 });
    e.execute("view.snapPixel", { on: false }); e.execute("view.snapObjects", { on: false }); e.execute("tool.pen"); click(a.x, a.y); click(b.x, b.y);
    expect(node().parent).toBe(parent); const actual = transformPoint(worldTransform(e.getRenderDocument(), node().id), node().network.vertices[1]);
    expect(actual.x).toBeCloseTo(b.x, 8); expect(actual.y).toBeCloseTo(b.y, 8);
  });
  it("view settings preserve an open path, tool switches finish it and revocation cancels it", () => {
    const { e, click, node } = setup(); click(100, 100); click(200, 100); const id = node().id;
    e.execute("view.snapObjects", { on: false }); expect(e.pen.open).toBe(true); expect(e.interacting).toBe(true);
    expect(e.execute("tool.scaleAnchor")).toEqual({ anchor: "tl" });
    e.execute("tool.scaleAnchor", { anchor: "c" }); expect(e.pen.open).toBe(true); expect(e.interacting).toBe(true); expect(node().id).toBe(id);
    expect(() => e.execute("tool.scaleAnchor", { anchor: "invalid" })).toThrow(/anchor/); expect(e.pen.open).toBe(true); expect(e.getUndoDepth()).toBe(0);
    e.execute("tool.pen"); expect(e.pen.open).toBe(true); e.execute("tool.rectangle"); expect(e.pen.open).toBe(false); expect(e.getSnapshot().document.nodes[id]).toBeDefined(); expect(e.getUndoDepth()).toBe(1);
    e.execute("tool.pen"); click(300, 300); click(400, 300); e.setEditable(false); expect(e.pen.open).toBe(false); expect(Object.keys(e.getSnapshot().document.nodes)).toHaveLength(2);
  });
  it("saving captures a finished path and round trips its geometry", async () => {
    const { e, click, node } = setup(); click(100, 100); click(200, 100); const id = node().id;
    await e.executeAsync("file.saveAs", { data: true }); expect(e.pen.open).toBe(false); expect(e.getUndoDepth()).toBe(1);
    const decoded = await decodeFigcraft(await e.nativeSnapshot()); expect(decoded.document.nodes[id]).toEqual(e.getSnapshot().document.nodes[id]);
  });
  it("invalid coordinates cancel the preview and invalid tool parameters preserve it", () => {
    const { e, click } = setup(), before = e.getSnapshot();
    expect(() => e.pen.down({ x: Infinity, y: 0 }, plain)).toThrow(/finite/); expect(e.pen.open).toBe(false);
    click(100, 100); e.pen.down({ x: 200, y: 100 }, plain);
    expect(() => e.execute("tool.move", { bad: true })).toThrow(/parameters/); expect(e.pen.open).toBe(true); expect(e.interacting).toBe(true);
    expect(() => e.pen.move({ x: Infinity, y: 0 })).toThrow(/finite/); expect(e.pen.open).toBe(false); expect(e.interacting).toBe(false); expect(e.getSnapshot()).toBe(before);
  });
});
