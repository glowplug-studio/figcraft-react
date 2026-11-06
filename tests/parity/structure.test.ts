import { isLeaf } from "../../src/engine/document";
import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { HierarchyDraft, worldTransform } from "../../src/engine/hierarchy";
import { decodeFigcraft } from "../../src/engine/file-format";
import { newDocument, type Document, type GroupNode, type NodeId, type RectangleNode } from "../../src/engine/document";
import { executeStructure } from "../../src/engine/structure";
import type { Affine } from "../../src/engine/affine";

function layer(engine: EditorEngine, x: number, y = 0): NodeId {
  return String(engine.execute("shape.rectangle", { x, y, width: 20, height: 10 }).id);
}
function children(document: Document, id: NodeId): readonly NodeId[] {
  const node = document.nodes[id];
  if (!node || isLeaf(node)) throw new Error("Expected container");
  return node.children;
}
function closeAffine(actual: readonly number[], expected: readonly number[]): void {
  for (let i = 0; i < 6; i++) expect(actual[i]).toBeCloseTo(expected[i], 9);
}

describe("native group structure commands", () => {
  it("preserves skew through grouping and ungrouping inside a rotated group", () => {
    const draft = new HierarchyDraft(newDocument());
    const outer: GroupNode = Object.freeze({ id: "2", kind: "group", name: "Outer", parent: "1", children: [],
      x: 100, y: 50, width: 100, height: 80, fill: "transparent", transform: [0, 1, -1, 0, 100, 50] as Affine });
    const skewed: RectangleNode = Object.freeze({ id: "3", kind: "rectangle", name: "Skewed", parent: "2",
      x: 10, y: 15, width: 20, height: 10, fill: "#abc", transform: [1, 0.2, 0.3, -1, 10, 15] as Affine });
    draft.insert(outer, "1"); draft.insert(skewed, "2"); draft.normaliseGroups();
    const before = draft.finish(), world = worldTransform(before, "3");
    const grouped = executeStructure("object.group", before, [], 4n, { ids: ["3"] });
    const nested = String(grouped.result.id);
    closeAffine(worldTransform(grouped.document, "3"), world);
    expect(children(grouped.document, "2")).toEqual([nested]);
    const ungrouped = executeStructure("object.ungroup", grouped.document, [nested], grouped.nextId, { ids: [nested] });
    closeAffine(worldTransform(ungrouped.document, "3"), world);
    expect(children(ungrouped.document, "2")).toEqual(["3"]);
  });

  it("groups at the topmost selected slot, filters selected descendants, then ungroups without moving rotated children", () => {
    const engine = new EditorEngine();
    const a = layer(engine, 0), b = layer(engine, 40), c = layer(engine, 80);
    engine.execute("node.set", { id: b, props: { rotation: 35 } });
    const before = engine.getSnapshot().document, worldA = worldTransform(before, a), worldB = worldTransform(before, b);
    const g = String(engine.execute("object.group", { ids: [b, a] }).id);
    const grouped = engine.getSnapshot().document;
    expect(children(grouped, "1")).toEqual([g, c]);
    expect(children(grouped, g)).toEqual([a, b]);
    closeAffine(worldTransform(grouped, a), worldA);
    closeAffine(worldTransform(grouped, b), worldB);
    const outer = String(engine.execute("object.group", { ids: [a, g, c] }).id);
    expect(children(engine.getSnapshot().document, outer)).toEqual([g, c]);
    engine.execute("node.set", { id: outer, props: { rotation: 30 } });
    const rotated = engine.getSnapshot().document;
    const rotatedA = worldTransform(rotated, a), rotatedB = worldTransform(rotated, b);
    engine.execute("object.ungroup", { ids: [outer] });
    const ungrouped = engine.getSnapshot().document;
    expect(ungrouped.nodes[outer]).toBeUndefined();
    expect(children(ungrouped, g)).toEqual([a, b]);
    closeAffine(worldTransform(ungrouped, a), rotatedA);
    closeAffine(worldTransform(ungrouped, b), rotatedB);
    expect(engine.getSnapshot().selection).toEqual([g, c]);
  });

  it("reparents a block at its final index and keeps world transforms", () => {
    const engine = new EditorEngine();
    const a = layer(engine, 0), b = layer(engine, 40), c = layer(engine, 80), d = layer(engine, 120);
    const before = engine.getSnapshot().document, wa = worldTransform(before, a), wd = worldTransform(before, d);
    engine.execute("node.reparent", { ids: [d, a], parent: "1", index: 1 });
    const after = engine.getSnapshot().document;
    expect(children(after, "1")).toEqual([b, a, d, c]);
    closeAffine(worldTransform(after, a), wa);
    closeAffine(worldTransform(after, d), wd);
  });

  it("removes empty groups, and rejects failed transactions without advancing the allocator", () => {
    const engine = new EditorEngine();
    const a = layer(engine, 0), g = String(engine.execute("object.group", { ids: [a] }).id);
    const snapshot = engine.getSnapshot();
    for (const [command, params] of [
      ["node.reparent", { ids: [g], parent: g }],
      ["node.reparent", { ids: [a], parent: a }],
      ["node.reparent", { ids: [a, "999"], parent: "1" }],
      ["object.group", { ids: [a, "999"] }],
    ] as const) expect(() => engine.execute(command, params)).toThrow();
    expect(engine.getSnapshot()).toBe(snapshot);
    engine.execute("edit.delete", { ids: [a] });
    expect(engine.getSnapshot().document.nodes[g]).toBeUndefined();
    const created = String(engine.execute("shape.rectangle").id);
    expect(BigInt(created)).toBe(BigInt(g) + 1n);
    const empty = String(engine.execute("node.create", { type: "group" }).id);
    expect(engine.getSnapshot().document.nodes[empty]).toBeUndefined();
    const sameProps = String(engine.execute("node.create", { type: "group", name: "Empty", props: { name: "Empty" } }).id);
    expect(engine.getSnapshot().document.nodes[sameProps]).toBeUndefined();
  });

  it("keeps group commands to one undo step and round-trips native hierarchy", async () => {
    const engine = new EditorEngine();
    const a = layer(engine, 10), b = layer(engine, 50);
    const before = engine.getSnapshot().document;
    const g = String(engine.execute("object.group", { ids: [a, b] }).id);
    const grouped = engine.getSnapshot().document;
    engine.execute("edit.undo");
    expect(engine.getSnapshot().document).toBe(before);
    engine.execute("edit.redo");
    expect(engine.getSnapshot().document).toBe(grouped);
    const decoded = await decodeFigcraft(await engine.nativeSnapshot());
    expect(children(decoded.document, g)).toEqual([a, b]);
    expect(decoded.document.nodes[g]).toMatchObject({ kind: "group", parent: "1" } satisfies Partial<GroupNode>);
    closeAffine(worldTransform(decoded.document, a), worldTransform(grouped, a));
    closeAffine(worldTransform(decoded.document, b), worldTransform(grouped, b));
  });
});
