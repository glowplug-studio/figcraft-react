import { describe, expect, it } from "vitest";
import { transformPoint } from "../../src/engine/affine";
import type { VectorNode } from "../../src/engine/document";
import { commandSpecs, EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft } from "../../src/engine/file-format";
import { HierarchyDraft, worldTransform } from "../../src/engine/hierarchy";
import { pointBoxCentre, pointBoxCorners, pointBoxOnto, pointRotationMatrix, shownVectorPointBox, transformVectorBox, vectorPointBox } from "../../src/engine/vector-point-transform";

const create = (e: EditorEngine, params = {}) => String(e.execute("shape.rectangle", { x: 0, y: 0, width: 100, height: 100, ...params }).id);
const node = (e: EditorEngine, id: string) => e.getSnapshot().document.nodes[id] as VectorNode;
const page = (e: EditorEngine, id: string, i: number) => transformPoint(worldTransform(e.getSnapshot().document, id), node(e, id).network.vertices[i]);
const near = (a: { x: number; y: number }, b: { x: number; y: number }) => { expect(a.x).toBeCloseTo(b.x, 8); expect(a.y).toBeCloseTo(b.y, 8); };
function square() { const e = new EditorEngine(), id = create(e); e.execute("vector.edit.begin"); return { e, id }; }
function vertex(e: EditorEngine, id: string, x: number, y: number) { return node(e, id).network.vertices.findIndex(v => v.x === x && v.y === y); }

describe("upstream vector transform box and numeric fixtures", () => {
  it("shows boxes for at least two distinct selected points, including segment endpoints", () => {
    const { e, id } = square(), doc = e.getSnapshot().document;
    expect(vectorPointBox(doc, e.getVectorEdit()!)).toBeUndefined();
    expect(() => e.execute("vector.edit.bounds")).toThrow(/Select points/);
    e.execute("vector.edit.select", { vertices: [0] });
    expect(vectorPointBox(doc, e.getVectorEdit()!)).toMatchObject({ width: 0, height: 0, points: [0] });
    expect(shownVectorPointBox(doc, e.getVectorEdit()!)).toBeUndefined();
    e.execute("vector.edit.select", { segments: [0] });
    expect(shownVectorPointBox(doc, e.getVectorEdit()!)?.points).toEqual([node(e, id).network.segments[0].a, node(e, id).network.segments[0].b].sort());
    e.execute("vector.edit.selectAll"); expect(shownVectorPointBox(doc, e.getVectorEdit()!)).toMatchObject({ width: 100, height: 100 });
    e.execute("vector.edit.tool", { tool: "bend" }); expect(shownVectorPointBox(doc, e.getVectorEdit()!)).toBeUndefined();
  });
  it("matches native top-left and centred resize and one-step undo", async () => {
    const { e, id } = square(); e.execute("vector.edit.selectAll"); const before = e.getSnapshot().document;
    expect(e.execute("vector.edit.bounds")).toMatchObject({ x: 0, y: 0, width: 100, height: 100, corners: [[0, 0], [100, 0], [100, 100], [0, 100]], points: [0, 1, 2, 3] });
    expect(commandSpecs["vector.edit.bounds"].undo).toBe(false);
    e.execute("vector.edit.resize", { width: 50 }); expect(node(e, id)).toMatchObject({ x: 0, y: 0, width: 50, height: 100 });
    const resized = e.getSnapshot().document;
    e.execute("vector.edit.resize", { height: 200, center: true }); expect(node(e, id)).toMatchObject({ y: -50, height: 200 });
    expect((await decodeFigcraft(await e.nativeSnapshot())).document).toEqual(e.getSnapshot().document);
    e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(resized);
    e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(before);
  });
  it("rotates counter-clockwise and transforms explicit vertices without selection", () => {
    const { e, id } = square(), v = vertex(e, id, 100, 0); e.execute("vector.edit.selectAll");
    e.execute("vector.edit.rotate", { angle: 90 }); near(page(e, id, v), { x: 0, y: 0 });
    e.execute("edit.undo"); e.execute("vector.edit.select");
    e.execute("vector.edit.transform", { matrix: [2, 0, 0, 1, 10, 0], vertices: [v] }); near(page(e, id, v), { x: 210, y: 0 });
    e.execute("edit.undo"); e.execute("vector.edit.select", { vertices: [v] });
    e.execute("vector.edit.rotate", { angle: 90, cx: 0, cy: 0 }); near(page(e, id, v), { x: 0, y: -100 });
  });
  it("keeps matrix overflow atomic, filters numeric coefficients, and rejects malformed matrices", () => {
    const { e, id } = square(); e.execute("vector.edit.selectAll"); const before = e.getSnapshot();
    e.execute("vector.edit.transform", { matrix: [1e308, 0, 0, 1e308, 1e308, 0] }); expect(e.getSnapshot()).toBe(before);
    for (const matrix of [null, [1, 0], [1, 0, 0, 1, 0, "bad"]]) {
      expect(() => e.execute("vector.edit.transform", { matrix })).toThrow(/matrix/); expect(e.getSnapshot()).toBe(before);
    }
    const v = vertex(e, id, 100, 0);
    e.execute("vector.edit.transform", { matrix: ["bad", "2", 0, 0, 1, 10, 0], vertices: [v] }); near(page(e, id, v), { x: 210, y: 0 });
    const stable = e.getSnapshot(); e.execute("vector.edit.rotate", { angle: 180, cx: 1e308, cy: 1e308 }); expect(e.getSnapshot()).toBe(stable);
  });
  it("retains optional dimensions on invalid input and clamps valid dimensions", () => {
    const { e, id } = square(); e.execute("vector.edit.selectAll");
    e.execute("vector.edit.resize", { width: "bad", height: "50px", center: "maybe" }); expect(node(e, id)).toMatchObject({ x: 0, y: 0, width: 100, height: 50 });
    e.execute("vector.edit.resize", { width: 1e308, height: -1e308 }); expect(node(e, id)).toMatchObject({ width: 1e7, height: 0 });
    const wide = new EditorEngine(), wid = String(wide.execute("vector.create", { points: [[0, 0], [2e7, 10]] }).id);
    wide.execute("vector.edit.begin"); wide.execute("vector.edit.selectAll"); wide.execute("vector.edit.resize", { height: 20 });
    expect(node(wide, wid)).toMatchObject({ width: 2e7, height: 20 });
    wide.execute("vector.edit.resize", { width: "invalid", height: 30 }); expect(node(wide, wid)).toMatchObject({ width: 2e7, height: 30 });
  });
  it("keeps degenerate axes fixed, including a one-point box", () => {
    const { e, id } = square(), v = vertex(e, id, 100, 0);
    e.execute("vector.edit.select", { vertices: [v] }); const p = page(e, id, v);
    e.execute("vector.edit.resize", { width: 250, height: 300, center: true }); near(page(e, id, v), p);
    e.execute("vector.edit.select", { segments: [0] }); e.execute("vector.edit.resize", { width: 200, height: 300, center: true });
    expect(e.execute("vector.edit.bounds")).toMatchObject({ x: -50, y: 0, width: 200, height: 0 });
  });
  it("numeric dimensions and local flips preserve rotated parent coordinates and other layers", () => {
    const e = new EditorEngine(), parent = String(e.execute("frame.create", { x: 300, y: 200, props: { rotation: 30 } }).id);
    const a = create(e, { x: 10, y: 20, parent, props: { rotation: 25 } }), b = create(e, { x: 500 });
    e.execute("vector.edit.begin", { ids: [a, b] }); e.execute("vector.edit.select", { id: b, vertices: [0, 2] }); e.execute("vector.edit.select", { id: a, vertices: [0, 1, 2, 3], add: true });
    const other = node(e, b), box = vectorPointBox(e.getSnapshot().document, e.getVectorEdit()!)!, initial = page(e, a, 0);
    e.execute("vector.edit.resize", { width: 50 }); near(page(e, a, 0), initial); near(page(e, a, 1), transformPoint(box.frame, { x: 50, y: 0 })); expect(node(e, b)).toBe(other);
    e.execute("edit.undo"); e.execute("object.flipH"); near(page(e, a, 0), transformPoint(box.frame, { x: 100, y: 0 })); expect(node(e, b)).toBe(other);
  });
  it("routes fixed rotations and flips to selected points unless id/ids is present", () => {
    const { e, id } = square(), a = vertex(e, id, 0, 0), b = vertex(e, id, 100, 100), neighbour = vertex(e, id, 100, 0), untouched = page(e, id, neighbour);
    e.execute("vector.edit.select", { vertices: [a, b] }); e.execute("object.flipH"); near(page(e, id, a), { x: 100, y: 0 }); near(page(e, id, b), { x: 0, y: 100 }); near(page(e, id, neighbour), untouched);
    e.execute("object.rotate180"); near(page(e, id, a), { x: 0, y: 100 }); expect(e.getVectorEdit()?.id).toBe(id);
    e.execute("edit.undo"); e.execute("edit.undo");
    for (const params of [{ id }, { ids: [id] }, { id: null }, { ids: null }]) {
      e.execute("object.flipH", params); near(page(e, id, neighbour), { x: 0, y: 0 }); e.execute("edit.undo");
    }
    e.execute("vector.edit.select"); e.execute("object.flipV"); near(page(e, id, neighbour), { x: 100, y: 100 });
  });
  it("uses page axes and transforms every selected layer of a shared box", () => {
    const e = new EditorEngine(), a = create(e, { props: { rotation: -20 } }), b = create(e, { x: 200, props: { rotation: 30 } });
    e.execute("vector.edit.begin", { ids: [a, b] }); e.execute("vector.edit.select", { vertices: [0, 2] }); e.execute("vector.edit.select", { id: b, vertices: [0, 1, 2, 3], add: true });
    const document = e.getSnapshot().document, state = e.getVectorEdit()!, box = shownVectorPointBox(document, state)!;
    expect(box.frame.slice(0, 4)).toEqual([1, 0, 0, 1]); expect(box.others).toEqual([{ id: a, vertices: [0, 2] }]);
    const original = [{ id: a, vertices: [0, 2] }, { id: b, vertices: [0, 1, 2, 3] }].flatMap(p => p.vertices.map(i => ({ id: p.id, i, point: page(e, p.id, i) })));
    const corners = pointBoxCorners(box), centre = pointBoxCentre(box);
    expect(corners[0].x).toBeCloseTo(Math.min(...original.map(p => p.point.x)), 8);
    expect(corners[2].y).toBeCloseTo(Math.max(...original.map(p => p.point.y)), 8);
    for (const matrix of [pointBoxOnto(box, 0, 0, box.width * 2, box.height), pointRotationMatrix(centre, -90)]) {
      const draft = new HierarchyDraft(document); transformVectorBox(draft, b, box, matrix); const next = draft.finish();
      for (const p of original) near(transformPoint(worldTransform(next, p.id), (next.nodes[p.id] as VectorNode).network.vertices[p.i]), transformPoint(matrix, p.point));
    }
    e.execute("vector.edit.select", { id: a, vertices: [0, 2] }); e.execute("vector.edit.select", { id: b, add: true });
    const otherOnly = shownVectorPointBox(e.getSnapshot().document, e.getVectorEdit()!)!;
    expect(otherOnly.points).toEqual([]); expect(otherOnly.others).toEqual([{ id: a, vertices: [0, 2] }]);
  });
  it("transforms relative handles at selected points while leaving neighbour handles unchanged", () => {
    const { e, id } = square(); e.execute("vector.edit.setHandle", { segment: 0, start: true, x: 20, y: 10, independent: true });
    e.execute("vector.edit.setHandle", { segment: 0, start: false, x: 80, y: 10, independent: true });
    e.execute("vector.edit.select", { vertices: [0] }); e.execute("vector.edit.transform", { matrix: [2, 0, 0, 3, 0, 0] });
    expect(node(e, id).network.segments[0].ta).toEqual([40, 30]); expect(node(e, id).network.segments[0].tb).toEqual([-20, 10]);
  });
});
