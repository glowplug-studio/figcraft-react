import { describe, expect, it } from "vitest";
import { colour } from "../../src/engine/colour";
import { newDocument, type Document, type GroupNode, type PageNode, type RectangleNode } from "../../src/engine/document";
import { decodeFigcraft, encodeFigcraft } from "../../src/engine/file-format";
import { executePage } from "../../src/engine/pages";
import { readSolidPaint } from "../../src/engine/solid-paint";

// Inspection-derived from upstream doc::Document::duplicate_all_into and page.duplicate.
function nestedPages(): Document {
  const original = newDocument("Nested pages");
  const first: PageNode = Object.freeze({ ...original.nodes["1"] as PageNode, children: Object.freeze(["2", "5"]), backgroundColor: colour(0.12345, 0.25, 0.5, 0.75) });
  const second: PageNode = Object.freeze({ id: "7", kind: "page", name: "Other", parent: null, children: Object.freeze([]), background: "#ffffff" });
  const paint = readSolidPaint({ type: "solid", color: [0.12345, 0.25, 0.75, 0.8], opacity: 0.4, colorAlpha: 0.2, visible: false });
  const group: GroupNode = Object.freeze({ id: "2", kind: "group", name: "Outer", parent: "1", children: Object.freeze(["3", "4"]), x: 20, y: 30, width: 80, height: 90, transform: [0, -1, 1, 0, 20, 30] as const, fill: "transparent", fills: Object.freeze([paint]), opacity: 0.5, locked: true });
  const child: RectangleNode = Object.freeze({ id: "3", kind: "rectangle", name: "Inner rectangle", parent: "2", x: 2, y: 3, width: 10, height: 11, fill: "transparent", fills: Object.freeze([paint]) });
  const inner: GroupNode = Object.freeze({ id: "4", kind: "group", name: "Inner group", parent: "2", children: Object.freeze(["6"]), x: 4, y: 5, width: 20, height: 20, fill: "#abcdef", visible: false });
  const sibling: RectangleNode = Object.freeze({ id: "5", kind: "rectangle", name: "Page sibling", parent: "1", x: 1, y: 2, width: 5, height: 6, fill: "#112233" });
  const leaf: RectangleNode = Object.freeze({ id: "6", kind: "rectangle", name: "Deep leaf", parent: "4", x: 6, y: 7, width: 8, height: 9, fill: "#445566" });
  return Object.freeze({ ...original, pages: Object.freeze(["1", "7"]), nodes: Object.freeze({ "1": first, "2": group, "3": child, "4": inner, "5": sibling, "6": leaf, "7": second }) });
}
const run = (command: string, document: Document, selection: readonly string[] = [], nextId = 8n, params: Record<string, unknown> = {}) => executePage(command, document, selection, nextId, params);

describe("page lifecycle with nested groups", () => {
  it("duplicates the whole tree in paint order with fresh IDs and intact local appearance", async () => {
    const original = nestedPages();
    const result = run("page.duplicate", original, ["2", "6"]);
    expect(result.result).toEqual({ id: "8" });
    expect(result.document.pages).toEqual(["1", "8", "7"]);
    expect(result.document.currentPage).toBe("8");
    expect(result.nextId).toBe(14n);
    expect(result.selection).toEqual([]);
    expect((result.document.nodes["8"] as PageNode).children).toEqual(["9", "13"]);
    expect((result.document.nodes["9"] as GroupNode).children).toEqual(["10", "11"]);
    expect((result.document.nodes["11"] as GroupNode).children).toEqual(["12"]);
    for (const [source, copy, parent] of [["2", "9", "8"], ["3", "10", "9"], ["4", "11", "9"], ["6", "12", "11"], ["5", "13", "8"]]) {
      const oldNode = original.nodes[source];
      const newNode = result.document.nodes[copy];
      expect(newNode).toMatchObject({ ...oldNode, id: copy, parent, ...(oldNode.kind === "group" ? { children: (newNode as GroupNode).children } : {}) });
      expect(Object.isFrozen(newNode)).toBe(true);
    }
    expect((result.document.nodes["8"] as PageNode).backgroundColor).toEqual((original.nodes["1"] as PageNode).backgroundColor);
    expect((result.document.nodes["9"] as GroupNode).transform).toEqual([0, -1, 1, 0, 20, 30]);
    expect((result.document.nodes["10"] as RectangleNode).fills).toEqual((original.nodes["3"] as RectangleNode).fills);
    expect(Object.isFrozen((result.document.nodes["9"] as GroupNode).children)).toBe(true);
    expect((original.nodes["2"] as GroupNode).children).toEqual(["3", "4"]);
    const reopened = await decodeFigcraft(await encodeFigcraft(result.document, String(result.nextId)));
    expect((reopened.document.nodes["9"] as GroupNode).children).toEqual(["10", "11"]);
    expect((reopened.document.nodes["10"] as RectangleNode).fills).toEqual((result.document.nodes["10"] as RectangleNode).fills);
  });

  it("deletes all descendants but preserves other pages and source input", () => {
    const original = nestedPages();
    const result = run("page.delete", original, ["2", "6"]);
    expect(result.document.pages).toEqual(["7"]);
    expect(result.document.currentPage).toBe("7");
    expect(result.selection).toEqual([]);
    expect(Object.keys(result.document.nodes)).toEqual(["7"]);
    expect(original.nodes["6"]).toBeDefined();
    expect(result.nextId).toBe(8n);
  });

  it("keeps nested group and leaf selection only on their owning page", () => {
    const original = nestedPages();
    const selected = Object.freeze(["2", "6"]);
    expect(run("page.rename", original, selected, 8n, { name: "Renamed" }).selection).toBe(selected);
    expect(run("page.delete", original, selected, 8n, { id: "7" }).selection).toBe(selected);
    expect(run("page.select", original, selected, 8n, { id: "7" }).selection).toEqual([]);
  });

  it("rejects repeated, missing, wrong-parent and unsupported descendants atomically", () => {
    const original = nestedPages();
    const cases: Document[] = [
      { ...original, nodes: { ...original.nodes, "2": { ...original.nodes["2"] as GroupNode, children: ["3", "3"] } } },
      { ...original, nodes: { ...original.nodes, "2": { ...original.nodes["2"] as GroupNode, children: ["3", "404"] } } },
      { ...original, nodes: { ...original.nodes, "3": { ...original.nodes["3"] as RectangleNode, parent: "1" } } },
      { ...original, nodes: { ...original.nodes, "3": { ...original.nodes["3"], kind: "frame" } as unknown as RectangleNode } },
    ];
    for (const document of cases) {
      const before = JSON.stringify(document);
      for (const command of ["page.duplicate", "page.delete"]) expect(() => run(command, document)).toThrow("unsupported or invalid");
      expect(JSON.stringify(document)).toBe(before);
    }
    expect(() => run("page.duplicate", original, [], 18446744073709551614n)).toThrow("exhausted");
    expect(original.nodes["8"]).toBeUndefined();
  });
});
