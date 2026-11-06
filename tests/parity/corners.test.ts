import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { roundedRect, flattenPath, setCorners, zeroCorners, cornerPath, type Corners, type Radii } from "../../src/engine/corners";
import { CornerInteraction, cornerDrag, cornerHandles } from "../../src/engine/corner-handles";
import { EditorEngine } from "../../src/engine/editor";
import type { LayerNode } from "../../src/engine/document";
import { hitRectangle } from "../../src/engine/selection";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import { transformPoint } from "../../src/engine/affine";
import { worldTransform } from "../../src/engine/hierarchy";

const corners = (r: number | Radii, smoothing = 0): Corners => ({ radii: typeof r === "number" ? [r, r, r, r] : r, smoothing });
const area = (w: number, h: number, c: Corners) => { const p = flattenPath(roundedRect(w, h, c)); return Math.abs(p.slice(1).reduce((a, q, i) => a + p[i].x * q.y - q.x * p[i].y, 0) / 2); };
function fixture(frame = false) {
  const e = new EditorEngine(), id = String(e.execute(frame ? "frame.create" : "shape.rectangle", { x: 100, y: 100, width: 200, height: 120 }).id);
  const node = () => e.getSnapshot().document.nodes[id] as LayerNode;
  const t = new CornerInteraction(e, message => { throw new Error(message); }); return { e, id, node, t };
}
describe("rounded paths from geom::tests", () => {
  it("matches plain and circular area and the oversized capsule bounds", () => {
    expect(area(100, 50, corners(0))).toBe(5000);
    expect(Math.abs(area(100, 50, corners(10)) - (5000 - 400 + Math.PI * 100))).toBeLessThan(.5);
    const p = flattenPath(roundedRect(100, 40, corners(1000)));
    expect(Math.min(...p.map(p => p.x))).toBeCloseTo(0); expect(Math.max(...p.map(p => p.x))).toBeCloseTo(100);
    expect(Math.min(...p.map(p => p.y))).toBeCloseTo(0); expect(Math.max(...p.map(p => p.y))).toBeCloseTo(40);
  });
  it.each([0, .3, .6, 1])("independent smoothed corners stay within bounds at %s", s => {
    const p = flattenPath(roundedRect(200, 120, corners([24, 0, 40, 8], s)));
    expect(p.every(p => p.x >= -1e-9 && p.y >= -1e-9 && p.x <= 200 + 1e-9 && p.y <= 120 + 1e-9)).toBe(true);
    expect(area(200, 120, corners([24, 0, 40, 8], s))).toBeLessThan(24000);
  });
  it("smoothing removes more area and sanitises invalid geometric inputs", () => {
    expect(area(200, 200, corners(40, 1))).toBeLessThan(area(200, 200, corners(40)));
    expect(roundedRect(NaN, -1)).toEqual([]);
    expect(roundedRect(100, 50, corners([NaN, -10, Infinity, 0], NaN))).toEqual(roundedRect(100, 50));
  });
});
describe("corner commands, serialisation and hits", () => {
  it.each([[5, [5, 5, 5, 5]], [[2], [2, 2, 2, 2]], [[2, 4], [2, 4, 2, 4]], [[-1, 3, 4, 5], [0, 3, 4, 5]]])("expands native radius input %j", (value, result) => {
    expect(setCorners(zeroCorners, { cornerRadius: value }).radii).toEqual(result);
  });
  it("sorts mixed keys and resets invalid smoothing while refusing malformed radii atomically", () => {
    const { e, node } = fixture();
    e.execute("node.set", { props: { topLeftRadius: "12px", bottomLeftRadius: 99, cornerRadius: [5, 6], cornerSmoothing: .6 } });
    expect(node().corners).toEqual(corners([12, 6, 5, 6], .6));
    const before = e.getSnapshot(); expect(() => e.execute("node.set", { props: { name: "Bad", cornerRadius: [1, 2, 3] } })).toThrow(); expect(e.getSnapshot()).toBe(before);
    e.execute("node.set", { props: { cornerSmoothing: {} } }); expect(node().corners?.smoothing).toBe(0);
  });
  it("retains stored radii during resize, scales them with Scale, and round-trips native files", async () => {
    const { e, node } = fixture(); e.execute("node.set", { props: { cornerRadius: [10, 20, 1000, 40], cornerSmoothing: .6 } });
    e.execute("node.set", { props: { width: 50 } }); expect(node().corners?.radii[2]).toBe(1000);
    e.execute("transform.scale", { factor: 2 }); expect(node().corners).toEqual(corners([20, 40, 2000, 80], .6));
    const decoded = await decodeFigcraft(await encodeFigcraft(e.getSnapshot().document)); expect((decoded.document.nodes[node().id] as LayerNode).corners).toEqual(node().corners);
    expect(Object.isFrozen((decoded.document.nodes[node().id] as LayerNode).corners?.radii)).toBe(true);
  });
  it("applies native Corners field defaults, retains wire radii and rejects malformed values", async () => {
    const raw = JSON.parse(readFileSync(new URL("../fixtures/native-rectangle.json", import.meta.url), "utf8"));
    const decode = (value: unknown) => { raw.nodes["2"].corners = value; return decodeFigcraft(new TextEncoder().encode(JSON.stringify(raw))); };
    expect(((await decode({ smoothing: .6 })).document.nodes["2"] as LayerNode).corners).toEqual(corners(0, .6));
    expect(((await decode({ radii: [-5, 6, 1000, 0] })).document.nodes["2"] as LayerNode).corners).toEqual(corners([-5, 6, 1000, 0]));
    for (const value of [{ radii: null }, { smoothing: null }, { radii: [1, 2] }, { radii: [1, 2, 3, "4"] }]) await expect(decode(value)).rejects.toThrow();
  });
  it("rejects scaling overflow atomically and preserves corner identity for no-op commands", () => {
    const { e, node } = fixture(); e.execute("node.set", { props: { cornerRadius: 1e308 } }); const before = e.getSnapshot();
    expect(() => e.execute("transform.scale", { factor: 2 })).toThrow("finite"); expect(e.getSnapshot()).toBe(before);
    const current = node().corners; e.execute("node.set", { props: { cornerRadius: 1e308 } }); expect(node().corners).toBe(current);
  });
  it("uses rounded rectangle hits but rectangular Frame fallback", () => {
    for (const frame of [false, true]) {
      const { e, id, node } = fixture(frame); e.execute("node.set", { props: { cornerRadius: 60, cornerSmoothing: .6 } }); const d = e.getSnapshot().document;
      expect(hitRectangle(d, { x: 101, y: 101 })).toBe(frame ? id : undefined); expect(hitRectangle(d, { x: 200, y: 150 })).toBe(id);
      expect(hitRectangle(d, { x: 200, y: 99 }, false, [], 2)).toBe(frame ? undefined : id); expect(hitRectangle(d, { x: 200, y: 97 }, false, [], 2)).toBeUndefined();
      expect(cornerPath(node())).toBe(cornerPath(node()));
    }
  });
  it("retains invisible Group corner metadata without showing handles", async () => {
    const { e } = fixture(); const id = String(e.execute("object.group").id); e.execute("node.set", { props: { cornerRadius: 17 } });
    const decoded = await decodeFigcraft(await encodeFigcraft(e.getSnapshot().document)); expect((decoded.document.nodes[id] as LayerNode).corners?.radii).toEqual([17, 17, 17, 17]); expect(cornerHandles(decoded.document, [id], 1)).toEqual([]);
  });
});
describe("source-derived corner gestures", () => {
  it("matches native inset, projection, all-corner edit and one undo", () => {
    const { e, id, node, t } = fixture(); const handles = cornerHandles(e.getSnapshot().document, [id], 1);
    expect(handles).toHaveLength(4); expect(handles[0].point.x).toBeCloseTo(107.07106781);
    expect(t.down(handles[0].point)).toBe(true); let notifications = 0; const off = e.subscribe(() => notifications++);
    t.move({ x: 130, y: 128 }, false); expect(notifications).toBe(0); expect(node().corners).toBeUndefined(); t.up(); off();
    expect(node().corners?.radii).toEqual([29, 29, 29, 29]); e.execute("edit.undo"); expect(node().corners).toBeUndefined();
  });
  it("Alt edits only its corner; cancel and modifier changes use the immutable base", () => {
    const { e, id, node, t } = fixture(); const start = cornerHandles(e.getSnapshot().document, [id], 1)[2].point;
    t.down(start); t.move({ x: 290, y: 210 }, false); t.move({ x: 290, y: 210 }, true); t.up(); expect(node().corners?.radii).toEqual([0, 0, 10, 0]);
    t.down(cornerHandles(e.getSnapshot().document, [id], 1)[0].point); t.move({ x: 400, y: 400 }, false);
    expect((e.getRenderDocument().nodes[id] as LayerNode).corners?.radii).toEqual([60, 60, 60, 60]); t.cancel(); expect(node().corners?.radii).toEqual([0, 0, 10, 0]);
  });
  it("supports rotated/flipped local projection and ignores nonfinite pointers", () => {
    const { e, id } = fixture(); e.execute("node.set", { props: { rotation: 45 } });
    const d = e.getSnapshot().document, point = transformPoint(worldTransform(d, id), { x: 30, y: 28 });
    expect(cornerDrag(d, id, 0, point, false)?.cornerRadius).toBeCloseTo(29); expect(cornerDrag(d, id, 0, { x: NaN, y: 0 }, false)).toBeUndefined();
  });
  it("hides small, locked, hidden, multi-selection and Scale-tool handles; actual box corners retain precedence", () => {
    const { e, id, t } = fixture(); expect(t.down({ x: 100, y: 100 })).toBe(false);
    e.execute("node.set", { props: { width: 40, height: 40 } }); expect(cornerHandles(e.getSnapshot().document, [id], 1)).toEqual([]); expect(cornerHandles(e.getSnapshot().document, [id], 4)).toHaveLength(4);
    expect(cornerHandles(e.getSnapshot().document, [id, id], 4)).toEqual([]);
    for (const props of [{ locked: true }, { locked: false, visible: false }]) { e.execute("node.set", { props }); expect(cornerHandles(e.getSnapshot().document, [id], 4)).toEqual([]); }
    e.execute("node.set", { props: { visible: true, width: 200, height: 120 } }); e.execute("tool.scale"); expect(t.down({ x: 107, y: 107 })).toBe(false);
  });
});
