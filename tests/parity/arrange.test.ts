import { isLeaf } from "../../src/engine/document";
import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { canAlign } from "../../src/engine/arrange";
import { boundsOf } from "../../src/engine/viewport";
import { pageOf } from "../../src/engine/document";
import { worldTransform } from "../../src/engine/hierarchy";
import { decodeFigcraft } from "../../src/engine/file-format";

function rectangle(engine: EditorEngine, x = 0, y = 0, width = 10, height = 10, parent?: string): string {
  return String(engine.execute("shape.rectangle", { x, y, width, height, ...(parent ? { parent } : {}) }).id);
}
function box(engine: EditorEngine, id: string) { return boundsOf(engine.getSnapshot().document, [id])!; }
function children(engine: EditorEngine, id: string) {
  const node = engine.getSnapshot().document.nodes[id];
  if (isLeaf(node)) throw new Error("Container required");
  return node.children;
}

describe("native movement and arrangement", () => {
  it("matches upstream align_distribute_zorder and outermost-edge fixtures", () => {
    const engine = new EditorEngine(), a = rectangle(engine), b = rectangle(engine, 30, 20), c = rectangle(engine, 100, 5);
    engine.execute("align.top", { ids: [a, b, c] }); expect(box(engine, b).y).toBe(0);
    engine.execute("distribute.horizontal", { ids: [a, b, c] }); expect(box(engine, b).x).toBe(50);
    engine.execute("arrange.back", { ids: [c] }); expect(pageOf(engine.getSnapshot().document).children[0]).toBe(c);
    engine.execute("node.set", { id: b, props: { x: 150, y: 150, width: 500, height: 500 } });
    engine.execute("node.set", { id: c, props: { x: 160, y: 160 } });
    engine.execute("distribute.horizontal", { ids: [a, b, c] });
    engine.execute("distribute.vertical", { ids: [a, b, c] });
    expect([a, b, c].map(id => box(engine, id).x)).toEqual([0, 75, 640]);
    expect([a, b, c].map(id => box(engine, id).y)).toEqual([0, 75, 640]);
  });

  it.each([
    ["left", [0, 0]], ["hcenter", [55, 45]], ["right", [110, 90]],
    ["top", [0, 0]], ["vcenter", [50, 40]], ["bottom", [100, 80]],
  ] as const)("aligns %s using page-space bounds", (side, expected) => {
    const engine = new EditorEngine(), a = rectangle(engine, 0, 0, 10, 20), b = rectangle(engine, 90, 80, 30, 40);
    engine.execute(`align.${side}`, { ids: [a, b] });
    const horizontal = ["left", "hcenter", "right"].includes(side);
    expect([a, b].map(id => horizontal ? box(engine, id).x : box(engine, id).y)).toEqual(expected);
    engine.execute("edit.undo"); expect(box(engine, b)).toMatchObject({ x: 90, y: 80 });
  });

  it("aligns one child to its frame, but a lone top-level layer is a no-op", () => {
    const engine = new EditorEngine(), frame = String(engine.execute("frame.create", { width: 200, height: 100 }).id);
    const child = rectangle(engine, 20, 30, 10, 10, frame), loose = rectangle(engine, 300, 5);
    const document = engine.getSnapshot().document;
    expect(canAlign(document, [])).toBe(false); expect(canAlign(document, [frame, child])).toBe(false); expect(canAlign(document, [child])).toBe(true);
    const before = engine.getSnapshot(); engine.execute("align.right", { ids: [loose] }); expect(engine.getSnapshot()).toBe(before);
    engine.execute("align.right", { id: child }); expect(box(engine, child).x).toBe(190);
  });

  it("distinguishes world move from parent-space nudge under a rotated frame", () => {
    const engine = new EditorEngine(), frame = String(engine.execute("frame.create", { width: 200, height: 200 }).id);
    const child = rectangle(engine, 20, 30, 10, 10, frame);
    engine.execute("node.set", { id: frame, props: { rotation: 90 } });
    const original = box(engine, child);
    engine.execute("transform.move", { ids: [child], dx: 13, dy: -7 });
    expect(box(engine, child).x).toBeCloseTo(original.x + 13); expect(box(engine, child).y).toBeCloseTo(original.y - 7);
    engine.execute("edit.undo"); engine.execute("transform.nudge", { ids: [child], dx: 1, big: "yes" });
    expect(box(engine, child).x).toBeCloseTo(original.x); expect(box(engine, child).y).toBeCloseTo(original.y - 10);
  });

  it("moves roots once, positions selection top-left, and preserves group world geometry", () => {
    const engine = new EditorEngine(), a = rectangle(engine, 20, 30), b = rectangle(engine, 100, 30);
    const group = String(engine.execute("object.group", { ids: [a, b] }).id);
    engine.execute("transform.move", { ids: [group, a, group], dx: 5, dy: 7 });
    expect(box(engine, a)).toMatchObject({ x: 25, y: 37 });
    engine.execute("transform.moveTo", { ids: [group], x: -20, y: -30 });
    expect(box(engine, group)).toMatchObject({ x: -20, y: -30 });
    const beforeB = worldTransform(engine.getSnapshot().document, b);
    engine.execute("transform.move", { id: a, dx: -10, dy: -10 });
    expect(box(engine, group)).toMatchObject({ x: -30, y: -40 });
    expect(worldTransform(engine.getSnapshot().document, b)).toEqual(beforeB);
  });

  it.each(["horizontal", "vertical"])("distributes %s with explicit negative gaps and packs two layers", axis => {
    const engine = new EditorEngine(), a = rectangle(engine, 0, 0, 20, 20), b = rectangle(engine, 100, 100, 30, 30);
    const before = engine.getSnapshot(); engine.execute(`distribute.${axis}`, { ids: [a, b] }); expect(engine.getSnapshot()).toBe(before);
    engine.execute(`distribute.${axis}`, { ids: [b, a], spacing: -5 });
    expect(box(engine, b)[axis === "horizontal" ? "x" : "y"]).toBe(15);
    engine.execute(axis === "horizontal" ? "arrange.packH" : "arrange.packV", { ids: [a, b] });
    expect(box(engine, b)[axis === "horizontal" ? "x" : "y"]).toBe(20);
  });

  it("tidies overlapping-centre rows using largest dimensions and inferred or explicit gap", () => {
    const engine = new EditorEngine(), a = rectangle(engine, 0, 0, 20, 20), b = rectangle(engine, 40, 4, 30, 10), c = rectangle(engine, 5, 100, 10, 40);
    engine.execute("arrange.tidy", { ids: [c, b, a] });
    expect([a, b, c].map(id => [box(engine, id).x, box(engine, id).y])).toEqual([[0, 0], [50, 0], [0, 60]]);
    engine.execute("edit.undo"); engine.execute("arrange.tidy", { ids: [c, b, a], spacing: "5px" });
    expect([a, b, c].map(id => [box(engine, id).x, box(engine, id).y])).toEqual([[0, 0], [35, 0], [0, 45]]);
  });

  it.each([
    ["front", [0, 3, 1, 2]], ["back", [1, 2, 0, 3]], ["forward", [0, 3, 1, 2]], ["backward", [1, 2, 0, 3]],
  ] as const)("preserves a selected block's order when moving %s", (direction, order) => {
    const engine = new EditorEngine(), ids = Array.from({ length: 4 }, () => rectangle(engine));
    engine.execute(`arrange.${direction}`, { ids: [ids[2], ids[1]] });
    expect(pageOf(engine.getSnapshot().document).children).toEqual(order.map(index => ids[index]));
    engine.execute("edit.undo"); expect(pageOf(engine.getSnapshot().document).children).toEqual(ids);
  });

  it("stacks independently across parents and keeps boundary no-ops out of history", () => {
    const engine = new EditorEngine(), fa = String(engine.execute("frame.create").id), fb = String(engine.execute("frame.create", { x: 300 }).id);
    const a = [rectangle(engine, 0, 0, 10, 10, fa), rectangle(engine, 0, 0, 10, 10, fa)];
    const b = Array.from({ length: 3 }, () => rectangle(engine, 0, 0, 10, 10, fb));
    engine.execute("arrange.back", { ids: [a[1], b[2]] });
    expect(children(engine, fa)).toEqual([a[1], a[0]]); expect(children(engine, fb)).toEqual([b[2], b[0], b[1]]);
    engine.execute("arrange.back", { ids: [b[1], a[0], b[0]] });
    expect(children(engine, fa)).toEqual(a); expect(children(engine, fb)).toEqual([b[0], b[1], b[2]]);
    const before = engine.getSnapshot(); engine.execute("arrange.front", { ids: [b[2]] }); expect(engine.getSnapshot()).toBe(before);
  });

  it("rejects invalid targets and overflowing multi-layer movement atomically", () => {
    const engine = new EditorEngine(), a = rectangle(engine), b = rectangle(engine, 1e308);
    const before = engine.getSnapshot();
    for (const ids of [[], [a, "bad"], [a, "9999"], "bad"]) {
      expect(() => engine.execute("transform.move", { ids, dx: 10 })).toThrow(); expect(engine.getSnapshot()).toBe(before);
    }
    expect(() => engine.execute("transform.move", { ids: [a, b], dx: 1e308 })).toThrow(); expect(engine.getSnapshot()).toBe(before);
    engine.execute("transform.move", { ids: null, id: a, dx: "bad" }); expect(engine.getSnapshot()).toBe(before);
    engine.execute("transform.nudge", { id: a, dx: 0, dy: 0 }); expect(engine.getSnapshot()).toBe(before);
  });

  it("round-trips arranged geometry and order through native files with one-step history", async () => {
    const engine = new EditorEngine(), a = rectangle(engine), b = rectangle(engine, 40);
    engine.execute("select.set", { ids: [a, b] }); engine.execute("transform.move", { dx: 30, dy: 20 });
    engine.execute("arrange.front", { id: a });
    const decoded = await decodeFigcraft(await engine.nativeSnapshot());
    expect(pageOf(decoded.document).children).toEqual([b, a]); expect(boundsOf(decoded.document, [a])).toMatchObject({ x: 30, y: 20 });
    engine.execute("edit.undo"); expect(pageOf(engine.getSnapshot().document).children).toEqual([a, b]);
    engine.execute("edit.undo"); expect(box(engine, a)).toMatchObject({ x: 0, y: 0 });
    engine.execute("edit.redo"); expect(box(engine, a)).toMatchObject({ x: 30, y: 20 });
  });
});
