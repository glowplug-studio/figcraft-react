import { describe, expect, it } from "vitest";
import { identity, type Affine } from "../../src/engine/affine";
import { rectanglePaints, type VectorNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { hitPaintedRegion, regionHatch, regionHatchSpacing } from "../../src/engine/vector-region-selection";

function setup() {
  const engine = new EditorEngine();
  const id = String(engine.execute("vector.create", { x: 0, y: 0, path: "M0 0H200V200H0Z M60 60H140V140H60Z", props: { fill: "#123456" } }).id);
  return { engine, id, document: engine.getRenderDocument() };
}
describe("native region hits and hatching", () => {
  it("scales point and segment clearance in screen pixels", () => {
    const { document, id } = setup();
    for (const zoom of [1, 4]) {
      for (const px of [3, 3.4, 3.6, 5]) {
        const at = 60 - px / zoom / Math.SQRT2;
        expect(hitPaintedRegion(document, id, { x: at, y: at }, zoom)).toBe(px > 3.5 ? 0 : undefined);
      }
      for (const px of [1.5, 1.9, 2.1, 2.6]) {
        expect(hitPaintedRegion(document, id, { x: 100, y: px / zoom }, zoom)).toBe(px > 2 ? 0 : undefined);
      }
    }
    expect(hitPaintedRegion(document, id, { x: NaN, y: 1 }, 1)).toBeUndefined();
  });
  it("chooses the last visible region and respects explicit empty overrides and native winding", () => {
    const { document, id } = setup(), node = document.nodes[id] as VectorNode, paint = rectanglePaints(node);
    const region = node.network.regions[0];
    const make = (visible: boolean, evenOdd: boolean) => ({ ...document, nodes: { ...document.nodes,
      [id]: { ...node, fill: "transparent", fills: [], network: { ...node.network, regions: [
        { ...region, fills: paint }, { ...region, fills: visible ? paint : [], winding: evenOdd ? "evenOdd" as const : "nonZero" as const },
      ] } } } });
    expect(hitPaintedRegion(make(false, false), id, { x: 25, y: 25 }, 1)).toBe(0);
    expect(hitPaintedRegion(make(true, false), id, { x: 25, y: 25 }, 1)).toBe(1);
    const clip = { x: 0, y: 0, width: 200, height: 200 };
    const hole = make(true, true);
    const midpointsInsideHole = (ruleDoc: typeof hole) => regionHatch(ruleDoc, id, [1], identity, clip).filter(([a,b]) => {
      const x = (a.x+b.x)/2, y = (a.y+b.y)/2;
      return x > 60 && x < 140 && y > 60 && y < 140;
    }).length;
    expect(midpointsInsideHole(hole)).toBe(0);
    expect(midpointsInsideHole(make(true, false))).toBeGreaterThan(0);
  });
  it("folds hatch spacing at octave boundaries", () => {
    for (const z of [.25, .5, 1, 2, 4]) expect(regionHatchSpacing(z)).toBe(8);
    expect(regionHatchSpacing(1.25)).toBe(10);
    expect(regionHatchSpacing(1.6)).toBe(6.4);
    for (const zoom of [0, -2, Infinity, NaN]) expect(regionHatchSpacing(zoom)).toBeUndefined();
  });
  it("hatches once, keeping the same diagonal phase when panning", () => {
    const { document, id } = setup(), clip = { x: -100, y: -100, width: 600, height: 600 };
    const lines = regionHatch(document, id, [0], identity, clip);
    expect(lines.length).toBeGreaterThan(5);
    expect(regionHatch(document, id, [0, 0], identity, clip)).toEqual(lines);
    for (const [a, b] of lines) {
      expect(a.x + a.y).toBeCloseTo(b.x + b.y, 8);
      expect(b.x).toBeGreaterThan(a.x);
      const k = (a.x + a.y) / Math.SQRT2 / 8;
      expect(k).toBeCloseTo(Math.round(k), 8);
    }
    const translated: Affine = [1, 0, 0, 1, 17, 23];
    const moved = regionHatch(document, id, [0], translated, clip).filter(([a,b]) => Math.hypot(b.x-a.x,b.y-a.y) > 1e-8);
    const original = lines.filter(([a,b]) => Math.hypot(b.x-a.x,b.y-a.y) > 1e-8);
    expect(moved).toHaveLength(original.length);
    moved.forEach((line, i) => line.forEach((p,j) => {
      expect(p.x - original[i][j].x).toBeCloseTo(17, 8);
      expect(p.y - original[i][j].y).toBeCloseTo(23, 8);
    }));
  });
});
