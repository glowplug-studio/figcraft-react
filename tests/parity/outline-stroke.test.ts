import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { solidPaint } from "../../src/engine/solid-paint";
import { fromRgba8 } from "../../src/engine/colour";
import { inverse, transformPoint } from "../../src/engine/affine";
import { worldTransform } from "../../src/engine/hierarchy";
import { type GroupNode, type VectorNode } from "../../src/engine/document";
import { vectorFillContains } from "../../src/engine/vector-path";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";

function contains(engine: EditorEngine, id: string, x: number, y: number) {
  const d = engine.getSnapshot().document;
  return vectorFillContains((d.nodes[id] as VectorNode).network, transformPoint(inverse(worldTransform(d, id)), { x, y }));
}
function outline(engine: EditorEngine, ids?: string[]) {
  return engine.execute("vector.outlineStroke", ids ? { ids } : {}).ids as string[];
}
describe("native Outline stroke", () => {
  it("groups visible fills beneath contours, replaces stroked lines and preserves sibling order in a single undo", async () => {
    const e = new EditorEngine();
    const a = String(e.execute("shape.rectangle", { x: 0, y: 0, width: 100, height: 60, props: { fill: "red", stroke: "blue", strokeWeight: 8, strokeAlign: "inside" } }).id);
    const b = String(e.execute("shape.ellipse", { x: 150, y: 0, width: 30, height: 30, props: { stroke: "black", strokeWeight: 4 } }).id);
    const c = String(e.execute("shape.line", { x: 20, y: 100, width: 100, props: { stroke: "green", strokeWeight: 10, opacity: 0.5 } }).id);
    const ignored = String(e.execute("shape.rectangle", { x: 500 }).id);
    e.execute("select.set", { ids: [a, b, c, ignored] });
    const before = e.getSnapshot(), depth = e.getUndoDepth();
    const output = outline(e);
    expect(output).toHaveLength(3);
    const doc = e.getSnapshot().document, group = doc.nodes[output[0]] as GroupNode;
    expect((doc.nodes[doc.currentPage] as GroupNode).children).toEqual([...output, ignored]);
    expect(group.children[0]).toBe(a);
    expect(doc.nodes[a]).toMatchObject({ strokes: [], fill: "#ff0000" });
    const ring = group.children[1];
    expect(doc.nodes[ring]).toMatchObject({ kind: "vector", fill: "#0000ff" });
    expect(contains(e, ring, 4, 30)).toBe(true);
    expect(contains(e, ring, 50, 30)).toBe(false);
    expect(doc.nodes[c]).toBeUndefined();
    expect(doc.nodes[output[2]]).toMatchObject({ kind: "vector", opacity: 0.5 });
    expect(contains(e, output[2], 50, 103)).toBe(true);
    expect(e.getSnapshot().selection).toEqual(output);
    expect(e.getUndoDepth()).toBe(depth + 1);
    const saved = (await decodeFigcraft(await e.nativeSnapshot())).document;
    expect(saved.nodes[ring]).toMatchObject({ kind: "vector", network: (doc.nodes[ring] as VectorNode).network });
    e.execute("edit.undo");
    expect(e.getSnapshot().document).toBe(before.document);
    expect(e.getSnapshot().selection).toEqual(before.selection);
  });
  it("uses an asymmetric width profile in parent space", () => {
    const e = new EditorEngine();
    const a = String(e.execute("shape.line", { x: 0, y: 50, width: 100, props: {
      stroke: "#006600", strokeWeight: 10, widthProfile: [[0,0,2],[1,0,2]],
    } }).id);
    const [id] = outline(e, [a]);
    expect(e.execute("node.get", { id, fields: ["absoluteBounds"] })).toMatchObject({
      absoluteBounds: { x: 0, y: 50, width: 100, height: 10 },
    });
    expect(contains(e, id, 50, 57)).toBe(true);
    expect(contains(e, id, 50, 46)).toBe(false);
  });
  it("keeps gaps between dashes, dots in a brush and the original rotation", () => {
    const e = new EditorEngine();
    const a = String(e.execute("shape.line", { x: 50, y: 40, width: 100, props: { stroke: "red", strokeWeight: 4, dashes: [10,10], rotation: 90 } }).id);
    const transform = worldTransform(e.getSnapshot().document, a);
    const [dashed] = outline(e, [a]);
    for (const [x, hit] of [[2,true],[10,false],[20,true]] as const) {
      const point = transformPoint(transform, { x, y: 0 });
      expect(contains(e, dashed, point.x, point.y)).toBe(hit);
    }
    const b = String(e.execute("shape.line", { width: 200, x: 0, y: 0, props: { stroke: "blue", strokeWeight: 8, brush: { preset: "dots", spacing: 4 } } }).id);
    const [dotted] = outline(e,[b]);
    const net = (e.getSnapshot().document.nodes[dotted] as VectorNode).network;
    expect(net.regions.flatMap(r=>r.loops).length).toBeGreaterThan(3);
  });
  it("retains explicit region paint underneath the outline when the layer has no fill", async () => {
    const e = new EditorEngine();
    const id = String(e.execute("vector.create", { path: "M0 0H40V40H0Z" }).id);
    e.execute("node.set", { id, props: { fill: null, stroke: "blue", strokeWeight: 4 } });
    const doc = e.getSnapshot().document, v = doc.nodes[id] as VectorNode;
    const areas = v.network.regions.map(r => ({ ...r, fills: [solidPaint(fromRgba8(255,0,0))] }));
    const archive = await encodeFigcraft({ ...doc, nodes: { ...doc.nodes, [id]: { ...v, network: { ...v.network, regions: areas } } } });
    await e.executeAsync("file.open", { data: Buffer.from(archive).toString("base64") });
    const [gid] = outline(e,[id]), nodes = e.getSnapshot().document.nodes;
    expect(nodes[gid].kind).toBe("group");
    expect((nodes[gid] as GroupNode).children[0]).toBe(id);
    expect((nodes[id] as VectorNode).network.regions[0].fills).toEqual(areas[0].fills);
  });
  it("outlines the live boolean result and preserves its editable children under a retained fill", () => {
    const e = new EditorEngine();
    const a = String(e.execute("shape.rectangle", { x: 0, y: 0, width: 60, height: 60 }).id);
    const b = String(e.execute("shape.rectangle", { x: 20, y: 20, width: 20, height: 20 }).id);
    const id = String(e.execute("bool.subtract", { ids: [a,b] }).id);
    e.execute("node.set", { id, props: { stroke: "blue", strokeWeight: 4, strokeAlign: "center" } });
    const [gid] = outline(e,[id]);
    const doc = e.getSnapshot().document, ring = (doc.nodes[gid] as GroupNode).children[1];
    expect(doc.nodes[id]).toMatchObject({ kind: "booleanOp", children: [a,b], strokes: [] });
    expect(contains(e,ring,30,20)).toBe(true);
    expect(contains(e,ring,30,30)).toBe(false);
    expect(contains(e,ring,10,10)).toBe(false);
  });
  it("skips unstroked targets and rejects a later missing target without modifying history", () => {
    const e = new EditorEngine();
    const a = String(e.execute("shape.rectangle").id);
    const depth = e.getUndoDepth(), doc = e.getSnapshot().document;
    expect(outline(e,[a])).toEqual([]);
    expect(e.getUndoDepth()).toBe(depth);
    expect(e.getSnapshot().document).toBe(doc);
    expect(()=>outline(e,[a,"9999"])).toThrow("No node");
    expect(e.getSnapshot().document).toBe(doc);
  });
});
