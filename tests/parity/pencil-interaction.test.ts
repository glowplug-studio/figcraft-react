import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import type { VectorNode } from "../../src/engine/document";
import { transformPoint } from "../../src/engine/affine";
import { worldTransform } from "../../src/engine/hierarchy";
import { decodeFigcraft } from "../../src/engine/file-format";
import { pencilPointerPressure } from "../../src/engine/pencil-samples";

const p = (x: number, y = 0) => ({ x, y });
function setup() { const engine = new EditorEngine(); engine.execute("tool.pencil"); return engine; }
function selected(engine: EditorEngine): VectorNode { return engine.getSnapshot().document.nodes[engine.getSnapshot().selection[0]] as VectorNode; }
describe("native Pencil stroke lifetime", () => {
  it("creates one selected open round black stroke on release with one undo and no React preview notifications", () => {
    const engine = setup(), before = engine.getSnapshot().document; let root = 0, panel = 0;
    engine.subscribe(() => root++); engine.subscribeVectorEdit(() => panel++);
    engine.pencil.down(p(10, 10)); engine.pencil.move(p(50, 50)); engine.pencil.move(p(100, 10));
    expect(engine.getRenderDocument()).toBe(before); expect(engine.getUndoDepth()).toBe(0); expect(root).toBe(0); expect(panel).toBe(0);
    engine.pencil.up(p(100, 10)); const node = selected(engine);
    expect(node).toMatchObject({ kind: "vector", fill: "transparent", stroke: { weight: 2, align: "center", capStart: "round", capEnd: "round", join: "round" } });
    expect(node.network.regions).toEqual([]); expect(node.network.vertices).toHaveLength(3); expect(engine.getUndoDepth()).toBe(1); expect(engine.getSnapshot().tool).toBe("pencil");
    engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(before); engine.execute("edit.redo"); expect(selected(engine)).toBe(node);
  });
  it("includes a release-only final position while a click or exact threshold produces no node", () => {
    const engine = setup(), before = engine.getSnapshot();
    engine.pencil.down(p(0)); engine.pencil.up(p(.5)); expect(engine.getSnapshot()).toBe(before);
    engine.pencil.down(p(0)); engine.pencil.up(p(20)); expect(selected(engine).width).toBe(20); expect(engine.getUndoDepth()).toBe(1);
  });
  it("matches the_pencil_records_pressure_and_its_brush and mouse-only follow-up", () => {
    const engine = setup(); engine.execute("tool.pencilBrush", { preset: "taper" });
    const position = (x: number) => p(x, 50 + Math.sin(x / 20) * 10);
    engine.pencil.down(position(0), .2);
    for (let i = 1; i <= 40; i++) engine.pencil.move(position(i * 5), .2 + .02 * i);
    engine.pencil.up(position(200), 1); const first = selected(engine);
    expect(first.stroke?.brush?.preset).toBe("taper"); expect(first.stroke?.widthProfile?.points[0].scale).toBeLessThan(.5); expect(first.stroke?.widthProfile?.points.at(-1)?.scale).toBeGreaterThan(1.9);
    engine.execute("tool.pencilBrush", { preset: null }); engine.pencil.down(p(0, 200)); engine.pencil.move(p(50, 220)); engine.pencil.up(p(100, 200));
    expect(selected(engine).stroke?.widthProfile).toBeUndefined(); expect(selected(engine).stroke?.brush).toBeUndefined(); expect(Object.keys(engine.getSnapshot().document.nodes)).toHaveLength(3);
  });
  it("preserves native brush preference reads, null clearing, ignored omitted-preset updates and atomic errors", () => {
    const engine = setup(), before = engine.getSnapshot(); expect(engine.execute("tool.pencilBrush")).toEqual({ brush: null });
    engine.execute("tool.pencilBrush", { preset: "dots", spacing: 3, seed: 12 }); const brush = engine.getPencilBrush();
    expect(engine.execute("tool.pencilBrush", { spacing: 4 })).toMatchObject({ brush: { preset: "dots", spacing: 3, seed: 12 } });
    expect(() => engine.execute("tool.pencilBrush", { preset: "invalid" })).toThrow(); expect(engine.getPencilBrush()).toBe(brush);
    expect(engine.execute("tool.pencilBrush", { unknown: 1 })).toMatchObject({ brush: { preset: "dots" } }); expect(engine.getSnapshot()).toBe(before); expect(engine.getUndoDepth()).toBe(0);
    engine.execute("tool.pencilBrush", { preset: null }); expect(engine.getPencilBrush()).toBeUndefined();
  });
  it("cancels on undo, tool changes and revocation without consuming earlier history", () => {
    const engine = setup(); engine.execute("shape.rectangle"); const before = engine.getSnapshot().document, depth = engine.getUndoDepth();
    for (const command of ["edit.undo", "tool.move", "tool.pencil"]) {
      engine.execute("tool.pencil"); engine.pencil.down(p(200)); engine.pencil.move(p(300)); engine.execute(command);
      expect(engine.pencil.active).toBe(false); expect(engine.interacting).toBe(false); expect(engine.getSnapshot().document).toBe(before); expect(engine.getUndoDepth()).toBe(depth);
    }
    engine.execute("tool.pencil"); engine.pencil.down(p(200)); engine.setEditable(false); expect(engine.pencil.active).toBe(false); expect(engine.getSnapshot().document).toBe(before);
  });
  it("preserves the stroke through view and tool preference commands", () => {
    const engine = setup(); engine.pencil.down(p(0)); engine.pencil.move(p(10));
    engine.execute("view.snapObjects", { on: false }); engine.execute("tool.scaleAnchor", { anchor: "c" }); engine.execute("tool.pencilBrush", { preset: "ink" });
    expect(engine.pencil.active).toBe(true); expect(engine.interacting).toBe(true); engine.pencil.up(p(20)); expect(selected(engine).stroke?.brush?.preset).toBe("ink");
  });
  it("uses the first point's rotated frame and preserves page-coordinate endpoints", () => {
    const engine = setup(), frame = String(engine.execute("frame.create", { x: 300, y: 200, width: 300, height: 200, props: { rotation: 30 } }).id);
    const world = worldTransform(engine.getSnapshot().document, frame), start = transformPoint(world, p(20, 30)), end = transformPoint(world, p(100, 40));
    engine.pencil.down(start); engine.pencil.up(end); const node = selected(engine); expect(node.parent).toBe(frame);
    const actual = transformPoint(worldTransform(engine.getSnapshot().document, node.id), node.network.vertices.at(-1)!);
    expect(actual.x).toBeCloseTo(end.x, 10); expect(actual.y).toBeCloseTo(end.y, 10);
  });
  it("retains native stroke geometry and pressure/brush data through file encoding", async () => {
    const engine = setup(); engine.execute("tool.pencilBrush", { preset: "stars", spacing: 2, scatter: .4, seed: 42 });
    engine.pencil.down(p(20, 30), .25); engine.pencil.move(p(40, 50), .5); engine.pencil.up(p(80, 20), 1);
    const node = selected(engine), recovered = await decodeFigcraft(await engine.nativeSnapshot()); expect(recovered.document.nodes[node.id]).toEqual(node);
  });
  it("clears malformed gestures atomically and leaves an invalid tool change uncommitted", () => {
    const engine = setup(), before = engine.getSnapshot(); engine.pencil.down(p(0)); engine.pencil.move(p(10));
    expect(() => engine.execute("tool.move", { invalid: true })).toThrow(); expect(engine.pencil.active).toBe(true);
    expect(() => engine.pencil.move(p(Infinity))).toThrow(/finite/); expect(engine.pencil.active).toBe(false); expect(engine.getSnapshot()).toBe(before);
    engine.pencil.down(p(-1e308)); expect(() => engine.pencil.up(p(1e308))).toThrow(/overflow/); expect(engine.getSnapshot()).toBe(before); expect(engine.interacting).toBe(false);
  });
  it("distinguishes mouse button pressure from pen/touch device pressure", () => {
    expect(pencilPointerPressure({ pointerType: "mouse", pressure: .5 })).toBeUndefined();
    expect(pencilPointerPressure({ pointerType: "", pressure: .5 })).toBeUndefined();
    expect(pencilPointerPressure({ pointerType: "pen", pressure: .25 })).toBe(.25); expect(pencilPointerPressure({ pointerType: "touch", pressure: 0 })).toBe(0);
  });
});
