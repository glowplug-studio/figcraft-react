import { nearPath, type PathCommand } from "./corners";
import { rectanglePaints, type VectorNode } from "./document";
import type { Point } from "./geometry";
import type { SolidPaint } from "./solid-paint";
import { defaultStroke, hasVisibleStroke, strokeMaxWeight } from "./stroke";
import { vectorFillContains, vectorFillPath, vectorRegionContains, vectorRegionPath, vectorStrokePath } from "./vector-path";
import { roundedNetwork } from "./vector-rounded";

export interface VectorPaintRegion { readonly path: readonly PathCommand[]; readonly paints: readonly SolidPaint[]; readonly rule: CanvasFillRule }
const painted = new WeakMap<VectorNode, readonly VectorPaintRegion[]>();
export const hasRegionPaints = (node: VectorNode): boolean => node.network.regions.some(r => r.fills !== undefined || r.paintSpace !== undefined);
/** Solid paints are independent of the region's paint frame; geometry stays in node space. */
export function vectorPaintRegions(node: VectorNode): readonly VectorPaintRegion[] {
  const prior = painted.get(node); if (prior) return prior;
  const inherited = rectanglePaints(node), net = roundedNetwork(node.network) ?? node.network;
  const regions: VectorPaintRegion[] = [];
  if (hasRegionPaints(node)) {
    net.regions.forEach((region, i) => {
      const path = vectorRegionPath(net, i);
      if (path) regions.push({ path, paints: region.fills ?? inherited, rule: region.winding === "evenOdd" ? "evenodd" : "nonzero" });
    });
  } else {
    const path = vectorFillPath(node.network);
    if (path.length) regions.push({ path, paints: inherited, rule: net.regions.some(r => r.winding === "evenOdd") ? "evenodd" : "nonzero" });
  }
  const result = Object.freeze(regions.map(r => Object.freeze(r)));
  if (Object.isFrozen(node)) painted.set(node, result);
  return result;
}
/** Native geometry::hits_node_itself: styled regions and legacy fill paths have different rules. */
export function hitsVector(node: VectorNode, point: Point, tolerance: number): boolean {
  const paints = rectanglePaints(node), stroke = hasVisibleStroke(node);
  let filled = paints.some(p => p.visible), path: readonly PathCommand[];
  if (hasRegionPaints(node)) {
    const net = roundedNetwork(node.network) ?? node.network;
    filled = false;
    for (let i = net.regions.length - 1; i >= 0; i--) {
      if (!(net.regions[i].fills ?? paints).some(p => p.visible)) continue;
      filled = true;
      if (vectorRegionContains(net, i, point)) return true;
    }
    path = vectorStrokePath(net);
  } else {
    if ((filled || !stroke) && vectorFillContains(node.network, point)) return true;
    const fill = vectorFillPath(node.network); path = fill.length ? fill : vectorStrokePath(node.network);
  }
  const reach = Math.max(strokeMaxWeight(node.stroke ?? defaultStroke) / 2, stroke && !filled ? tolerance * 2.5 : tolerance);
  return nearPath(path, point, reach);
}
