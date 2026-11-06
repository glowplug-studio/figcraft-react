import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { MoveInteraction, type MoveModifiers } from "../../src/engine/move-interaction";
import { SnapTargets } from "../../src/engine/snapping";
import { dragParent, dropParent, marqueeSelection } from "../../src/engine/canvas-selection";
import { neighbourGuides, placeGuideLabels } from "../../src/engine/measurements";
import { boundsOf } from "../../src/engine/viewport";
import { transformPoint } from "../../src/engine/affine";
import { worldTransform } from "../../src/engine/hierarchy";
import type { Point, Rectangle } from "../../src/engine/geometry";
import { decodeFigcraft } from "../../src/engine/file-format";
import { hitRectangle } from "../../src/engine/selection";

const none: MoveModifiers = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
const alt = { ...none, altKey: true }, ctrl = { ...none, ctrlKey: true }, shift = { ...none, shiftKey: true };
const make = (e: EditorEngine, x = 0, y = 0, params: Record<string, unknown> = {}, frame = false) => String(e.execute(frame ? "frame.create" : "shape.rectangle", { x, y, width: 100, height: 100, ...params }).id);
const at = (e: EditorEngine, id: string) => boundsOf(e.getSnapshot().document, [id])!;
function fixture() { const engine = new EditorEngine(), errors: string[] = []; return { engine, errors, move: new MoveInteraction(engine, error => errors.push(error)) }; }
function drag(move: MoveInteraction, start: Point, end: Point, modifiers = none) { expect(move.down(start, modifiers)).toBe(true); move.move(end, modifiers); move.up(end, modifiers); }
function scene() {
  const f = fixture(), e = f.engine, frame = make(e, 0, 0, { width: 300, height: 200 }, true);
  const a = make(e, 20, 20, { parent: frame, width: 40, height: 40 }), b = make(e, 80, 20, { parent: frame, width: 40, height: 40 });
  const group = String(e.execute("object.group", { ids: [a, b] }).id), c = make(e, 20, 120, { parent: frame, width: 40, height: 40 }), outside = make(e, 400, 0, { width: 40, height: 40 });
  e.execute("select.none"); return { ...f, frame, group, a, b, c, outside };
}

describe("native free-layout move and marquee", () => {
  it("copies with Alt, snaps to its source and repeats its committed step", () => {
    const { engine: e, move, errors } = fixture(), a = make(e);
    drag(move, { x: 50, y: 50 }, { x: 250, y: 52 }, alt);
    const copy = e.getSnapshot().selection[0]; expect(copy).not.toBe(a); expect(at(e, copy)).toMatchObject({ x: 200, y: 0 }); expect(at(e, a)).toMatchObject({ x: 0, y: 0 });
    const next = (e.execute("edit.duplicate").ids as string[])[0]; expect(at(e, next)).toMatchObject({ x: 400, y: 0 }); expect(errors).toEqual([]);
  });
  it("Alt-copy snaps to equal gaps with the original and its neighbour", () => {
    const { engine: e, move } = fixture(); make(e); make(e, 200);
    drag(move, { x: 250, y: 50 }, { x: 448, y: 50 }, alt);
    expect(at(e, e.getSnapshot().selection[0])).toMatchObject({ x: 400, y: 0 });
  });
  it.each(["press", "mid-drag", "release"])("Alt enabled at %s copies without consuming preview IDs", when => {
    const { engine: e, move, errors } = fixture(), a = make(e);
    move.down({ x: 50, y: 50 }, when === "press" ? alt : none);
    move.move({ x: 150, y: 50 }, when === "release" ? none : alt);
    move.move({ x: 180, y: 50 }, when === "release" ? none : alt);
    move.up({ x: 180, y: 50 }, alt);
    expect(e.getSnapshot().selection).toEqual(["3"]); expect(at(e, a).x).toBe(0); expect(at(e, "3").x).toBe(130);
    expect(make(e, 500)).toBe("4"); expect(errors).toEqual([]);
  });
  it.each(["during", "release"])("releasing Alt %s restores and moves the original", when => {
    const { engine: e, move, errors } = fixture(), a = make(e);
    move.down({ x: 50, y: 50 }, alt); move.move({ x: 180, y: 50 }, alt);
    if (when === "during") move.move({ x: 180, y: 50 }, none);
    move.up({ x: 180, y: 50 }, none);
    expect(e.getSnapshot().selection).toEqual([a]); expect(at(e, a).x).toBe(130); expect(Object.keys(e.getSnapshot().document.nodes)).toHaveLength(2);
    expect(make(e)).toBe("3"); expect(errors).toEqual([]);
  });
  it("previews geometry and selection without root publication or native-save leakage", async () => {
    const { engine: e, move } = fixture(), a = make(e); let notifications = 0;
    move.down({ x: 50, y: 50 }, alt); const before = e.getSnapshot(); const stop = e.subscribe(() => notifications++);
    for (let i = 0; i < 20; i++) move.move({ x: 180 + i, y: 50 }, alt);
    expect(e.getSnapshot()).toBe(before); expect(e.getRenderSelection()).toEqual(["3"]); expect(e.getRenderDocument().nodes["3"]).toBeDefined(); expect(notifications).toBe(0);
    const saved = await decodeFigcraft(await e.nativeSnapshot()); expect(saved.document.nodes["3"]).toBeUndefined();
    move.cancel(); expect(e.getRenderSelection()).toEqual([a]); expect(e.getRenderDocument()).toBe(before.document); expect(notifications).toBe(0); stop();
    expect(make(e)).toBe("3");
  });
  it("commits exactly one history step and a return home adds none", () => {
    const { engine: e, move } = fixture(), a = make(e), before = e.getSnapshot().document;
    drag(move, { x: 50, y: 50 }, { x: 80, y: 70 }, ctrl); e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(before);
    e.execute("edit.redo"); expect(at(e, a)).toMatchObject({ x: 30, y: 20 });
    move.down({ x: 80, y: 70 }, ctrl); move.move({ x: 100, y: 80 }, ctrl); move.move({ x: 80, y: 70 }, ctrl); move.up({ x: 80, y: 70 }, ctrl);
    e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(before);
  });
  it("copy previews temporarily hide a custom rotation origin and cancellation restores it", () => {
    const { engine: e, move } = fixture(); make(e); e.execute("transform.rotationOrigin", { on: true }); e.execute("transform.setRotationOrigin", { x: 10, y: 10 });
    move.down({ x: 50, y: 50 }, alt); move.move({ x: 180, y: 50 }, alt); expect(e.getRotationOrigin().editing).toBe(false);
    move.move({ x: 180, y: 50 }, none); expect(e.getRotationOrigin()).toMatchObject({ editing: true, moved: true, point: { x: 140, y: 10 } });
    move.move({ x: 180, y: 50 }, alt); move.cancel(); expect(e.getRotationOrigin()).toMatchObject({ editing: true, moved: true, point: { x: 10, y: 10 } });
  });
  it("keeps a multiselection for dragging and narrows it only on a plain click", () => {
    const { engine: e, move } = fixture(), a = make(e), b = make(e, 200); e.execute("select.set", { ids: [a, b] });
    move.down({ x: 50, y: 50 }, none); expect(e.getSnapshot().selection).toEqual([a, b]); move.up({ x: 50, y: 50 }, none); expect(e.getSnapshot().selection).toEqual([a]);
    e.execute("select.set", { ids: [a, b] }); drag(move, { x: 50, y: 50 }, { x: 70, y: 60 });
    expect(e.getSnapshot().selection).toEqual([a, b]); expect(at(e, a)).toMatchObject({ x: 20, y: 10 }); expect(at(e, b)).toMatchObject({ x: 220, y: 10 });
  });
  it("Shift-click removal is deferred, while Shift-drag axis-locks and keeps selection", () => {
    const { engine: e, move } = fixture(), a = make(e), b = make(e, 200); e.execute("select.set", { ids: [a, b] });
    move.down({ x: 50, y: 50 }, shift); move.move({ x: 51, y: 51 }, shift); expect(e.getSnapshot().selection).toEqual([a, b]); move.up({ x: 51, y: 51 }, shift); expect(e.getSnapshot().selection).toEqual([b]);
    e.execute("select.set", { ids: [a, b] }); drag(move, { x: 50, y: 50 }, { x: 70, y: 60 }, shift);
    expect(e.getSnapshot().selection).toEqual([a, b]); expect(at(e, a)).toMatchObject({ x: 20, y: 0 }); expect(at(e, b)).toMatchObject({ x: 220, y: 0 });
  });
  it("locked selections and locked descendants remain still", () => {
    const { engine: e, move } = fixture(), a = make(e), b = make(e, 200, 0, { props: { locked: true } }); e.execute("select.set", { ids: [a, b] });
    drag(move, { x: 50, y: 50 }, { x: 70, y: 70 }, ctrl); expect(at(e, a)).toMatchObject({ x: 20, y: 20 }); expect(at(e, b).x).toBe(200);
    const frame = make(e, 400, 0, { width: 300, height: 200, props: { locked: true } }, true);
    const child = make(e, 20, 20, { parent: frame }); e.execute("select.set", { ids: [a, child] });
    drag(move, { x: 70, y: 70 }, { x: 90, y: 90 }, ctrl);
    expect(at(e, a)).toMatchObject({ x: 40, y: 40 }); expect(at(e, child)).toMatchObject({ x: 420, y: 20 });
  });
  it("retains an already-selected hidden layer through its own-box fallback but cannot newly hit it", () => {
    const { engine: e, move } = fixture(), a = make(e, 0, 0, { props: { visible: false } });
    drag(move, { x: 50, y: 50 }, { x: 50, y: 50 }); expect(e.getSnapshot().selection).toEqual([a]);
    drag(move, { x: 300, y: 300 }, { x: 300, y: 300 }); expect(e.getSnapshot().selection).toEqual([]);
    drag(move, { x: 50, y: 50 }, { x: 50, y: 50 }); expect(e.getSnapshot().selection).toEqual([]);
  });
  it("plain marquee requires full Frame coverage; primary marquee enters nested contents", () => {
    const { engine: e, move, frame, a, b, c, outside } = scene();
    drag(move, { x: -10, y: 10 }, { x: 500, y: 70 }); expect(e.getSnapshot().selection).toEqual([outside]);
    e.execute("select.none"); drag(move, { x: -10, y: 10 }, { x: 500, y: 70 }, ctrl); expect(new Set(e.getSnapshot().selection)).toEqual(new Set([a, b, outside]));
    e.execute("select.none"); drag(move, { x: -10, y: 10 }, { x: 100, y: 190 }, ctrl); expect(new Set(e.getSnapshot().selection)).toEqual(new Set([a, b, c]));
    e.execute("select.none"); drag(move, { x: -10, y: -10 }, { x: 310, y: 210 }); expect(e.getSnapshot().selection).toEqual([frame]);
  });
  it("Frame-background marquee stays inside that Frame and Shift toggles touched layers", () => {
    const { engine: e, move, group, outside } = scene();
    drag(move, { x: 200, y: 100 }, { x: 10, y: 10 }); expect(e.getSnapshot().selection).toEqual([group]);
    const other = make(e, 400, 100, { width: 40, height: 40 }); e.execute("select.set", { ids: [outside] });
    drag(move, { x: 370, y: -30 }, { x: 450, y: 150 }, shift); expect(e.getSnapshot().selection).toEqual([other]);
  });
  it("primary click selects a leaf and double-click enters a group one level", () => {
    const { engine: e, move, group, a } = scene();
    drag(move, { x: 30, y: 30 }, { x: 30, y: 30 }); expect(e.getSnapshot().selection).toEqual([group]);
    move.doubleClick({ x: 30, y: 30 }); expect(e.getSnapshot().selection).toEqual([a]);
    e.execute("select.none"); drag(move, { x: 30, y: 30 }, { x: 30, y: 30 }, ctrl); expect(e.getSnapshot().selection).toEqual([a]);
  });
  it("moves into and out of Frames preserving world geometry; group children stay in their group", () => {
    const { engine: e, move, errors } = fixture(), frame = make(e, 300, 0, { width: 300, height: 300 }, true), a = make(e);
    drag(move, { x: 50, y: 50 }, { x: 350, y: 50 }, ctrl); expect(e.getSnapshot().document.nodes[a].parent).toBe(frame); expect(at(e, a)).toMatchObject({ x: 300, y: 0 });
    drag(move, { x: 350, y: 50 }, { x: 700, y: 50 }, ctrl); expect(e.getSnapshot().document.nodes[a].parent).toBe("1"); expect(at(e, a).x).toBe(650);
    const b = make(e, 850), group = String(e.execute("object.group", { ids: [a, b] }).id); e.execute("select.set", { ids: [a] });
    drag(move, { x: 700, y: 50 }, { x: 350, y: 50 }, ctrl); expect(e.getSnapshot().document.nodes[a].parent).toBe(group); expect(at(e, a).x).toBeCloseTo(300); expect(errors).toEqual([]);
  });
  it("external context changes and undo cancel a move and stale release cannot commit", () => {
    for (const change of ["select.none", "page.add", "edit.undo", "access"] as const) {
      const { engine: e, move } = fixture(), a = make(e); move.down({ x: 50, y: 50 }, alt); move.move({ x: 180, y: 50 }, alt);
      if (change === "access") e.setEditable(false); else e.execute(change);
      move.up({ x: 180, y: 50 }, alt); expect(at(e, a).x).toBe(0); expect(e.getSnapshot().document.nodes["3"]?.kind).not.toBe("rectangle");
    }
  });
});

describe("source-derived snap, drop and measurement geometry", () => {
  it("uses local outline distance for rectangle hit tolerance, including corner misses", () => {
    const e = new EditorEngine(), id = make(e), doc = e.getSnapshot().document;
    expect(hitRectangle(doc, { x: -1.5, y: 50 }, true, [], 2)).toBe(id);
    expect(hitRectangle(doc, { x: -1.5, y: -1.5 }, true, [], 2)).toBeUndefined();
    expect(hitRectangle(doc, { x: -1, y: -1 }, true, [], 2)).toBe(id);
  });
  it("snaps nearest edges and centres, respects reach and keeps the first equal candidate", () => {
    const e = new EditorEngine(), a = make(e, 0, 0, { width: 10, height: 10 }); make(e, 100, 100, { width: 10, height: 10 });
    const t = new SnapTargets(e.getSnapshot().document, [a]);
    expect(t.snapMove({ x: 87, y: 0 }, 5).correction).toEqual({ x: 3, y: 0 });
    expect(t.snapMove({ x: 87, y: 0 }, 2).correction).toEqual({ x: 0, y: 0 });
    expect(t.snapMove({ x: 92.5, y: 0 }, 5).correction.x).toBe(2.5);
  });
  it("uses rotated parent axes for snap lines and pixel rounding", () => {
    const e = new EditorEngine(), frame = make(e, 0, 0, { width: 600, height: 600, props: { rotation: 30 } }, true);
    const a = make(e, 50, 50, { width: 40, height: 40, parent: frame }); make(e, 150, 50, { width: 40, height: 40, parent: frame });
    const world = worldTransform(e.getSnapshot().document, frame), t = new SnapTargets(e.getSnapshot().document, [a]);
    const vector = (x: number, y: number) => ({ x: world[0] * x + world[2] * y, y: world[1] * x + world[3] * y });
    const c = t.snapMove(vector(58, 2), 5).correction, expected = vector(2, -2);
    expect(c.x).toBeCloseTo(expected.x); expect(c.y).toBeCloseTo(expected.y);
    const rounded = t.roundMove(vector(10.4, -5.4)), wanted = vector(10, -5);
    expect(rounded.x).toBeCloseTo(wanted.x); expect(rounded.y).toBeCloseTo(wanted.y);
  });
  it("rounds negative pixel ties away from zero and excludes hidden siblings", () => {
    const e = new EditorEngine(), a = make(e, -10, -10, { width: 10, height: 10 }); make(e, 100, 0, { props: { visible: false } });
    const t = new SnapTargets(e.getSnapshot().document, [a]); expect(t.boxes).toHaveLength(0); expect(t.roundMove({ x: -0.5, y: 0.5 })).toEqual({ x: -1, y: 0 });
  });
  it("drop excludes moving branches and invisible/locked Frames and retains a rotated home", () => {
    const e = new EditorEngine(), frame = make(e, 0, 0, { props: { rotation: 30 } }, true), child = make(e, 10, 10, { width: 10, height: 10, parent: frame });
    const document = e.getSnapshot().document, p = transformPoint(worldTransform(document, frame), { x: 50, y: 50 });
    expect(dropParent(document, p, [frame])).toBeUndefined(); expect(dragParent(document, p, [child])).toBe(frame);
    e.execute("node.set", { id: frame, props: { locked: true } }); expect(dropParent(e.getSnapshot().document, p, [])).toBeUndefined();
  });
  it("marquee touches zero-sized bounds and excludes hidden/locked branches", () => {
    const e = new EditorEngine(), line = make(e, 10, 10, { width: 0, height: 100 }), hidden = make(e, 10, 10, { props: { visible: false } }), locked = make(e, 10, 10, { props: { locked: true } });
    expect(marqueeSelection(e.getSnapshot().document, { x: 0, y: 0, width: 10, height: 10 }, undefined, true, [], false)).toEqual([line]); expect([hidden, locked]).not.toContain(line);
  });
  it("measures nearest facing neighbours and parent edges", () => {
    const e = new EditorEngine(), frame = make(e, 0, 0, { width: 300, height: 200 }, true), a = make(e, 100, 50, { width: 40, height: 40, parent: frame });
    make(e, 20, 50, { width: 40, height: 40, parent: frame }); make(e, 200, 50, { width: 40, height: 40, parent: frame });
    expect(neighbourGuides(e.getSnapshot().document, [a]).map(g => g.label)).toEqual(["40", "60", "50", "110"]);
  });
  it("places labels on long lines, beside short lines and without crowded overlaps", () => {
    const lines = [{ a: { x: 0, y: 50 }, b: { x: 200, y: 50 }, width: 24, height: 14 }, { a: { x: 50, y: 0 }, b: { x: 50, y: 300 }, width: 24, height: 14 }];
    expect(placeGuideLabels(lines)).toEqual([{ x: 88, y: 43, width: 24, height: 14 }, { x: 38, y: 143, width: 24, height: 14 }]);
    const short = placeGuideLabels([{ ...lines[0], b: { x: 10, y: 50 } }]); expect(short[0].y).toBeGreaterThan(50);
    const crowd = placeGuideLabels(Array.from({ length: 100 }, (_, i) => ({ a: { x: 10, y: 10 }, b: { x: 10 + i % 2 * .5, y: 10 + i % 3 * .5 }, width: 24, height: 14 })));
    const overlaps = (a: Rectangle, b: Rectangle) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    expect(crowd.some((a, i) => crowd.slice(i + 1).some(b => overlaps(a, b)))).toBe(false);
  });
});
