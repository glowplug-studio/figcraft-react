import { describe, expect, it } from "vitest";
import { fromPositionRotation, multiply, transformPoint, type Affine } from "../../src/engine/affine";
import type { Document, GroupNode, PageNode, RectangleNode } from "../../src/engine/document";
import { executeSelection, hitRectangle } from "../../src/engine/selection";

// Source: original/figcraft/crates/doc/src/geometry.rs hit_leaf/select_target and
// original/figcraft/crates/engine/src/cmd/edit/select.rs select_all (0b97f3f).
function fixture(): Document {
  const page = (id: string, children: string[]): PageNode => ({ id, kind: "page", name: id, parent: null, children, background: "#fff" });
  const group = (id: string, parent: string, children: string[], transform: Affine): GroupNode => ({
    id, kind: "group", name: id, parent, children, x: transform[4], y: transform[5], width: 100, height: 100, transform, fill: "transparent",
  });
  const rectangle = (id: string, parent: string, transform: Affine): RectangleNode => ({
    id, kind: "rectangle", name: id, parent, x: transform[4], y: transform[5], width: 20, height: 20, transform, fill: "#000",
  });
  return { name: "Nested", pages: ["1", "2"], currentPage: "1", nodes: {
    "1": page("1", ["3", "8"]), "2": page("2", ["6"]),
    "3": group("3", "1", ["4"], fromPositionRotation(100, 100, 45)),
    "4": group("4", "3", ["5"], [1, 0.25, 0.5, 1, 10, 5]),
    "5": rectangle("5", "4", [1, 0, 0, 1, 20, 10]),
    "6": group("6", "2", ["7"], [1, 0, 0, 1, 100, 100]),
    "7": rectangle("7", "6", [1, 0, 0, 1, 20, 10]),
    "8": rectangle("8", "1", [1, 0, 0, 1, 300, 300]),
  } };
}

describe("nested selection and hit parity", () => {
  it("hits through rotated and skewed group transforms; normal click selects group and deep click selects leaf", () => {
    const document = fixture();
    const point = transformPoint(multiply(multiply((document.nodes["3"] as GroupNode).transform!, (document.nodes["4"] as GroupNode).transform!), (document.nodes["5"] as RectangleNode).transform!), { x: 10, y: 10 });
    expect(hitRectangle(document, point)).toBe("3");
    expect(hitRectangle(document, point, true)).toBe("5");
    expect(hitRectangle(document, point, false, ["4"])).toBe("4");
    expect(hitRectangle(document, point, false, ["5"])).toBe("5");
    expect(hitRectangle(document, { x: NaN, y: point.y }, true)).toBeUndefined();
    expect(hitRectangle(document, { x: 300, y: 300 })).toBe("8");
  });

  it("skips hidden and locked ancestors for pointer hits and Select all, yet permits explicit selection", () => {
    const base = fixture();
    const point = transformPoint(multiply(multiply((base.nodes["3"] as GroupNode).transform!, (base.nodes["4"] as GroupNode).transform!), (base.nodes["5"] as RectangleNode).transform!), { x: 10, y: 10 });
    for (const property of ["visible", "locked"] as const) {
      const value = property === "visible" ? false : true;
      const document: Document = { ...base, nodes: { ...base.nodes, "4": { ...base.nodes["4"] as GroupNode, [property]: value } } };
      expect(hitRectangle(document, point)).toBeUndefined();
      expect(hitRectangle(document, point, true)).toBeUndefined();
      expect(executeSelection("select.set", document, [], { ids: ["4", "5"] }).selection).toEqual(["4", "5"]);
    }
    const hiddenRoot: Document = { ...base, nodes: { ...base.nodes, "3": { ...base.nodes["3"] as GroupNode, visible: false }, "8": { ...base.nodes["8"] as RectangleNode, locked: true } } };
    expect(executeSelection("select.all", hiddenRoot, [], {}).selection).toEqual([]);
    expect(executeSelection("select.set", hiddenRoot, [], { ids: ["3", "5", "8"] }).selection).toEqual(["3", "5", "8"]);
  });

  it("switches pages from the first nested target and cleans other-page IDs", () => {
    const document = fixture();
    const selected = executeSelection("select.set", document, ["5"], { ids: ["7", "5", "6", "7"] });
    expect(selected.document.currentPage).toBe("2");
    expect(selected.selection).toEqual(["7", "6"]);
    expect(executeSelection("select.all", selected.document, [], {}).selection).toEqual(["6"]);
    expect(executeSelection("select.add", document, ["5"], { ids: ["7", "4"] }).selection).toEqual(["5", "4"]);
    expect(executeSelection("select.all", document, ["5"], {}).selection).toEqual(["5"]);
    expect(executeSelection("select.inverse", document, ["5"], {}).selection).toEqual([]);
    expect(executeSelection("select.children", document, ["3"], {}).selection).toEqual(["4"]);
    expect(executeSelection("select.children", document, ["5"], {}).selection).toEqual(["5"]);
    expect(executeSelection("select.parent", document, ["5"], {}).selection).toEqual(["4"]);
    expect(executeSelection("select.parent", document, ["3"], {}).selection).toEqual(["3"]);
    expect(executeSelection("select.inverse", document, ["3"], {}).selection).toEqual(["8"]);
  });

  it("does not let singular group transforms hit descendants", () => {
    const base = fixture();
    const document: Document = { ...base, nodes: { ...base.nodes, "3": { ...base.nodes["3"] as GroupNode, transform: [1, 0, 0, 0, 100, 100] } } };
    expect(hitRectangle(document, { x: 130, y: 100 }, true)).toBeUndefined();
  });
});
