import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { executeVectorEdit } from "../../src/engine/vector-edit-commands";
import { clearVectorSelection } from "../../src/engine/vector-edit";

function setup() {
  const engine = new EditorEngine(), id = String(engine.execute("vector.create", { points: [[0, 0], [100, 0], [100, 100]], closed: false }).id);
  engine.execute("vector.edit.begin", { id }); engine.execute("vector.edit.select", { vertices: [0] });
  return { engine, id };
}
function move(engine: EditorEngine, dx: number) {
  engine.previewVectorEdit((document, state) => {
    const result = executeVectorEdit("vector.edit.nudge", document, [state.id], state, { dx });
    return { document: result.document, state: result.state! };
  });
}

describe("vector preview transactions", () => {
  it("derives each frame from the base, publishes only to canvas and commits one undo item", () => {
    const { engine } = setup(), before = engine.getSnapshot(), selection = engine.getVectorEdit();
    let root = 0, chrome = 0, canvas = 0;
    engine.subscribe(() => root++); engine.subscribeVectorEdit(() => chrome++); engine.subscribeCanvas(() => canvas++);
    engine.beginInteraction(); move(engine, -10); move(engine, -20);
    expect(engine.getSnapshot()).toBe(before); expect(engine.getVectorEdit()).toBe(selection);
    expect(engine.getRenderDocument()).not.toBe(before.document);
    expect(root).toBe(0); expect(chrome).toBe(0); expect(canvas).toBe(2);
    expect(engine.commitInteraction()).toBe(true); expect(root).toBe(1); expect(chrome).toBe(1);
    const state = engine.execute("vector.edit.state") as { network: { vertices: { x: number }[] } };
    expect(state.network.vertices[1].x - state.network.vertices[0].x).toBe(120);
    engine.execute("edit.undo"); expect(engine.getSnapshot().document).toBe(before.document);
    engine.execute("edit.redo"); expect(engine.getSnapshot().document).not.toBe(before.document);
  });
  it("cancels geometry and preview selection while retaining the initial click selection", () => {
    const { engine } = setup(); engine.updateVectorSelection(s => ({ ...s, vertices: [1] }));
    const before = engine.getSnapshot(), state = engine.getVectorEdit(); engine.beginInteraction();
    engine.previewVectorEdit((document, s) => {
      const next = executeVectorEdit("vector.edit.addVertex", document, [s.id], s, { segment: 0, t: .5 });
      return { document: next.document, state: next.state! };
    });
    expect(engine.getRenderVectorEdit()?.vertices).toEqual([3]); expect(engine.getVectorEdit()).toBe(state);
    engine.cancelInteraction(); expect(engine.getRenderVectorEdit()).toBe(state); expect(engine.getSnapshot()).toBe(before);
  });
  it("commits marquee selection without content history or root notifications", () => {
    const { engine } = setup(), before = engine.getSnapshot(); let root = 0, chrome = 0;
    engine.subscribe(() => root++); engine.subscribeVectorEdit(() => chrome++);
    engine.beginInteraction(); engine.previewVectorEdit((document, state) => ({ document, state: { ...clearVectorSelection(state), vertices: [1, 2] } }));
    expect(engine.commitInteraction()).toBe(false); expect(engine.getSnapshot()).toBe(before);
    expect(engine.getVectorEdit()?.vertices).toEqual([1, 2]); expect(root).toBe(0); expect(chrome).toBe(1);
  });
  it("leaves the previous preview intact on failure and rejects invalid interaction states", () => {
    const { engine } = setup(); expect(() => move(engine, 10)).toThrow(/No active vector interaction/);
    engine.beginInteraction(); move(engine, 20); const document = engine.getRenderDocument(), state = engine.getRenderVectorEdit();
    expect(() => engine.updateVectorSelection(s => s)).toThrow(/No idle vector/);
    expect(() => engine.previewVectorEdit(() => { throw new Error("Failed geometry"); })).toThrow("Failed geometry");
    expect(engine.getRenderDocument()).toBe(document); expect(engine.getRenderVectorEdit()).toBe(state);
    engine.setEditable(false); expect(engine.interacting).toBe(false); expect(engine.getVectorEdit()).toBeUndefined();
    expect(() => engine.updateVectorSelection(s => s)).toThrow(/Sign in/);
  });
  it("returning to the original geometry adds no history and undo cancels an active preview", () => {
    const { engine } = setup(), before = engine.getSnapshot();
    engine.beginInteraction(); move(engine, -20); move(engine, 0); expect(engine.commitInteraction()).toBe(false);
    expect(engine.getSnapshot()).toBe(before);
    engine.beginInteraction(); move(engine, -20); engine.execute("edit.undo");
    expect(engine.getSnapshot()).toBe(before); expect(engine.interacting).toBe(false);
  });
});
