import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { MoveInteraction } from "../../src/engine/move-interaction";
import { frameAt, dragParent } from "../../src/engine/canvas-selection";
import { boundsOf } from "../../src/engine/viewport";
import type { FrameNode } from "../../src/engine/document";

const modifiers = {shiftKey: false, ctrlKey: false, metaKey: false, altKey: false};
function scene(mode: string) {
  const engine = new EditorEngine();
  const move = new MoveInteraction(engine, message => { throw Error(message); });
  engine.execute("view.zoom100");
  engine.execute("frame.create", {x: 0, y: 0, width: 200, height: 200});
  for (let i = 0; i < 6; i++) engine.execute("shape.rectangle", {parent: 2, x: i*60, y: 0, width: 50, height: 30});
  engine.execute("node.set", {id: 2, layout: mode, wrap: true, padding: 0, gap: 10, crossGap: 10, gridColumns: 3, gridRows: 2});
  engine.execute("select.none");
  return {engine, move};
}

it("reorders wrapped rows in preview, cancels without saving, then commits one undo step", () => {
  const {engine, move} = scene("horizontal");
  const before = engine.getSnapshot().document;
  const start = {x: 25, y: 15}, end = {x: 125, y: 55};
  const order = () => (engine.getRenderDocument().nodes[2] as FrameNode).children;
  move.down(start, modifiers); move.move(end, modifiers);
  expect(order()).toEqual(["4","5","6","7","3","8"]);
  expect(engine.getSnapshot().document).toBe(before);
  move.cancel(); expect(engine.getRenderDocument()).toBe(before);
  move.down(start, modifiers); move.move(end, modifiers); move.up(end, modifiers);
  expect(order()).toEqual(["4","5","6","7","3","8"]);
  expect(boundsOf(engine.getSnapshot().document, ["3"])).toMatchObject({x: 60, y: 40});
  engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(before);
});

it("anchors the first moved grid child in the indicated cell and restores automatic placement on undo", () => {
  const {engine, move} = scene("grid");
  const before = engine.getSnapshot().document;
  const start = {x: 25, y: 15}, end = {x: 168, y: 150};
  move.down(start, modifiers); move.move(end, modifiers);
  expect(engine.getRenderDocument().nodes[3]).toMatchObject({childLayout: {gridColumn: 2, gridRow: 1}});
  move.up(end, modifiers);
  expect(engine.getSnapshot().document.nodes[3]).toMatchObject({childLayout: {gridColumn: 2, gridRow: 1}});
  engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(before);
});

it("places an Alt copy into the flow before reflow and discards it when Alt is released", () => {
  const {engine, move} = scene("horizontal");
  const start = {x: 25, y: 15}, end = {x: 125, y: 55};
  move.down(start, modifiers); move.move(end, {...modifiers, altKey: true});
  expect((engine.getRenderDocument().nodes[2] as FrameNode).children).toEqual(["3","4","5","6","7","9","8"]);
  expect(engine.getRenderSelection()).toEqual(["9"]);
  move.up(end, modifiers);
  expect(engine.getSnapshot().document.nodes[9]).toBeUndefined();
  expect(engine.getSnapshot().selection).toEqual(["3"]);
});

it("keeps an absolute item in its frame and distinguishes drawing inside a card from dropping beside it", () => {
  const {engine, move} = scene("horizontal");
  engine.execute("node.set", {id: 3, absolute: true, x: 100, y: 105});
  engine.execute("select.set", {ids: [3]});
  const end = {x: 420, y: 310};
  move.down({x: 120, y: 115}, modifiers); move.move(end, modifiers); move.up(end, modifiers);
  expect(engine.getSnapshot().document.nodes[3]).toMatchObject({parent: "2", x: 400, y: 300});
  engine.execute("frame.create", {parent: 2, width: 50, height: 30, x: 0, y: 0});
  const doc = engine.getSnapshot().document, box = boundsOf(doc, ["9"])!;
  const inside = {x: box.x + 10, y: box.y + 10};
  expect(frameAt(doc, inside, [])).toBe("9");
  expect(dragParent(doc, inside, ["5"])).toBe("2");
  expect(dragParent(doc, {x: 207, y: 50}, ["5"])).toBe("2");
  expect(dragParent(doc, {x: 209, y: 50}, ["5"])).toBe("1");
});
