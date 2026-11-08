import { expectSolid } from "../fixtures/expect-solid";
import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { newDocument, pageOf, rectanglePaints, type Document, type RectangleNode } from "../../src/engine/document";
import { setRectangleProperties } from "../../src/engine/properties";

function fixture(): Document {
  const doc = newDocument();
  const page = Object.freeze({ ...pageOf(doc), children: Object.freeze(["2", "3"]) });
  const rectangle = (id: string): RectangleNode => Object.freeze({
    id, kind: "rectangle", name: "Rectangle", parent: page.id,
    x: 10, y: 20, width: 100, height: 50, fill: "#ff0000",
  });
  return Object.freeze({ ...doc, nodes: Object.freeze({ ...doc.nodes, [page.id]: page, "2": rectangle("2"), "3": rectangle("3") }) });
}

describe("node.set rectangle appearance parity", () => {
  it("sets native base properties with fraction parsing and one transaction", () => {
    const doc = fixture();
    const result = setRectangleProperties(doc, [], {
      ids: ["2", "3"], props: { name: 42, visible: false, locked: true, opacity: "50%", width: 120 },
    });
    for (const id of ["2", "3"]) expect(result.nodes[id]).toMatchObject({ name: "42", visible: false, locked: true, opacity: 0.5, width: 120 });
    expect(doc.nodes["2"]).toMatchObject({ name: "Rectangle", width: 100 });
    expect(setRectangleProperties(result, ["2", "3"], { props: { name: "42", visible: false, locked: true, opacity: 50, width: 120 } })).toBe(result);
    expect((setRectangleProperties(doc, ["2"], { opacity: 1.5 }).nodes["2"] as RectangleNode).opacity).toBe(Math.fround(0.015));
    expect((setRectangleProperties(doc, ["2"], { opacity: -5 }).nodes["2"] as RectangleNode).opacity).toBe(0);
  });

  it("sets and clears fills, keeping native colour and paint metadata", () => {
    const doc = fixture();
    const colour = [0.12345, 0.25, 0.75, 0.5];
    const filled = setRectangleProperties(doc, ["2"], { fill: colour });
    const node = filled.nodes["2"] as RectangleNode;
    expect(rectanglePaints(node)[0]).toMatchObject({ opacity: Math.fround(0.5), colorAlpha: Math.fround(0.5) });
    expect(expectSolid(rectanglePaints(node)[0]).color.r).toBe(Math.fround(0.12345));
    expect(node.fills).toBeDefined();
    const withMetadata = setRectangleProperties(filled, ["2"], { fills: [
      { type: "solid", color: [0.12345, 0.25, 0.75, 0.5], opacity: 0.35, visible: false, blend: "passThrough", colorAlpha: 0.4 },
      "#aabbcc",
    ] });
    expect(rectanglePaints(withMetadata.nodes["2"] as RectangleNode)).toHaveLength(2);
    expect(rectanglePaints(withMetadata.nodes["2"] as RectangleNode)[0]).toMatchObject({
      opacity: Math.fround(0.35), visible: false, blend: "passThrough", colorAlpha: Math.fround(0.4),
    });
    expect(setRectangleProperties(withMetadata, ["2"], { fill: "none" }).nodes["2"]).toMatchObject({ fill: "transparent" });
    expect(rectanglePaints(setRectangleProperties(withMetadata, ["2"], { fill: null }).nodes["2"] as RectangleNode)).toEqual([]);
    expect(rectanglePaints(setRectangleProperties(withMetadata, ["2"], { fills: [] }).nodes["2"] as RectangleNode)).toEqual([]);
    expect(expectSolid(rectanglePaints(setRectangleProperties(doc, ["2"], { fill: "#000", fills: ["#fff"] }).nodes["2"] as RectangleNode)[0]).color.r).toBe(1);
  });

  it("validates every property and target before publishing changes", () => {
    const doc = fixture();
    for (const props of [
      { visible: "false" }, { locked: 1 }, { name: true }, { opacity: "nope" },
      { fill: "nonsense" }, { fills: [{ type: "solid", color: "#fff", visible: "yes" }] },
      { fill: "#fff", fills: [{ type: "gradient", color: "#fff" }] },
    ]) expect(() => setRectangleProperties(doc, [], { ids: ["2", "3"], props })).toThrow();
    expect(() => setRectangleProperties(doc, [], { ids: ["2", "999"], props: { fill: "#000" } })).toThrow();
    expect(doc.nodes["2"]).toMatchObject({ fill: "#ff0000", name: "Rectangle" });
    expect(doc.nodes["3"]).toMatchObject({ fill: "#ff0000", name: "Rectangle" });
  });

  it("records one undo step for changed appearance and none for unchanged values", () => {
    const engine = new EditorEngine();
    const id = String(engine.execute("shape.rectangle").id);
    const before = engine.getSnapshot().document;
    engine.execute("node.set", { props: { name: "Named", visible: false, opacity: "25%", fill: "#abc" } });
    const after = engine.getSnapshot().document;
    expect(after.nodes[id]).toMatchObject({ name: "Named", visible: false, opacity: 0.25, fill: "#aabbcc" });
    engine.execute("node.set", { props: { name: "Named", visible: false, opacity: 25, fill: "#aabbcc" } });
    expect(engine.getSnapshot().document).toBe(after);
    engine.execute("edit.undo");
    expect(engine.getSnapshot().document).toBe(before);
    engine.execute("edit.redo");
    expect(engine.getSnapshot().document).toBe(after);
  });
});
