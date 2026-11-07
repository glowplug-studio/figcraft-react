import { describe, expect, it } from "vitest";
import { transformPoint } from "../../src/engine/affine";
import type { VectorNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { worldTransform } from "../../src/engine/hierarchy";
import type { MoveModifiers } from "../../src/engine/move-interaction";
import { DrawInteraction } from "../../src/engine/draw-interaction";
import { VectorInteraction } from "../../src/engine/vector-interaction";
import { VectorPointTargets } from "../../src/engine/vector-point-snap";

const plain: MoveModifiers = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
const cmd = { ...plain, metaKey: true };
function setup() {
  const e = new EditorEngine(), errors: string[] = [];
  e.execute("vector.create", { points: [[300, 0], [400, 100], [320, 60]], closed: true });
  const id = String(e.execute("shape.rectangle", { x: 0, y: 0, width: 100, height: 100 }).id);
  e.execute("vector.edit.begin"); e.execute("vector.edit.select", { vertices: [2] });
  const interaction = new VectorInteraction(e, m => errors.push(m));
  const point = () => { const d = e.getRenderDocument(); return transformPoint(worldTransform(d, id), (d.nodes[id] as VectorNode).network.vertices[2]); };
  return { e, id, errors, interaction, point };
}

describe("native vector point snapping", () => {
  it("snaps to other vectors' points and own segment midpoints, showing and clearing the marker", () => {
    const f = setup(); f.interaction.down({ x: 100, y: 100 }, plain); f.interaction.move({ x: 318, y: 62 }, plain);
    expect(f.point()).toEqual({ x: 320, y: 60 }); expect(f.interaction.overlay.guides).toContainEqual({ x0: 320, y0: 60, x1: 320, y1: 60 });
    f.interaction.up({ x: 318, y: 62 }); expect(f.interaction.overlay.guides).toEqual([]);
    f.e.execute("edit.undo"); f.interaction.down({ x: 100, y: 100 }, plain); f.interaction.move({ x: 52, y: 3 }, plain);
    expect(f.point()).toEqual({ x: 50, y: 0 }); f.interaction.cancel(); expect(f.point()).toEqual({ x: 100, y: 100 }); expect(f.errors).toEqual([]);
  });
  it("suppresses objects with Command while pixel snapping remains independently selectable", () => {
    const f = setup(); f.interaction.down({ x: 100, y: 100 }, plain); f.interaction.move({ x: 318.4, y: 62.3 }, cmd);
    expect(f.point()).toEqual({ x: 318, y: 62 }); expect(f.interaction.overlay.guides).toEqual([]); f.interaction.cancel();
    f.e.execute("view.snapPixel", { on: false }); f.interaction.down({ x: 100, y: 100 }, plain); f.interaction.move({ x: 318.4, y: 62.3 }, cmd);
    expect(f.point().x).toBeCloseTo(318.4, 9); expect(f.point().y).toBeCloseTo(62.3, 9); f.interaction.cancel();
    f.e.execute("view.snapObjects", { on: false }); f.interaction.down({ x: 100, y: 100 }, plain); f.interaction.move({ x: 318.4, y: 62.3 }, plain);
    expect(f.point().x).toBeCloseTo(318.4, 9); expect(f.errors).toEqual([]);
  });
  it("preserves a zero object correction instead of rounding that axis to a pixel", () => {
    const e = new EditorEngine(), t = new VectorPointTargets(e.getSnapshot().document, undefined, [], [], [{ x: 10.4, y: 50 }]);
    const result = t.snap([{ x: 10.4, y: -2.5 }], { x: 10.4, y: -2.5 }, 1, true, true);
    expect(result.correction).toEqual({ x: 0, y: -.5 });
    expect(t.snap([{ x: -2.5, y: -2.5 }], { x: -2.5, y: -2.5 }, 1, false, true).correction).toEqual({ x: -.5, y: -.5 });
  });
  it("keeps native target-first ties and derives guides after axis locking", () => {
    const e = new EditorEngine(), t = new VectorPointTargets(e.getSnapshot().document, undefined, [], [], [{ x: 10, y: 12 }, { x: 14, y: 16 }]);
    const result = t.snap([{ x: 12, y: 14 }], undefined, 1, true, false, true);
    expect(result.correction).toEqual({ x: -2, y: 0 });
    expect(result.guides).toContainEqual({ x0: 10, y0: 12, x1: 10, y1: 14 });
    expect(result.guides.some(g => g.y0 === g.y1)).toBe(false);
  });
  it("excludes moving points and their midpoints across layers, including hidden subtrees", () => {
    const f = setup(), other = String(f.e.execute("vector.create", { points: [[600, 200], [700, 300], [800, 200]] }).id);
    const frame = String(f.e.execute("frame.create", { x: 900, y: 0, props: { visible: false } }).id);
    f.e.execute("vector.create", { parent: frame, points: [[0, 0], [100, 100]] });
    const t = new VectorPointTargets(f.e.getSnapshot().document, f.id, [2], [{ id: other, vertices: [0] }]);
    expect(t.points).not.toContainEqual({ x: 100, y: 100 }); expect(t.points).not.toContainEqual({ x: 100, y: 50 });
    expect(t.points).not.toContainEqual({ x: 600, y: 200 }); expect(t.points).not.toContainEqual({ x: 650, y: 250 });
    expect(t.points).toContainEqual({ x: 750, y: 250 }); expect(t.points.some(p => p.x >= 900)).toBe(false);
  });
  it("uses page axes inside rotated frames and includes visible locked vectors", () => {
    const e = new EditorEngine(), parent = String(e.execute("frame.create", { x: 300, y: 400, props: { rotation: 30 } }).id);
    const id = String(e.execute("vector.create", { parent, points: [[0, 0], [100, 0]], props: { locked: true } }).id), d = e.getSnapshot().document;
    const t = new VectorPointTargets(d, id, []);
    expect(t.layers.space).toEqual([1, 0, 0, 1, 0, 0]); expect(t.points).toContainEqual(transformPoint(worldTransform(d, id), { x: 50, y: 0 }));
  });
  it("caps target points at 20,000 and moving candidates at 256 without changing tie order", () => {
    const e = new EditorEngine(), extra = Array.from({ length: 20_001 }, (_, i) => ({ x: i * 100, y: i * 100 }));
    const t = new VectorPointTargets(e.getSnapshot().document, undefined, [], [], extra); expect(t.points).toHaveLength(20_000);
    const small = new VectorPointTargets(e.getSnapshot().document, undefined, [], [], [{ x: 10, y: 10 }]);
    const points = Array.from({ length: 257 }, (_, i) => i === 256 ? { x: 9, y: 9 } : { x: -100, y: -100 });
    expect(small.snap(points, undefined, 1, true, false).correction).toEqual({ x: 0, y: 0 });
  });
  it("indexed nearest candidates match native target-first scanning across duplicate coordinates and ties", () => {
    const e = new EditorEngine(), extra = Array.from({ length: 400 }, (_, i) => ({ x: (i * 137 % 233) / 2, y: (i * 19 % 191) / 2 }));
    const t = new VectorPointTargets(e.getSnapshot().document, undefined, [], [], extra);
    for (let sample = 0; sample < 100; sample++) {
      const pts = Array.from({ length: 12 }, (_, i) => ({ x: (sample * 17 + i * 7) % 130 + .25, y: (sample * 13 + i * 23) % 115 + .25 }));
      const best = (axis: "x" | "y") => {
        let d: number | undefined;
        for (const target of extra) for (const p of pts) { const next = target[axis] - p[axis]; if (Math.abs(next) <= 5 && (d === undefined || Math.abs(next) < Math.abs(d))) d = next; }
        return d ?? 0;
      };
      expect(t.snap(pts, undefined, 1, true, false).correction).toEqual({ x: best("x"), y: best("y") });
    }
  });
  it("snaps handles against captured targets despite repeated vector refitting", () => {
    const f = setup(); f.e.execute("vector.edit.setHandle", { segment: 0, start: true, x: 30, y: 0, independent: true });
    f.e.execute("vector.edit.select", { vertices: [0] }); f.interaction.down({ x: 30, y: 0 }, plain);
    for (const p of [{ x: -10, y: -40 }, { x: -30, y: -60 }, { x: -50, y: -80 }]) f.interaction.move(p, plain);
    f.interaction.up({ x: -50, y: -80 });
    const d = f.e.getSnapshot().document, n = d.nodes[f.id] as VectorNode, v = n.network.vertices[0], h = n.network.segments[0].ta;
    expect(transformPoint(worldTransform(d, f.id), { x: v.x + h[0], y: v.y + h[1] })).toEqual({ x: -50, y: -80 }); expect(f.errors).toEqual([]);
  });
  it("view toggles preserve the document/history and remain through viewport updates", () => {
    const { e } = setup(), before = e.getSnapshot(); let changes = 0; e.subscribe(() => changes++);
    expect(e.execute("view.snapObjects")).toEqual({ on: false }); expect(e.execute("view.snapPixel", { on: false })).toEqual({ on: false });
    e.execute("view.set", { zoom: 2 }); e.execute("view.zoomFit");
    expect(e.getView()).toMatchObject({ snapObjects: false, snapPixel: false }); expect(e.getSnapshot()).toBe(before); expect(changes).toBe(0);
    expect(e.execute("view.snapPixel", { on: "yes" })).toEqual({ on: true });
  });
  it("the same view switches disable object and pixel snapping for shape drawing", () => {
    const e = new EditorEngine(), errors: string[] = [], draw = new DrawInteraction(e, m => errors.push(m));
    e.execute("shape.rectangle", { x: 100, y: 100, width: 100, height: 100 });
    e.execute("view.snapObjects", { on: false }); e.execute("view.snapPixel", { on: false }); e.execute("tool.rectangle");
    draw.down({ x: 10.2, y: 20.3 }); draw.move({ x: 98.4, y: 99.1 }, plain); draw.up({ x: 98.4, y: 99.1 });
    const n = e.getSnapshot().document.nodes[e.getSnapshot().selection[0]] as VectorNode;
    expect(n.x).toBeCloseTo(10.2, 9); expect(n.y).toBeCloseTo(20.3, 9); expect(n.width).toBeCloseTo(88.2, 9); expect(errors).toEqual([]);
  });
});
