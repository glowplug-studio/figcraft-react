import { describe, expect, it } from "vitest";
import { multiply, transformBounds, type Affine } from "../../src/engine/affine";
import { newDocument, type Document, type GroupNode, type RectangleNode } from "../../src/engine/document";
import { frameRelative, HierarchyDraft, pageForNode, rootIds, subtreeIds, worldTransform, zSorted } from "../../src/engine/hierarchy";

const group = (id: string, parent = "1", transform: Affine = [1, 0, 0, 1, 0, 0]): GroupNode => Object.freeze({
  id, kind: "group", name: `Group ${id}`, parent, children: Object.freeze([]), x: transform[4], y: transform[5],
  transform, width: 0, height: 0, fill: "transparent",
});
const rectangle = (id: string, parent = "1", transform: Affine = [1, 0, 0, 1, 0, 0]): RectangleNode => Object.freeze({
  id, kind: "rectangle", name: `Rectangle ${id}`, parent, x: transform[4], y: transform[5],
  transform, width: 20, height: 10, fill: "#ff0000",
});
function fixture(): Document {
  const draft = new HierarchyDraft(newDocument());
  draft.insert(group("2", "1", [0, 1, -1, 0, 100, 50]), "1");
  draft.insert(rectangle("3", "2", [2, 0.3, 0.5, 1, 10, 20]), "2");
  draft.insert(rectangle("4", "1", [1, 0, 0, 1, 200, 20]), "1");
  return draft.finish();
}

describe("hierarchy primitives", () => {
  it("composes world and frame-relative transforms through groups", () => {
    const doc = fixture();
    expect(worldTransform(doc, "3")).toEqual(multiply(worldTransform(doc, "2"), [2, 0.3, 0.5, 1, 10, 20]));
    expect(frameRelative(doc, "3")).toEqual(worldTransform(doc, "3"));
    expect(pageForNode(doc, "3")).toBe("1");
    expect(pageForNode(doc, "missing")).toBeUndefined();
    expect(subtreeIds(doc, "2")).toEqual(["2", "3"]);
    expect(rootIds(doc, ["3", "2", "4", "2"])).toEqual(["2", "4"]);
    expect(zSorted(doc, ["4", "3", "2"])).toEqual(["2", "3", "4"]);
  });

  it("reparents rotation and skew without moving the child in page space", () => {
    const before = fixture(), draft = new HierarchyDraft(before);
    const world = worldTransform(before, "3");
    draft.reparent("3", "1", 2);
    const after = draft.finish();
    expect(worldTransform(after, "3")).toEqual(world);
    expect(after.nodes["3"].parent).toBe("1");
    expect(after.nodes["1"].kind === "page" && after.nodes["1"].children).toEqual(["2", "4", "3"]);
    expect(before.nodes["3"].parent).toBe("2");
    expect(before.nodes["2"].kind === "group" && before.nodes["2"].children).toEqual(["3"]);
  });

  it("uses native pre-removal index semantics and rejects cycles", () => {
    const draft = new HierarchyDraft(fixture());
    draft.reparent("2", "1", 2);
    expect(draft.nodes["1"].kind === "page" && draft.nodes["1"].children).toEqual(["4", "2"]);
    expect(() => draft.reparent("2", "2")).toThrow();
    expect(() => draft.reparent("2", "3")).toThrow();
    expect(() => draft.reparent("1", "2")).toThrow();
    expect(() => draft.reparent("4", "3")).toThrow();
  });

  it("fits group bounds while preserving world transforms, then removes subtrees", () => {
    const before = fixture(), draft = new HierarchyDraft(before);
    const childWorld = worldTransform(before, "3");
    const originalBounds = transformBounds(childWorld, 20, 10);
    draft.fitToChildren("2");
    const fitted = draft.finish();
    expect(worldTransform(fitted, "3")).toEqual(childWorld);
    expect(transformBounds(worldTransform(fitted, "2"), (fitted.nodes["2"] as GroupNode).width, (fitted.nodes["2"] as GroupNode).height)).toEqual(originalBounds);
    const removing = new HierarchyDraft(fitted);
    removing.remove("2");
    expect(removing.finish().nodes["3"]).toBeUndefined();
    expect((removing.finish().nodes["1"] as { readonly children: readonly string[] }).children).toEqual(["4"]);
  });

  it("keeps drafts isolated and returns the original when unchanged", () => {
    const before = fixture(), draft = new HierarchyDraft(before);
    expect(draft.finish()).toBe(before);
    const child = draft.nodes["3"] as RectangleNode;
    draft.set(Object.freeze({ ...child, name: "Changed" }));
    expect(before.nodes["3"].name).toBe("Rectangle 3");
    expect(draft.finish().nodes["3"].name).toBe("Changed");
  });

  it("normalises touched group ancestors and cascades empty group removal", () => {
    const draft = new HierarchyDraft(newDocument());
    draft.insert(group("2"), "1");
    draft.insert(group("3", "2"), "2");
    draft.insert(rectangle("4", "3", [1, 0, 0, 1, 30, 40]), "3");
    draft.normaliseGroups();
    const fitted = draft.finish();
    expect(transformBounds(worldTransform(fitted, "2"), (fitted.nodes["2"] as GroupNode).width, (fitted.nodes["2"] as GroupNode).height)).toEqual({ x: 30, y: 40, width: 20, height: 10 });
    const removing = new HierarchyDraft(fitted);
    removing.remove("4");
    removing.normaliseGroups();
    const after = removing.finish();
    expect(after.nodes["2"]).toBeUndefined();
    expect(after.nodes["3"]).toBeUndefined();
    expect(after.nodes["1"].kind === "page" && after.nodes["1"].children).toEqual([]);
  });
});
