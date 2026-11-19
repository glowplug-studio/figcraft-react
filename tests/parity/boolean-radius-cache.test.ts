import { expect, it, vi } from "vitest";
import { booleanResult } from "../../src/engine/boolean-result";
import { flattenContours } from "../../src/engine/corners";
import type { BooleanNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import * as pathBoolean from "../../src/engine/path-boolean";
import { vectorFillPath } from "../../src/engine/vector-path";

// Restates crates/render/src/boolean_radius_tests.rs at bad07e44 (upstream #2222): the areas the rounded L draws, and
// `the_radius_keys_the_result_and_the_fold_is_not_redone`.
vi.mock("../../src/engine/path-boolean", async original => {
  const actual = await original<typeof import("../../src/engine/path-boolean")>();
  return { ...actual, booleanStep: vi.fn(actual.booleanStep) };
});

function lGroup() {
  const engine = new EditorEngine();
  engine.execute("shape.rectangle", { x: 0, y: 0, width: 200, height: 100 });
  engine.execute("shape.rectangle", { x: 150, y: 0, width: 100, height: 200 });
  engine.execute("bool.union", { ids: [2, 3] });
  const outline = () => { const doc = engine.getSnapshot().document; return vectorFillPath(booleanResult(doc, doc.nodes["4"] as BooleanNode, 0, true)!.network); };
  const area = () => Math.abs(flattenContours(outline(), 1e-4).reduce((sum, points) =>
    sum + points.reduce((s, p, i) => { const q = points[(i + 1) % points.length]; return s + (p.x * q.y - q.x * p.y) / 2; }, 0), 0));
  const radius = (r: number) => engine.execute("node.set", { ids: [4], props: { cornerRadius: r } });
  return { engine, outline, area, radius };
}

it("draws native's areas for the L at radius 20 and 40", () => {
  const { area, radius } = lGroup();
  expect(area()).toBeCloseTo(35000, 6);
  // Five convex corners cut off and one concave corner filled in: four net corners of (4 - pi) r^2 / 4 each.
  radius(20); expect(Math.abs(area() - 34656.6)).toBeLessThan(1);
  radius(40); expect(Math.abs(area() - 33626.6)).toBeLessThan(2);
});

it("reuses the fold when only the radius changes, and never draws a stale rounded path", () => {
  const { engine, outline, area, radius } = lGroup(), steps = vi.mocked(pathBoolean.booleanStep);
  const sharp = outline();
  radius(20); outline();
  const before = steps.mock.calls.length;
  radius(40); expect(Math.abs(area() - 33626.6)).toBeLessThan(2);
  expect(steps.mock.calls.length, "a new radius reuses the fold").toBe(before);
  radius(0); expect(outline(), "radius 0 draws the fold itself").toEqual(sharp);
  radius(20);
  const rounded = area();
  engine.execute("node.set", { ids: [3], props: { x: 160 } });
  expect(Math.abs(area() - rounded), "moving an operand does not draw a stale rounded path").toBeGreaterThan(1);
});
