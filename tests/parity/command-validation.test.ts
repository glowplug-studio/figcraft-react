import { expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { decodeFigcraft } from "../../src/engine/file-format";
import { strokeCaps } from "../../src/engine/stroke";
import { frameRelative } from "../../src/engine/hierarchy";
import { newDocument, type GroupNode } from "../../src/engine/document";

it("bad_point_is_rejected for every entry and aliases while an SVG path takes precedence", () => {
  const e = new EditorEngine(), before = e.getSnapshot();
  for (const item of [["abc", 5], [1], 7, [1, 2, 3], null, [[], 3], [1, Infinity]]) {
    for (const command of ["vector.create", "node.create"]) {
      const params = { ...(command === "node.create" && { type: "path" }), points: [[0, 0], item, [100, 100]], closed: false };
      expect(() => e.execute(command, params)).toThrow("`points` entries must be numeric [x, y] pairs");
      expect(e.getSnapshot()).toBe(before);
    }
  }
  expect(e.execute("vector.create", { points: [[false, true], ["100px", "50%"]] })).toMatchObject({ id: "2" });
  expect(e.getSnapshot().document.nodes["2"]).toMatchObject({ x: 0, y: 1, width: 100, height: 49 });
  expect(e.execute("vector.create", { path: "M0 0L10 20", points: [[1]] })).toMatchObject({ id: "3" });
});

it("page_move_refuses_negative_or_fractional_indexes and preserves redo", () => {
  const e = new EditorEngine(); e.execute("page.add"); const id = String(e.execute("page.add").id);
  e.execute("page.move", { id, index: "0px" }); e.execute("edit.undo");
  const before = e.getSnapshot();
  for (const index of [-1, .5, 1e9, null, "x", Infinity]) {
    expect(() => e.execute("page.move", { id, index })).toThrow(); expect(e.getSnapshot()).toBe(before);
  }
  e.execute("edit.redo"); expect(e.getSnapshot().document.pages[0]).toBe(id);
  e.execute("page.move", { id, index: 999999999 }); expect(e.getSnapshot().document.pages.at(-1)).toBe(id);
});

it("reorder_rejects_negative_and_fractional_indexes and preserves node identity, selection and native order", async () => {
  const e = new EditorEngine(), frame = String(e.execute("frame.create").id);
  const create = (x: number) => String(e.execute("shape.rectangle", { parent: frame, x, y: 14, props: { rotation: 31 } }).id);
  const a = create(10), b = create(30), c = create(50);
  e.execute("select.set", { ids: [b] });
  const before = e.getSnapshot(), source = before.document.nodes[c];
  for (const params of [{ id: c, index: -1 }, { id: c, index: .5 }, { id: c, index: "x" }, { id: c, index: 1e9 }, { index: 2 }, { id: "999", index: 0 }, { id: before.document.currentPage, index: 0 }]) {
    expect(() => e.execute("node.reorder", params)).toThrow(); expect(e.getSnapshot()).toBe(before);
  }
  expect(e.execute("node.reorder", { id: c, index: "0px" })).toEqual({ ok: true });
  expect(e.getSnapshot().document.nodes[frame]).toMatchObject({ children: [c, a, b] });
  expect(e.getSnapshot().document.nodes[c]).toBe(source); expect(e.getSnapshot().selection).toEqual([b]);
  expect((await decodeFigcraft(await e.nativeSnapshot())).document.nodes[frame]).toMatchObject({ children: [c, a, b] });
  e.execute("node.reorder", { id: b, index: 80 }); e.execute("edit.undo");
  expect(e.getSnapshot().document).toBe(before.document);
  e.execute("edit.redo"); e.execute("node.reorder", { id: c, index: 80 });
  expect(e.getSnapshot().document.nodes[frame]).toMatchObject({ children: [a, b, c] });
});

it("a bad stroke cap names its property and lists all accepted spellings", () => {
  const e = new EditorEngine(), id = String(e.execute("shape.line").id);
  for (const key of ["startCap", "endCap", "strokeCap"]) {
    const before = e.getSnapshot();
    for (const bad of ["butt", "triangle", 19, null]) {
      expect(() => e.execute("node.set", { id, props: { opacity: .5, [key]: bad } })).toThrow(key + ": " + strokeCaps.join("|"));
      expect(e.getSnapshot()).toBe(before);
    }
    for (const cap of strokeCaps) {
      e.execute("node.set", { id, props: { [key]: cap } });
      const stroke = { ...(key !== "endCap" && { capStart: cap }), ...(key !== "startCap" && { capEnd: cap }) };
      expect(e.getSnapshot().document.nodes[id]).toMatchObject({ stroke });
    }
  }
});

it("frame_relative_ends_on_a_looping_parent_chain at the native node count", () => {
  const doc = newDocument();
  const group = (id: string, parent: string, x: number): GroupNode => ({
    id, parent, x, name: id, kind: "group", y: 0, children: [], width: 10, height: 10, fill: "transparent",
  });
  const corrupt = { ...doc, nodes: { ...doc.nodes, "2": group("2", "3", 2), "3": group("3", "2", 3) } };
  // Starting local transform 3, then three native parent hops (2 + 3 + 2).
  expect(frameRelative(corrupt, "3")).toEqual([1, 0, 0, 1, 10, 0]);
  expect(frameRelative(doc, "missing")).toEqual([1, 0, 0, 1, 0, 0]);
});
