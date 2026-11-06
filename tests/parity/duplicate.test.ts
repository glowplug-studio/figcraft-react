import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { executeDuplicate } from "../../src/engine/duplicate";
import { decodeFigcraft } from "../../src/engine/file-format";
import { boundsOf } from "../../src/engine/viewport";
import { subtreeIds } from "../../src/engine/hierarchy";
import type { LayerNode } from "../../src/engine/document";

const make = (e: EditorEngine, params: Record<string, unknown> = {}, frame = false) => String(e.execute(frame ? "frame.create" : "shape.rectangle", params).id);
const copy = (e: EditorEngine, params: Record<string, unknown> = {}) => (e.execute("edit.duplicate", params).ids as string[])[0];
const node = (e: EditorEngine, id: string) => e.getSnapshot().document.nodes[id] as LayerNode;

describe("native duplicate maps and repeated spacing", () => {
  it("duplicates in place, selects the copy and repeats a moved step", () => {
    const e = new EditorEngine(), original = make(e);
    const first = copy(e); expect(node(e, first)).toMatchObject({ x: 0, y: 0, name: "Rectangle" });
    e.execute("node.set", { props: { x: 150, y: 20 } });
    const second = copy(e), third = copy(e);
    expect(node(e, second)).toMatchObject({ x: 300, y: 40 }); expect(node(e, third)).toMatchObject({ x: 450, y: 60 });
    expect(node(e, original)).toMatchObject({ x: 0, y: 0 }); expect(e.getSnapshot().selection).toEqual([third]);
  });
  it("copies top-level frames with a100-unit gap and explicit offsets override it", () => {
    const e = new EditorEngine(); make(e, { x: 10, y: 20, width: 200 }, true);
    expect(node(e, copy(e))).toMatchObject({ x: 310, y: 20 });
    expect(node(e, copy(e))).toMatchObject({ x: 610, y: 20 });
    expect(node(e, copy(e, { dy: "5" }))).toMatchObject({ x: 610, y: 25 });
    expect(node(e, copy(e, { dx: 0 }))).toMatchObject({ x: 610, y: 25 });
  });
  it("forgets the repeated step when selection leaves and returns", () => {
    const e = new EditorEngine(), original = make(e), first = copy(e);
    e.execute("transform.nudge", { dx: 1, big: true });
    e.execute("select.set", { ids: [original] }); e.execute("select.set", { ids: [first] });
    expect(node(e, copy(e))).toMatchObject({ x: 10 });
  });
  it("keeps repeat state across reordered selections and uses combined bounds", () => {
    const e = new EditorEngine(), a = make(e), b = make(e, { x: 200 });
    const first = e.execute("edit.duplicate", { ids: [b, a] }).ids as string[];
    e.execute("transform.move", { dx: 40, dy: -10 }); e.execute("select.set", { ids: [...first].reverse() });
    const second = e.execute("edit.duplicate").ids as string[];
    expect(second.map(id => node(e, id).x)).toEqual([80, 280]); expect(second.map(id => node(e, id).y)).toEqual([-20, -20]);
  });
  it("maps every nested layer, filters descendant targets and preserves supported properties", () => {
    const e = new EditorEngine(), frame = make(e, { name: "Board", width: 300, props: { clip: false, rotation: 20 } }, true);
    const a = make(e, { parent: frame, name: "A", x: 20, y: 30, props: { opacity: 0.4, constraints: { horizontal: "right", vertical: "bottom" }, fill: "#aabbcc" } });
    const b = make(e, { parent: frame, name: "B", x: 100 });
    const group = String(e.execute("object.group", { ids: [a, b] }).id);
    const before = e.getSnapshot().document;
    const result = e.execute("edit.duplicate", { ids: [a, frame, group, frame], map: true });
    const map = result.map as Record<string, string>, ids = result.ids as string[];
    expect(ids).toEqual([map[frame]]); expect(Object.keys(map).sort()).toEqual([frame, group, a, b].sort());
    const copied = e.getSnapshot().document;
    for (const oldId of subtreeIds(before, frame)) {
      const old = before.nodes[oldId] as LayerNode, fresh = copied.nodes[map[oldId]] as LayerNode;
      expect(fresh).not.toBe(old); expect(fresh.name).toBe(old.name); expect(fresh.kind).toBe(old.kind);
      expect(fresh.width).toBeCloseTo(old.width); expect(fresh.height).toBeCloseTo(old.height);
      expect(fresh.constraints).toEqual(old.constraints); expect(fresh.opacity).toBe(old.opacity); expect(fresh.fill).toBe(old.fill);
      if (old.kind !== "rectangle" && fresh.kind !== "rectangle") expect(fresh.children).toEqual(old.children.map(id => map[id]));
      expect(fresh.parent).toBe(oldId === frame ? old.parent : map[old.parent]);
    }
    expect(node(e, map[frame])).toMatchObject({ clip: false });
    e.execute("node.set", { id: map[a], props: { fill: "red" } }); expect(e.getSnapshot().document.nodes[a]).toBe(before.nodes[a]);
    e.execute("edit.undo"); e.execute("edit.undo"); expect(e.getSnapshot().document).toBe(before);
  });
  it("inserts multiple copies immediately above their sources in paint order", () => {
    const e = new EditorEngine(), a = make(e), b = make(e), c = make(e);
    const ids = e.execute("edit.duplicate", { ids: [c, a] }).ids as string[];
    const page = e.getSnapshot().document.nodes["1"];
    expect(page.kind !== "rectangle" && page.children).toEqual([a, ids[0], b, c, ids[1]]);
    expect(Object.keys(e.execute("edit.duplicate", { map: false }))).toEqual(["ids"]);
  });
  it("distinguishes parent-space explicit offsets from page-space remembered offsets", () => {
    const e = new EditorEngine(), frame = make(e, { props: { rotation: 30 } }, true);
    make(e, { parent: frame, x: 50, y: 50, width: 40 });
    const first = copy(e, { dx: 100, dy: 20 }); expect(node(e, first)).toMatchObject({ x: 150, y: 70 });
    const old = boundsOf(e.getSnapshot().document, [first])!;
    e.execute("transform.move", { dx: 20, dy: 40 });
    const moved = boundsOf(e.getSnapshot().document, [first])!, second = copy(e), after = boundsOf(e.getSnapshot().document, [second])!;
    const source = boundsOf(e.getSnapshot().document, ["3"])!;
    expect(moved.x - old.x).toBeCloseTo(20); expect(moved.y - old.y).toBeCloseTo(40);
    expect(after.x - moved.x).toBeCloseTo(moved.x - source.x); expect(after.y - moved.y).toBeCloseTo(moved.y - source.y);
  });
  it("does not retain a stale repeat after undo and redo", () => {
    const e = new EditorEngine(); make(e); copy(e); e.execute("transform.move", { dx: 40 }); copy(e);
    e.execute("edit.undo"); e.execute("edit.redo"); expect(node(e, copy(e)).x).toBe(80);
  });
  it("missing sources disable repeat and explicit zero overrides a previous step", () => {
    const e = new EditorEngine(), a = make(e), b = copy(e); e.execute("transform.move", { dx: 40 });
    e.execute("edit.delete", { ids: [a] }); e.execute("select.set", { ids: [b] }); expect(node(e, copy(e)).x).toBe(40);
    e.execute("transform.move", { dx: 10 }); expect(node(e, copy(e, { dx: 0 })).x).toBe(50);
  });
  it("allocates exact u64 IDs and rejects exhausted subtrees without changing source", () => {
    const e = new EditorEngine(), frame = make(e, {}, true); make(e, { parent: frame });
    const before = e.getSnapshot().document, maximum = 18446744073709551615n;
    expect(() => executeDuplicate(before, [frame], maximum, {})).toThrow("exhausted"); expect(e.getSnapshot().document).toBe(before);
    const result = executeDuplicate(before, [frame], maximum - 1n, { map: true });
    expect(result.result.ids).toEqual([String(maximum - 1n)]); expect(result.document.nodes[String(maximum)]).toMatchObject({ parent: String(maximum - 1n) });
    expect(() => executeDuplicate(result.document, result.result.ids, result.nextId, {})).toThrow("exhausted");
  });
  it("rejects malformed targets and overflowing transforms atomically", () => {
    const e = new EditorEngine(), a = make(e, { x: 1e308, width: 1 }); const before = e.getSnapshot();
    for (const params of [{ ids: [] }, { ids: ["1"] }, { ids: ["missing"] }, { ids: [a], dx: 1e308 }, { dx: 1, unknown: true }]) {
      expect(() => e.execute("edit.duplicate", params)).toThrow(); expect(e.getSnapshot()).toBe(before);
    }
    expect(copy(e, { dx: 0 })).toBe("3");
  });
  it("native save retains copied hierarchy and excludes remembered duplication state", async () => {
    const e = new EditorEngine(), frame = make(e, {}, true); make(e, { parent: frame, x: 20 });
    const copied = copy(e, { ids: [frame] }); const decoded = await decodeFigcraft(await e.nativeSnapshot());
    expect(subtreeIds(decoded.document, copied)).toHaveLength(2); expect(decoded.document).not.toHaveProperty("lastDuplicate");
    expect(decoded.document.nodes[copied]).toMatchObject({ x: 200 });
  });
});
