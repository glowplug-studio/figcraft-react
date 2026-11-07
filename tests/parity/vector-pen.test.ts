import { describe, expect, it } from "vitest";
import { transformPoint } from "../../src/engine/affine";
import type { VectorNode } from "../../src/engine/document";
import { commandSpecs, EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft } from "../../src/engine/file-format";
import { worldTransform } from "../../src/engine/hierarchy";
import { activateVector, clampVectorEdit, newVectorEdit } from "../../src/engine/vector-edit";
import { freezeNetwork, networkFromPoints, networkIncident, networkMirroring, vectorLine, vectorVertex } from "../../src/engine/vector-network";
import { applyPen, connectVectorPoints, penAt45, planPen } from "../../src/engine/vector-pen";
import { shownVectorPointBox } from "../../src/engine/vector-point-transform";

const pt = (x: number, y: number) => ({ x, y });
const open = () => networkFromPoints([pt(0, 0), pt(100, 0), pt(100, 100)], false);
const node = (e: EditorEngine, id: string) => e.getSnapshot().document.nodes[id] as VectorNode;
function editing() {
  const e = new EditorEngine(), id = String(e.execute("vector.create", { points: [[0, 0], [100, 0]], closed: false }).id);
  e.execute("vector.edit.begin"); e.execute("vector.edit.tool", { tool: "pen" }); return { e, id };
}
const pen = (e: EditorEngine, x: number, y: number, extra = {}) => e.execute("vector.edit.pen", { x, y, ...extra });

describe("native Pen network operations and commands", () => {
  it("closes an unfilled endpoint chain and branches without adding a face", () => {
    const source = open(), closed = connectVectorPoints(source, 2, 0)!;
    expect(closed.segment).toBe(2); expect(closed.network.regions).toEqual([{ winding: "nonZero", loops: [[2, 0, 1]] }]);
    expect(source.regions).toEqual([]); expect(source.segments).toHaveLength(2);
    const branch = applyPen(closed.network, { kind: "new", at: pt(50, -50), from: 1 });
    expect(networkIncident(branch.network, 1)).toHaveLength(3); expect(branch.network.regions).toEqual(closed.network.regions);
    expect(connectVectorPoints(source, 1, 1)).toBeUndefined(); expect(connectVectorPoints(source, 1, 99)).toBeUndefined();
  });
  it("preserves native breadth-first segment ordering and existing region ownership", () => {
    const net = freezeNetwork({ vertices: [0, 1, 2, 3, 4, 5].map(x => vectorVertex(x, 0)),
      segments: [vectorLine(0, 1), vectorLine(1, 2), vectorLine(1, 3), vectorLine(2, 4), vectorLine(3, 4), vectorLine(4, 5)], regions: [] });
    expect(connectVectorPoints(net, 5, 0)!.network.regions[0].loops).toEqual([[6, 0, 1, 3, 5]]);
    const painted = freezeNetwork({ ...net, regions: [{ loops: [[2, 4]], winding: "evenOdd", fills: [] }] });
    expect(connectVectorPoints(painted, 5, 0)!.network.regions).toHaveLength(2);
    const owned = freezeNetwork({ ...net, regions: [{ loops: [[1, 3]], winding: "evenOdd", fills: [] }] });
    expect(connectVectorPoints(owned, 5, 0)!.network.regions).toEqual(owned.regions);
  });
  it("joins separate paths without a region and sanitises each non-finite handle", () => {
    const net = freezeNetwork({ vertices: [0, 1, 2, 3].map(x => vectorVertex(x, 0)), segments: [vectorLine(0, 1), vectorLine(2, 3)], regions: [] });
    const joined = connectVectorPoints(net, 1, 2, [Infinity, 3], [4, 5])!.network;
    expect(joined.regions).toEqual([]); expect(joined.segments[2]).toMatchObject({ ta: [0, 0], tb: [4, 5] });
    for (const index of [-1, NaN, 1.5]) expect(connectVectorPoints(net, index, 0)).toBeUndefined();
  });
  it("closes a 20,000-point chain without recursive traversal or repeated network scans", () => {
    const net = networkFromPoints(Array.from({ length: 20_000 }, (_, i) => pt(i, i % 2)), false);
    const closed = connectVectorPoints(net, 19_999, 0)!.network;
    expect(closed.regions[0].loops[0]).toHaveLength(20_000); expect(closed.regions[0].loops[0].slice(0, 3)).toEqual([19_999, 0, 1]);
  });
  it("plans continuation, finish, connection, split and Shift in local axes", () => {
    const net = open();
    expect(planPen(net, undefined, { kind: "vertex", index: 1 }, pt(0, 0), false)).toEqual({ kind: "start", vertex: 1 });
    expect(planPen(net, 1, { kind: "vertex", index: 1 }, pt(0, 0), false)).toEqual({ kind: "end" });
    expect(planPen(net, 1, { kind: "vertex", index: 0 }, pt(0, 0), false)).toMatchObject({ plan: { kind: "connect", from: 1, to: 0 } });
    expect(planPen(net, 1, { kind: "segment", seg: 0, t: .25 }, pt(0, 0), false)).toMatchObject({ plan: { kind: "split", from: 1, seg: 0, t: .25 } });
    const shifted = planPen(net, 1, undefined, pt(300, 20), true);
    expect(shifted).toMatchObject({ plan: { kind: "new", from: 1, at: { x: 100 + Math.hypot(200, 20), y: 0 } } });
    const down = penAt45(pt(0, 0), pt(200, -100)); expect(down.x).toBeCloseTo(-down.y, 9);
  });
  it("mirrors a new point's incoming drag and uses its outgoing handle on the next segment", () => {
    const first = applyPen(open(), { kind: "new", at: pt(150, 50), from: 1 }, undefined, pt(0, 30));
    expect(first.network.segments.at(-1)?.tb[0]).toBeCloseTo(0, 12); expect(first.network.segments.at(-1)?.tb[1]).toBe(-30); expect(networkMirroring(first.network, 3)).toBe("angleAndLength");
    const next = applyPen(first.network, { kind: "new", at: pt(250, 50), from: 3 }, [0, 30]);
    expect(next.network.segments.at(-1)?.ta).toEqual([0, 30]); expect(next.network.vertices).toHaveLength(5);
  });
  it("a closing drag shapes both sides only at a point with exactly one prior segment", () => {
    const source = open(), closed = applyPen(source, { kind: "connect", from: 2, to: 0 }, [5, 6], pt(10, 20)).network;
    expect(closed.segments[0].ta).toEqual([10, 20]); expect(closed.segments[2]).toMatchObject({ ta: [5, 6], tb: [-10, -20] });
    expect(closed.vertices[0].mirror).toBe("angleAndLength"); expect(source.segments[0].ta).toEqual([0, 0]);
    const branch = applyPen(closed, { kind: "connect", from: 2, to: 0 }, undefined, pt(30, 40)).network;
    expect(branch.segments[0]).toEqual(closed.segments[0]); expect(branch.vertices[0]).toEqual(closed.vertices[0]);
  });
  it("splits and connects with zero incoming tangent, ignoring a dragged split handle", () => {
    const split = applyPen(open(), { kind: "split", seg: 0, t: .5, from: 2 }, [7, 8], pt(90, 90));
    expect(split.vertex).toBe(3); expect(split.network.vertices[3]).toMatchObject({ x: 50, y: 0 });
    expect(split.network.segments.at(-1)).toMatchObject({ a: 2, b: 3, ta: [7, 8], tb: [0, 0] });
    expect(applyPen(open(), { kind: "split", seg: 999, t: .5 }).vertex).toBeUndefined();
    expect(() => applyPen(open(), { kind: "new", at: pt(Infinity, 0) })).toThrow(/finite/);
  });
  it("matches native command continuation, close, branch and no-geometry point selection", () => {
    const { e, id } = editing(), before = e.getSnapshot();
    expect(pen(e, 100, 0)).toEqual({ vertex: 1 }); expect(e.getSnapshot()).toBe(before);
    pen(e, 100, 100); expect(node(e, id).network.vertices).toHaveLength(3);
    pen(e, 0, 0); expect(node(e, id).network.regions).toHaveLength(1); expect(e.getVectorEdit()?.anchor).toBeUndefined();
    pen(e, 100, 100); pen(e, 200, 150); expect(networkIncident(node(e, id).network, 2)).toHaveLength(3);
    expect(commandSpecs["vector.edit.pen"]).toEqual({ label: "Pen point", undo: true });
    expect(commandSpecs["vector.edit.penEnd"].undo).toBe(false);
  });
  it("keeps command history per click, clears invalid anchors on undo and round trips the network", async () => {
    const { e, id } = editing(); pen(e, 100, 0); const before = e.getSnapshot().document;
    pen(e, 150, 50, { dx: 0, dy: 30 }); const first = e.getSnapshot().document;
    expect(e.getVectorEdit()?.penOut).toEqual([0, 30]); pen(e, 250, 50);
    expect(node(e, id).network.segments.at(-1)?.ta).toEqual([0, 30]);
    // JSON's signed zero normalisation has no geometry or native equality difference.
    expect((await decodeFigcraft(await e.nativeSnapshot())).document).toEqual(JSON.parse(JSON.stringify(e.getSnapshot().document)));
    e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(first); expect(e.getVectorEdit()?.anchor).toBeUndefined();
    e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(before);
    e.execute("edit.redo"); expect(e.getSnapshot().document).toBe(first);
  });
  it("honours page coordinates and local tangent offsets beneath a rotated parent", () => {
    const e = new EditorEngine(), parent = String(e.execute("frame.create", { x: 300, y: 200, width: 500, height: 500, props: { rotation: 90 } }).id);
    const id = String(e.execute("vector.create", { points: [[0, 0], [100, 0]], closed: false, parent }).id); e.execute("vector.edit.begin");
    const w = worldTransform(e.getSnapshot().document, id), from = transformPoint(w, pt(100, 0)), to = transformPoint(w, pt(200, 50));
    pen(e, from.x, from.y); pen(e, to.x, to.y, { dx: 30, dy: 0 });
    const n = node(e, id), actual = transformPoint(worldTransform(e.getSnapshot().document, id), n.network.vertices[2]);
    expect(actual.x).toBeCloseTo(to.x, 8); expect(actual.y).toBeCloseTo(to.y, 8);
    expect(Math.hypot(...e.getVectorEdit()!.penOut!)).toBeCloseTo(30, 8);
    expect(Math.abs(e.getVectorEdit()!.penOut![0])).toBeLessThan(1e-8);
  });
  it("ends continuation without history, preserves repeated Pen selection, clears on tool changes and rejects errors atomically", () => {
    const { e, id } = editing(); pen(e, 100, 0); pen(e, 150, 50, { dy: 30 }); const before = e.getSnapshot();
    e.execute("vector.edit.tool", { tool: "pen" }); expect(e.getVectorEdit()?.anchor).toBe(2);
    e.execute("vector.edit.penEnd"); expect(e.getVectorEdit()?.anchor).toBeUndefined(); expect(e.getSnapshot()).toBe(before);
    pen(e, 150, 50); e.execute("vector.edit.tool", { tool: "move" }); expect(e.getVectorEdit()?.anchor).toBeUndefined(); expect(e.getVectorEdit()?.penOut).toBeUndefined();
    const state = e.getVectorEdit();
    expect(() => pen(e, NaN, 0)).toThrow(); expect(() => pen(e, 0, 0, { unknown: 1 })).toThrow();
    expect(e.getSnapshot()).toBe(before); expect(e.getVectorEdit()).toBe(state);
    const hidden = { ...newVectorEdit(id), vertices: [0, 1], anchor: 0 };
    expect(shownVectorPointBox(before.document, hidden)).toBeUndefined();
    expect(clampVectorEdit(before.document, { ...hidden, anchor: 999, penOut: [4, 5] })?.penOut).toBeUndefined();
    expect(activateVector({ ...hidden, others: [{ id: "other", vertices: [], segments: [] }] }, "other")?.anchor).toBeUndefined();
  });
});
