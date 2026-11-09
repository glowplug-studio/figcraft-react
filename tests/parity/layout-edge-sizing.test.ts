import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { TransformInteraction } from "../../src/engine/transform-interaction";
import { transformPoint } from "../../src/engine/affine";
import { worldTransform } from "../../src/engine/hierarchy";

const none = {altKey: false, ctrlKey: false, metaKey: false, shiftKey: false};
it.each([0, 31, -69])("hugs the rotated frame's local edge and fills its child's edge at %s degrees", rotation => {
  const engine = new EditorEngine();
  const transform = new TransformInteraction(engine, msg => { throw Error(msg); });
  engine.execute("view.zoom100");
  engine.execute("frame.create", {x: 10, y: 20, width: 400, height: 100, props: {rotation, layout: "horizontal", padding: 0, gap: 0}});
  engine.execute("shape.rectangle", {parent: 2, x: 0, y: 0, width: 100, height: 40});
  engine.execute("select.set", {id: 2});
  const initial = engine.getSnapshot().document;
  const point = (id: string, x: number, y: number) => transformPoint(worldTransform(engine.getSnapshot().document, id), {x,y});
  expect(transform.doubleClickEdge(point("2",400,50), {...none, shiftKey: true})).toBe(false);
  expect(transform.doubleClickEdge(point("2",400,50), none)).toBe(true);
  expect(engine.getSnapshot().document.nodes[2]).toMatchObject({width: 100, height: 100});
  engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(initial);
  expect(transform.doubleClickEdge(point("2",200,100), none)).toBe(true);
  expect(engine.getSnapshot().document.nodes[2]).toMatchObject({width: 400, height: 40});
  engine.execute("select.set", {id: 3});
  expect(transform.doubleClickEdge(point("3",100,20), none)).toBe(false);
  expect(transform.doubleClickEdge(point("3",100,20), {...none, altKey: true})).toBe(true);
  expect(engine.getSnapshot().document.nodes[3]).toMatchObject({width: 400, height: 40});
  engine.execute("node.set", {id: 3, absolute: true});
  expect(transform.doubleClickEdge(point("3",200,40), {...none, altKey: true})).toBe(false);
});
