import { describe, expect, it } from "vitest";
import { polygonPoints, starPoints, roundedPolygon, smoothedPolygon } from "../../src/engine/polygon";
import { flattenContours, roundedRect, type PathCommand } from "../../src/engine/corners";
import type { Point } from "../../src/engine/geometry";
import { readFileSync } from "node:fs";
import { EditorEngine } from "../../src/engine/editor";
import type { PolygonNode, StarNode } from "../../src/engine/document";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import { CornerInteraction, cornerHandles, cornerDrag } from "../../src/engine/corner-handles";
import { DrawInteraction } from "../../src/engine/draw-interaction";
import { hitRectangle } from "../../src/engine/selection";
import { transformPoint } from "../../src/engine/affine";
import { worldTransform } from "../../src/engine/hierarchy";
import { shapePath } from "../../src/engine/shape-path";
const area = (path: readonly PathCommand[]) => Math.abs(flattenContours(path).reduce((sum, points) => sum + points.reduce((a, p, i) => { const q = points[(i + 1) % points.length]; return a + p.x * q.y - q.x * p.y; }, 0) / 2, 0));
function nearest(path: readonly PathCommand[], p: Point): number {
  let best = Infinity;
  for (const points of flattenContours(path)) for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return best;
}
function segments(path: readonly PathCommand[]) {
  const result: ((t: number) => Point)[] = []; let prev: Point = { x: 0, y: 0 }, first = prev;
  for (const cmd of path) {
    const a = prev;
    if (cmd[0] === "M") { prev = first = { x: cmd[1], y: cmd[2] }; continue; }
    if (cmd[0] === "C") {
      const b = { x: cmd[1], y: cmd[2] }, c = { x: cmd[3], y: cmd[4] }, d = { x: cmd[5], y: cmd[6] }; prev = d;
      if (Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - b.x, c.y - b.y) + Math.hypot(d.x - c.x, d.y - c.y) < 1e-6) continue;
      result.push(t => { const u = 1 - t; return { x: u ** 3 * a.x + 3 * u ** 2 * t * b.x + 3 * u * t ** 2 * c.x + t ** 3 * d.x, y: u ** 3 * a.y + 3 * u ** 2 * t * b.y + 3 * u * t ** 2 * c.y + t ** 3 * d.y }; });
    } else {
      const b = cmd[0] === "Z" ? first : { x: cmd[1], y: cmd[2] }; prev = b;
      if (Math.hypot(b.x - a.x, b.y - a.y) >= 1e-6) result.push(t => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }));
    }
  }
  return result;
}
describe("native polygon and star geometry", () => {
  it("starts at the top centre, doubles star vertices and clamps geometric counts/ratio", () => {
    const points = polygonPoints(100, 100, 3); expect(points).toHaveLength(3); expect(points[0].x).toBeCloseTo(50); expect(points[0].y).toBeCloseTo(0);
    expect(starPoints(100, 100, 5, .38)).toHaveLength(10);
    expect(polygonPoints(100, 100, 0)).toHaveLength(3); expect(polygonPoints(100, 100, 200)).toHaveLength(120);
    expect(starPoints(100, 100, 200, 0)).toHaveLength(240);
    const inner = starPoints(100, 100, 5, 0)[1]; expect(Math.hypot(inner.x - 50, inner.y - 50)).toBeCloseTo(.05);
  });
  it("rounding a hexagon removes less than20% of its area", () => {
    const pts = polygonPoints(100, 100, 6), sharp = area(roundedPolygon(pts, 0)), round = area(roundedPolygon(pts, 10));
    expect(round).toBeLessThan(sharp); expect(round).toBeGreaterThan(sharp * .8);
  });
  it.each([[10, 0], [10, .6], [12, 1], [30, .6], [1000, .6]])("matches rotated rounded-square area for radius%s smoothing%s", (r, s) => {
    const side = 50 * Math.SQRT2, polygon = area(smoothedPolygon(polygonPoints(100, 100, 4), r, s)), rect = area(roundedRect(side, side, { radii: [r, r, r, r], smoothing: s }));
    expect(Math.abs(polygon - rect)).toBeLessThan(.05);
  });
  it.each(["triangle", "hexagon", "star"])("smooths every %s vertex with tangent continuity and retained edge midpoints", shape => {
    const points = shape === "star" ? starPoints(100, 100, 5, .38) : polygonPoints(shape === "hexagon" ? 120 : 100, shape === "hexagon" ? 80 : 100, shape === "hexagon" ? 6 : 3);
    const plain = smoothedPolygon(points, 8, 0), sharp = area(roundedPolygon(points, 0)); expect(plain).toEqual(roundedPolygon(points, 8)); let last = area(plain);
    for (const smoothing of [.3, .6, 1]) {
      const path = smoothedPolygon(points, 8, smoothing), current = area(path);
      if (shape !== "star") expect(current).toBeLessThan(last); else expect(Math.abs(current - last)).toBeGreaterThan(.001);
      expect(Math.abs(current - sharp)).toBeLessThan(sharp * .2); last = current;
      const segs = segments(path);
      for (let i = 0; i < segs.length; i++) {
        const a = segs[i](1), b = segs[i](1 - 1e-6), next = segs[(i + 1) % segs.length], c = next(1e-6), d = next(0);
        const x = a.x - b.x, y = a.y - b.y, u = c.x - d.x, v = c.y - d.y;
        expect((x * u + y * v) / (Math.hypot(x, y) * Math.hypot(u, v))).toBeGreaterThan(.999);
      }
      for (const p of flattenContours(path).flat()) { expect(p.x).toBeGreaterThanOrEqual(-1e-6); expect(p.x).toBeLessThanOrEqual(120 + 1e-6); expect(p.y).toBeGreaterThanOrEqual(-1e-6); expect(p.y).toBeLessThanOrEqual(100 + 1e-6); }
      for (let i = 0; i < points.length; i++) { const p = points[i], q = points[(i + 1) % points.length]; expect(nearest(path, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 })).toBeLessThan(.001); expect(nearest(path, p)).toBeGreaterThan(.5); }
    }
  });
  it("handles empty, repeated, collinear and nonfinite inputs without invalid output", () => {
    const inputs = [[], [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }], [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], polygonPoints(NaN, Infinity, 0), starPoints(10, 10, 1, -3)];
    for (const pts of inputs) for (const [r, s] of [[4, .6], [4, 1], [Infinity, NaN]]) expect(smoothedPolygon(pts, r, s).flat().filter(v => typeof v === "number").every(Number.isFinite)).toBe(true);
    expect(smoothedPolygon([], 4, .6)).toEqual([]);
  });
});

function fixture(kind: "polygon" | "star" = "star") {
  const e = new EditorEngine(), id = String(e.execute(`shape.${kind}`, { width: 200, height: 200 }).id);
  return { e, id, node: () => e.getSnapshot().document.nodes[id] as PolygonNode | StarNode, doc: () => e.getSnapshot().document };
}
describe("native Polygon/Star command, file and hierarchy contracts", () => {
  it.each(["polygon", "triangle", "star", "STAR"])("creates %s with source defaults and command properties", type => {
    const e = new EditorEngine(), star = type.toLowerCase() === "star";
    const id = String(e.execute("node.create", { type }).id);
    expect(e.getSnapshot().document.nodes[id]).toMatchObject({ kind: star ? "star" : "polygon", count: star ? 5 : 3, width: 100, height: 100, fill: "#d9d9d9", ...(star ? { innerRatio: .38 } : {}) });
    e.execute("edit.undo"); expect(e.getSnapshot().document.nodes[id]).toBeUndefined(); e.execute("edit.redo"); expect(e.getSnapshot().document.nodes[id]).toBeDefined();
  });
  it("rounds and clamps counts differently for Polygon and Star, with atomic failures", () => {
    for (const kind of ["polygon", "star"] as const) {
      const { e, node } = fixture(kind);
      for (const [value, result] of [[2, 3], [4.5, 5], [300, kind === "star" ? 60 : 120]] as const) { e.execute("node.set", { props: { pointCount: value } }); expect(node().count).toBe(result); }
      const before = e.getSnapshot(); expect(() => e.execute("node.set", { props: { name: "bad", pointCount: "bad" } })).toThrow(); expect(e.getSnapshot()).toBe(before);
    }
    const { e } = fixture("polygon"); const before = e.getSnapshot(); expect(() => e.execute("node.set", { props: { ratio: .3 } })).toThrow("stars"); expect(e.getSnapshot()).toBe(before);
    e.execute("shape.rectangle"); expect(() => e.execute("node.set", { props: { pointCount: 5 } })).toThrow("polygons and stars");
  });
  it("preserves ratio aliases, sorted precedence, percentage parsing and malformed fallback", () => {
    const { e, node } = fixture();
    for (const [value, expected] of [["50%", .5], [1, 1], [200, 1], [-1, 0], ["nonsense", .38], [null, .38]] as const) {
      e.execute("node.set", { props: { innerRadius: value } }); expect((node() as StarNode).innerRatio).toBe(expected);
    }
    e.execute("node.set", { props: { ratio: .7, innerRadius: .2 } }); expect((node() as StarNode).innerRatio).toBe(.7);
  });
  it.each(["polygon", "star"])("retains raw %s fields, requires native fields and rejects invalid u32 counts", async kind => {
    const raw = JSON.parse(readFileSync(new URL("../fixtures/native-rectangle.json", import.meta.url), "utf8"));
    Object.assign(raw.nodes["2"], { type: kind, count: 0, ...(kind === "star" ? { inner_ratio: 1.5 } : {}) });
    const decode = () => decodeFigcraft(new TextEncoder().encode(JSON.stringify(raw)));
    for (const count of [0, 4294967295]) {
      raw.nodes["2"].count = count; const opened = await decode(); expect(opened.document.nodes["2"]).toMatchObject({ kind, count, ...(kind === "star" ? { innerRatio: 1.5 } : {}) });
      expect(await decodeFigcraft(await encodeFigcraft(opened.document, opened.nextId))).toEqual(opened);
    }
    for (const count of [undefined, null, -1, 3.5, 4294967296]) { raw.nodes["2"].count = count; await expect(decode()).rejects.toThrow(); }
    raw.nodes["2"].count = 5;
    for (const literal of ["5.0", "5e0", "4294967295.0000001"]) {
      const text = JSON.stringify(raw).replace('"count":5', `"count":${literal}`);
      await expect(decodeFigcraft(new TextEncoder().encode(text))).rejects.toThrow("u32");
    }
    if (kind === "star") { delete raw.nodes["2"].inner_ratio; await expect(decode()).rejects.toThrow(); raw.nodes["2"].inner_ratio = .38; }
    raw.nodes["2"].children = [3]; await expect(decode()).rejects.toThrow("leaf");
  });
  it.each(["polygon", "star"] as const)("hits %s path, caches geometry and preserves subtree/page duplicates", kind => {
    const { e, id, node, doc } = fixture(kind);
    expect(hitRectangle(doc(), { x: 2, y: 2 })).toBeUndefined(); expect(hitRectangle(doc(), { x: 100, y: 100 })).toBe(id);
    expect(shapePath(node())).toBe(shapePath(node()));
    e.execute("node.set", { props: { cornerRadius: 8, cornerSmoothing: .6 } });
    const path = shapePath(node()); e.execute("node.set", { props: { topRightRadius: 100 } }); expect(shapePath(node())).toBe(path);
    e.execute("object.group"); e.execute("edit.duplicate"); e.execute("page.duplicate");
    expect(Object.values(doc().nodes).filter(n => n.kind === kind)).toHaveLength(4);
    expect(() => e.execute("shape.rectangle", { parent: id })).toThrow("container");
  });
});
describe("native Polygon/Star shape handles and drawing", () => {
  it("places the native Star ratio handle on its first inner vertex and projects the ratio", () => {
    const { id, doc } = fixture(); const handles = cornerHandles(doc(), [id], 1), expected = starPoints(200, 200, 5, .38)[1];
    expect(handles.map(h => h.index)).toEqual([0, "ratio"]); expect(handles[1].point).toEqual(expected);
    expect(cornerDrag(doc(), id, "ratio", starPoints(200, 200, 5, .5)[1], false)?.innerRadius).toBeCloseTo(.5);
    expect(cornerDrag(doc(), id, "ratio", { x: 100, y: 100 }, false)).toEqual({ innerRadius: .001 });
    expect(cornerDrag(doc(), id, 0, { x: 100, y: 30 }, true)?.cornerRadius).toBeGreaterThan(0);
    const p = fixture("polygon"); expect(cornerHandles(p.doc(), [p.id], 1).map(h => h.index)).toEqual([0]);
  });
  it("uses transformed coordinates, hides small/locked handles and guards invalid pointers", () => {
    const { e, id, doc } = fixture(); e.execute("node.set", { props: { rotation: 30 } }); e.execute("object.flipH");
    const p = transformPoint(worldTransform(doc(), id), starPoints(200, 200, 5, .6)[1]); expect(cornerDrag(doc(), id, "ratio", p, false)?.innerRadius).toBeCloseTo(.6);
    expect(cornerHandles(doc(), [id], .2)).toEqual([]); expect(cornerHandles(doc(), [id, id], 1)).toEqual([]);
    expect(cornerDrag(doc(), id, "ratio", { x: NaN, y: 0 }, false)).toBeUndefined();
    e.execute("node.set", { props: { locked: true } }); expect(cornerHandles(doc(), [id], 1)).toEqual([]);
  });
  it("previews outside React, restores cancellation and commits ratio once with undo", () => {
    const { e, id, node, doc } = fixture(), t = new CornerInteraction(e, m => { throw new Error(m); }), before = doc();
    expect(t.down(starPoints(200, 200, 5, .38)[1])).toBe(true); let calls = 0; const off = e.subscribe(() => calls++);
    t.move(starPoints(200, 200, 5, .5)[1], false); expect(calls).toBe(0); expect((node() as StarNode).innerRatio).toBe(.38); expect((e.getRenderDocument().nodes[id] as StarNode).innerRatio).toBeCloseTo(.5);
    t.cancel(); expect(doc()).toBe(before); expect(e.getRenderDocument()).toBe(before);
    t.down(starPoints(200, 200, 5, .38)[1]); t.move(starPoints(200, 200, 5, .5)[1], false); t.up(); off(); expect((node() as StarNode).innerRatio).toBeCloseTo(.5);
    e.execute("edit.undo"); expect((node() as StarNode).innerRatio).toBe(.38);
  });
  it.each(["polygon", "star"] as const)("draws %s with Shift/Alt, one ID/history action and Frame parent", kind => {
    const e = new EditorEngine(), t = new DrawInteraction(e, m => { throw new Error(m); });
    const frame = String(e.execute("frame.create", { x: 100, y: 100, width: 400, height: 400 }).id); e.execute(`tool.${kind}`);
    t.down({ x: 250, y: 250 }); t.move({ x: 310, y: 290 }, { shiftKey: true, altKey: true, ctrlKey: true, metaKey: false });
    expect(e.getRenderDocument().nodes["3"]).toMatchObject({ kind, parent: frame, x: 90, y: 90, width: 120, height: 120 });
    t.up({ x: 310, y: 290 }); expect(e.getSnapshot().tool).toBe("move"); e.execute("edit.undo"); expect(e.getSnapshot().document.nodes["3"]).toBeUndefined();
  });
});
