import { describe, expect, it } from "vitest";
import { multiply } from "../../src/engine/affine";
import { rectanglePaints, type VectorNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { worldTransform } from "../../src/engine/hierarchy";
import { executeVector } from "../../src/engine/vector-commands";
import { freezeNetwork } from "../../src/engine/vector-network";
import { vectorFillContains } from "../../src/engine/vector-path";

const create = (e: EditorEngine, command: string, params: Record<string, unknown> = {}) => String(e.execute(command, params).id);
const vector = (e: EditorEngine, id: string) => e.getSnapshot().document.nodes[id] as VectorNode;
describe("native Flatten and Reverse path direction", () => {
  it("matches the upstream two-open-paths-and-triangle fixture and restores all layers in one undo", () => {
    const e = new EditorEngine(), a = create(e, "vector.create", { points: [[0, 0], [100, 50], [200, 0]] }), b = create(e, "vector.create", { points: [[0, 100], [100, 150], [200, 100]] }), c = create(e, "vector.create", { points: [[300, 0], [400, 0], [400, 100]], closed: true });
    const before = e.getSnapshot(), id = create(e, "vector.flatten", { ids: [c, a, b] }), node = vector(e, id), after = e.getSnapshot();
    expect(node).toMatchObject({ kind: "vector", x: 0, y: 0, width: 400, height: 150 });
    expect(node.network.vertices).toHaveLength(9); expect(node.network.segments).toHaveLength(7); expect(node.network.regions).toHaveLength(1);
    expect(after.document.nodes["1"]).toMatchObject({ children: [id] }); expect(after.selection).toEqual([id]);
    e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(before.document); expect(e.getSnapshot().selection).toEqual(before.selection);
    e.execute("edit.redo"); expect(e.getSnapshot().document).toBe(after.document);
  });
  it("takes first-source appearance, topmost insertion position and root selection without duplicates", () => {
    const e = new EditorEngine(), a = create(e, "shape.rectangle", { name: "First", props: { fill: "red", stroke: "blue", strokeWeight: 4, opacity: .6 } });
    const group = create(e, "object.group", { ids: [a], name: "Wrapped" });
    const keep = create(e, "shape.rectangle", { name: "Keep", x: 200 });
    const b = create(e, "shape.rectangle", { name: "Top", x: 400 }), above = create(e, "shape.rectangle", { name: "Above", x: 600 });
    e.execute("node.set", { id: group, props: { opacity: .5 } });
    const id = create(e, "vector.flatten", { ids: [b, a, group, group] }), node = vector(e, id);
    expect(e.getSnapshot().document.nodes["1"]).toMatchObject({ children: [keep, id, above] });
    expect(node).toMatchObject({ name: "Wrapped", fill: "#d9d9d9", opacity: .5, blend: "normal", stroke: { align: "center" } });
    expect(node.network.regions).toHaveLength(2); expect(node.network.regions[0].fills?.[0].color).toMatchObject({ r: 1, g: 0, b: 0 });
    expect(e.getSnapshot().document.nodes[a]).toBeUndefined(); expect(e.getSnapshot().document.nodes[group]).toBeUndefined();
  });
  it("includes a nonempty Frame's visible fill and visible descendants, retaining explicit differing paints", () => {
    const e = new EditorEngine(), frame = create(e, "frame.create", { width: 100, height: 100, x: 20, y: 30 });
    create(e, "shape.rectangle", { parent: frame, x: 10, y: 10, width: 30, height: 20, props: { fill: "red" } });
    create(e, "shape.rectangle", { parent: frame, x: 500, props: { visible: false } });
    const id = create(e, "vector.flatten", { id: frame }), node = vector(e, id);
    expect(node).toMatchObject({ x: 20, y: 30, width: 100, height: 100 }); expect(node.network.regions).toHaveLength(2);
    expect(node.network.regions[0].fills).toBeUndefined(); expect(node.network.regions[1].fills?.[0].color.r).toBe(1);
    expect(node.network.regions[1].paintSpace).toMatchObject({ width: 30, height: 20, transform: [1, 0, 0, 1, 10, 10] });
  });
  it("keeps inherited paints editable and source paint frames stable through rotated regrouping", () => {
    const e = new EditorEngine(), a = create(e, "shape.rectangle", { x: 40, y: 60, width: 80, height: 60, props: { rotation: 25 } });
    const originalFrame = worldTransform(e.getSnapshot().document, a), group = create(e, "object.group", { ids: [a] });
    const first = create(e, "vector.flatten", { id: group }), node = vector(e, first);
    expect(node.network.regions[0].fills).toBeUndefined();
    const frame = multiply(worldTransform(e.getSnapshot().document, first), node.network.regions[0].paintSpace!.transform);
    frame.forEach((v, i) => expect(v).toBeCloseTo(originalFrame[i], 8));
    const regrouped = create(e, "object.group", { ids: [first] }), second = create(e, "vector.flatten", { id: regrouped }), final = vector(e, second);
    const after = multiply(worldTransform(e.getSnapshot().document, second), final.network.regions[0].paintSpace!.transform);
    after.forEach((v, i) => expect(v).toBeCloseTo(frame[i], 8));
    e.execute("node.set", { id: second, props: { fill: "black" } }); expect(vector(e, second).network.regions[0].fills).toBeUndefined(); expect(rectanglePaints(vector(e, second))[0].color).toMatchObject({ r: 0, g: 0, b: 0 });
  });
  it("combines unstyled legacy regions with their even-odd hole while retaining explicit empty region paints", () => {
    const e = new EditorEngine(), id = create(e, "vector.create", { path: "M0 0H200V200H0Z M50 50H150V150H50Z" });
    const doc = e.getSnapshot().document, source = vector(e, id), loops = source.network.regions[0].loops;
    const node = { ...source, network: freezeNetwork({ ...source.network, regions: loops.map((loop, i) => ({ loops: [loop], winding: i ? "evenOdd" : "nonZero" })) }) };
    const result = executeVector("vector.flatten", { ...doc, nodes: { ...doc.nodes, [id]: node } }, [id], 10n, {}), out = result.document.nodes[String(result.result.id)] as VectorNode;
    expect(out.network.regions).toHaveLength(1); expect(out.network.regions[0].loops).toHaveLength(2); expect(vectorFillContains(out.network, { x: 100, y: 100 })).toBe(false);
    const styled = { ...source, network: freezeNetwork({ ...source.network, regions: [{ loops, winding: "nonZero", fills: [] }] }) };
    const next = executeVector("vector.flatten", { ...doc, nodes: { ...doc.nodes, [id]: styled } }, [id], 11n, {});
    expect((next.document.nodes["11"] as VectorNode).network.regions[0].fills).toEqual([]);
  });
  it("reverses only segment endpoints and handles, with mixed non-vector targets ignored", () => {
    const e = new EditorEngine(), id = create(e, "vector.create", { path: "M0 0C20 0 80 100 100 100L0 100Z", props: { cornerRadius: 4 } }), box = create(e, "shape.rectangle");
    const before = e.getSnapshot().document, original = vector(e, id);
    e.execute("vector.reverse", { ids: [id, box] }); const reversed = vector(e, id);
    expect(reversed.network.vertices).toEqual(original.network.vertices); expect(reversed.network.regions).toEqual(original.network.regions);
    expect(reversed.network.segments).toEqual(original.network.segments.map(s => ({ a: s.b, b: s.a, ta: s.tb, tb: s.ta })));
    expect(e.getSnapshot().document.nodes[box]).toBe(before.nodes[box]);
    e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(before);
  });
  it("rejects empty, invalid and page targets atomically", () => {
    const e = new EditorEngine(), empty = create(e, "vector.create"), before = e.getSnapshot();
    for (const params of [{ ids: [] }, { id: "missing" }, { id: "1" }, { id: empty }, { id: empty, extra: true }]) {
      expect(() => e.execute("vector.flatten", params)).toThrow(); expect(e.getSnapshot()).toBe(before);
    }
    const rect = create(e, "shape.rectangle"), doc = e.getSnapshot().document;
    expect(() => executeVector("vector.flatten", doc, [rect], 18446744073709551616n, {})).toThrow(/exhausted/); expect(e.getSnapshot().document).toBe(doc);
  });
});
