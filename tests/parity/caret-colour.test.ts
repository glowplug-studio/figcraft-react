import { beforeAll, expect, it } from "vitest";
import { prepareText } from "../../src/engine/text-node-layout";
import { EditorEngine } from "../../src/engine/editor";
import { caretFallback, caretFill } from "../../src/engine/caret-colour";
import type { TextNode } from "../../src/engine/document";

// Restates native crates/ui-egui/src/canvas/overlays.rs `caret_tests` at bad07e44 (upstream 2beec8b3, 06d03a54, 3cdc5f7e,
// 6920ea63, e3701d85; #2156, #2190, #2163).
beforeAll(async () => { await prepareText("Caret ab cd x"); });
function text(chars = "Caret") {
  const engine = new EditorEngine(), id = String((engine.execute("text.create", { text: chars, x: 0, y: 0 }) as { id: string }).id);
  const node = () => engine.getSnapshot().document.nodes[id] as TextNode;
  return { engine, id, node };
}
const rgb = (c: { r: number; g: number; b: number; a: number } | undefined) => c && [c.r, c.g, c.b, c.a].map(v => Math.round(v * 255));

it("red text has a red caret, and light grey text keeps its own colour whatever is behind it", () => {
  const { engine, id, node } = text();
  engine.execute("node.set", { id, props: { fill: "#FF0000" } });
  expect(rgb(caretFill(node(), 2))).toEqual([255, 0, 0, 255]);
  const frame = String((engine.execute("frame.create", { x: 0, y: 0, width: 300, height: 200 }) as { id: string }).id);
  engine.execute("node.set", { id: frame, props: { fill: "#222222" } });
  const inner = String((engine.execute("text.create", { text: "Caret", x: 20, y: 20, parent: frame }) as { id: string }).id);
  engine.execute("node.set", { id: inner, props: { fill: "#DDDDDD" } });
  const grey = engine.getSnapshot().document.nodes[inner] as TextNode;
  expect(rgb(caretFill(grey, 5))).toEqual([0xdd, 0xdd, 0xdd, 255]);
  expect(rgb(caretFill(grey, 0))).toEqual([0xdd, 0xdd, 0xdd, 255]);
});

it("the caret follows the run of the character before it", () => {
  const { engine, id, node } = text("ab cd");
  engine.execute("node.set", { id, props: { fill: "#000000" } });
  engine.execute("text.style", { id, start: 3, end: 5, textFills: ["#FF0000"] });
  expect(rgb(caretFill(node(), 2)), "after a black character").toEqual([0, 0, 0, 255]);
  expect(rgb(caretFill(node(), 4)), "after a red character").toEqual([255, 0, 0, 255]);
  expect(rgb(caretFill(node(), 0)), "at the start: the first character's").toEqual([0, 0, 0, 255]);
});

it("the caret is opaque whatever the fill opacity", () => {
  const { engine, id, node } = text("x");
  engine.execute("fill.set", { ids: [id], index: 0, paint: { type: "solid", color: "#336699", opacity: 0.2 } });
  expect(caretFill(node(), 1)?.a).toBe(1);
});

it("gradient, missing and hidden fills have no fill colour", () => {
  const { engine, id, node } = text();
  engine.execute("fill.set", { ids: [id], index: 0, paint: { type: "gradient", kind: "linear", stops: [{ position: 0, color: "#FF0000" }, { position: 1, color: "#0000FF" }] } });
  expect(caretFill(node(), 2)).toBeUndefined();
  engine.execute("fill.set", { ids: [id], index: 0, paint: { type: "solid", color: "#FF0000", visible: false } });
  expect(caretFill(node(), 2)).toBeUndefined();
  engine.execute("fill.remove", { ids: [id], index: 0 });
  expect(caretFill(node(), 2)).toBeUndefined();
});

it("without a solid fill the caret contrasts with the page", () => {
  const { engine, id } = text();
  expect(caretFallback(engine.getSnapshot().document, id), "the default light page").toBe("#000000");
  engine.execute("page.setBackground", { color: "#1E1E1E" });
  expect(caretFallback(engine.getSnapshot().document, id), "a dark page").toBe("#ffffff");
});

it("without a solid fill the caret contrasts with the frame around it, as drawn", () => {
  const engine = new EditorEngine();
  const frame = String((engine.execute("frame.create", { x: 0, y: 0, width: 300, height: 200 }) as { id: string }).id);
  engine.execute("node.set", { id: frame, props: { fill: "#222222" } });
  const id = String((engine.execute("text.create", { text: "Caret", x: 20, y: 20, parent: frame }) as { id: string }).id);
  const fallback = () => caretFallback(engine.getSnapshot().document, id);
  expect(fallback(), "inside a dark frame on the light page").toBe("#ffffff");
  engine.execute("node.set", { id: frame, props: { fill: "#F0F0F0" } });
  expect(fallback(), "inside a light frame").toBe("#000000");
  engine.execute("node.set", { id: frame, props: { fill: "#222222", opacity: 0.2 } });
  expect(fallback(), "a faint dark frame on the light page").toBe("#000000");
  engine.execute("node.set", { id: frame, props: { fill: "#22222233", opacity: 1 } });
  expect(fallback(), "a dark fill at 20% alpha").toBe("#000000");
});
