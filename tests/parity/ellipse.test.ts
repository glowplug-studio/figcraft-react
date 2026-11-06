import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import type { EllipseNode } from "../../src/engine/document";
import { ellipsePath, shapePath, TAU, type Arc } from "../../src/engine/ellipse";
import { flattenContours, hitsPath } from "../../src/engine/corners";
import { ArcInteraction, arcHandlePoint, arcHandles, arcLabel, dragArc, hitArc } from "../../src/engine/arc-handles";
import { DrawInteraction } from "../../src/engine/draw-interaction";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import { hitRectangle } from "../../src/engine/selection";
import { transformPoint } from "../../src/engine/affine";
import { worldTransform } from "../../src/engine/hierarchy";

const full: Arc = { start: 0, sweep: TAU, inner: 0 };
const point = (degrees: number, radius = 50) => ({ x: 50 + radius * Math.cos(degrees * Math.PI / 180), y: 50 + radius * Math.sin(degrees * Math.PI / 180) });
const mods = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
function fixture() {
  const e = new EditorEngine(), id = String(e.execute("shape.ellipse").id);
  const node = () => e.getSnapshot().document.nodes[id] as EllipseNode;
  return { e, id, node, doc: () => e.getSnapshot().document, t: new ArcInteraction(e, message => { throw new Error(message); }) };
}
function area(a: Arc): number {
  return flattenContours(ellipsePath(100, 100, a)).reduce((sum, p) => sum + p.reduce((v, q, i) => { const r = p[(i + 1) % p.length]; return v + q.x * r.y - r.x * q.y; }, 0) / 2, 0);
}
describe("source-derived ellipse geometry and command contracts", () => {
  it("matches native full, ring and half-disc areas with opposite-winding holes", () => {
    expect(Math.abs(area(full) - Math.PI * 2500)).toBeLessThan(2);
    expect(Math.abs(area({ ...full, inner: .5 }) - Math.PI * 1875)).toBeLessThan(5);
    expect(Math.abs(area({ ...full, sweep: Math.PI }) - Math.PI * 1250)).toBeLessThan(2);
    const ring = ellipsePath(100, 100, { ...full, inner: .5 });
    expect(flattenContours(ring)).toHaveLength(2);
    expect(hitsPath(ring, { x: 50, y: 50 }, .5)).toBe(false);
    expect(hitsPath(ring, { x: 90, y: 50 }, .5)).toBe(true);
  });
  it("uses full-ellipse major-axis phase, ignores full start/sign and closes partial contours", () => {
    const tall = ellipsePath(100, 200, full); expect(tall[0][0]).toBe("M"); expect(tall[0][1]).toBeCloseTo(50); expect(tall[0][2]).toBeCloseTo(200);
    expect(tall).toEqual(ellipsePath(100, 200, { start: 2, sweep: -TAU, inner: 0 }));
    expect(tall.some(p => p[0] === "Z")).toBe(false);
    expect(ellipsePath(100, 100, { start: 0, sweep: Math.PI, inner: .5 }).at(-1)).toEqual(["Z"]);
    expect(area({ ...full, sweep: -Math.PI })).toBeLessThan(0);
    expect(ellipsePath(NaN, Infinity, { start: NaN, sweep: NaN, inner: Infinity }).flat().filter(v => typeof v === "number").every(Number.isFinite)).toBe(true);
  });
  it("bounds browser path work for astronomical but finite wire dimensions", () => {
    const path = ellipsePath(1e308, 1e308, full); expect(path).toHaveLength(4097);
    expect(path.flat().filter(v => typeof v === "number").every(Number.isFinite)).toBe(true);
    const contours = flattenContours(path); expect(contours[0].length).toBeLessThan(70_000);
    expect(contours[0].every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
  it.each(["ellipse", "circle", "oval", "ELLIPSE"])("creates %s with native defaults and shared lenient parameters", type => {
    const e = new EditorEngine(); const id = String(e.execute("node.create", { type, width: "40px", height: "80", x: true, y: "invalid", name: 17, select: "false", parent: null, index: null }).id);
    expect(e.getSnapshot().document.nodes[id]).toMatchObject({ kind: "ellipse", width: 40, height: 80, x: 1, y: 0, name: "17", ...full });
    expect(e.getSnapshot().selection).toEqual([]);
    expect(e.execute("edit.undo")).toEqual({ undone: true }); expect(e.getSnapshot().document.nodes[id]).toBeUndefined();
  });
  it("clamps command arcs, retains start turns and treats percentage ratios like native fraction_of", () => {
    const { e, node } = fixture();
    e.execute("node.set", { props: { arcStart: "720", arcSweep: -500, arcInner: "1%" } });
    expect(node()).toMatchObject({ start: 2 * TAU, sweep: -TAU, inner: .01 });
    for (const [value, result] of [[50, .5], [1, .99], [-2, 0], [200, .99]] as const) { e.execute("node.set", { props: { arcInner: value } }); expect(node().inner).toBe(result); }
    const before = e.getSnapshot(); expect(() => e.execute("node.set", { props: { name: "bad", arcSweep: "bad" } })).toThrow(); expect(e.getSnapshot()).toBe(before);
    e.execute("shape.rectangle"); expect(() => e.execute("node.set", { props: { arcInner: .5 } })).toThrow("ellipses");
  });
  it("retains raw finite native radians/ratio, defaults omitted fields and rejects leaf children/nulls", async () => {
    const raw = JSON.parse(readFileSync(new URL("../fixtures/native-rectangle.json", import.meta.url), "utf8")); raw.nodes["2"].type = "ellipse";
    const decode = () => decodeFigcraft(new TextEncoder().encode(JSON.stringify(raw)));
    expect((await decode()).document.nodes["2"]).toMatchObject(full);
    Object.assign(raw.nodes["2"], { start: 22, sweep: -9, inner: 1.5 });
    const opened = await decode(), roundTrip = await decodeFigcraft(await encodeFigcraft(opened.document, opened.nextId));
    expect(roundTrip).toEqual(opened); expect(roundTrip.document.nodes["2"]).toMatchObject({ start: 22, sweep: -9, inner: 1.5 });
    for (const key of ["start", "sweep", "inner"]) { const saved = raw.nodes["2"][key]; raw.nodes["2"][key] = null; await expect(decode()).rejects.toThrow(); raw.nodes["2"][key] = saved; }
    raw.nodes["2"].children = [3]; await expect(decode()).rejects.toThrow("leaf");
  });
  it("hits the path and hole independently of box bounds and supports hierarchy/duplication/page copies", () => {
    const { e, id, node, doc } = fixture(); e.execute("node.set", { props: { arcInner: .5 } });
    expect(hitRectangle(doc(), { x: 1, y: 1 })).toBeUndefined(); expect(hitRectangle(doc(), { x: 50, y: 50 })).toBeUndefined(); expect(hitRectangle(doc(), { x: 90, y: 50 })).toBe(id);
    expect(shapePath(node())).toBe(shapePath(node()));
    e.execute("object.group"); e.execute("edit.duplicate"); e.execute("page.duplicate");
    expect(Object.values(doc().nodes).filter(n => n.kind === "ellipse")).toHaveLength(4);
    expect(() => e.execute("shape.rectangle", { parent: id })).toThrow("container");
  });
});
describe("native arc handle fixtures", () => {
  it("places and filters handles by screen size, selection and visibility", () => {
    const { e, id, doc } = fixture(); expect(arcHandles(doc(), [id], 1)[0].point.x).toBeCloseTo(90); expect(arcHandles(doc(), [id], 1)[0].point.y).toBeCloseTo(50);
    expect(arcHandles(doc(), [id], 4)[0].point.x).toBe(97.5); expect(arcHandles(doc(), [id], .3)).toEqual([]); expect(arcHandles(doc(), [id, id], 1)).toEqual([]);
    expect(arcHandlePoint(doc(), id, "sweep", full, NaN)?.x).toBe(90);
    for (const props of [{ locked: true }, { locked: false, visible: false }, { visible: true, width: 0 }]) { e.execute("node.set", { props }); expect(arcHandles(doc(), [id], 1)).toEqual([]); }
  });
  it("opens upwards to75%, previews outside root state and commits one undo", () => {
    const { e, id, doc, node, t } = fixture(); t.down({ x: 90, y: 50 }); let calls = 0; const off = e.subscribe(() => calls++);
    for (const deg of [-20, -60, -90]) t.move(point(deg), false);
    expect(calls).toBe(0); expect(node().sweep).toBe(TAU);
    expect((e.getRenderDocument().nodes[id] as EllipseNode).sweep).toBeCloseTo(1.5 * Math.PI); t.up(); off();
    expect(arcLabel(node(), "sweep")).toBe("Sweep 75%"); expect(arcHandles(doc(), [id], 1)).toHaveLength(3);
    e.execute("edit.undo"); expect(node().sweep).toBe(TAU);
  });
  it("crosses negative full sweep continuously and closes near the start", () => {
    const { doc, id } = fixture(); let a = full;
    for (const deg of [20, 60, 90]) a = dragArc(doc(), id, "sweep", a, point(deg), false, 1)!;
    expect(a.sweep).toBeCloseTo(-1.5 * Math.PI);
    for (const deg of [45, 10, 1]) a = dragArc(doc(), id, "sweep", a, point(deg), false, 1)!;
    expect(arcLabel(a, "sweep")).toBe("Sweep -100%");
    for (const deg of [-10, -45]) a = dragArc(doc(), id, "sweep", a, point(deg), false, 1)!;
    expect(a.sweep).toBeCloseTo(1.75 * Math.PI);
  });
  it("snaps sweep/start to15degrees and ratio to5percent, preserving sweep on start edit", () => {
    const { doc, id } = fixture(); let a = full;
    for (const deg of [-30, -50]) a = dragArc(doc(), id, "sweep", a, point(deg), true, 1)!;
    expect(a.sweep * 180 / Math.PI).toBeCloseTo(315);
    for (const deg of [40, 52]) a = dragArc(doc(), id, "start", a, point(deg), true, 1)!;
    expect(arcLabel(a, "start")).toBe("Start 45°"); expect(a.sweep * 180 / Math.PI).toBeCloseTo(315);
    for (const r of [20, 31]) a = dragArc(doc(), id, "ratio", a, point(120, r), true, 1)!;
    expect(arcLabel(a, "ratio")).toBe("Ratio 60%");
  });
  it("complements the arc when ratio enters its gap and keeps ratio on full rings", () => {
    const { e, id, doc } = fixture(); let a = { ...full, sweep: 1.5 * Math.PI };
    a = dragArc(doc(), id, "ratio", a, point(135, 25), false, 1)!; expect(a.inner).toBeCloseTo(.5);
    a = dragArc(doc(), id, "ratio", a, point(-45, 30), false, 1)!;
    expect(a.start).toBeCloseTo(1.5 * Math.PI); expect(a.sweep).toBeCloseTo(.5 * Math.PI); expect(a.inner).toBeCloseTo(.6);
    e.execute("node.set", { props: { arcInner: .5 } }); expect(arcHandles(doc(), [id], 1).map(h => h.handle)).toEqual(["sweep", "ratio"]);
  });
  it("uses rotated/flipped local geometry, zoom-aware picking and finite pointer guards", () => {
    const { e, id, doc } = fixture(); expect(hitArc(doc(), [id], { x: 80, y: 62 }, .5)).toBe("sweep"); expect(hitArc(doc(), [id], { x: 80, y: 62 }, 2)).toBeUndefined();
    e.execute("node.set", { props: { rotation: 30 } }); e.execute("object.flipH");
    expect(dragArc(doc(), id, "sweep", full, transformPoint(worldTransform(doc(), id), point(-90)), false, 1)?.sweep).toBeCloseTo(1.5 * Math.PI);
    for (const zoom of [NaN, Infinity, 0, -1]) expect(dragArc(doc(), id, "ratio", full, { x: 40, y: 40 }, false, zoom)?.inner).toBeGreaterThanOrEqual(0);
    for (const p of [{ x: NaN, y: 0 }, { x: Infinity, y: 0 }]) expect(dragArc(doc(), id, "sweep", full, p, false, 1)).toBeUndefined();
  });
  it("cancels changes and skips no-op click history, with Move-only editing", () => {
    const { e, doc, t } = fixture(); const before = doc(); t.down({ x: 90, y: 50 }); t.move(point(-90), false); t.cancel(); expect(doc()).toBe(before);
    t.down({ x: 90, y: 50 }); t.up(); expect(doc()).toBe(before); e.execute("edit.undo"); expect(Object.keys(doc().nodes)).toHaveLength(1);
    const f = fixture(); f.e.execute("tool.scale"); expect(f.t.down({ x: 90, y: 50 })).toBe(false);
  });
});
describe("shared native Rectangle/Ellipse drawing", () => {
  it.each(["rectangle", "ellipse"] as const)("previews %s with one ID/undo and returns to Move", kind => {
    const e = new EditorEngine(), t = new DrawInteraction(e, m => { throw new Error(m); }); e.execute(`tool.${kind}`);
    const before = e.getSnapshot(); t.down({ x: 100, y: 100 }); let calls = 0; const off = e.subscribe(() => calls++);
    t.move({ x: 150, y: 130 }, { ...mods, shiftKey: true, altKey: true }); t.move({ x: 160, y: 140 }, { ...mods, shiftKey: true, altKey: true });
    expect(calls).toBe(0); expect(e.getSnapshot()).toBe(before); expect(e.getRenderDocument().nodes["2"]).toMatchObject({ kind, x: 40, y: 40, width: 120, height: 120 });
    t.up({ x: 160, y: 140 }); off(); expect(e.getSnapshot().tool).toBe("move"); expect(e.getSnapshot().selection).toEqual(["2"]);
    e.execute("edit.undo"); expect(e.getSnapshot().document.nodes["2"]).toBeUndefined();
  });
  it("uses click defaults, restores cancelled IDs and creates inside a rotated Frame in page axes", () => {
    const e = new EditorEngine(), t = new DrawInteraction(e, m => { throw new Error(m); });
    const frame = String(e.execute("frame.create", { x: 100, y: 100, width: 400, height: 400, props: { rotation: 15 } }).id);
    e.execute("tool.ellipse"); t.down({ x: 200, y: 200 }); t.move({ x: 201, y: 201 }, { ...mods, altKey: true }); t.cancel();
    t.down({ x: 200, y: 200 }); t.up({ x: 200, y: 200 });
    const d = e.getSnapshot().document, id = e.getSnapshot().selection[0]; expect(id).toBe("3"); expect(d.nodes[id]).toMatchObject({ kind: "ellipse", parent: frame, width: 100, height: 100 });
    const matrix = worldTransform(d, id); expect(matrix[0]).toBeCloseTo(1); expect(matrix[1]).toBeCloseTo(0); expect(matrix[4]).toBeCloseTo(200); expect(matrix[5]).toBeCloseTo(200);
  });
  it("snaps endpoints to existing objects unless Control/Meta suppresses snapping", () => {
    const e = new EditorEngine(), t = new DrawInteraction(e, m => { throw new Error(m); }); e.execute("shape.rectangle", { x: 200, y: 100, width: 100, height: 100 }); e.execute("tool.ellipse");
    t.down({ x: 20, y: 20 }); t.move({ x: 198, y: 197 }, mods); expect(e.getRenderDocument().nodes["3"]).toMatchObject({ width: 180, height: 180 });
    t.move({ x: 198, y: 197 }, { ...mods, ctrlKey: true }); expect(e.getRenderDocument().nodes["3"]).toMatchObject({ width: 178, height: 177 }); t.cancel();
  });
});
