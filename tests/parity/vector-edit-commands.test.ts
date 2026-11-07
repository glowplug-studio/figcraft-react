import { describe, expect, it } from "vitest";
import { transformPoint } from "../../src/engine/affine";
import { type VectorNode } from "../../src/engine/document";
import { commandSpecs, EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft } from "../../src/engine/file-format";
import { worldTransform } from "../../src/engine/hierarchy";
import { vectorParts } from "../../src/engine/vector-edit";

const create = (e: EditorEngine, command = "shape.rectangle", params = {}) => String(e.execute(command, params).id);
const node = (e: EditorEngine, id: string) => e.getSnapshot().document.nodes[id] as VectorNode;
function pagePoint(e: EditorEngine, id: string, index: number) { return transformPoint(worldTransform(e.getSnapshot().document, id), node(e, id).network.vertices[index]); }
function near(actual: { x: number; y: number }, expected: { x: number; y: number }) { expect(actual.x).toBeCloseTo(expected.x, 8); expect(actual.y).toBeCloseTo(expected.y, 8); }
function editedRect() { const e = new EditorEngine(), id = create(e); e.execute("vector.edit.begin"); return { e, id }; }

describe("native vector editing commands and history", () => {
  it("records shape conversion once and leaves edit mode when undo restores a shape", () => {
    const e = new EditorEngine(), a = create(e), b = create(e, "shape.ellipse"), before = e.getSnapshot().document;
    expect(e.execute("vector.edit.begin", { ids: [a, b] })).toEqual({ id: a, layers: [a, b] });
    const converted = e.getSnapshot().document; expect(node(e, a).kind).toBe("vector");
    e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(before); expect(e.getVectorEdit()).toBeUndefined();
    e.execute("edit.redo"); expect(e.getSnapshot().document).toBe(converted); expect(e.getVectorEdit()).toBeUndefined();
    expect(commandSpecs["vector.edit.begin"].undo).toBe(false); expect(commandSpecs["vector.edit.moveVertices"].undo).toBe(true);
  });
  it("entering existing vectors and point selection do not insert history or dirty the document", () => {
    const e = new EditorEngine(), id = create(e, "vector.create", { path: "M0 0L100 0" }), before = e.getSnapshot();
    e.execute("vector.edit.begin"); e.execute("vector.edit.select", { vertices: [0] }); e.execute("vector.edit.selectAll");
    expect(e.getSnapshot()).toBe(before); expect(e.getVectorEdit()?.vertices).toEqual([0, 1]);
    e.execute("edit.undo"); expect(e.getSnapshot().document.nodes[id]).toBeUndefined(); expect(e.getVectorEdit()).toBeUndefined();
  });
  it("moves selected points on every edited layer by page units in one undo", () => {
    const e = new EditorEngine(), a = create(e, "shape.rectangle", { x: 30, y: 40, props: { rotation: 40 } }), b = create(e, "shape.rectangle", { x: 220, y: 90, props: { rotation: -25 } });
    e.execute("vector.edit.begin", { ids: [a, b] }); e.execute("vector.edit.select", { vertices: [0] }); e.execute("vector.edit.select", { id: b, vertices: [1], add: true });
    const pa = pagePoint(e, a, 0), pb = pagePoint(e, b, 1), before = e.getSnapshot().document;
    e.execute("vector.edit.nudge", { dx: 10, dy: -20 }); near(pagePoint(e, a, 0), { x: pa.x + 10, y: pa.y - 20 }); near(pagePoint(e, b, 1), { x: pb.x + 10, y: pb.y - 20 });
    e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(before); expect(e.getVectorEdit()?.id).toBe(b);
    const aBefore = node(e, a); e.execute("vector.edit.moveVertices", { vertices: [1, 1], dx: "5px", dy: 0 }); expect(node(e, a)).toBe(aBefore);
  });
  it("positions the active selection in parent coordinates while preserving other layer selections", () => {
    const e = new EditorEngine(), frame = create(e, "frame.create", { x: 300, y: 400 }), a = create(e, "shape.rectangle", { parent: frame, x: 10, y: 20 }), b = create(e, "shape.rectangle", { x: 500 });
    e.execute("vector.edit.begin", { ids: [a, b] }); e.execute("vector.edit.select", { id: b, vertices: [0] }); e.execute("vector.edit.select", { id: a, vertices: [0], add: true });
    const other = node(e, b); e.execute("vector.edit.position", { x: 50, y: 60 }); near(pagePoint(e, a, 0), { x: 350, y: 460 }); expect(node(e, b)).toBe(other);
    expect(vectorParts(e.getVectorEdit()!).map(p => p.vertices)).toEqual([[0], [0]]);
  });
  it("sets absolute local handles, then moves selected handles in page space", () => {
    const e = new EditorEngine(), id = create(e, "vector.create", { path: "M0 0L50 0L100 0", props: { rotation: 90 } }); e.execute("vector.edit.begin");
    e.execute("vector.edit.select", { vertices: [1] }); e.execute("vector.edit.mirroring", { mode: "ANGLEANDLENGTH" });
    e.execute("vector.edit.setHandle", { segment: 1, start: true, x: 60, y: 20 });
    expect(node(e, id).network.segments[1].ta).toEqual([10, 20]); expect(node(e, id).network.segments[0].tb).toEqual([-10, -20]);
    e.execute("vector.edit.select", { handles: [[1, true]], vertices: [1] });
    const handlePage = () => { const n = node(e, id), v = n.network.vertices[n.network.segments[1].a], h = n.network.segments[1].ta; return transformPoint(worldTransform(e.getSnapshot().document, id), { x: v.x + h[0], y: v.y + h[1] }); };
    const before = handlePage(); e.execute("vector.edit.moveHandles", { dx: 5, dy: 10, independent: true }); near(handlePage(), { x: before.x + 5, y: before.y + 10 });
    expect(node(e, id).network.vertices[1].mirror).toBe("none");
  });
  it("smooths only selected vertices, but mirroring and point styles include segment endpoints", async () => {
    const { e, id } = editedRect(); e.execute("vector.edit.select", { segments: [0] }); const before = e.getSnapshot().document;
    e.execute("vector.edit.smooth"); expect(e.getSnapshot().document).toBe(before);
    e.execute("vector.edit.mirroring", { mode: "angle" }); expect(node(e, id).network.vertices.slice(0, 2).map(v => v.mirror)).toEqual(["angle", "angle"]);
    e.execute("vector.edit.cornerRadius", { radius: 10 }); e.execute("vector.edit.strokeCap", { cap: "triangle-arrow" }); e.execute("vector.edit.strokeJoin", { join: "round" });
    expect(node(e, id).network.vertices[0]).toMatchObject({ radius: 10, cap: "triangleArrow", join: "round" });
    e.execute("vector.edit.strokeCap", { cap: null }); expect(node(e, id).network.vertices[0]).not.toHaveProperty("cap");
    expect((await decodeFigcraft(await e.nativeSnapshot())).document).toEqual(e.getSnapshot().document);
    e.execute("vector.edit.select", { vertices: [1] }); e.execute("vector.edit.smooth"); expect(node(e, id).network.segments[0].tb.some(x => x !== 0)).toBe(true);
    e.execute("vector.edit.smooth", { smooth: false }); expect(node(e, id).network.vertices[1].mirror).toBeUndefined();
  });
  it("bends in page coordinates and selects a newly inserted point without losing the native loop", () => {
    const { e, id } = editedRect(); e.execute("vector.edit.bend", { segment: 0, t: .5, x: 50, y: -30 });
    const before = e.getSnapshot().document, result = e.execute("vector.edit.addVertex", { segment: "0.9", t: .5 });
    expect(result.vertex).toBe(4); expect(e.getVectorEdit()?.vertices).toEqual([4]); expect(e.getVectorEdit()?.segments).toEqual([]);
    near(pagePoint(e, id, 4), { x: 50, y: -30 }); expect(node(e, id).network.regions[0].loops[0]).toHaveLength(5);
    e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(before); expect(e.getVectorEdit()?.vertices).toEqual([]);
  });
  it("deletes points and segments without stale indices and removes an empty layer on Done", () => {
    const { e, id } = editedRect(); e.execute("vector.edit.select", { vertices: [1], segments: [2] }); e.execute("vector.edit.delete");
    // Native point deletion keeps neighbours left isolated by that deletion.
    expect(node(e, id).network.vertices).toHaveLength(3); expect(node(e, id).network.segments).toHaveLength(1); expect(e.getVectorEdit()?.vertices).toEqual([]);
    e.execute("edit.undo"); const beforeLastDelete = e.getSnapshot().document;
    e.execute("vector.edit.selectAll"); e.execute("vector.edit.delete"); expect(node(e, id).network.segments).toHaveLength(0);
    e.execute("vector.edit.end"); expect(e.getSnapshot().document.nodes[id]).toBeUndefined(); expect(e.getSnapshot().selection).toEqual([]); expect(e.getVectorEdit()).toBeUndefined();
    e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(beforeLastDelete);
  });
  it("heals selected points in multiple layers atomically and ignores selected segments for heal", () => {
    const e = new EditorEngine(), a = create(e), b = create(e); e.execute("vector.edit.begin", { ids: [a, b] });
    e.execute("vector.edit.select", { vertices: [1] }); e.execute("vector.edit.select", { id: b, vertices: [2], segments: [0], add: true });
    const before = e.getSnapshot().document; e.execute("vector.deleteHeal");
    expect(node(e, a).network.segments).toHaveLength(3); expect(node(e, b).network.segments).toHaveLength(3);
    e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(before);
  });
  it("rejects invalid required parameters atomically and preserves lenient native index parsing", () => {
    const { e } = editedRect(); e.execute("vector.edit.select", { vertices: ["1.9", -1, "bad", true, 1e9], handles: [["0.8", true], [1, "yes"]] });
    expect(e.getVectorEdit()?.vertices).toEqual([1]); expect(e.getVectorEdit()?.handles).toEqual([[0, true]]);
    const before = e.getSnapshot(), state = e.getVectorEdit();
    for (const [command, params] of [["vector.edit.setHandle", { segment: -1, x: 1, y: 2 }], ["vector.edit.addVertex", { segment: 99 }], ["vector.edit.bend", { segment: 0, x: "bad", y: 0 }], ["vector.edit.strokeCap", {}], ["vector.edit.strokeJoin", { join: "invalid" }], ["vector.edit.mirroring", { mode: " angle " }]] as const) {
      expect(() => e.execute(command, params)).toThrow(); expect(e.getSnapshot()).toBe(before); expect(e.getVectorEdit()).toBe(state);
    }
  });
  it("clears mode on page/file/identity changes and protects geometry after sign-out", async () => {
    const { e, id } = editedRect(); e.execute("page.add"); expect(e.getVectorEdit()).toBeUndefined();
    e.execute("page.select", { id: "1" }); e.execute("vector.edit.begin", { id });
    const saved = await e.executeAsync("file.saveAs", { data: true }); await e.executeAsync("file.open", { data: saved.data }); expect(e.getVectorEdit()).toBeUndefined();
    e.execute("vector.edit.begin", { id }); e.setEditable(false); expect(e.getVectorEdit()).toBeUndefined(); expect(() => e.execute("vector.edit.begin", { id })).toThrow(/Sign in/);
    e.setEditable(true); expect(e.getVectorEdit()).toBeUndefined();
  });
  it("keeps Move/Scale mode but leaves point editing for drawing tools and Select none", () => {
    const { e, id } = editedRect(); e.execute("tool.scale"); expect(e.getVectorEdit()?.id).toBe(id);
    e.execute("tool.move"); expect(e.getVectorEdit()?.id).toBe(id);
    e.execute("select.none"); expect(e.getVectorEdit()).toBeUndefined();
    e.execute("vector.edit.begin", { id }); e.execute("vector.edit.selectAll"); e.execute("vector.edit.delete");
    e.execute("tool.rectangle"); expect(e.getVectorEdit()).toBeUndefined(); expect(e.getSnapshot().document.nodes[id]).toBeUndefined();
    expect(e.getSnapshot().tool).toBe("rectangle");
  });
  it("reports actual network and selected overlays and uses a targeted selection subscription", () => {
    const { e, id } = editedRect(); let root = 0, vector = 0; e.subscribe(() => root++); e.subscribeVectorEdit(() => vector++);
    e.execute("vector.edit.select", { vertices: [0], regions: [0] }); e.execute("vector.edit.tool", { tool: "BEND" });
    expect(root).toBe(0); expect(vector).toBe(2);
    const state = e.execute("vector.edit.state"); expect(state).toMatchObject({ id, tool: "bend", layers: [id], regions: [0], regionVertices: [1, 2, 3], network: { vertices: expect.any(Array) } });
    expect(state.overlay).toMatchObject({ selectedVertices: [0], anchor: null }); expect(vector).toBe(2);
    e.execute("vector.edit.end"); expect(() => e.execute("vector.edit.state")).toThrow(/Not in vector/);
  });
});
