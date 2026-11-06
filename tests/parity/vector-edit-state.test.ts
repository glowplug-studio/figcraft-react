import { describe, expect, it } from "vitest";
import { transformPoint } from "../../src/engine/affine";
import { layerTransform, type Document, type VectorNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import { worldTransform } from "../../src/engine/hierarchy";
import { moveVertices, setHandle, splitSegment } from "../../src/engine/vector-edit-ops";
import { activateVector, beginVectorEdit, clampVectorEdit, clearVectorSelection, convertToVector, newVectorEdit, refitVector, regionPoints, selectVectorParts, selectedVectorPoints, vectorEditOverlay, vectorParts, vectorSelectionPosition, visibleVectorHandles } from "../../src/engine/vector-edit";
import { freezeNetwork } from "../../src/engine/vector-network";

const create = (e: EditorEngine, command = "shape.rectangle", params = {}) => String(e.execute(command, params).id);
const vector = (d: Document, id: string) => d.nodes[id] as VectorNode;
const replace = (d: Document, node: VectorNode): Document => ({ ...d, nodes: { ...d.nodes, [node.id]: node } });

describe("native vector edit session primitives", () => {
  it("converts shapes in input order once, skips containers and preserves existing vectors", () => {
    const e = new EditorEngine(), a = create(e), b = create(e, "shape.ellipse", { x: 200 }), frame = create(e, "frame.create"), before = e.getSnapshot().document;
    const out = beginVectorEdit(before, [a, a, frame, "missing", b]);
    expect(out.selection).toEqual([a, b]); expect(out.state.id).toBe(a); expect(out.state.others.map(p => p.id)).toEqual([b]);
    expect(before.nodes[a].kind).toBe("rectangle"); expect(out.document.nodes[a].kind).toBe("vector");
    expect(out.document.nodes[frame]).toBe(before.nodes[frame]);
    expect(beginVectorEdit(out.document, [a, b]).document).toBe(out.document);
    expect(() => beginVectorEdit(before, [frame, "missing"])).toThrow(/frame/); expect(() => beginVectorEdit(before, [])).toThrow(/Select a shape/);
  });
  it("keeps baked rounded shapes, Line openness, appearance and native archive fields", async () => {
    const e = new EditorEngine(), shape = create(e, "shape.star", { props: { cornerRadius: 10, cornerSmoothing: .4, rotation: 25, fill: "red", opacity: .5 } });
    const line = create(e, "shape.line", { width: 120, props: { strokeAlign: "outside" } });
    const before = e.getSnapshot().document, out = beginVectorEdit(before, [shape, line]);
    const star = vector(out.document, shape), open = vector(out.document, line);
    expect(star.corners).toBeUndefined(); expect(star).not.toHaveProperty("count"); expect(star).not.toHaveProperty("innerRatio");
    expect(star.network.segments.some(s => [...s.ta, ...s.tb].some(x => x !== 0))).toBe(true);
    expect(star.fills).toEqual((before.nodes[shape] as VectorNode).fills); expect(star.opacity).toBe(.5);
    expect(open.network.regions).toEqual([]); expect(open.stroke?.align).toBe("center");
    expect((await decodeFigcraft(await encodeFigcraft(out.document))).document).toEqual(out.document);
    expect(convertToVector(star)).toBe(star);
  });
  it("refits rotated vector geometry and paint frames without moving page-space points", () => {
    const e = new EditorEngine(), id = create(e, "vector.create", { path: "M0 0L100 0L100 100Z", x: 70, y: 90, props: { rotation: 37 } });
    const n = vector(e.getSnapshot().document, id), network = freezeNetwork({ ...n.network, regions: [{ ...n.network.regions[0], paintSpace: { width: 100, height: 100, transform: [1, 0, 0, 1, 0, 0] } }] });
    const moved = { ...n, network: moveVertices(network, [0], { x: -25, y: -10 }) }, refit = refitVector(moved);
    expect(refit.width).toBe(125); expect(refit.height).toBe(110);
    moved.network.vertices.forEach((v, i) => {
      const before = transformPoint(layerTransform(moved), v), after = transformPoint(layerTransform(refit), refit.network.vertices[i]);
      expect(after.x).toBeCloseTo(before.x, 10); expect(after.y).toBeCloseTo(before.y, 10);
    });
    expect(refit.network.regions[0].paintSpace?.transform).toEqual([1, 0, 0, 1, 25, 10]);
    expect(refitVector(refit)).toBe(refit);
  });
  it("retains every layer's selection when activating another and clears active handle state", () => {
    const e = new EditorEngine(), a = create(e), b = create(e), out = beginVectorEdit(e.getSnapshot().document, [a, b]);
    let s = selectVectorParts(out.document, out.state, { vertices: [0], handles: [[0, true]] });
    s = selectVectorParts(out.document, s, { id: b, vertices: [1], add: true });
    expect(vectorParts(s).map(p => [p.id, p.vertices])).toEqual([[b, [1]], [a, [0]]]); expect(s.handles).toEqual([]);
    const back = activateVector(s, a)!; expect(vectorParts(back).map(p => [p.id, p.vertices])).toEqual([[a, [0]], [b, [1]]]);
    expect(activateVector(back, "missing")).toBeUndefined();
    expect(vectorParts(clearVectorSelection(back)).every(p => !p.vertices.length && !p.segments.length)).toBe(true);
    s = selectVectorParts(out.document, back, { id: b, vertices: [2] }); expect(s.others[0].vertices).toEqual([]);
  });
  it("tracks region-only points separately, promotes explicit points and clears topology-sensitive selection", () => {
    const e = new EditorEngine(), id = create(e), out = beginVectorEdit(e.getSnapshot().document, [id]), net = vector(out.document, id).network;
    let state = selectVectorParts(out.document, out.state, { regions: [0, 0, 99], vertices: [0] });
    expect(regionPoints(net, 0)).toEqual([0, 1, 2, 3]); expect(state.regions).toEqual([0]); expect(state.regionVertices).toEqual([1, 2, 3]);
    state = selectVectorParts(out.document, state, { vertices: [1], add: true }); expect(state.regionVertices).toEqual([2, 3]);
    const changed = moveVertices(net, [0], { x: 10, y: 20 }), same = clampVectorEdit(replace(out.document, { ...vector(out.document, id), network: changed }), state)!;
    expect(same.regions).toEqual([0]); expect(same.regionVertices).toEqual([2, 3]);
    const split = splitSegment(net, 0, .5)!.network, newTopology = clampVectorEdit(replace(out.document, { ...vector(out.document, id), network: split }), state)!;
    expect(newTopology.regions).toEqual([]); expect(newTopology.regionVertices).toEqual([]); expect(newTopology.vertices).toEqual([0, 1, 2, 3]);
  });
  it("clamps invalid indices and drops edited layers after undo removes their vector kinds", () => {
    const e = new EditorEngine(), a = create(e), b = create(e), before = e.getSnapshot().document, out = beginVectorEdit(before, [a, b]);
    const state = selectVectorParts(out.document, out.state, { vertices: [3, 1, 3, 99, -1], segments: [2, 99], handles: [[2, true], [99, false], [2, true]] });
    expect(state.vertices).toEqual([1, 3]); expect(state.segments).toEqual([2]); expect(state.handles).toEqual([[2, true]]);
    const oneUndone = { ...out.document, nodes: { ...out.document.nodes, [b]: before.nodes[b] } };
    expect(clampVectorEdit(oneUndone, { ...state, others: [{ id: b, vertices: [99], segments: [0] }] })?.others).toEqual([]);
    expect(clampVectorEdit(before, state)).toBeUndefined(); expect(() => selectVectorParts(out.document, state, { id: "missing" })).toThrow(/isn't being edited/);
  });
  it("reports selection position in parent coordinates and overlay points in page coordinates", () => {
    const e = new EditorEngine(), parent = create(e, "frame.create", { x: 100, y: 200 }), id = create(e, "vector.create", { parent, x: 10, y: 20, path: "M0 0C20 10 80 30 100 0L100 100" });
    const d = e.getSnapshot().document, state = selectVectorParts(d, newVectorEdit(id), { segments: [0], handles: [[0, true]] });
    expect(selectedVectorPoints(vector(d, id).network, state)).toEqual([0, 1]); expect(vectorSelectionPosition(d, state)).toEqual({ x: 10, y: 20 });
    const overlay = vectorEditOverlay(d, state)!;
    expect(overlay.handles).toHaveLength(2); expect(overlay.handles[0]).toMatchObject({ seg: 0, start: true, vertex: [110, 220], handle: [130, 230] });
    const world = transformPoint(worldTransform(d, id), { x: 100, y: 100 }); expect(overlay.vertices[2]).toEqual([world.x, world.y]);
    expect(overlay.selectedHandles).toEqual([[0, true]]); expect(vectorSelectionPosition(d, newVectorEdit(id))).toBeUndefined();
  });
  it("shows handles of explicit points and selected segments, excluding region-only points", () => {
    const e = new EditorEngine(), id = create(e), out = beginVectorEdit(e.getSnapshot().document, [id]), node = vector(out.document, id);
    const net = setHandle(setHandle(node.network, 0, true, [10, 10], true), 1, true, [20, 20], true), d = replace(out.document, { ...node, network: net });
    const region = selectVectorParts(d, out.state, { regions: [0] }); expect(visibleVectorHandles(net, region)).toEqual([]);
    const point = selectVectorParts(d, region, { vertices: [0], add: true }); expect(visibleVectorHandles(net, point)).toEqual([[0, true]]);
    const segment = selectVectorParts(d, point, { segments: [1], add: true }); expect(visibleVectorHandles(net, segment)).toEqual([[0, true], [1, true]]);
  });
  it("applies the native 500 input-layer limit before deduplication", () => {
    const e = new EditorEngine(), a = create(e), b = create(e), d = e.getSnapshot().document;
    const out = beginVectorEdit(d, [...Array.from({ length: 500 }, () => a), b]);
    expect(out.selection).toEqual([a]); expect(out.document.nodes[b]).toBe(d.nodes[b]);
    expect(Object.isFrozen(vector(out.document, a))).toBe(true); expect(Object.isFrozen(out.state.others)).toBe(true);
  });
});
