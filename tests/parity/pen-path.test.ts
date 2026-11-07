import { describe, expect, it } from "vitest";
import { identity, multiply, transformPoint } from "../../src/engine/affine";
import { EditorEngine } from "../../src/engine/editor";
import { worldTransform } from "../../src/engine/hierarchy";
import { buildPenPath, penPathAction, penPathHandles, selectedVectorEnd, type PenAnchor } from "../../src/engine/pen-path";

const anchor = (x: number, y: number, dx = 0, dy = 0): PenAnchor => ({ at: { x, y }, incoming: { x: -dx, y: -dy }, outgoing: { x: dx, y: dy } });
describe("native top-level Pen path geometry", () => {
  it("creates no network before two anchors and bounds an open line in parent space", () => {
    expect(buildPenPath([anchor(100, 100)], identity, false)).toBeUndefined();
    const path = buildPenPath([anchor(100, 100), anchor(200, 100)], identity, false)!;
    expect(path).toMatchObject({ width: 100, height: 0, transform: [1, 0, 0, 1, 100, 100] });
    expect(path.network.vertices).toEqual([{ x: 0, y: 0, radius: 0 }, { x: 100, y: 0, radius: 0 }]);
    expect(path.network.regions).toEqual([]); expect(path.network.segments).toHaveLength(1);
  });
  it("matches native overlay handle order for dragged anchors", () => {
    const first = anchor(100, 100, 40, 0), second = anchor(200, 200, 0, 40);
    expect(penPathHandles([first])).toEqual([[{ x: 100, y: 100 }, { x: 60, y: 100 }], [{ x: 100, y: 100 }, { x: 140, y: 100 }]]);
    expect(penPathHandles([first, second])).toEqual([[{ x: 100, y: 100 }, { x: 140, y: 100 }], [{ x: 200, y: 200 }, { x: 200, y: 160 }], [{ x: 200, y: 200 }, { x: 200, y: 240 }]]);
    expect(penPathHandles([anchor(0, 0), anchor(100, 0)])).toEqual([]);
  });
  it("uses analytical curve extrema, retains relative handles and parent-local placement", () => {
    const points = [anchor(100, 100, 0, 100), anchor(200, 100, 0, -100)];
    const path = buildPenPath(points, identity, false)!;
    expect(path.width).toBeCloseTo(100, 10); expect(path.height).toBeCloseTo(75, 10);
    expect(path.network.segments[0]).toMatchObject({ ta: [0, 100], tb: [0, 100] });
    const parent = [0, 1, -1, 0, 400, 200] as const, local = buildPenPath(points, parent, false)!;
    const world = multiply(parent, local.transform);
    local.network.vertices.forEach((v, i) => {
      const p = transformPoint(world, v); expect(p.x).toBeCloseTo(points[i].at.x, 9); expect(p.y).toBeCloseTo(points[i].at.y, 9);
    });
  });
  it("closes with one region while interior-anchor joining stays unfilled", () => {
    const points = [anchor(0, 0), anchor(100, 0), anchor(100, 100), anchor(0, 100)];
    const closed = buildPenPath(points, identity, true)!;
    expect(closed.network.vertices).toHaveLength(4); expect(closed.network.segments).toHaveLength(4); expect(closed.network.regions[0].loops).toEqual([[0, 1, 2, 3]]);
    const joined = buildPenPath(points, identity, false, 1)!;
    expect(joined.network.segments.at(-1)).toMatchObject({ a: 3, b: 1 }); expect(joined.network.regions).toEqual([]);
    expect(joined).toMatchObject({ width: 100, height: 100 });
  });
  it("tests close/join/duplicate-last before applying Shift and preserves the eight-pixel strict boundary", () => {
    const points = [anchor(100, 100), anchor(200, 100), anchor(200, 200), anchor(100, 200)];
    expect(penPathAction(points, { x: 100, y: 100 }, 1, false)).toEqual({ kind: "close" });
    expect(penPathAction(points, { x: 200, y: 100 }, 1, false)).toEqual({ kind: "join", index: 1 });
    expect(penPathAction(points, { x: 100, y: 200 }, 1, false)).toEqual({ kind: "ignore" });
    expect(penPathAction(points, { x: 108, y: 200 }, 1, false)).toEqual({ kind: "add", point: { x: 108, y: 200 } });
    expect(penPathAction(points.slice(0, 2), { x: 100, y: 100 }, 1, false).kind).toBe("add");
    expect(penPathAction([anchor(100, 100)], { x: 300, y: 120 }, 1, true)).toEqual({ kind: "add", point: { x: 100 + Math.hypot(200, 20), y: 100 } });
  });
  it("resumes selected endpoints in selection order and rejects interior or closed vertices", () => {
    const e = new EditorEngine(), a = String(e.execute("vector.create", { points: [[100, 100], [200, 100], [200, 200]], closed: false }).id);
    const b = String(e.execute("vector.create", { points: [[100, 100], [200, 100]], closed: false }).id), doc = e.getSnapshot().document;
    expect(selectedVectorEnd(doc, [b, a], { x: 100, y: 100 }, 8)).toEqual({ id: b, vertex: 0 });
    expect(selectedVectorEnd(doc, [a], { x: 200, y: 100 }, 8)).toBeUndefined();
    const p = transformPoint(worldTransform(doc, a), { x: 100, y: 100 });
    expect(selectedVectorEnd(doc, [a], p, 8)).toEqual({ id: a, vertex: 2 });
  });
  it("rejects singular or overflowing parent geometry without mutating its anchors", () => {
    const points = [anchor(100, 100), anchor(200, 100)], before = structuredClone(points);
    expect(() => buildPenPath(points, [0, 0, 0, 0, 0, 0], false)).toThrow(/singular/);
    expect(() => buildPenPath([anchor(1e308, 0, 1e308, 0), anchor(0, 0)], identity, false)).toThrow(/finite/);
    expect(points).toEqual(before);
  });
});
