import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { TransformInteraction } from "../../src/engine/transform-interaction";
import { frameCorners, handleAt, handleCursor, resizedBox, scaleFactor, type Handle } from "../../src/engine/transform-handles";
import { previewResize, resizeStart } from "../../src/engine/transform-preview";
import { selectionFrame } from "../../src/engine/rotation";
import { transformPoint, rotationDegrees } from "../../src/engine/affine";
import { worldTransform } from "../../src/engine/hierarchy";
import { boundsOf } from "../../src/engine/viewport";
import { decodeFigcraft } from "../../src/engine/file-format";
import { scaleAbout } from "../../src/ScalePanel";
import type { Point } from "../../src/engine/geometry";
import { canvasAccent } from "../../src/engine/canvas-colours";
import { PointSnapCache } from "../../src/engine/snapping";

const none = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }, ctrl = { ...none, ctrlKey: true };
const corner = (index: number): Handle => ({ kind: "corner", index }), edge = (index: number): Handle => ({ kind: "edge", index });
const make = (e: EditorEngine, p: Record<string, unknown> = {}, frame = false) => String(e.execute(frame ? "frame.create" : "shape.rectangle", { x: 0, y: 0, width: 100, height: 50, ...p }).id);
const box = (e: EditorEngine, id: string) => boundsOf(e.getSnapshot().document, [id])!;
function fixture() { const e = new EditorEngine(), errors: string[] = [], interaction = new TransformInteraction(e, m => errors.push(m)); return { e, interaction, errors }; }
function drag(t: TransformInteraction, from: Point, to: Point, mods = ctrl) { expect(t.down(from)).toBe(true); t.move(to, mods); t.up(); }

describe("source-derived handle geometry", () => {
  const c = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }];
  it("selects the source theme's contrasting light/dark canvas greens", () => {
    const e = new EditorEngine(); expect(canvasAccent(e.getSnapshot().document)).toBe("#00875f");
    e.execute("page.setBackground", { color: "#000000" }); expect(canvasAccent(e.getSnapshot().document)).toBe("#02da96");
  });
  it("prioritises nearest corners, edges and outward rotation zones", () => {
    expect(handleAt(c, { x: 104, y: 4 }, 1)).toEqual(corner(1)); expect(handleAt(c, { x: 50, y: -4 }, 1)).toEqual(edge(0));
    expect(handleAt(c, { x: 110, y: -10 }, 1)).toEqual({ kind: "rotate", index: 1 }); expect(handleAt(c, { x: 50, y: 25 }, 1)).toBeUndefined();
    expect(handleAt(c, { x: 119, y: 0 }, 1)).toBeUndefined(); expect(handleAt(c, { x: 106, y: 0 }, 2)).toEqual({ kind: "rotate", index: 1 });
  });
  it("small boxes preserve their move centre and wide boxes keep diagonal corner cursors", () => {
    const tiny = c.map(p => ({ x: p.x / 10, y: p.y / 10 }));
    expect(handleAt(tiny, { x: 5, y: 2.5 }, 1)).toBeUndefined(); expect(handleAt(tiny, { x: -3, y: -3 }, 1)).toEqual(corner(0));
    expect(handleCursor(c.map(p => ({ x: p.x * 100, y: p.y })), corner(0))).toBe("nwse-resize"); expect(handleCursor(c, edge(0))).toBe("ns-resize");
  });
  it.each([[0, [-20, -10, 100, 50]], [1, [0, -10, -20, 50]], [2, [0, 0, -20, -10]], [3, [-20, 0, 100, -10]]] as const)("corner%d resizes only its sides and preserves crossings", (index, result) => {
    expect(resizedBox(corner(index), { x: -20, y: -10 }, 100, 50, false, false)).toEqual(result);
  });
  it("Shift and Alt use opposite-handle or centre anchors", () => {
    resizedBox(corner(2), { x: 150, y: 60 }, 100, 50, true, false).forEach((v, i) => expect(v).toBeCloseTo([0, 0, 150, 75][i]));
    resizedBox(edge(1), { x: 150, y: 999 }, 100, 50, true, false).forEach((v, i) => expect(v).toBeCloseTo([0, -12.5, 150, 62.5][i]));
    expect(resizedBox(corner(2), { x: 150, y: 75 }, 100, 50, false, true)).toEqual([-50, -25, 150, 75]);
  });
  it("Scale factor follows native anchor, fallback, centre, flips and limits", () => {
    expect(scaleFactor(corner(2), { x: 200, y: 60 }, 100, 50, "tl", false)).toEqual({ factor: 2, pivot: { x: 0, y: 0 } });
    expect(scaleFactor(corner(1), { x: 150, y: -25 }, 100, 50, "tl", false)).toEqual({ factor: 1.5, pivot: { x: 0, y: 50 } });
    expect(scaleFactor(edge(3), { x: -100, y: 0 }, 100, 50, "tl", false)).toEqual({ factor: 2, pivot: { x: 100, y: 25 } });
    expect(scaleFactor(corner(2), { x: 150, y: 75 }, 100, 50, "c", false)).toEqual({ factor: 2, pivot: { x: 50, y: 25 } });
    expect(scaleFactor(edge(2), { x: 0, y: 75 }, 100, 50, "tl", true)?.factor).toBe(2);
    expect(scaleFactor(corner(2), { x: -100, y: -50 }, 100, 50, "tl", false)?.factor).toBe(-1);
    expect(scaleFactor(corner(2), { x: 0, y: 0 }, 100, 50, "tl", false)?.factor).toBe(.01);
    expect(scaleFactor(corner(2), { x: 1e8, y: 1e8 }, 100, 50, "tl", false)?.factor).toBe(1000);
    expect(scaleFactor(corner(2), { x: 5, y: 5 }, 0, 0, "tl", false)).toBeUndefined();
    expect(scaleFactor(corner(2), { x: NaN, y: 5 }, 100, 50, "tl", false)).toBeUndefined();
  });
  it("numeric scale panel uses page bounds and its distinct100 limit", () => {
    const b = { x: 10, y: 20, width: 100, height: 50 };
    expect(scaleAbout(b, "c", .5)).toEqual({ factor: .5, pivot: { x: 60, y: 45 } });
    expect(scaleAbout(b, "br", 1e6)).toEqual({ factor: 100, pivot: { x: 110, y: 70 } });
    for (const k of [1, 0, -2, NaN, Infinity]) expect(scaleAbout(b, "tl", k)).toBeUndefined();
  });
  it("point snap cache refreshes changed siblings and parent axes but ignores moving geometry", () => {
    const e = new EditorEngine(), f = make(e, { width: 500, height: 500 }, true), a = make(e, { parent: f }), b = make(e, { parent: f, x: 200 });
    const cache = new PointSnapCache([a]), initial = cache.get(e.getSnapshot().document);
    e.execute("node.set", { id: a, props: { width: 150 } }); expect(cache.get(e.getSnapshot().document)).toBe(initial);
    e.execute("node.set", { id: b, props: { x: 300 } }); const changed = cache.get(e.getSnapshot().document); expect(changed).not.toBe(initial);
    expect(changed.snapPoint({ x: 298, y: 80 }, 5).point.x).toBe(300);
    e.execute("node.set", { id: f, props: { rotation: 30 } }); expect(cache.get(e.getSnapshot().document)).not.toBe(changed);
  });
});
describe("native resize, rotate and Scale gestures", () => {
  it("resizes a rotated layer in its own axes, with fixed opposite corner and one undo", () => {
    const { e, interaction: t, errors } = fixture(), id = make(e, { props: { rotation: 30 } }), before = e.getSnapshot().document, w = worldTransform(before, id);
    drag(t, transformPoint(w, { x: 100, y: 50 }), transformPoint(w, { x: 150, y: 80 }));
    const resized = e.getSnapshot().document.nodes[id]; if (resized.kind === "page") throw new Error("Expected layer"); expect(resized.width).toBeCloseTo(150); expect(resized.height).toBeCloseTo(80); expect(rotationDegrees(worldTransform(e.getSnapshot().document, id))).toBeCloseTo(30);
    const m = worldTransform(e.getSnapshot().document, id); expect(m[4]).toBeCloseTo(w[4]); expect(m[5]).toBeCloseTo(w[5]);
    e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(before); expect(errors).toEqual([]);
  });
  it("crossed edges flip and single layers never collapse below0.01", () => {
    const { e, interaction: t } = fixture(), id = make(e, { x: 300 }); drag(t, { x: 400, y: 25 }, { x: 260, y: 25 });
    expect(box(e, id)).toMatchObject({ x: 260, y: 0, width: 40, height: 50 }); expect(worldTransform(e.getSnapshot().document, id)[0]).toBe(-1);
    e.execute("edit.undo"); drag(t, { x: 400, y: 25 }, { x: 300, y: 25 }); expect(e.getSnapshot().document.nodes[id].kind !== "page" && e.getSnapshot().document.nodes[id]).toMatchObject({ width: .01 });
  });
  it("Frame constraints apply normally; primary resize retains child page geometry", () => {
    for (const preserve of [false, true]) {
      const { e, interaction: t } = fixture(), f = make(e, { width: 200, height: 100 }, true), child = make(e, { parent: f, x: 150, y: 60, width: 40, height: 30, props: { constraints: { horizontal: "right", vertical: "bottom" } } });
      e.execute("select.set", { ids: [f] }); drag(t, { x: 200, y: 100 }, { x: 300, y: 150 }, preserve ? ctrl : none);
      expect(box(e, child)).toMatchObject({ x: preserve ? 150 : 250, y: preserve ? 60 : 110, width: 40, height: 30 });
    }
  });
  it("multi-selection resize follows box centres and retains individual rotations", () => {
    const { e, interaction: t } = fixture(), a = make(e, { width: 50, height: 50 }), b = make(e, { x: 100, y: 50, width: 50, height: 50 }); e.execute("select.set", { ids: [a, b] });
    drag(t, { x: 150, y: 100 }, { x: 300, y: 150 }); expect(box(e, a)).toEqual({ x: 0, y: 0, width: 100, height: 75 }); expect(box(e, b)).toEqual({ x: 200, y: 75, width: 100, height: 75 });
    e.execute("edit.undo"); e.execute("node.set", { id: b, props: { rotation: 30 } }); const beforeAngle = rotationDegrees(worldTransform(e.getSnapshot().document, b)), frame = selectionFrame(e.getSnapshot().document, [a, b])!;
    drag(t, frameCorners(frame)[2], transformPoint(frame.matrix, { x: frame.width * 1.5, y: frame.height * 2 })); expect(rotationDegrees(worldTransform(e.getSnapshot().document, b))).toBeCloseTo(beforeAngle);
  });
  it("mixed90-degree selections resize and mirror with the native own-axis dimensions", () => {
    const { e, interaction: t } = fixture(), a = make(e), b = make(e, { x: 200, props: { rotation: 90 } }); e.execute("select.set", { ids: [a, b] });
    drag(t, { x: 275, y: 25 }, { x: 550, y: 25 });
    expect(box(e, a)).toMatchObject({ x: 0, y: 0, width: 200, height: 50 });
    const bounds = box(e, b); expect(bounds.x).toBeCloseTo(450); expect(bounds.y).toBeCloseTo(-25); expect(bounds.width).toBeCloseTo(100); expect(bounds.height).toBeCloseTo(100);
    expect(e.getSnapshot().document.nodes[b]).toMatchObject({ width: 100, height: 100 });
    e.execute("edit.undo"); drag(t, { x: 275, y: 25 }, { x: -275, y: 25 });
    expect(box(e, a)).toMatchObject({ x: -100, y: 0, width: 100, height: 50 }); expect(box(e, b).x).toBeCloseTo(-275); expect(box(e, b).width).toBeCloseTo(50);
  });
  it("Scale ignores constraints, retains live factor/pivot and scales descendants once", () => {
    const { e, interaction: t, errors } = fixture(), f = make(e, { width: 200, height: 100 }, true), child = make(e, { parent: f, x: 150, y: 60, width: 40, height: 30, props: { constraints: { horizontal: "right", vertical: "bottom" } } });
    e.execute("select.set", { ids: [f] }); e.execute("tool.scale"); expect(t.down({ x: 200, y: 100 })).toBe(true); t.move({ x: 300, y: 150 }, ctrl);
    expect(t.scaleHint).toEqual({ factor: 1.5, pivot: { x: 0, y: 0 } }); t.up(); expect(t.scaleHint).toBeUndefined();
    expect(box(e, child)).toMatchObject({ x: 225, y: 90, width: 60, height: 45 }); expect(errors).toEqual([]);
  });
  it("Scale centre anchors, Alt and crossed pivots match native fixtures", () => {
    const { e, interaction: t } = fixture(), id = make(e); e.execute("tool.scale"); e.execute("tool.scaleAnchor", { anchor: " C " });
    expect(e.execute("tool.scaleAnchor")).toEqual({ anchor: "c" }); drag(t, { x: 100, y: 50 }, { x: 150, y: 75 }); expect(box(e, id)).toEqual({ x: -50, y: -25, width: 200, height: 100 });
    e.execute("tool.scaleAnchor", { anchor: "tl" }); drag(t, { x: 150, y: 75 }, { x: 125, y: 62.5 }, { ...ctrl, altKey: true }); expect(box(e, id)).toEqual({ x: -25, y: -12.5, width: 150, height: 75 });
    e.execute("edit.undo"); e.execute("edit.undo"); drag(t, { x: 100, y: 50 }, { x: -100, y: -50 }); expect(box(e, id)).toEqual({ x: -100, y: -50, width: 100, height: 50 });
    expect(() => e.execute("tool.scaleAnchor", { anchor: "invalid" })).toThrow();
  });
  it("rotation handles turn freely or in15-degree steps about the custom origin", () => {
    for (const shift of [false, true]) {
      const { e, interaction: t } = fixture(), id = make(e, { y: 200, height: 100 }), centre = { x: 50, y: 250 }, from = { x: 110, y: 190 };
      const angle = Math.atan2(from.y - centre.y, from.x - centre.x) + 37 * Math.PI / 180;
      drag(t, from, { x: centre.x + Math.cos(angle) * 80, y: centre.y + Math.sin(angle) * 80 }, { ...ctrl, shiftKey: shift });
      expect(Math.abs(rotationDegrees(worldTransform(e.getSnapshot().document, id)))).toBeCloseTo(shift ? 30 : 37);
    }
    const { e, interaction: t } = fixture(), id = make(e); e.execute("transform.setRotationOrigin", { x: 0, y: 0 });
    drag(t, { x: 110, y: -10 }, { x: 10, y: 110 }); const w = worldTransform(e.getSnapshot().document, id); expect(w[4]).toBeCloseTo(0); expect(w[5]).toBeCloseTo(0);
  });
  it("proportion lock affects pointer and single-axis properties, round-trips and rejects invalid values", async () => {
    const { e, interaction: t } = fixture(), id = make(e); e.execute("node.set", { props: { constrainProportions: true } }); e.execute("node.set", { props: { width: 200 } });
    expect(e.getSnapshot().document.nodes[id]).toMatchObject({ width: 200, height: 100 }); e.execute("node.set", { props: { width: 100, height: 50 } });
    drag(t, { x: 100, y: 50 }, { x: 150, y: 60 }); expect(e.getSnapshot().document.nodes[id]).toMatchObject({ width: 150, height: 75 });
    const saved = await decodeFigcraft(await e.nativeSnapshot()); expect(saved.document.nodes[id]).toMatchObject({ constrainProportions: true });
    expect(() => e.execute("node.set", { props: { constrainProportions: "yes" } })).toThrow();
    e.execute("node.set", { props: { constrainProportions: false, width: 300 } }); expect(e.getSnapshot().document.nodes[id]).toMatchObject({ width: 300, height: 150, constrainProportions: false });
  });
  it("slop, cancellation and no-op release preserve history without root preview notifications", () => {
    const { e, interaction: t } = fixture(); make(e); const before = e.getSnapshot().document; let notifications = 0; e.subscribe(() => notifications++);
    t.down({ x: 100, y: 50 }); t.move({ x: 101, y: 51 }, ctrl); t.up(); expect(e.getSnapshot().document).toBe(before);
    t.down({ x: 100, y: 50 }); t.move({ x: 160, y: 80 }, ctrl); expect(notifications).toBe(0); expect(e.getSnapshot().document).toBe(before); t.cancel(); expect(e.getRenderDocument()).toBe(before);
    t.down({ x: 100, y: 50 }); t.move({ x: 160, y: 80 }, ctrl); e.execute("select.none"); t.up(); expect(e.getSnapshot().document).toBe(before);
  });
  it("locked ancestors remove handles and invalid previews leave the committed source intact", () => {
    const { e, interaction: t } = fixture(), f = make(e, { width: 300, height: 200, props: { locked: true } }, true), id = make(e, { parent: f });
    expect(t.down({ x: 100, y: 50 })).toBe(false); e.execute("node.set", { id: f, props: { locked: false } }); const doc = e.getSnapshot().document, start = resizeStart(doc, [id], corner(2))!;
    expect(() => previewResize(doc, start, { x: Infinity, y: 0 }, false, false, false)).toThrow(); expect(e.getSnapshot().document).toBe(doc);
  });
});
