import { describe, expect, it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import type { VectorNode } from "../../src/engine/document";
import { freezeNetwork } from "../../src/engine/vector-network";
import { hitsVector, vectorPaintRegions } from "../../src/engine/vector-presentation";
import { isClosedShape, shapePath, strokeGeometry } from "../../src/engine/shape-path";
import { vectorArrowhead, vectorPathEnd, vectorStrokePlan } from "../../src/engine/vector-stroke";

function vector(path: string, props: Record<string, unknown> = {}): VectorNode {
  const engine = new EditorEngine(), id = String(engine.execute("vector.create", { path, props }).id);
  return engine.getSnapshot().document.nodes[id] as VectorNode;
}
const ring = "M0 0H100V100H0Z M25 25H75V75H25Z";
describe("vector presentation and native geometry selection", () => {
  it("separates open stroke runs from fill geometry and never closes their hit path", () => {
    const open = vector("M0 0L100 0L100 100");
    expect(vectorPaintRegions(open)).toEqual([]); expect(isClosedShape(open)).toBe(false);
    expect(hitsVector(open, { x: 50, y: 50 }, 2)).toBe(false); expect(hitsVector(open, { x: 100, y: 50 }, 2)).toBe(true);
    const mixed = vector("M0 0H20V20H0Z M50 0L100 100", { stroke: "black" });
    expect(shapePath(mixed).filter(c => c[0] === "M")).toHaveLength(1); expect(strokeGeometry(mixed).filter(c => c[0] === "M")).toHaveLength(2);
    // Native legacy selection follows shape_path, although strokes paint all segments.
    expect(hitsVector(mixed, { x: 75, y: 50 }, 2)).toBe(false);
  });
  it("uses any-region even-odd for legacy fills, preserving nonzero and invisible empty-fill selection", () => {
    const node = vector(ring), odd = { ...node, network: freezeNetwork({ ...node.network, regions: node.network.regions.map(r => ({ ...r, winding: "evenOdd" })) }) };
    expect(hitsVector(node, { x: 50, y: 50 }, 0)).toBe(true); expect(hitsVector(odd, { x: 50, y: 50 }, 0)).toBe(false);
    expect(vectorPaintRegions(odd)[0].rule).toBe("evenodd");
    const ghost = vector("M0 0H100V100H0Z", { fill: null }); expect(hitsVector(ghost, { x: 50, y: 50 }, 0)).toBe(true);
    const explicit = { ...ghost, network: freezeNetwork({ ...ghost.network, regions: ghost.network.regions.map(r => ({ ...r, fills: [] })) }) };
    expect(hitsVector(explicit, { x: 50, y: 50 }, 0)).toBe(false);
  });
  it("evaluates region paints independently, inheriting only when absent", () => {
    const node = vector("M0 0H40V40H0Z M60 0H100V40H60Z"), loops = node.network.regions[0].loops;
    const styled = Object.freeze({ ...node, network: freezeNetwork({ ...node.network, regions: [{ loops: [loops[0]], winding: "nonZero", fills: [] }, { loops: [loops[1]], winding: "evenOdd", paintSpace: { width: -1, height: 0, transform: [0, 0, 0, 0, 0, 0] } }] }) });
    const regions = vectorPaintRegions(styled); expect(regions[0].paints).toEqual([]); expect(regions[1].paints).toHaveLength(1);
    expect(hitsVector(styled, { x: 20, y: 20 }, 0)).toBe(false); expect(hitsVector(styled, { x: 80, y: 20 }, 0)).toBe(true);
    expect(vectorPaintRegions(styled)).toBe(regions);
  });
  it("uses rounded region geometry and native stroke-only tolerance", () => {
    const rounded = vector("M0 0H100V100H0Z", { cornerRadius: 30 });
    expect(hitsVector(rounded, { x: 1, y: 1 }, 0)).toBe(false); expect(hitsVector(rounded, { x: 30, y: 1 }, 0)).toBe(true);
    const line = vector("M0 0L100 0", { fill: null, stroke: "black" });
    expect(hitsVector(line, { x: 50, y: 4 }, 2)).toBe(true); expect(hitsVector(line, { x: 50, y: 6 }, 2)).toBe(false);
  });
});
describe("vector stroke styles and endpoint mathematics", () => {
  it("centres open networks and fits the native half dash separately to each run", () => {
    const node = vector("M0 0H100 M0 20H50", { strokeAlign: "outside", strokeWeight: 10, dashes: [10, 10] });
    const plan = vectorStrokePlan(node); expect(plan.align).toBe("center"); expect(plan.width).toBe(10);
    expect(plan.bands.map(b => b.dash)).toEqual([{ pattern: [10, 10], offset: 5 }, { pattern: [12.5, 12.5], offset: 6.25 }]);
    expect(vectorStrokePlan(node)).toBe(plan);
  });
  it("breaks differing point joins, uses endpoint caps, and suppresses overrides for dashes/profiles/brushes", () => {
    const base = vector("M0 0H50V50", { strokeWeight: 10, strokeJoin: "miter", strokeCap: "square" });
    const styled = Object.freeze({ ...base, network: freezeNetwork({ ...base.network, vertices: base.network.vertices.map((v, i) => ({ ...v, ...(i === 1 ? { join: "round" as const } : { cap: "round" as const }) })) }) });
    const plan = vectorStrokePlan(styled); expect(plan.bands).toHaveLength(3); expect(plan.bands.map(b => b.caps)).toEqual([["round", "none"], ["none", "round"], ["none", "none"]]); expect(plan.bands[2].join).toBe("round");
    const same = { ...styled, stroke: { ...styled.stroke!, join: "round" as const } }; expect(vectorStrokePlan(same).bands).toHaveLength(1);
    const dashed = { ...styled, stroke: { ...styled.stroke!, dashes: [10, 10] } }; expect(vectorStrokePlan(dashed).bands).toHaveLength(1); expect(vectorStrokePlan(dashed).bands[0].caps).toEqual(["square", "square"]);
    const variable = { ...styled, stroke: { ...styled.stroke!, widthProfile: { points: [{ t: 0, scale: 1, bias: 0 }] } } }; expect(vectorStrokePlan(variable).outline?.length).toBeGreaterThan(0); expect(vectorStrokePlan(variable).bands).toHaveLength(0);
  });
  it("matches endpoint directions, skips zero derivatives and places rotated arrowheads", () => {
    expect(vectorPathEnd([["M", 0, 0], ["C", 0, 0, 10, 10, 10, 10]], false)).toBeUndefined();
    expect(vectorPathEnd([["M", 0, 0], ["L", 0, 0], ["L", 0, 100]], true)).toEqual({ point: { x: 0, y: 100 }, direction: { x: 0, y: 1 } });
    const head = vectorArrowhead([["M", 0, 0], ["L", 0, 100]], 10, "triangleArrow", true);
    expect(head).toEqual([["M", 0, 105], ["L", -18, 70], ["L", 18, 70], ["Z"]]);
    const open = vector("M0 0H100 M0 40H100", { startCap: "triangleArrow", endCap: "triangleArrow", strokeWeight: 10 });
    expect(vectorStrokePlan(open).arrows.filter(c => c[0] === "M")).toHaveLength(2);
    expect(vectorStrokePlan(vector("M0 0H100V100H0Z", { startCap: "triangleArrow", endCap: "triangleArrow" })).arrows).toEqual([]);
  });
});
