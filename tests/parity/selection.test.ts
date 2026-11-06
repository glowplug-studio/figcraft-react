import { describe, expect, it } from "vitest";
import { fromPositionRotation, transformPoint, type Affine } from "../../src/engine/affine";
import { type Document, type PageNode, type RectangleNode } from "../../src/engine/document";
import { executeSelection, hitRectangle, selectionSpecs } from "../../src/engine/selection";

function fixture(): Document {
  const page = (id: string, children: string[]): PageNode => Object.freeze({ id, kind: "page", name: id, parent: null, children: Object.freeze(children), background: "#fff" });
  const rectangle = (id: string, parent: string, transform?: Affine): RectangleNode => Object.freeze({ id, kind: "rectangle", name: id, parent, x: transform?.[4] ?? 0, y: transform?.[5] ?? 0, width: 10, height: 10, fill: "#000", ...(transform ? { transform } : {}) });
  return Object.freeze({ name: "Selection", pages: Object.freeze(["1", "2"]), currentPage: "1", nodes: Object.freeze({
    "1": page("1", ["3", "4"]), "2": page("2", ["5"]),
    "3": rectangle("3", "1"), "4": rectangle("4", "1"), "5": rectangle("5", "2"),
  }) });
}
const run = (command: string, document = fixture(), selection: readonly string[] = [], params: Record<string, unknown> = {}) => executeSelection(command, document, selection, params);

describe("selection command parity", () => {
  it("is non-undoable and leaves document data untouched", () => {
    expect(Object.values(selectionSpecs).every(spec => spec.undo === false)).toBe(true);
    const document = fixture();
    const selected = run("select.set", document, [], { ids: ["3"] });
    expect(selected.document).toBe(document);
    expect(selected.result).toEqual({ selection: ["3"] });
    expect(Object.isFrozen(selected.selection)).toBe(true);
    expect(document.nodes["3"]).toBe(selected.document.nodes["3"]);
  });

  it("switches to the first target page, then cleans other-page, page, and duplicate IDs", () => {
    const document = fixture();
    const selected = run("select.set", document, ["3"], { ids: ["5", "3", "5", "2", "garbage"] });
    expect(selected.document.currentPage).toBe("2");
    expect(selected.document.nodes).toBe(document.nodes);
    expect(selected.selection).toEqual(["5"]);
    expect(document.currentPage).toBe("1");
    expect(run("select.set", document, ["3"], { ids: ["2", "5"] }).selection).toEqual(["5"]);
  });

  it("validates parsed set targets atomically and drops malformed IDs", () => {
    const document = fixture();
    const selection = Object.freeze(["3"]);
    expect(() => run("select.set", document, selection, { ids: ["5", "999"] })).toThrow("No node 999");
    expect(document.currentPage).toBe("1");
    expect(selection).toEqual(["3"]);
    expect(run("select.set", document, selection, { ids: ["not-id", null, " 0:004 ", 3] }).selection).toEqual(["4", "3"]);
    expect(run("select.set", document, selection, { id: "bad" }).selection).toEqual([]);
    expect(run("select.set", document, selection, { id: "3", ids: ["4"] }).selection).toEqual(["4"]);
  });

  it("adds/removes parsed IDs without page switches and cleans selection", () => {
    const document = fixture();
    const added = run("select.add", document, ["3"], { ids: ["5", "4", "4", "bad"] });
    expect(added.document).toBe(document);
    expect(added.selection).toEqual(["3", "4"]);
    expect(run("select.remove", document, added.selection, { id: 3 }).selection).toEqual(["4"]);
    expect(run("select.remove", document, ["3", "4"], { ids: ["5", "bad"] }).selection).toEqual(["3", "4"]);
  });

  it("selects all current-page children and clears selection", () => {
    const document = fixture();
    expect(run("select.all", document, ["5"]).selection).toEqual(["3", "4"]);
    const cleared = run("select.none", document, ["3"]);
    expect(cleared.selection).toEqual([]);
    expect(cleared.result).toEqual({ ok: true });
    expect(cleared.document).toBe(document);
  });
  it("skips hidden and locked nodes for pointer/all but permits explicit selection", () => {
    const base = fixture();
    const document: Document = { ...base, nodes: { ...base.nodes,
      "3": { ...base.nodes["3"], visible: false } as RectangleNode,
      "4": { ...base.nodes["4"], locked: true } as RectangleNode,
    } };
    expect(hitRectangle(document, { x: 5, y: 5 })).toBeUndefined();
    expect(run("select.all", document).selection).toEqual([]);
    expect(run("select.set", document, [], { ids: ["3", "4"] }).selection).toEqual(["3", "4"]);
  });

  it("rejects unsupported parameters and commands", () => {
    expect(() => run("select.set", fixture(), [], { unexpected: true })).toThrow("Unsupported");
    expect(() => run("select.all", fixture(), [], { ids: ["3"] })).toThrow("Unsupported");
    expect(() => run("select.layersAt")).toThrow("Unsupported");
  });
});

describe("flat transformed rectangle hit", () => {
  const withTransforms = (transforms: Record<string, Affine>, children = ["3", "4"]): Document => {
    const base = fixture();
    const nodes = { ...base.nodes };
    nodes["1"] = Object.freeze({ ...nodes["1"], children: Object.freeze(children) }) as PageNode;
    for (const [id, transform] of Object.entries(transforms)) nodes[id] = Object.freeze({ ...nodes[id], x: transform[4], y: transform[5], transform }) as RectangleNode;
    return Object.freeze({ ...base, nodes: Object.freeze(nodes) });
  };

  it("takes the frontmost child", () => {
    expect(hitRectangle(fixture(), { x: 5, y: 5 })).toBe("4");
    expect(hitRectangle(fixture(), { x: 20, y: 20 })).toBeUndefined();
  });

  it("uses inverse rotation rather than the world axis-aligned bounds", () => {
    const rotated = fromPositionRotation(20, 20, 45);
    const document = withTransforms({ "4": rotated }, ["4"]);
    expect(hitRectangle(document, transformPoint(rotated, { x: 5, y: 5 }))).toBe("4");
    expect(hitRectangle(document, { x: 13, y: 20 })).toBeUndefined();
  });

  it("uses the local skewed box and skips singular matrices", () => {
    const skew: Affine = [1, 0, 1, 1, 20, 20];
    const document = withTransforms({ "4": skew }, ["4"]);
    expect(hitRectangle(document, transformPoint(skew, { x: 8, y: 8 }))).toBe("4");
    expect(hitRectangle(document, { x: 21, y: 29 })).toBeUndefined();
    const singular = withTransforms({ "4": [1, 0, 0, 0, 0, 0] });
    expect(hitRectangle(singular, { x: 5, y: 5 })).toBe("3");
    expect(hitRectangle(singular, { x: NaN, y: 5 })).toBeUndefined();
  });
});
