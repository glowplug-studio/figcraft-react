import { expectSolid } from "../fixtures/expect-solid";
import { describe, expect, it } from "vitest";
import { EditorEngine, commandSpecs } from "../../src/engine/editor";
import type { LayerNode } from "../../src/engine/document";
import { solidPaint } from "../../src/engine/solid-paint";
import { fromRgba8 } from "../../src/engine/colour";

function fixture() {
  const e = new EditorEngine(), a = String(e.execute("shape.rectangle").id), b = String(e.execute("shape.line").id);
  e.execute("select.set", { ids: [a, b] });
  return { e, a, b, paints: (id: string) => (e.getSnapshot().document.nodes[id] as LayerNode).strokes ?? [] };
}
describe("native stroke list commands", () => {
  it("appends independently to mixed stacks, with one undo and native paint precedence", () => {
    const { e, a, b, paints } = fixture(), before = e.getSnapshot().document;
    e.execute("stroke.add", { paint: "red", color: "blue" });
    expect(paints(a)).toHaveLength(1); expect(paints(b)).toHaveLength(2); expect(expectSolid(paints(b)[1]).color.r).toBe(1);
    e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(before); e.execute("edit.redo"); expect(paints(b)).toHaveLength(2);
    e.execute("stroke.add", { ids: [a, a] }); expect(paints(a)).toHaveLength(3);
    expect(commandSpecs["stroke.add"]).toEqual({ label: "Add stroke", undo: true });
  });
  it("removes the top item by default and ignores missing positions", () => {
    const { e, a, b, paints } = fixture(); e.execute("stroke.add", { color: "red" }); e.execute("stroke.remove", { index: null });
    expect(paints(a)).toHaveLength(0); expect(paints(b)).toHaveLength(1);
    const before = e.getSnapshot().document; e.execute("stroke.remove", { index: 500 }); expect(e.getSnapshot().document).toBe(before);
    for (const index of [-1, 1.1, 1e9, "invalid"]) expect(() => e.execute("stroke.remove", { index })).toThrow();
  });
  it("reorders bottom-first indices and treats out-of-range or equal moves as no-ops", () => {
    const { e, a, paints } = fixture(); e.execute("stroke.add", { id: a, color: "red" }); e.execute("stroke.add", { id: a, color: "blue" });
    e.execute("stroke.move", { id: a, from: "0", to: "1" }); expect(expectSolid(paints(a)[1]).color.r).toBe(1);
    const before = e.getSnapshot().document;
    for (const [from, to] of [[1, 1], [7, 1], [0, 7]]) { e.execute("stroke.move", { from, to }); expect(e.getSnapshot().document).toBe(before); }
  });
  it("sets an empty stack, retains opacity for opaque colours and clears colour alpha on explicit opacity", () => {
    const { e, a, paints } = fixture(); e.execute("stroke.set", { id: a, color: "#ff000080" });
    expect(paints(a)[0].opacity).toBeCloseTo(128 / 255); expect(expectSolid(paints(a)[0]).colorAlpha).toBeCloseTo(128 / 255);
    e.execute("stroke.set", { id: a, color: "blue" }); expect(paints(a)[0].opacity).toBeCloseTo(128 / 255); expect(expectSolid(paints(a)[0]).color.b).toBe(1);
    e.execute("stroke.set", { id: a, opacity: "25%", visible: "off", blend: "Pass-through" });
    expect(paints(a)[0]).toMatchObject({ opacity: .25, colorAlpha: 1, visible: false, blend: "passThrough" });
    const before = e.getSnapshot().document; e.execute("stroke.set", { id: a, color: "nonsense", opacity: "bad", visible: "unknown", blend: "unknown" }); expect(e.getSnapshot().document).toBe(before);
  });
  it("applies paint, colour and metadata in native order, including numeric fraction coercion", () => {
    const { e, a, paints } = fixture(); e.execute("stroke.set", { id: a, paint: { ...solidPaint(fromRgba8(255, 0, 0)), opacity: .2 }, color: "blue", opacity: 50, visible: 1 });
    expect(paints(a)[0]).toMatchObject({ color: { r: 0, g: 0, b: 1 }, opacity: .5, colorAlpha: 1, visible: true });
  });
  it("refuses malformed targets, unsupported paints and later-target errors atomically", () => {
    const { e, a, b } = fixture(); e.execute("stroke.add", { id: b }); const before = e.getSnapshot();
    for (const params of [{ ids: [b, a], index: 1, color: "red" }, { ids: [] }, { ids: [a, "missing"] }, { ids: "bad" }, { paint: { type: "gradient" } }, { paint: {type:"solid",color:"red",blend:"unknownMode"} }]) {
      expect(() => e.execute("stroke.set", params)).toThrow(); expect(e.getSnapshot()).toBe(before);
    }
  });
});
