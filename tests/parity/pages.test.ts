import { describe, expect, it } from "vitest";
import { newDocument, pageColour, type Document, type PageNode, type RectangleNode } from "../../src/engine/document";
import { executePage, isDivider, listPages, pageSpecs } from "../../src/engine/pages";

// Inspection-derived cases: upstream panels_behaviour_tests:327–393,
// page_target_tests, theme_pages_tests and cmd/page.rs:13–160. No Rust engine execution.
function fixture(): Document {
  const first: PageNode = Object.freeze({ id: "1", kind: "page", name: "Design", parent: null, children: Object.freeze(["4", "3"]), background: "#336699" });
  const second: PageNode = Object.freeze({ id: "2", kind: "page", name: "Flows", parent: null, children: Object.freeze([]), background: "#ffe08a" });
  const rectangle = (id: string): RectangleNode => Object.freeze({ id, kind: "rectangle", name: `Rectangle ${id}`, parent: "1", x: -20, y: 30, width: 80, height: 45, fill: "#d9d9d9" });
  return Object.freeze({ name: "Pages", pages: Object.freeze(["1", "2"]), currentPage: "1", nodes: Object.freeze({ "1": first, "2": second, "3": rectangle("3"), "4": rectangle("4") }) });
}
const run = (command: string, document: Document, params: Record<string, unknown> = {}, selection: readonly string[] = Object.freeze(["4"]), nextId = 5n) => executePage(command, document, selection, nextId, params);

describe("page lifecycle upstream parity", () => {
  it("retains upstream labels/history flags and provides an ordered query without changes", () => {
    expect(pageSpecs["page.select"]).toEqual({ label: "Go to page", undo: false });
    expect(pageSpecs["page.add"]).toEqual({ label: "Add page", undo: true });
    expect(pageSpecs["page.list"]).toEqual({ label: "List pages", undo: false });
    const document = fixture();
    expect(listPages(document)).toEqual([
      { id: "1", name: "Design", current: true, children: 2, divider: false },
      { id: "2", name: "Flows", current: false, children: 0, divider: false },
    ]);
    const queried = run("page.list", document);
    expect(queried.document).toBe(document);
    expect(queried.nextId).toBe(5n);
    expect(queried.result).toEqual({ pages: listPages(document) });
    expect(Object.isFrozen(listPages(document)[0])).toBe(true);
  });

  it("adds a numbered current page with the active background and clears selection", () => {
    const document = fixture();
    const result = run("page.add", document);
    expect(result.result).toEqual({ id: "5" });
    expect(result.document.pages).toEqual(["1", "2", "5"]);
    expect(result.document.currentPage).toBe("5");
    expect(result.document.nodes["5"]).toEqual({ id: "5", name: "Page 3", kind: "page", parent: null, children: [], background: "#336699" });
    expect(result.selection).toEqual([]);
    expect(result.nextId).toBe(6n);
    const fromSecond = run("page.add", run("page.select", document, { id: "2" }).document);
    expect(fromSecond.document.nodes["5"]).toMatchObject({ background: "#ffe08a" });
    expect(document.pages).toEqual(["1", "2"]);
    expect(document.nodes["5"]).toBeUndefined();
  });

  it("adds a divider without changing current page or valid selection", () => {
    const document = fixture();
    const selected = Object.freeze(["4"]);
    const result = run("page.add", document, { name: "- Section" }, selected);
    expect(result.result).toEqual({ id: "5", divider: true });
    expect(result.document.currentPage).toBe("1");
    expect(result.selection).toBe(selected);
    expect(isDivider(result.document, "5")).toBe(true);
    expect(() => run("page.select", result.document, { id: "5" })).toThrow("divider");
    expect(isDivider(result.document, "missing")).toBe(false);
    expect(isDivider(result.document, "4")).toBe(false);
  });

  it.each([false, 17, ""])("accepts upstream name coercion (%j)", name => {
    const added = run("page.add", newDocument(), { name });
    expect(added.document.nodes["5"].name).toBe(String(name));
    expect(run("page.rename", added.document, { name }).document.nodes["5"].name).toBe(String(name));
  });

  it("matches optional-name defaults and unparseable optional-ID fallback", () => {
    const document = fixture();
    expect(run("page.add", document, { name: null }).document.nodes["5"].name).toBe("Page 3");
    expect(run("page.rename", document, { id: {}, name: "Current" }).document.nodes["1"].name).toBe("Current");
    expect(() => run("page.rename", document, { name: null })).toThrow();
  });

  it.each(["2", " 0:002 ", 2])("selects parsed ID %j with ID taking precedence over index", id => {
    const document = fixture();
    const result = run("page.select", document, { id, index: -1 });
    expect(result.document.currentPage).toBe("2");
    expect(result.selection).toEqual([]);
    expect(result.document.nodes).toBe(document.nodes);
    expect(result.document.pages).toBe(document.pages);
    expect(result.nextId).toBe(5n);
    expect(result.result).toEqual({ ok: true });
  });

  it.each([1, "1", true, "1px", "1%", "1e0"])("selects by lenient numeric index %j", index => {
    expect(run("page.select", fixture(), { index }).document.currentPage).toBe("2");
  });

  it.each([-1, 0.5, "-1", "0.5", 1e9, Infinity, NaN, "", "0x1", null, {}])("rejects invalid select index %j atomically", index => {
    const document = fixture();
    const before = JSON.stringify(document);
    expect(() => run("page.select", document, { index })).toThrow();
    expect(JSON.stringify(document)).toBe(before);
  });

  it("selecting the current page clears selection but preserves the document reference", () => {
    const document = fixture();
    const result = run("page.select", document, { id: "1" });
    expect(result.document).toBe(document);
    expect(result.selection).toEqual([]);
  });

  it("renames populated hyphen pages without turning them into dividers", () => {
    const result = run("page.rename", fixture(), { name: "-Design" });
    expect(result.document.nodes["1"].name).toBe("-Design");
    expect(isDivider(result.document, "1")).toBe(false);
    expect(result.document.currentPage).toBe("1");
    expect(result.selection).toEqual(["4"]);
  });

  it("renaming an empty current page to a divider selects the first ordinary page", () => {
    const document = run("page.select", fixture(), { id: "2" }).document;
    const result = run("page.rename", document, { name: "-Flows" });
    expect(isDivider(result.document, "2")).toBe(true);
    expect(result.document.currentPage).toBe("1");
    expect(result.selection).toEqual([]);
  });

  it("refuses deleting or dividing the last ordinary page with complete atomicity", () => {
    const ordinary = newDocument();
    const divided = run("page.add", ordinary, { name: "-" }).document;
    for (const document of [ordinary, divided]) {
      const before = JSON.stringify(document);
      expect(() => run("page.delete", document)).toThrow("needs a page");
      expect(() => run("page.rename", document, { name: "-Last" })).toThrow("needs a page");
      expect(JSON.stringify(document)).toBe(before);
    }
    const deletedDivider = run("page.delete", divided, { id: "5" });
    expect(deletedDivider.document.pages).toEqual(["1"]);
  });

  it("deletes a page with its children and skips leading dividers when settling", () => {
    let document = run("page.add", fixture(), { name: "-" }).document;
    document = run("page.move", document, { id: "5", index: 0 }).document;
    const deleted = run("page.delete", document, { id: "1" });
    expect(deleted.document.pages).toEqual(["5", "2"]);
    expect(deleted.document.currentPage).toBe("2");
    expect(deleted.selection).toEqual([]);
    expect(Object.keys(deleted.document.nodes).sort()).toEqual(["2", "5"]);
    expect(document.nodes["3"]).toBeDefined();
    expect(deleted.nextId).toBe(5n);
  });

  it("deletes a non-current page without changing current selection", () => {
    const selected = Object.freeze(["4"]);
    const result = run("page.delete", fixture(), { id: "2" }, selected);
    expect(result.document.currentPage).toBe("1");
    expect(result.selection).toBe(selected);
  });

  it("duplicates after source with fresh ordered child IDs, geometry, background and selection cleanup", () => {
    const document = fixture();
    const copied = run("page.duplicate", document, { id: "1" });
    expect(copied.result).toEqual({ id: "5" });
    expect(copied.document.pages).toEqual(["1", "5", "2"]);
    expect(copied.document.currentPage).toBe("5");
    expect(copied.document.nodes["5"]).toMatchObject({ name: "Copy of Design", background: "#336699", children: ["6", "7"] });
    expect(copied.document.nodes["6"]).toEqual({ ...document.nodes["4"], id: "6", parent: "5" });
    expect(copied.document.nodes["7"]).toEqual({ ...document.nodes["3"], id: "7", parent: "5" });
    expect(copied.document.nodes["1"]).toBe(document.nodes["1"]);
    expect(copied.selection).toEqual([]);
    expect(copied.nextId).toBe(8n);
    expect(Object.isFrozen(copied.document)).toBe(true);
    expect(Object.isFrozen(copied.document.nodes)).toBe(true);
    expect(Object.isFrozen(copied.document.nodes["5"])).toBe(true);
    expect(Object.isFrozen((copied.document.nodes["5"] as PageNode).children)).toBe(true);
    expect(Object.isFrozen(copied.document.nodes["6"])).toBe(true);
  });

  it("a duplicated divider becomes an ordinary Copy of page", () => {
    const document = run("page.add", fixture(), { name: "-" }).document;
    const copied = run("page.duplicate", document, { id: "5" }, [], 6n);
    expect(copied.document.nodes["6"].name).toBe("Copy of -");
    expect(isDivider(copied.document, "6")).toBe(false);
    expect(copied.document.currentPage).toBe("6");
  });

  it.each([[true, ["1", "2"]], [false, ["2", "1"]], [999, ["1", "2"]], ["0px", ["2", "1"]]] as const)("moves using a valid whole index %j", (index, expected) => {
    const document = fixture();
    const result = run("page.move", document, { id: "2", index });
    expect(result.document.pages).toEqual(expected);
    expect(result.document.currentPage).toBe("1");
    expect(result.selection).toEqual(["4"]);
    expect(result.document.nodes).toBe(document.nodes);
  });

  it("keeps document references for content no-ops", () => {
    const document = fixture();
    expect(run("page.move", document, { id: "2", index: 1 }).document).toBe(document);
    expect(run("page.rename", document, { name: "Design" }).document).toBe(document);
  });

  it.each(["page.rename", "page.delete", "page.duplicate", "page.move", "page.select"])("refuses rectangle and absent targets for %s", command => {
    const document = fixture();
    for (const id of ["4", "99999"]) {
      expect(() => run(command, document, { id, ...(command === "page.rename" ? { name: "Wrong" } : {}), ...(command === "page.move" ? { index: 0 } : {}) })).toThrow("not a page");
    }
    expect(document.nodes["4"].name).toBe("Rectangle 4");
  });

  it("allocates exact u64 identifiers, skipping stale occupied IDs", () => {
    expect(run("page.add", fixture(), {}, [], 1n).result).toEqual({ id: "5" });
    const copied = run("page.duplicate", fixture(), {}, [], 9007199254740993n);
    expect(copied.result).toEqual({ id: "9007199254740993" });
    expect((copied.document.nodes["9007199254740993"] as PageNode).children).toEqual(["9007199254740994", "9007199254740995"]);
    expect(copied.nextId).toBe(9007199254740996n);
  });

  it("keeps maximum u64 allocator serialisable and refuses subsequent exhausted allocation", () => {
    const max = 18446744073709551615n;
    const added = run("page.add", fixture(), {}, [], max);
    expect(added.result).toEqual({ id: String(max) });
    expect(added.nextId).toBe(max);
    expect(() => run("page.add", added.document, {}, [], added.nextId)).toThrow("exhausted");
    const document = fixture();
    expect(() => run("page.duplicate", document, {}, [], max - 1n)).toThrow("exhausted");
    expect(Object.keys(document.nodes)).toHaveLength(4);
    expect(() => run("page.add", document, {}, [], max + 1n)).toThrow("exhausted");
  });

  it("rejects future or invalid subtree content rather than silently losing it", () => {
    const original = fixture();
    const bad = { ...original, nodes: { ...original.nodes, "4": { ...original.nodes["4"], kind: "frame" } } } as unknown as Document;
    for (const command of ["page.duplicate", "page.delete"]) expect(() => run(command, bad)).toThrow("unsupported or invalid");
    expect((bad.nodes["4"] as { kind: string }).kind).toBe("frame");
  });

  it("rejects unsupported parameters and commands without touching input", () => {
    const document = fixture();
    expect(() => run("page.setPrototype", document, { color: "#ffffff" })).toThrow("Unsupported");
    expect(() => run("page.add", document, { unknown: true })).toThrow("Unsupported");
    expect(() => run("page.list", document, { id: "1" })).toThrow("Unsupported");
    expect(document.pages).toEqual(["1", "2"]);
  });
  it("preserves precise translucent page colours through creation and duplication", () => {
    const document = fixture();
    const updated = run("page.setBackground", document, { color: [0.12345, .5, .75, .4] }).document;
    const expected = { r: Math.fround(.12345), g: .5, b: .75, a: Math.fround(.4) };
    expect(pageColour(updated.nodes["1"] as PageNode)).toEqual(expected);
    expect(pageColour(run("page.add", updated).document.nodes["5"] as PageNode)).toEqual(expected);
    expect(pageColour(run("page.duplicate", updated).document.nodes["5"] as PageNode)).toEqual(expected);
    expect(document.nodes["1"]).toMatchObject({ background: "#336699" });
    expect(() => run("page.setBackground", updated, { color: "invalid" })).toThrow("colour");
    expect(() => run("page.setBackground", updated, { id: "4", color: "red" })).toThrow("not a page");
  });
});
