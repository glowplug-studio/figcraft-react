import { describe, expect, it } from "vitest";
import { transformPoint } from "../../src/engine/affine";
import type { VectorNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { worldTransform } from "../../src/engine/hierarchy";
import type { MoveModifiers } from "../../src/engine/move-interaction";
import { VectorInteraction } from "../../src/engine/vector-interaction";
import { hitVectorPointBox, shownVectorPointBox } from "../../src/engine/vector-point-transform";

const plain: MoveModifiers = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
const near = (p: { x: number; y: number }, x: number, y: number) => { expect(p.x).toBeCloseTo(x, 8); expect(p.y).toBeCloseTo(y, 8); };
function setup(path = "M0 0L100 0L100 100L0 100Z") {
  const e = new EditorEngine(), errors: string[] = [], id = String(e.execute("vector.create", { path }).id);
  e.execute("vector.edit.begin"); e.execute("vector.edit.selectAll");
  const interaction = new VectorInteraction(e, error => errors.push(error));
  const points = (target = id) => { const d = e.getRenderDocument(), n = d.nodes[target] as VectorNode; return n.network.vertices.map(v => transformPoint(worldTransform(d, target), v)); };
  const drag = (from: [number, number], to: [number, number], modifiers = plain) => {
    interaction.down({ x: from[0], y: from[1] }, modifiers); interaction.move({ x: to[0], y: to[1] }, modifiers); interaction.up({ x: to[0], y: to[1] }); expect(errors).toEqual([]);
  };
  return { e, errors, id, interaction, points, drag };
}

describe("native selected-point transform box gestures", () => {
  it("lets points and Bezier handles win, then corners, edges, segments and rotation zones", () => {
    const f = setup(), b = shownVectorPointBox(f.e.getSnapshot().document, f.e.getVectorEdit()!)!;
    expect(hitVectorPointBox(b, { kind: "vertex", index: 2 }, { x: 100, y: 100 }, 1)).toBeUndefined();
    expect(hitVectorPointBox(b, { kind: "handle", seg: 0, start: true }, { x: 100, y: 50 }, 1)).toBeUndefined();
    expect(hitVectorPointBox(b, { kind: "segment", seg: 1, t: .5 }, { x: 100, y: 50 }, 1)).toEqual({ kind: "handle", handle: { kind: "edge", index: 1 } });
    expect(hitVectorPointBox(b, undefined, { x: 110, y: -10 }, 1)).toEqual({ kind: "handle", handle: { kind: "rotate", index: 1 } });
    expect(hitVectorPointBox(b, { kind: "segment", seg: 0, t: .5 }, { x: 110, y: -10 }, 1)).toBeUndefined();
    expect(hitVectorPointBox(b, undefined, { x: 40, y: 60 }, 1)).toEqual({ kind: "inside" });
    f.e.execute("vector.edit.select", { segments: [0] }); const line = shownVectorPointBox(f.e.getSnapshot().document, f.e.getVectorEdit()!)!;
    expect(hitVectorPointBox(line, { kind: "segment", seg: 0, t: .5 }, { x: 50, y: 0 }, 1)).toBeUndefined();
  });
  it("scales an empty corner, with Shift proportions and Alt centre", () => {
    const f = setup("M0 0L50 0M0 50L0 0"), before = f.e.getSnapshot().document;
    f.drag([50, 50], [150, 120]); near(f.points()[1], 150, 0); near(f.points()[2], 0, 120);
    f.e.execute("edit.undo"); expect(f.e.getSnapshot().document).toBe(before);
    f.drag([50, 50], [150, 110], { ...plain, shiftKey: true }); near(f.points()[1], 150, 0); near(f.points()[2], 0, 150);
    f.e.execute("edit.undo");
    f.drag([50, 50], [60, 70], { ...plain, altKey: true }); near(f.points()[0], -10, -20); near(f.points()[1], 60, -20); near(f.points()[2], -10, 70);
  });
  it("drags a selected corner point without scaling its selection", () => {
    const f = setup(); f.e.execute("vector.edit.select", { vertices: [0, 1] });
    f.drag([100, 0], [130, 40]); near(f.points()[0], 30, 40); near(f.points()[1], 130, 40); near(f.points()[2], 100, 100);
  });
  it("scales an edge and its handles from the captured original without React notifications", () => {
    const f = setup(); f.e.execute("vector.edit.setHandle", { segment: 0, start: true, x: 20, y: 10, independent: true });
    const before = f.e.getSnapshot().document; let root = 0, chrome = 0;
    f.e.subscribe(() => root++); f.e.subscribeVectorEdit(() => chrome++);
    f.interaction.down({ x: 100, y: 50 }, plain); f.interaction.move({ x: 150, y: 50 }, plain); f.interaction.move({ x: 200, y: 50 }, plain);
    near(f.points()[1], 200, 0); expect((f.e.getRenderDocument().nodes[f.id] as VectorNode).network.segments[0].ta).toEqual([40, 10]);
    expect(root).toBe(0); expect(chrome).toBe(0); f.interaction.cancel(); expect(f.e.getSnapshot().document).toBe(before);
    f.drag([100, 50], [200, 50]); f.e.execute("edit.undo"); expect(f.e.getSnapshot().document).toBe(before);
  });
  it("rotates the points and preview box, including Shift 15-degree steps", () => {
    const f = setup(), before = f.e.getSnapshot().document;
    f.interaction.down({ x: 110, y: -10 }, plain); f.interaction.move({ x: 110, y: 110 }, plain);
    near(f.points()[1], 100, 100); near(f.interaction.overlay.box![0], 100, 0);
    f.interaction.up({ x: 110, y: 110 }); f.e.execute("edit.undo"); expect(f.e.getSnapshot().document).toBe(before);
    const angle = (-45 + 19) * Math.PI / 180, r = Math.hypot(60, 60);
    f.drag([110, -10], [50 + r * Math.cos(angle), 50 + r * Math.sin(angle)], { ...plain, shiftKey: true });
    const a = 15 * Math.PI / 180; near(f.points()[1], 50 + 50 * Math.cos(a) + 50 * Math.sin(a), 50 + 50 * Math.sin(a) - 50 * Math.cos(a));
  });
  it("moves from the interior, clears all points on click, and uses Shift for marquee", () => {
    const f = setup(); f.e.execute("vector.edit.select", { vertices: [0, 2] });
    f.drag([60, 40], [80, 50]); near(f.points()[0], 20, 10); near(f.points()[2], 120, 110); near(f.points()[1], 100, 0);
    f.e.execute("edit.undo"); f.interaction.down({ x: 60, y: 40 }, plain); f.interaction.up({ x: 60, y: 40 }); expect(f.e.getVectorEdit()?.vertices).toEqual([]);
    f.e.execute("vector.edit.select", { vertices: [0, 2] }); f.drag([110, 40], [65, -10], { ...plain, shiftKey: true });
    expect(f.e.getVectorEdit()?.vertices).toEqual([0, 2, 1]); near(f.points()[0], 0, 0);
  });
  it("transforms both differently rotated layers and moves across the gap between them", () => {
    const f = setup(), other = String(f.e.execute("shape.rectangle", { x: 200, y: 0, width: 100, height: 100, props: { rotation: 30 } }).id);
    // Native two_layers fixture disables snapping so this test measures only the affine mapping.
    f.e.execute("view.snapObjects", { on: false }); f.e.execute("view.snapPixel", { on: false });
    f.e.execute("node.set", { id: f.id, props: { rotation: -20 } }); f.e.execute("vector.edit.begin", { ids: [f.id, other] });
    f.e.execute("vector.edit.select", { vertices: [0, 2] }); f.e.execute("vector.edit.select", { id: other, vertices: [0, 1, 2, 3], add: true });
    const a = f.points(), b = f.points(other), doc = f.e.getSnapshot().document;
    f.drag([150, 50], [170, 60]); for (const i of [0, 2]) near(f.points()[i], a[i].x + 20, a[i].y + 10);
    for (let i = 0; i < 4; i++) near(f.points(other)[i], b[i].x + 20, b[i].y + 10);
    f.e.execute("edit.undo"); expect(f.e.getSnapshot().document).toBe(doc);
    const box = shownVectorPointBox(doc, f.e.getVectorEdit()!)!, x = box.frame[4], y = box.frame[5];
    f.drag([x + box.width, y + box.height], [x + box.width * 2, y + box.height]);
    for (const i of [0, 2]) near(f.points()[i], x + 2 * (a[i].x - x), a[i].y);
    for (let i = 0; i < 4; i++) near(f.points(other)[i], x + 2 * (b[i].x - x), b[i].y);
    f.e.execute("edit.undo"); expect(f.e.getSnapshot().document).toBe(doc);
    f.interaction.down({ x: 150, y: 50 }, plain); f.interaction.up({ x: 150, y: 50 });
    expect(f.e.getVectorEdit()?.vertices).toEqual([]); expect(f.e.getVectorEdit()?.others[0].vertices).toEqual([]);
  });
});
