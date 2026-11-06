import { describe, expect, it } from "vitest";
import { transformBounds, type Affine } from "../../src/engine/affine";
import { newDocument, type Document, type GroupNode, type RectangleNode } from "../../src/engine/document";
import { HierarchyDraft, worldTransform } from "../../src/engine/hierarchy";
import { setRectangleProperties } from "../../src/engine/properties";

function fixture(): Document {
  const draft = new HierarchyDraft(newDocument());
  const group: GroupNode = Object.freeze({ id: "2", kind: "group", name: "Outer", parent: "1", children: [],
    x: 100, y: 50, width: 100, height: 60, fill: "transparent", transform: [0, 1, -1, 0, 100, 50] as Affine });
  const child: RectangleNode = Object.freeze({ id: "3", kind: "rectangle", name: "Skewed", parent: "2",
    x: 10, y: 15, width: 20, height: 10, fill: "#ff0000", transform: [1, 0.25, 0.3, -1, 10, 15] as Affine });
  draft.insert(group, "1"); draft.insert(child, "2"); draft.normaliseGroups();
  return draft.finish();
}
function closeAffine(actual: readonly number[], expected: readonly number[]): void {
  for (let i = 0; i < 6; i++) expect(actual[i]).toBeCloseTo(expected[i], 9);
}

describe("group geometry and appearance properties", () => {
  it("scales descendants while retaining their rotation, skew and reflection", () => {
    const before = fixture(), group = before.nodes["2"] as GroupNode, child = before.nodes["3"] as RectangleNode;
    const after = setRectangleProperties(before, ["2"], { props: { width: group.width * 2, height: group.height * 1.5 } });
    const scaled = after.nodes["3"] as RectangleNode;
    // Native applies height then width, scaling each child's own axes at each step.
    const widthFactor = Math.hypot(1, .25 * 1.5) / Math.hypot(1, .25) * Math.hypot(2, .25) / Math.hypot(1, .25);
    const heightFactor = Math.hypot(.3, 1.5) / Math.hypot(.3, 1) * Math.hypot(.6, 1) / Math.hypot(.3, 1);
    expect(scaled.width).toBeCloseTo(child.width * widthFactor, 9);
    expect(scaled.height).toBeCloseTo(child.height * heightFactor, 9);
    expect(scaled.transform?.slice(0, 4)).toEqual(child.transform?.slice(0, 4));
    const fitted = after.nodes["2"] as GroupNode;
    expect(fitted.width).toBeGreaterThan(group.width);
    const childBox = transformBounds(scaled.transform ?? [1, 0, 0, 1, scaled.x, scaled.y], scaled.width, scaled.height);
    expect(fitted.width).toBeCloseTo(childBox.width, 9);
    expect(before.nodes["3"]).toBe(child);
  });

  it("treats a group's child X/Y as page-relative despite rotation and refitting", () => {
    const before = fixture(), child = before.nodes["3"] as RectangleNode;
    const prior = worldTransform(before, "3");
    const after = setRectangleProperties(before, ["3"], { props: { x: prior[4] + 25 } });
    const moved = worldTransform(after, "3");
    expect(moved[4]).toBeCloseTo(prior[4] + 25, 9);
    expect(moved[5]).toBeCloseTo(prior[5], 9);
    expect(moved.slice(0, 4)).toEqual(prior.slice(0, 4));
    const group = after.nodes["2"] as GroupNode;
    expect(transformBounds(worldTransform(after, "2"), group.width, group.height))
      .toEqual(transformBounds(moved, child.width, child.height));
  });

  it("rejects an invalid multi-target edit atomically", () => {
    const before = fixture();
    expect(() => setRectangleProperties(before, [], { ids: ["3", "999"], props: { width: 80 } })).toThrow();
    expect(before.nodes["3"]).toMatchObject({ width: 20 });
  });
});
