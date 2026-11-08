import { describe, expect, it } from "vitest";
import { transformPoint } from "../../src/engine/affine";
import type { VectorNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { encodeFigcraft } from "../../src/engine/file-format";
import { base64Bytes } from "../../src/engine/recovery";
import { worldTransform } from "../../src/engine/hierarchy";
import type { MoveModifiers } from "../../src/engine/move-interaction";
import { MoveInteraction } from "../../src/engine/move-interaction";
import { networkIncident, networkMirroring } from "../../src/engine/vector-network";
import { VectorInteraction } from "../../src/engine/vector-interaction";

const plain: MoveModifiers = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
const alt = { ...plain, altKey: true }, shift = { ...plain, shiftKey: true };
function setup(path?: string) {
  const engine = new EditorEngine(), errors: string[] = [];
  const id = String(engine.execute(path ? "vector.create" : "shape.rectangle", path ? { path } : { x: 0, y: 0, width: 100, height: 100 }).id);
  engine.execute("vector.edit.begin", { id });
  const interaction = new VectorInteraction(engine, e => errors.push(e));
  const points = () => { const d = engine.getRenderDocument(), n = d.nodes[id] as VectorNode, w = worldTransform(d, id); return n.network.vertices.map(v => transformPoint(w, v)); };
  const net = () => (engine.getRenderDocument().nodes[id] as VectorNode).network;
  const click = (x: number, y: number, modifiers = plain) => { interaction.down({ x, y }, modifiers); interaction.up({ x, y }); };
  return { engine, interaction, id, errors, points, net, click };
}

describe("native point editing gestures", () => {
  it("double-click enters selected hollow shapes and retains every selected editable layer", () => {
    const e = new EditorEngine(), move = new MoveInteraction(e, message => { throw new Error(message); });
    const a = String(e.execute("shape.rectangle", { x: 0, y: 0, width: 100, height: 100, props: { fill: null, stroke: "black" } }).id);
    move.doubleClick({ x: 50, y: 50 }); expect(e.getVectorEdit()?.id).toBe(a); e.execute("vector.edit.end");
    const b = String(e.execute("shape.rectangle", { x: 200, y: 0, width: 100, height: 100 }).id);
    e.execute("select.set", { ids: [a, b] }); move.doubleClick({ x: 250, y: 50 });
    expect(e.getVectorEdit()?.id).toBe(b); expect(e.getVectorEdit()?.others.map(p => p.id)).toEqual([a]);
  });
  it("moves selected points from the captured origin, preserves click selection and commits one undo", () => {
    const f = setup(), before = f.engine.getSnapshot().document; let notifications = 0;
    f.engine.subscribe(() => notifications++);
    expect(f.interaction.down({ x: 0, y: 0 }, plain)).toBe(true);
    f.interaction.move({ x: -10, y: -20 }, plain); f.interaction.move({ x: -30, y: -40 }, plain);
    expect(f.points()[0]).toEqual({ x: -30, y: -40 }); expect(notifications).toBe(0);
    f.interaction.up({ x: -30, y: -40 }); expect(notifications).toBe(1);
    f.engine.execute("edit.undo"); expect(f.engine.getSnapshot().document).toBe(before); expect(f.errors).toEqual([]);
    f.interaction.down({ x: 0, y: 0 }, plain); f.interaction.move({ x: -30, y: -40 }, plain); f.interaction.cancel();
    expect(f.engine.getSnapshot().document).toBe(before); expect(f.engine.getVectorEdit()?.vertices).toEqual([0]);
  });
  it("applies screen movement threshold and Shift axis locking", () => {
    const f = setup(); f.engine.updateView({ ...f.engine.getView(), zoom: 2 });
    f.interaction.down({ x: 0, y: 0 }, plain); f.interaction.move({ x: .2, y: .2 }, plain);
    expect(f.points()[0]).toEqual({ x: 0, y: 0 });
    f.interaction.move({ x: -20, y: -10 }, shift); f.interaction.up({ x: -20, y: -10 });
    expect(f.points()[0]).toEqual({ x: -20, y: 0 }); expect(f.errors).toEqual([]);
  });
  it("inserts and drags an Alt point in one step without accumulating refit offsets", () => {
    // vectoredit/tests.rs::alt_click_adds_a_point_that_drags_in_the_same_gesture.
    const f = setup(), before = f.engine.getSnapshot().document;
    f.interaction.down({ x: 50, y: 0 }, alt); expect(f.net().vertices).toHaveLength(5);
    f.interaction.move({ x: 50, y: -10 }, plain); f.interaction.move({ x: 50, y: -20 }, plain); f.interaction.up({ x: 50, y: -20 });
    expect(f.points()[4]).toEqual({ x: 50, y: -20 }); expect(f.engine.getVectorEdit()?.vertices).toEqual([4]);
    f.engine.execute("edit.undo"); expect(f.engine.getSnapshot().document).toBe(before); expect(f.errors).toEqual([]);
  });
  it("shows and inserts successive midpoints, while off-midpoint clicks select segments", () => {
    const f = setup(); f.interaction.hover({ x: 30, y: 0 }, plain);
    expect(f.interaction.overlay.add).toEqual({ point: { x: 50, y: 0 }, on: false });
    f.click(30, 0); expect(f.net().vertices).toHaveLength(4); expect(f.engine.getVectorEdit()?.segments).toEqual([0]);
    f.click(50, 0); expect(f.net().vertices).toHaveLength(5); expect(f.points()[4]).toEqual({ x: 50, y: 0 });
    f.interaction.hover({ x: 25, y: 0 }, plain); expect(f.interaction.overlay.add).toEqual({ point: { x: 25, y: 0 }, on: true });
    f.click(25, 0); expect(f.net().vertices).toHaveLength(6); expect(f.points()[5]).toEqual({ x: 25, y: 0 });
    expect(f.errors).toEqual([]);
  });
  it("Shift toggles points and segments without adding midpoint vertices", () => {
    const f = setup(); f.click(0, 0); f.click(100, 0, shift); expect(f.engine.getVectorEdit()?.vertices).toEqual([0, 1]);
    f.click(0, 0, shift); expect(f.engine.getVectorEdit()?.vertices).toEqual([1]);
    f.click(50, 100, shift); expect(f.engine.getVectorEdit()?.segments).toEqual([2]); expect(f.net().vertices).toHaveLength(4);
    // With the top point still selected, the box's bottom edge takes priority over the segment.
    f.click(50, 100, shift); expect(f.engine.getVectorEdit()?.segments).toEqual([2]);
    f.engine.execute("vector.edit.select", { segments: [2] });
    f.click(50, 100, shift); expect(f.engine.getVectorEdit()?.segments).toEqual([]);
    expect(f.errors).toEqual([]);
  });
  it("smooths and sharpens a Bend click while leaving endpoints unchanged", () => {
    // Native #1875 a_bend_click_curves_a_sharp_point_between_its_neighbours.
    const f = setup("M0 0L50 30L100 0"); f.engine.execute("vector.edit.tool", { tool: "bend" });
    const before = f.engine.getSnapshot().document; f.click(50, 30);
    expect(networkMirroring(f.net(), 1)).toBe("angle");
    const reach = Math.hypot(50, 30) / 3;
    for (const [seg, start] of networkIncident(f.net(), 1)) {
      const h = start ? f.net().segments[seg].ta : f.net().segments[seg].tb; expect(Math.abs(h[0])).toBeCloseTo(reach, 9); expect(h[1]).toBeCloseTo(0, 9);
    }
    const smooth = f.engine.getSnapshot().document; f.click(0, 0); expect(f.engine.getSnapshot().document).toBe(smooth);
    f.click(50, 30); expect(f.net().segments.every(s => [...s.ta, ...s.tb].every(n => n === 0))).toBe(true);
    f.engine.execute("edit.undo"); expect(f.engine.getSnapshot().document).toBe(smooth);
    f.engine.execute("edit.undo"); expect(f.engine.getSnapshot().document).toBe(before); expect(f.errors).toEqual([]);
  });
  it("Bend drags handles and segments, including temporary Command bending", () => {
    const f = setup(), before = f.engine.getSnapshot().document;
    f.interaction.down({ x: 0, y: 50 }, { ...plain, metaKey: true });
    f.interaction.move({ x: -40, y: 50 }, plain); f.interaction.up({ x: -40, y: 50 });
    expect(f.net().segments.some(s => [...s.ta, ...s.tb].some(n => n !== 0))).toBe(true);
    f.engine.execute("edit.undo"); expect(f.engine.getSnapshot().document).toBe(before);
    f.engine.execute("vector.edit.tool", { tool: "bend" });
    f.interaction.down({ x: 0, y: 0 }, plain); f.interaction.move({ x: -20, y: 0 }, plain); f.interaction.up({ x: -20, y: 0 });
    expect(networkIncident(f.net(), 0).every(([seg, start]) => (start ? f.net().segments[seg].ta : f.net().segments[seg].tb).some(n => n !== 0))).toBe(true);
    expect(f.errors).toEqual([]);
  });
  it("moves selected handles from originals and Alt breaks mirroring", () => {
    const f = setup("M0 0C20 20 80 20 100 0C120 -20 180 -20 200 0");
    f.engine.execute("vector.edit.select", { vertices: [1], handles: [[0, false], [1, true]] });
    f.interaction.down({ x: 80, y: 20 }, alt); f.interaction.move({ x: 70, y: 30 }, plain); f.interaction.up({ x: 70, y: 30 });
    expect(f.net().segments[0].tb).toEqual([-30, 30]); expect(f.net().segments[1].ta).toEqual([10, -10]);
    expect(networkMirroring(f.net(), 1)).toBe("none"); expect(f.errors).toEqual([]);
  });
  it("marquees all edited layers, retains Shift points and activates a selected other layer", () => {
    const f = setup(), b = String(f.engine.execute("shape.rectangle", { x: 200, y: 0, width: 100, height: 100 }).id);
    f.engine.execute("vector.edit.begin", { ids: [f.id, b] });
    f.interaction.down({ x: 180, y: -20 }, plain); f.interaction.move({ x: 320, y: 120 }, plain); f.interaction.up({ x: 320, y: 120 });
    expect(f.engine.getVectorEdit()?.id).toBe(b); expect(f.engine.getVectorEdit()?.vertices).toEqual([0, 1, 2, 3]);
    f.interaction.down({ x: -20, y: -20 }, shift); f.interaction.move({ x: 20, y: 20 }, shift); f.interaction.up({ x: 20, y: 20 });
    expect(f.engine.getVectorEdit()?.vertices).toEqual([0, 1, 2, 3]); expect(f.engine.getVectorEdit()?.others[0].vertices).toEqual([0]);
    expect(f.errors).toEqual([]);
  });
  it("moves selected points across layers in page coordinates and merges a single dropped point", () => {
    const f = setup(), b = String(f.engine.execute("shape.rectangle", { x: 200, y: 0, width: 100, height: 100 }).id);
    f.engine.execute("vector.edit.begin", { ids: [f.id, b] }); f.engine.execute("vector.edit.select", { vertices: [0] });
    f.engine.execute("vector.edit.select", { id: b, vertices: [0], add: true });
    f.interaction.down({ x: 0, y: 0 }, plain); f.interaction.move({ x: -20, y: -30 }, plain); f.interaction.up({ x: -20, y: -30 });
    expect(f.points()[0]).toEqual({ x: -20, y: -30 });
    const d = f.engine.getSnapshot().document, n = d.nodes[b] as VectorNode;
    expect(transformPoint(worldTransform(d, b), n.network.vertices[0])).toEqual({ x: 180, y: -30 });
    f.engine.execute("vector.edit.select", { vertices: [0], id: f.id });
    f.interaction.down({ x: -20, y: -30 }, plain); f.interaction.move({ x: 98, y: 0 }, plain); f.interaction.up({ x: 98, y: 0 });
    expect(f.net().vertices).toHaveLength(3); expect(f.points()[0]).toEqual({ x: 100, y: 0 }); expect(f.errors).toEqual([]);
  });
  it("empty clicks clear points, empty double-clicks exit and distant-layer clicks request replay", () => {
    const f = setup(); f.click(0, 0); f.click(-10, 45); expect(f.engine.getVectorEdit()?.vertices).toEqual([]);
    expect(f.interaction.doubleClick({ x: 50, y: 50 })).toBe(true); expect(f.engine.getVectorEdit()).toBeUndefined();
    f.engine.execute("shape.rectangle", { x: 300, y: 0, width: 100, height: 100 }); f.engine.execute("vector.edit.begin", { id: f.id });
    f.interaction.down({ x: 350, y: 50 }, plain); expect(f.interaction.up({ x: 350, y: 50 })).toEqual({ x: 350, y: 50 });
    expect(f.engine.getVectorEdit()).toBeUndefined(); expect(f.errors).toEqual([]);
  });
});

describe("painted-region Move gestures", () => {
  it("gives the painted interior priority past the outline clearance and clears hover on exit or tool change", () => {
    const f = setup(), at = { x: 35, y: 3 };
    let published = 0;
    f.engine.subscribeVectorEdit(() => published++);
    f.interaction.hover(at, plain);
    expect(f.engine.execute("vector.edit.state").regionHover).toBe(0);
    expect(f.interaction.overlay.hover).toBeUndefined();
    f.interaction.hover(at, { ...plain, ctrlKey: true });
    expect(f.engine.execute("vector.edit.state").regionHover).toBeNull();
    f.interaction.hover(at, plain); f.interaction.hover(undefined);
    expect(f.engine.getVectorEdit()?.regionHover).toBeUndefined();
    expect(published).toBe(0);
    f.interaction.hover(at, plain);
    f.engine.execute("vector.edit.tool", { tool: "bend" });
    expect(f.engine.execute("vector.edit.state").regionHover).toBeNull();
  });
  it("invalidates hovered and selected regions when a command changes topology", () => {
    const f = setup(), at = { x: 40, y: 40 };
    f.click(at.x, at.y); f.interaction.hover(at, plain);
    expect(f.engine.getVectorEdit()?.regionHover).toBe(0);
    f.engine.execute("vector.edit.connect", { a: 0, b: 2 });
    const state = f.engine.getVectorEdit()!;
    expect(state.regionHover).toBeUndefined(); expect(state.regions).toEqual([]);
    expect(state.regionVertices).toEqual([]);
  });
  it("keeps independently selected vertices when Shift removes a region and records only movement in history", () => {
    const f = setup(), original = f.engine.getSnapshot().document, depth = f.engine.getUndoDepth();
    f.click(0, 0); f.click(40, 40, shift);
    expect(f.engine.getVectorEdit()?.regions).toEqual([0]);
    expect(f.engine.getVectorEdit()?.regionVertices).toEqual([1, 2, 3]);
    f.click(40, 40, shift);
    expect(f.engine.getVectorEdit()?.regions).toEqual([]);
    expect(f.engine.getVectorEdit()?.vertices).toEqual([0]);
    f.click(40, 40);
    expect(f.engine.getUndoDepth()).toBe(depth);
    for (const commit of [false, true]) {
      f.interaction.down({ x: 40, y: 40 }, plain); f.interaction.move({ x: 60, y: 70 }, plain);
      expect(f.points()[0]).toEqual({ x: 20, y: 30 });
      expect(f.engine.getRenderVectorEdit()?.regions).toEqual([0]);
      if (commit) f.interaction.up({ x: 60, y: 70 }); else f.interaction.cancel();
    }
    expect(f.engine.getUndoDepth()).toBe(depth + 1);
    f.engine.execute("edit.undo");
    expect(f.engine.getSnapshot().document).toBe(original);
    expect(f.errors).toEqual([]);
  });
});

describe("remaining native vector edit tools", () => {
  it("lassos across edited layers and activates the selected one without recording history", () => {
    const f = setup(), b = String(f.engine.execute("shape.rectangle", { x: 200, y: 0, width: 100, height: 100 }).id);
    f.engine.execute("vector.edit.begin", { ids: [f.id, b] }); f.engine.execute("vector.edit.tool", { tool: "lasso" });
    const depth = f.engine.getUndoDepth();
    f.interaction.down({ x: 190, y: -10 }, plain);
    for (const p of [{ x: 310, y: -10 }, { x: 310, y: 10 }, { x: 190, y: 10 }]) f.interaction.move(p, plain);
    expect(f.interaction.overlay.lasso).toHaveLength(4);
    f.interaction.up({ x: 190, y: 10 }); expect(f.interaction.overlay.lasso).toBeUndefined();
    expect(f.engine.getVectorEdit()).toMatchObject({ id: b, vertices: [0, 1], segments: [] });
    f.interaction.down({ x: 285, y: 90 }, shift);
    for (const p of [{ x: 310, y: 90 }, { x: 310, y: 110 }, { x: 285, y: 110 }]) f.interaction.move(p, shift);
    f.interaction.up({ x: 285, y: 110 });
    expect(f.engine.getVectorEdit()?.vertices).toEqual([0,1,2]);
    expect(f.engine.getUndoDepth()).toBe(depth); expect(f.errors).toEqual([]);
  });
  it("cuts across two sides into ordered editable sibling layers in one undo and restores exact geometry", () => {
    const f = setup(), original = f.engine.getSnapshot().document, depth = f.engine.getUndoDepth();
    f.engine.execute("vector.edit.tool", { tool: "cut" });
    f.interaction.down({ x: 50, y: -10 }, plain); f.interaction.move({ x: 50, y: 110 }, plain);
    expect(f.interaction.overlay.rubber).toEqual([{ x: 50, y: -10 }, { x: 50, y: 110 }]); expect(f.engine.getRenderDocument()).toBe(original);
    f.interaction.cancel(); expect(f.engine.getUndoDepth()).toBe(depth);
    f.interaction.down({ x: 50, y: -10 }, plain); f.interaction.up({ x: 50, y: 110 });
    const doc = f.engine.getSnapshot().document, parent = doc.nodes[doc.currentPage];
    if (parent.kind !== "page") throw Error("Expected page");
    expect(parent.children).toHaveLength(2); expect(parent.children[0]).toBe(f.id);
    const pieces = parent.children.map(id => doc.nodes[id] as VectorNode);
    expect(pieces.map(p => Math.round(p.width))).toEqual([50,50]);
    expect(pieces.map(p => Math.round(p.x))).toEqual([0,50]); expect(pieces[0].fill).toBe(pieces[1].fill);
    f.engine.execute("edit.undo"); expect(f.engine.getSnapshot().document).toBe(original);
    f.click(25, 0); expect(f.engine.getVectorEdit()?.vertices).toHaveLength(2);
    f.engine.execute("edit.undo"); f.click(0, 0); expect(f.engine.getVectorEdit()?.vertices).toHaveLength(2);
    expect(f.errors).toEqual([]);
  });
  it("rolls back an entire multi-piece cut when the second sibling cannot be allocated", async () => {
    const f = setup("M0 0H100 M0 50H100 M0 100H100");
    const maximum = "18446744073709551615";
    const data = base64Bytes(await encodeFigcraft(f.engine.getSnapshot().document, maximum));
    await f.engine.executeAsync("file.open", { data });
    f.engine.execute("vector.edit.begin", { id: f.id });
    const before = f.engine.getSnapshot().document, depth = f.engine.getUndoDepth(), state = f.engine.getVectorEdit();
    expect(() => f.engine.execute("vector.edit.cut", { from: [50, -10], to: [50, 110] })).toThrow("exhausted");
    expect(f.engine.getSnapshot().document).toBe(before);
    expect(f.engine.getVectorEdit()).toBe(state);
    expect(f.engine.getUndoDepth()).toBe(depth);
    f.engine.execute("vector.edit.end");
    expect(f.engine.execute("shape.rectangle").id).toBe(maximum);
  });
  it("erases at screen radius with interpolated drag stamps, atomic cancellation and page-space command radius", () => {
    const f = setup(), original = f.engine.getSnapshot().document, depth = f.engine.getUndoDepth();
    f.engine.execute("vector.edit.tool", { tool: "eraser" });
    f.interaction.hover({ x: 50, y: -5 }); expect(f.interaction.overlay.brush).toEqual({ x: 50, y: -5 });
    for (const commit of [false, true]) {
      f.interaction.down({ x: 50, y: -5 }, plain); f.interaction.move({ x: 50, y: 5 }, plain);
      expect(f.net().segments).toHaveLength(5);
      if (commit) f.interaction.up({ x: 50, y: 5 }); else f.interaction.cancel();
    }
    expect(f.engine.getUndoDepth()).toBe(depth + 1); f.engine.execute("edit.undo");
    expect(f.engine.getSnapshot().document).toBe(original);
    expect(f.engine.execute("vector.edit.erase", { points: [[100, 50]], radius: 5 })).toEqual({ changed: true });
    expect(f.engine.execute("vector.edit.erase", { points: [null, ["bad", 0], [1000,1000]] })).toEqual({ changed: false });
    expect(f.errors).toEqual([]);
  });
});
