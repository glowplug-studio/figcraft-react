import {rotationDegrees} from "./affine";
import type {Document, LayerNode} from "./document";
import {pixelRound} from "./geometry";
import {frameRelative, worldTransform} from "./hierarchy";

export type GeometryField = "x" | "y" | "width" | "height" | "rotation";

/** Native mixed edits operate on the two-decimal value in each layer’s field. */
export function shownGeometry(document: Document, node: LayerNode, key: GeometryField): number {
  // The Rotation field shows the rotation on the page: the layer's own angle plus its parents'.
  const value = key === "rotation" ? rotationDegrees(worldTransform(document,node.id)) :
    key === "x" || key === "y" ? frameRelative(document,node.id)[key === "x" ? 4 : 5] : node[key];
  return pixelRound(value*100)/100;
}
