import type { PathCommand } from "./corners";
import { commonProperties, type LayerNode } from "./document";
import { booleanStep, normaliseBooleanPath, outlineBand } from "./path-boolean";
import { shapePath } from "./shape-path";
import { MAX_STROKE_WIDTH } from "./stroke";
import { refitVector } from "./vector-edit";
import { appendNetwork, freezeNetwork, networkFromPath, regionPaintFrame, type VectorRegion, type VectorVertex, type VectorSegment } from "./vector-network";
import { vectorFillPath, vectorRegionPath } from "./vector-path";
import { hasRegionPaints } from "./vector-presentation";
import { drawnVectorNetwork } from "./vector-rounded";

/** Native offset_path grows or erodes by combining the fill with its round-joined boundary stroke. */
export function offsetLayer(node: LayerNode, distance: number) {
  if (node.kind === "group") return;
  const width = Math.abs(distance) * 2;
  const offset = (path: readonly PathCommand[]) => {
    const band = Number.isFinite(width) ? outlineBand(path, Math.min(width, MAX_STROKE_WIDTH), "round", 4, ["butt","butt"], null) : [];
    return networkFromPath(booleanStep(path, band, distance > 0 ? "union" : "subtract"));
  };
  const result = { vertices: [] as VectorVertex[], segments: [] as VectorSegment[], regions: [] as VectorRegion[] };
  if (node.kind === "vector" && node.network.regions.length) {
    const drawn = drawnVectorNetwork(node);
    const append = (path: readonly PathCommand[], source: VectorRegion, evenOdd: boolean) => {
      const part = offset(normaliseBooleanPath(path, evenOdd));
      const paintSpace = regionPaintFrame(source, node.width, node.height);
      appendNetwork(result, { ...part, regions: part.regions.map(r => ({
        ...r, winding: "evenOdd", paintSpace, ...(source.fills === undefined ? {} : { fills: source.fills }),
      })) });
    };
    if (hasRegionPaints(node)) {
      node.network.regions.forEach((region, i) => {
        const p = vectorRegionPath(drawn, i);
        if (p) append(p, region, region.winding === "evenOdd");
      });
    } else {
      append(vectorFillPath(drawn), node.network.regions[0], node.network.regions.some(r => r.winding === "evenOdd"));
    }
  } else {
    // Native node_outline on a regionless vector returns the empty fill path.
    const path = node.kind === "vector" || node.kind === "booleanOp" ? [] : shapePath(node);
    appendNetwork(result, offset(path));
  }
  return refitVector({ ...commonProperties(node), kind: "vector", width: 0, height: 0, network: freezeNetwork(result) });
}
