import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { autoLayoutSlot } from "../../src/engine/layout-navigation";
import type { FrameNode } from "../../src/engine/document";

function frame(engine: EditorEngine, layout: string, width: number, height: number, parent = "1") {
  const { id } = engine.execute("frame.create", { x: 0, y: 0, width, height, parent }) as { id: string };
  engine.execute("node.set", { id, layout, padding: 0, gap: 10, crossGap: 10 });
  return id;
}

function children(engine: EditorEngine, parent: string, count: number, width = 40) {
  return Array.from({ length: count }, () => {
    const { id } = engine.execute("shape.rectangle", { parent, width, height: 20, x: 0, y: 0 }) as { id: string };
    return id;
  });
}

function order(engine: EditorEngine, frameId: string) {
  return (engine.getSnapshot().document.nodes[frameId] as FrameNode).children;
}

it("moves a block past a placed sibling, keeps hidden and absolute slots, and skips undo at an edge", () => {
  const engine = new EditorEngine();
  const row = frame(engine, "horizontal", 400, 40);
  const [a, hidden, b, free, c] = children(engine, row, 5);
  engine.execute("node.set", { id: hidden, visible: false });
  engine.execute("node.set", { id: free, absolute: true });
  const before = engine.getSnapshot().document;
  engine.execute("transform.nudge", { ids: [a, b], dx: 1 });
  expect(order(engine, row)).toEqual([c, hidden, a, free, b]);
  engine.execute("transform.nudge", { ids: [a, b], dx: 1 });
  engine.execute("transform.nudge", { ids: [a, b], dy: 1 });
  engine.execute("edit.undo");
  expect(engine.getSnapshot().document).toBe(before);
});

it("selects the wrapped line under the pointer and moves the nearest item across rows", () => {
  const engine = new EditorEngine();
  const row = frame(engine, "horizontal", 160, 200);
  engine.execute("node.set", { id: row, wrap: true });
  const [a, b, c, d, e, f] = children(engine, row, 6);
  const doc = engine.getSnapshot().document;
  expect(autoLayoutSlot(doc, doc.nodes[row] as FrameNode, { x: 10, y: 35 }, new Set())).toEqual({
    index: 3,
    line: [-2, 30, -2, 50],
  });
  engine.execute("transform.nudge", { id: b, dy: 1 });
  expect(order(engine, row)).toEqual([a, c, d, e, b, f]);
  expect(engine.getSnapshot().document.nodes[b]).toMatchObject({ x: 50, y: 30 });
});

it("swaps anchored grid cells and pins an item moved into a vacant cell", () => {
  const engine = new EditorEngine();
  const grid = frame(engine, "grid", 200, 200);
  engine.execute("node.set", { id: grid, gridColumns: 2, gridRows: 2 });
  const [a, b] = children(engine, grid, 2);
  engine.execute("node.set", { id: a, gridColumn: 0, gridRow: 0 });
  engine.execute("node.set", { id: b, gridColumn: 1, gridRow: 0 });
  engine.execute("transform.nudge", { id: a, dx: 1 });
  expect(engine.getSnapshot().document.nodes[b]).toMatchObject({ childLayout: { gridColumn: 0, gridRow: 0 } });
  engine.execute("transform.nudge", { id: a, dy: 1 });
  expect(engine.getSnapshot().document.nodes[a]).toMatchObject({ childLayout: { gridColumn: 1, gridRow: 1 } });
});

it("moves to the matching position in a neighbouring nested frame in one undo step", () => {
  const engine = new EditorEngine();
  const column = frame(engine, "vertical", 300, 200);
  const top = frame(engine, "horizontal", 200, 40, column);
  const bottom = frame(engine, "horizontal", 200, 40, column);
  const [, selected] = children(engine, top, 3);
  const [a, b, c] = children(engine, bottom, 3);
  const before = engine.getSnapshot().document;
  engine.execute("transform.nudge", { id: selected, dy: 1 });
  expect(order(engine, bottom)).toEqual([a, selected, b, c]);
  engine.execute("edit.undo");
  expect(engine.getSnapshot().document).toBe(before);
});
