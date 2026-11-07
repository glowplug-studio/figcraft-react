import { expect, it } from "vitest";
import type { VectorNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { VectorInteraction } from "../../src/engine/vector-interaction";
import { widthHandles, widthHit } from "../../src/engine/vector-width";
import { widthPointSides, widthProfileSidesAt } from "../../src/engine/width-profile";

const plain = { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };
function setup() {
  const e = new EditorEngine(), id = String(e.execute("vector.create", { points: [[0, 50], [100, 50]], closed: false }).id);
  e.execute("node.set", { id, props: { strokes: ["#000000"], strokeWeight: 10, strokeAlign: "center" } });
  e.execute("vector.edit.begin", { id }); e.execute("vector.edit.tool", { tool: "width" });
  const interaction = new VectorInteraction(e, message => { throw Error(message); });
  const edit = (p: Record<string, unknown>) => e.execute("vector.edit.widthPoint", p);
  const profile = () => (e.getRenderDocument().nodes[id] as VectorNode).stroke?.widthProfile;
  const sides = (i: number) => widthPointSides(profile()!.points[i]).map(v => Math.round(v * 1e8) / 1e8);
  const drag = (x: number, y: number, endX: number, endY: number, altKey = false) => {
    interaction.down({ x, y }, plain);
    interaction.move({ x: (x + endX) / 2, y: (y + endY) / 2 }, { ...plain, altKey });
    interaction.move({ x: endX, y: endY }, { ...plain, altKey }); interaction.up({ x: endX, y: endY });
  };
  return { e, id, edit, profile, sides, interaction, drag };
}

it("adds, interpolates, slides and removes native width points and their ephemeral selection", () => {
  const { e, edit, profile } = setup();
  expect(edit({ t: .25, width: 30 })).toEqual({ index: 1, points: 3 });
  edit({ index: 1, t: .75, scale: .5 });
  const expected = widthProfileSidesAt(profile()!, .5);
  edit({ t: .5 }); expect(profile()!.points[1].scale).toBeCloseTo(expected[0], 12);
  edit({ index: 1, t: 2 }); expect(profile()!.points[1].t).toBe(.75);
  expect(edit({ t: .75 })).toEqual({ index: 3, points: 5 });
  expect(e.execute("vector.edit.state").widthPoints).toHaveLength(5);
  for (const index of [4, 3, 2, 1, 0]) edit({ action: "remove", index });
  expect(profile()).toBeUndefined(); expect(e.execute("vector.edit.state").widthPoint).toBeNull();
  expect(() => edit({ action: "spin" })).toThrow("no width points");
  expect(() => edit({ action: "add" })).toThrow();
  e.execute("vector.edit.end"); expect(() => edit({ t: .5 })).toThrow();
});

it("preserves the other side, converts pixel widths, sanitises and rejects invalid indices atomically", () => {
  const { e, id, edit, profile, sides } = setup();
  edit({ t: .5, width: 40 }); edit({ index: 1, side: "RIGHT", width: 30 });
  expect(sides(1)).toEqual([4, 6]); edit({ t: .9, side: "right", width: 25 });
  expect(sides(2)[1]).toBe(5); edit({ index: 1, t: .3 }); expect(sides(1)).toEqual([4, 6]);
  edit({ index: 1, width: 20, scale: 3 }); expect(sides(1)).toEqual([3, 3]);
  const before = e.getSnapshot();
  for (const p of [{ index: -1 }, { index: .5 }, { index: 1e9 }, { index: 0, side: " left" }, { action: "spin" }]) expect(() => edit(p)).toThrow();
  expect(e.getSnapshot()).toBe(before);
  edit({ t: 1e300, scale: 1e300 }); expect(profile()!.points.at(-1)).toEqual({ t: 1, scale: 1000, bias: 0 });
  e.execute("node.set", { id, props: { widthProfile: Array.from({ length: 64 }, (_, i) => [i / 63, 1]) } });
  expect(edit({ t: 1 })).toEqual({ index: 64, points: 65 }); expect(profile()!.points).toHaveLength(64);
});

it("sizes and slides in one undo each, with screen-sized handles and page-space state", () => {
  const { e, id, profile, sides, drag, interaction } = setup(), depth = e.getUndoDepth();
  interaction.hover({ x: 50, y: 52 }); expect(interaction.overlay.widthHover).toEqual({ kind: "path", t: .5, side: "right" });
  drag(50, 50, 50, 70);
  expect(sides(1)).toEqual([4, 4]); expect(e.getUndoDepth()).toBe(depth + 1);
  expect(e.execute("vector.edit.state").widthPoint).toBe(1);
  expect(widthHandles(e.getRenderDocument(), id, 1)[1]).toEqual({ index: 1, at: [50, 50], sides: [[50,70],[50,30]], width: 40, oneSided: false });
  expect(widthHandles(e.getRenderDocument(), id, .25)[1].sides).toEqual([[50,82],[50,18]]);
  e.execute("edit.undo"); expect(profile()).toBeUndefined(); e.execute("edit.redo");
  drag(50, 50, 72, 51); expect(profile()!.points[1].t).toBeCloseTo(.72);
  expect(e.getUndoDepth()).toBe(depth + 2); e.execute("edit.undo"); expect(profile()!.points[1].t).toBe(.5);
});

it("sizes the grabbed side, clamps past the centre and follows the pointer side for a newly added point", () => {
  const { e, id, sides, edit, drag } = setup(); edit({ t: .5, width: 40 });
  expect(widthHit(e.getRenderDocument(), id, { x: 50, y: 70 }, 1)).toEqual({ kind: "handle", index: 1, side: "right" });
  drag(50, 70, 65, 80, true); expect(sides(1)).toEqual([4, 6]);
  drag(50, 80, 50, 30, true); expect(sides(1)).toEqual([4, 0]);
  drag(50, 30, 50, 40); expect(sides(1)).toEqual([2, 2]);
  const other = setup(); other.drag(50, 51, 50, 20, true); expect(other.sides(1)).toEqual([6, 1]);
});

it("keeps captured previews isolated, restores cancellation, commits clicks adding a point and ignores zero weight", () => {
  const { e, id, interaction, profile } = setup(), depth = e.getUndoDepth(), snapshot = e.getSnapshot();
  let roots = 0, panels = 0; e.subscribe(() => roots++); e.subscribeVectorEdit(() => panels++);
  interaction.down({ x: 50, y: 50 }, plain);
  for (let y = 51; y <= 79; y++) interaction.move({ x: 50, y }, { ...plain, altKey: y % 2 === 0 });
  expect(profile()!.points).toHaveLength(3); expect(roots).toBe(0); expect(panels).toBe(0);
  interaction.cancel(); expect(e.getSnapshot()).toBe(snapshot); expect(profile()).toBeUndefined(); expect(e.getUndoDepth()).toBe(depth);
  interaction.down({ x: 50, y: 50 }, plain); interaction.up({ x: 50, y: 50 });
  interaction.down({ x: 50, y: 50 }, plain); interaction.up({ x: 50, y: 50 });
  expect(e.getUndoDepth()).toBe(depth + 1); expect(e.getVectorEdit()?.widthPoint).toBe(1);
  interaction.down({ x: 200, y: 90 }, plain); interaction.up({ x: 200, y: 90 });
  expect(e.getVectorEdit()?.widthPoint).toBeUndefined();
  e.execute("node.set", { id, props: { strokeWeight: 0 } }); const before = e.getSnapshot();
  interaction.down({ x: 70, y: 50 }, plain); interaction.up({ x: 70, y: 50 });
  expect(e.getSnapshot()).toBe(before);
});

it("repeats points on compound paths using page-space normals, painted reach and the closest local subpath", () => {
  const e = new EditorEngine();
  const id = String(e.execute("vector.create", { path: "M0 0L100 0 M0 60L100 60" }).id);
  e.execute("node.set", { id, props: { strokeWeight: 20, widthProfile: [[.5, 1, 3]] } });
  const source = e.getRenderDocument(), node = source.nodes[id];
  if (node.kind !== "vector") throw Error("Expected a vector");
  const doc = { ...source, nodes: { ...source.nodes, [id]: { ...node, transform: [0, 2, -3, 0, 400, 100] as const } } };
  const handles = widthHandles(doc, id, 1);
  expect(handles.map(h => h.at)).toEqual([[400,200],[220,200]]);
  expect(handles[1]).toEqual({ index: 0, at: [220,200], sides: [[130,200],[250,200]], width: 40, oneSided: true });
  expect(widthHit(doc, id, { x: 130, y: 200 }, 1)).toEqual({ kind: "handle", index: 0, side: "right" });
  expect(widthHit(doc, id, { x: 219, y: 200 }, 1)).toEqual({ kind: "point", index: 0 });
  expect(widthHit(doc, id, { x: 160, y: 250 }, 1)).toEqual({ kind: "path", side: "right", t: .75 });
  expect(widthHit(doc, id, { x: 247, y: 250 }, 1)).toBeUndefined();
});
