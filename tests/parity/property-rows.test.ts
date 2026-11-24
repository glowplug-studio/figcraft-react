import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { rectanglePaints, type LayerNode } from "../../src/engine/document";
import { toCssHex } from "../../src/engine/colour";
import { paintColour } from "../../src/engine/solid-paint";
import { followIndex } from "../../src/engine/property-rows";

// Restates native crates/ui-egui/src/property_rows_tests.rs at bad07e44 (upstream 375a7b8a, 33ac1d14, 0ad70b95; #1494) through the
// engine's highlight, copy and paste; the browser case drives the rows, keys and system clipboard.
function setup() {
  const e = new EditorEngine();
  const rect = (x: number, fill: string) => {
    const id = String((e.execute("shape.rectangle", { x, y: 0, width: 40, height: 40 }) as { id: string }).id);
    e.execute("node.set", { id, props: { fill } });
    return id;
  };
  const a = rect(0, "#FF0000"), b = rect(100, "#00FF00");
  e.execute("stroke.add", { ids: [a], paint: { type: "solid", color: "#0000FF" } });
  e.execute("node.set", { id: a, props: { strokeWeight: 3 } });
  e.execute("effect.add", { ids: [a], type: "layerBlur" });
  e.execute("effect.add", { ids: [b], type: "dropShadow" });
  e.execute("select.set", { ids: [a] });
  const fills = (id: string) => rectanglePaints(e.getSnapshot().document.nodes[id] as LayerNode).map(p => p.type === "solid" ? toCssHex(paintColour(p)).slice(1) : p.type);
  const select = (id: string) => e.execute("select.set", { ids: [id] });
  const count = () => Object.keys(e.getSnapshot().document.nodes).length;
  return { e, a, b, fills, select, count };
}

it("a highlighted fill row copies with the keyboard, goes with the selection and pastes on top of another layer's fills in one undo step", () => {
  const { e, a, b, fills, select, count } = setup();
  e.highlightPropertyRow("fill", 0);
  expect(e.propertyRow()).toEqual({ kind: "fill", index: 0, ids: [a] });
  expect(e.copyPropertyRow(true)).toEqual({ text: "#FF0000" });
  expect(e.hasCopiedFill()).toBe(true);
  expect(e.hasCopiedLayers(), "the layers were not copied").toBe(false);
  select(b);
  expect(e.propertyRow(), "the highlight belonged to A").toBeUndefined();
  const layers = count();
  expect(e.pasteProperty("#FF0000")).toBe(true);
  expect(fills(b)).toEqual(["00FF00", "FF0000"]);
  expect(count(), "no layer was pasted").toBe(layers);
  expect(fills(a)).toEqual(["FF0000"]);
  e.execute("edit.undo");
  expect(fills(b)).toEqual(["00FF00"]);
});

it("a paste replaces the highlighted row of the target", () => {
  const { e, b, fills, select } = setup();
  e.highlightPropertyRow("fill", 0); e.copyPropertyRow(true);
  select(b); e.highlightPropertyRow("fill", 0);
  e.pasteProperty("#FF0000");
  expect(fills(b)).toEqual(["FF0000"]);
});

it("a stroke row copies its paint and settings; a copied stroke goes to the strokes with a fill row highlighted", () => {
  const { e, a, b, fills, select } = setup();
  e.highlightPropertyRow("stroke", 0); e.copyPropertyRow(true);
  select(b); e.highlightPropertyRow("fill", 0);
  e.pasteProperty("#0000FF");
  const doc = e.getSnapshot().document, na = doc.nodes[a] as LayerNode, nb = doc.nodes[b] as LayerNode;
  expect(nb.strokes).toEqual(na.strokes);
  expect(nb.stroke?.weight).toBe(3);
  expect(fills(b), "the fills are untouched").toEqual(["00FF00"]);
});

it("an effect row copies a marker and pastes its effect on top of the target's", () => {
  const { e, a, b, select } = setup();
  e.highlightPropertyRow("effect", 0);
  expect(e.copyPropertyRow(true)).toEqual({ text: "figcraft://clipboard/effect" });
  select(b); e.pasteProperty("figcraft://clipboard/effect");
  const doc = e.getSnapshot().document;
  expect(doc.nodes[b].effects).toHaveLength(2);
  expect(doc.nodes[b].effects?.[1]).toEqual(doc.nodes[a].effects?.[0]);
});

it("copied layers, another app's text, or a later layer copy leave the paste to the layers or the text", () => {
  const { e, a, b, select } = setup();
  expect(e.copyPropertyRow(true), "nothing highlighted").toBeUndefined();
  e.highlightPropertyRow("fill", 0); e.copyPropertyRow(true);
  select(b);
  expect(e.pasteProperty("Hello"), "the clipboard holds another app's text").toBe(false);
  select(a); e.execute("edit.copy");
  select(b);
  expect(e.pasteProperty("#FF0000"), "the layers were the last copy").toBe(false);
});

it("Escape lets the highlight go and keeps the selection; so does an undo that takes its paint away", () => {
  const { e, a } = setup();
  e.highlightPropertyRow("fill", 0);
  expect(e.clearPropertyRow()).toBe(true);
  expect(e.getSnapshot().selection).toEqual([a]);
  expect(e.clearPropertyRow(), "Escape then does what it does otherwise").toBe(false);
  e.execute("fill.add", { ids: [a] });
  e.highlightPropertyRow("fill", 1);
  e.execute("edit.undo");
  expect(e.propertyRow()).toBeUndefined();
});

it("the highlight follows its row when rows move or go", () => {
  expect(followIndex(1, 1, 3)).toBe(3);
  expect(followIndex(3, 0)).toBe(2);
  expect(followIndex(2, 2)).toBeUndefined();
  const { e, a } = setup();
  e.execute("fill.add", { ids: [a] }); e.execute("fill.add", { ids: [a] });
  e.highlightPropertyRow("fill", 0);
  e.execute("fill.move", { ids: [a], from: 0, to: 2 });
  expect(e.propertyRow()?.index, "moved with its paint").toBe(2);
  e.execute("stroke.remove", { ids: [a], index: 0 });
  expect(e.propertyRow()?.index, "another list's change leaves it").toBe(2);
  e.execute("fill.remove", { ids: [a], index: 0 });
  expect(e.propertyRow()?.index, "a paint under it went").toBe(1);
  e.execute("fill.remove", { ids: [a], index: 1 });
  expect(e.propertyRow(), "its paint went").toBeUndefined();
});

it("a paste onto several layers adds the fill to each in one undo step, or replaces their highlighted rows", () => {
  const { e, a, b, fills } = setup();
  e.highlightPropertyRow("fill", 0); e.copyPropertyRow(true);
  e.execute("node.set", { id: a, props: { fill: "#123456" } });
  e.execute("select.set", { ids: [a, b] });
  e.pasteProperty("#FF0000");
  expect([fills(a), fills(b)]).toEqual([["123456", "FF0000"], ["00FF00", "FF0000"]]);
  e.execute("edit.undo");
  expect([fills(a), fills(b)]).toEqual([["123456"], ["00FF00"]]);
  e.highlightPropertyRow("fill", 0);
  e.pasteProperty("#FF0000");
  expect([fills(a), fills(b)]).toEqual([["FF0000"], ["FF0000"]]);
});

it("an effect copied after a fill is what pastes; a property copy whose engine copy is gone pastes no stale layers", () => {
  const { e, a, b, select, count } = setup();
  e.highlightPropertyRow("fill", 0); e.copyPropertyRow(true);
  e.highlightPropertyRow("effect", 0); e.copyPropertyRow(true);
  select(b); e.pasteProperty("figcraft://clipboard/effect");
  expect(e.getSnapshot().document.nodes[b].effects).toHaveLength(2);
  // A layer copy first, then a fill copied from its row, then a stroke copied by a command: the fill is gone.
  select(a); e.execute("edit.copy");
  e.highlightPropertyRow("fill", 0); e.copyPropertyRow(true);
  e.execute("stroke.copy", { ids: [a], index: 0 });
  select(b);
  const layers = count();
  expect(e.pasteProperty("#FF0000"), "the paste is ours, with nothing to paste").toBe(true);
  expect(count()).toBe(layers);
});

it("a programmatic copy and paste of a row leave the system clipboard alone", () => {
  const { e, b, fills, select } = setup();
  e.highlightPropertyRow("fill", 0);
  expect(e.copyPropertyRow(false)).toEqual({ text: undefined });
  select(b);
  expect(e.pasteProperty("#FF0000"), "a user's paste: no mirror was written").toBe(false);
  expect(e.pasteProperty()).toBe(true);
  expect(fills(b)).toEqual(["00FF00", "FF0000"]);
});
