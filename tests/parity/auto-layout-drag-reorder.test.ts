import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { boundsOf } from "../../src/engine/viewport";

// Restates native crates/engine/src/al_drag_tests.rs at bad07e44 (upstream cf567c3f, e415a3a0, #2142): three 60 x 60 rectangles in a
// row (or column), gap 20, at 0, 80 and 160 along the flow; one dragged by `by`, grabbed `grab` from its start edge.
function three(mode: "horizontal" | "vertical") {
  const e = new EditorEngine();
  const f = String((e.execute("frame.create", { x: 0, y: 0, width: 300, height: 300 }) as { id: string }).id);
  const kids = [0, 1, 2].map(() => String((e.execute("shape.rectangle", { x: 0, y: 0, width: 60, height: 60, parent: f }) as { id: string }).id));
  e.execute("layout.add", { ids: [f] });
  e.execute("node.set", { id: f, props: { layoutMode: mode, gap: 20, padding: 0, sizingH: "fixed", sizingV: "fixed" } });
  e.execute("select.none");
  return { e, f, kids };
}
function drag(e: EditorEngine, ids: string[], from: { x: number; y: number }, to: { x: number; y: number }) {
  e.beginInteraction();
  for (const t of [{ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, to]) {
    const delta = { x: t.x - from.x, y: t.y - from.y };
    e.previewMove(ids, delta, false, t, delta);
  }
  e.commitInteraction();
}
function draggedOrder(mode: "horizontal" | "vertical", which: number, grab: number, by: number) {
  const { e, f, kids } = three(mode), vertical = mode === "vertical";
  const b = boundsOf(e.getSnapshot().document, [kids[which]])!;
  const from = vertical ? { x: b.x + b.width / 2, y: b.y + grab } : { x: b.x + grab, y: b.y + b.height / 2 };
  drag(e, [kids[which]], from, vertical ? { x: from.x, y: from.y + by } : { x: from.x + by, y: from.y });
  return (e.getSnapshot().document.nodes[f] as { children: readonly string[] }).children.map(id => kids.indexOf(id));
}

it("a child dragged right passes a sibling when its leading edge reaches the sibling's middle, wherever it is grabbed", () => {
  for (const grab of [30, 10]) {
    expect([49, 50, 129, 130].map(by => draggedOrder("horizontal", 0, grab, by))).toEqual([[0, 1, 2], [1, 0, 2], [1, 0, 2], [1, 2, 0]]);
  }
});

it("a child dragged left passes a sibling by its left edge, the second one a pixel later", () => {
  expect([-49, -50, -129, -130].map(by => draggedOrder("horizontal", 2, 30, by))).toEqual([[0, 1, 2], [0, 2, 1], [0, 2, 1], [2, 0, 1]]);
});

it("a column reorders by the bottom edge and at the boundaries both ways", () => {
  expect([49, 50, 129, 130].map(by => draggedOrder("vertical", 0, 30, by))).toEqual([[0, 1, 2], [1, 0, 2], [1, 0, 2], [1, 2, 0]]);
  expect([-49, -50, -129, -130].map(by => draggedOrder("vertical", 2, 30, by))).toEqual([[0, 1, 2], [0, 2, 1], [0, 2, 1], [2, 0, 1]]);
});

it("a drag with no move along the flow keeps the slot", () => {
  expect(draggedOrder("horizontal", 1, 30, 0)).toEqual([0, 1, 2]);
  expect(draggedOrder("vertical", 1, 30, 0)).toEqual([0, 1, 2]);
  const { e, f, kids } = three("horizontal");
  const b = boundsOf(e.getSnapshot().document, [kids[1]])!, from = { x: b.x + 30, y: b.y + 30 };
  drag(e, [kids[1]], from, { x: from.x, y: from.y + 40 });
  expect((e.getSnapshot().document.nodes[f] as { children: readonly string[] }).children).toEqual(kids);
});

it("several dragged children use their combined box", () => {
  for (const [by, expected] of [[49, [0, 1, 2]], [50, [2, 0, 1]]] as const) {
    const { e, f, kids } = three("horizontal");
    e.execute("select.set", { ids: [kids[0], kids[1]] });
    const b = boundsOf(e.getSnapshot().document, [kids[0]])!, from = { x: b.x + 30, y: b.y + 30 };
    drag(e, [kids[0], kids[1]], from, { x: from.x + by, y: from.y });
    expect((e.getSnapshot().document.nodes[f] as { children: readonly string[] }).children.map(id => kids.indexOf(id)), "by " + by).toEqual(expected);
  }
});
