import {rotationDegrees} from "./affine";
import {layerTransform, type Document, type LayerNode} from "./document";
import {pixelRound} from "./geometry";
import {frameRelative} from "./hierarchy";

export type GeometryField = "x" | "y" | "width" | "height" | "rotation";

/** Native mixed edits operate on the two-decimal value in each layer’s field. */
export function shownGeometry(document: Document, node: LayerNode, key: GeometryField): number {
  const value = key === "rotation" ? rotationDegrees(layerTransform(node)) :
    key === "x" || key === "y" ? frameRelative(document,node.id)[key === "x" ? 4 : 5] : node[key];
  return pixelRound(value*100)/100;
}
