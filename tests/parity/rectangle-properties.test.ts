import { describe, expect, it } from "vitest";
import { rotationDegrees, transformBounds } from "../../src/engine/affine";
import { newDocument, pageOf, rectangleTransform, type Document, type RectangleNode } from "../../src/engine/document";
import { setRectangleProperties } from "../../src/engine/properties";

function fixture(rectangles: readonly Partial<RectangleNode>[] = [{}]): Document {
  const doc = newDocument();
  const nodes = Object.fromEntries(rectangles.map((partial, index) => {
    const id = String(index + 2);
    return [id, Object.freeze({
      id, kind: "rectangle", name: "Rectangle", parent: doc.currentPage,
      x: 10, y: 20, width: 100, height: 50, fill: "#ff0000", ...partial,
    })];
  }));
  const page = Object.freeze({ ...pageOf(doc), children: Object.freeze(Object.keys(nodes)) });
  return Object.freeze({ ...doc, nodes: Object.freeze({ ...doc.nodes, [page.id]: page, ...nodes }) });
}

describe("node.set rectangle geometry parity", () => {
  it("applies final size before rotation, preserving the resulting centre", () => {
    const doc = fixture();
    const updated = setRectangleProperties(doc, ["2"], { props: { width: 200, height: 80, rotation: 90 } });
    const node = updated.nodes["2"] as RectangleNode;
    expect([node.width, node.height]).toEqual([200, 80]);
    expect(rotationDegrees(rectangleTransform(node))).toBeCloseTo(90);
    expect(transformBounds(rectangleTransform(node), 200, 80)).toMatchObject({ x: 70, y: -40, width: 80, height: 200 });
    expect(doc.nodes["2"]).toMatchObject({ width: 100, height: 50, x: 10, y: 20 });
  });

  it("applies x/y after rotation and accepts aliases and numeric strings", () => {
    const node = setRectangleProperties(fixture(), [], { id: "node:2", w: "40px", h: "-5", rotation: "90", x: "30", y: "40" }).nodes["2"] as RectangleNode;
    expect([node.width, node.height, node.x, node.y]).toEqual([40, 0, 30, 40]);
    expect(rotationDegrees(rectangleTransform(node))).toBeCloseTo(90);
  });

  it("keeps skew and reflection when changing translation alone", () => {
    const transform = [2, 0.25, 0.5, -3, 10, 20] as const;
    const node = setRectangleProperties(fixture([{ transform }]), ["2"], { props: { x: 60 } }).nodes["2"] as RectangleNode;
    expect(rectangleTransform(node)).toEqual([2, 0.25, 0.5, -3, 60, 20]);
    expect(node.y).toBe(20);
  });

  it("rejects invalid targets, unsupported fields and overflow atomically", () => {
    const doc = fixture([{}, {}]);
    for (const params of [
      { ids: ["2", "999"], props: { width: 20 } },
      { ids: ["2", doc.currentPage], props: { width: 20 } },
      { ids: ["2", "3"], props: { effects: [] } },
      { ids: ["2", "3"], props: { width: Number.POSITIVE_INFINITY } },
      { ids: ["2", "3"], props: { width: 1e308, x: 1e308 } },
      { ids: [], props: { x: 1 } },
    ]) {
      expect(() => setRectangleProperties(doc, ["2"], params)).toThrow();
      expect(doc.nodes["2"]).toMatchObject({ x: 10, width: 100 });
      expect(doc.nodes["3"]).toMatchObject({ x: 10, width: 100 });
    }
  });

  it("rejects unsupported effects and strokes without changing geometry", () => {
    const doc = fixture();
    expect(() => setRectangleProperties(doc, ["2"], { props: { effects: [] } })).toThrow("unsupported properties");
    expect(() => setRectangleProperties(doc, ["2"], { props: { strokes: [] } })).toThrow("unsupported properties");
    expect(setRectangleProperties(doc, ["2"], { props: { x: 10 } })).toBe(doc);
  });
});
