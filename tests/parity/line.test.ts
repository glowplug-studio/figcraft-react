import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { drawnLine } from "../../src/engine/geometry";
import { DrawInteraction } from "../../src/engine/draw-interaction";
import type { LineNode } from "../../src/engine/document";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import { worldTransform } from "../../src/engine/hierarchy";
import { transformPoint } from "../../src/engine/affine";
import { frameCorners, handleAt } from "../../src/engine/transform-handles";
import { previewResize, resizeStart } from "../../src/engine/transform-preview";
import { hitRectangle } from "../../src/engine/selection";
import { shapePath } from "../../src/engine/shape-path";

const mods = { shiftKey: false, altKey: false, ctrlKey: true, metaKey: false };
describe("native Line/Arrow creation and persistence", () => {
  it.each(["line", "arrow", "LINE", "ARROW"])("creates %s as a zero-height Line with native stroke defaults", async type => {
    const engine = new EditorEngine(), id = String(engine.execute("node.create", { type, height: 500 }).id), node = engine.getSnapshot().document.nodes[id] as LineNode;
    expect(node).toMatchObject({ kind: "line", name: type.toLowerCase() === "arrow" ? "Arrow" : "Line", width: 100, height: 0, fill: "transparent", stroke: { weight: 1, align: "center", capStart: "none", capEnd: type.toLowerCase() === "arrow" ? "lineArrow" : "none" } });
    expect(node.strokes).toHaveLength(1); expect(node.strokes?.[0].color).toMatchObject({ r: 0, g: 0, b: 0 });
    const document = engine.getSnapshot().document; expect((await decodeFigcraft(await encodeFigcraft(document))).document).toEqual(document);
    engine.execute("edit.undo"); expect(engine.getSnapshot().document.nodes[id]).toBeUndefined(); engine.execute("edit.redo"); expect(engine.getSnapshot().document).toBe(document);
  });
  it("retains a finite wire height while native Line geometry stays horizontal", async () => {
    const engine = new EditorEngine(), id = String(engine.execute("shape.line", { props: { height: 35 } }).id), document = engine.getSnapshot().document;
    expect(shapePath(document.nodes[id] as LineNode)).toEqual([["M", 0, 0], ["L", 100, 0]]);
    expect((await decodeFigcraft(await encodeFigcraft(document))).document.nodes[id]).toMatchObject({ height: 35 });
    expect(() => engine.execute("shape.line", { parent: id })).toThrow("container");
  });
  it("uses the native pick band regardless of dash gaps, caps or stroke visibility", () => {
    const engine = new EditorEngine(), id = String(engine.execute("shape.arrow", { props: { strokeWeight: 4, dashes: [10, 10] } }).id);
    expect(hitRectangle(engine.getSnapshot().document, { x: 10, y: 1 })).toBe(id);
    expect(hitRectangle(engine.getSnapshot().document, { x: 101.9, y: 1.9 })).toBe(id);
    expect(hitRectangle(engine.getSnapshot().document, { x: 50, y: 2.1 })).toBeUndefined();
    expect(hitRectangle(engine.getSnapshot().document, { x: 50, y: 4.9 }, false, [], 2)).toBe(id);
    engine.execute("node.set", { props: { stroke: null } }); expect(hitRectangle(engine.getSnapshot().document, { x: 10, y: 1 })).toBe(id);
  });
  it("selects only the outline of unfilled stroked shapes", () => {
    const engine = new EditorEngine(), id = String(engine.execute("shape.rectangle", { props: { fill: null, stroke: "black", strokeWeight: 2 } }).id);
    expect(hitRectangle(engine.getSnapshot().document, { x: 50, y: 50 })).toBeUndefined();
    expect(hitRectangle(engine.getSnapshot().document, { x: 50, y: -4.9 }, false, [], 2)).toBe(id);
    engine.execute("node.set", { props: { stroke: null } }); expect(hitRectangle(engine.getSnapshot().document, { x: 50, y: 50 })).toBe(id);
  });
});
describe("native Line drawing and endpoint editing", () => {
  it("rounds endpoints, snaps Shift to45 degrees and doubles around Alt origin", () => {
    const line = drawnLine({ x: 10.4, y: 20.4 }, { x: 40.4, y: 60.4 });
    expect(line).toMatchObject({ x: 10, y: 20, width: 50, height: 0 }); expect(line.angle).toBeCloseTo(Math.atan2(40, 30));
    const shift = drawnLine({ x: 10, y: 20 }, { x: 40, y: 60 }, true, true);
    expect(shift.width).toBeCloseTo(100); expect(shift.angle).toBeCloseTo(Math.PI / 4);
    expect(shift.x).toBeCloseTo(10 - 50 / Math.SQRT2); expect(shift.y).toBeCloseTo(20 - 50 / Math.SQRT2);
  });
  it.each(["line", "arrow"] as const)("draws %s through one undo transaction without root preview notifications", kind => {
    const engine = new EditorEngine(); engine.execute(`tool.${kind}`);
    const draw = new DrawInteraction(engine, message => { throw new Error(message); });
    expect(draw.down({ x: 10, y: 20 })).toBe(true);
    let notifications = 0; const off = engine.subscribe(() => notifications++);
    draw.move({ x: 40, y: 60 }, mods); expect(notifications).toBe(0); off();
    const doc = engine.getRenderDocument(), node = doc.nodes["2"] as LineNode;
    expect(node.width).toBeCloseTo(50); expect(node.height).toBe(0);
    const end = transformPoint(worldTransform(doc, "2"), { x: node.width, y: 0 }); expect(end.x).toBeCloseTo(40); expect(end.y).toBeCloseTo(60);
    draw.up({ x: 40, y: 60 }); expect(engine.getSnapshot().tool).toBe("move");
    engine.execute("edit.undo"); expect(engine.getSnapshot().document.nodes["2"]).toBeUndefined();
  });
  it("click-creates100×0, and cancellation restores the document", () => {
    const engine = new EditorEngine(); engine.execute("tool.arrow"); const draw = new DrawInteraction(engine, message => { throw new Error(message); });
    draw.down({ x: 12.5, y: 10.5 }); draw.up({ x: 12.5, y: 10.5 });
    expect(engine.getSnapshot().document.nodes["2"]).toMatchObject({ x: 13, y: 11, width: 100, height: 0 });
    engine.execute("tool.line"); const before = engine.getSnapshot().document; draw.down({ x: 100, y: 100 }); draw.move({ x: 160, y: 130 }, mods); draw.cancel(); expect(engine.getRenderDocument()).toBe(before);
  });
  it("offers two end handles with full reach, no middle edge and retained rotation zones", () => {
    const engine = new EditorEngine(), id = String(engine.execute("shape.line").id), start = resizeStart(engine.getSnapshot().document, [id], { kind: "corner", index: 1 })!;
    const c = frameCorners(start.frame);
    expect(handleAt(c, { x: 6, y: 4 }, 1, true)).toEqual({ kind: "corner", index: 0 });
    expect(handleAt(c, { x: 100, y: 4 }, 1, true)).toEqual({ kind: "corner", index: 1 });
    expect(handleAt(c, { x: 50, y: 0 }, 1, true)).toBeUndefined();
    expect(handleAt(c, { x: -12, y: 0 }, 1, true)?.kind).toBe("rotate");
  });
  it("moves either endpoint, ignores Alt centring and keeps nested world geometry", () => {
    const engine = new EditorEngine(), parent = String(engine.execute("frame.create", { x: 200, y: 100, props: { rotation: 20 } }).id);
    const id = String(engine.execute("shape.line", { parent, x: 10, y: 20 }).id), doc = engine.getSnapshot().document;
    for (const index of [0, 1]) {
      const start = resizeStart(doc, [id], { kind: "corner", index })!, point = { x: 220, y: 180 };
      const plain = previewResize(doc, start, point, false, false, false).document, centred = previewResize(doc, start, point, false, true, false).document;
      expect(centred).toEqual(plain); const node = plain.nodes[id] as LineNode;
      const moved = transformPoint(worldTransform(plain, id), { x: index ? node.width : 0, y: 0 }); expect(moved.x).toBeCloseTo(point.x); expect(moved.y).toBeCloseTo(point.y);
      const fixed = transformPoint(worldTransform(plain, id), { x: index ? 0 : node.width, y: 0 });
      const original = transformPoint(worldTransform(doc, id), { x: index ? 0 : 100, y: 0 }); expect(fixed.x).toBeCloseTo(original.x); expect(fixed.y).toBeCloseTo(original.y);
      expect(node.height).toBe(0);
    }
  });
});
