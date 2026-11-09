import { transformBounds } from "./affine";
import { layerTransform, withLayerSize, withLayerTransform, type FrameNode, type LayerNode } from "./document";
import { defaultStroke, hasVisibleStroke } from "./stroke";
import type { HierarchyDraft } from "./hierarchy";

export function frameInsets(frame: FrameNode): readonly [number, number, number, number] {
  const layout = frame.layout!, stroke = frame.stroke ?? defaultStroke;
  const inside = layout.strokesIncluded && hasVisibleStroke(frame) && stroke.align === "inside";
  const inset = (i: number) => Math.max(0, layout.padding[i]) + (inside ? Math.max(0, stroke.sides?.[i] ?? stroke.weight) : 0);
  return [inset(0), inset(1), inset(2), inset(3)];
}

export function outerBox(node: LayerNode) {
  const [a,b,c,d] = layerTransform(node);
  return transformBounds([a,b,c,d,0,0], node.width, node.height);
}

export function clampSize(value: number, min?: number, max?: number) {
  return Math.max(min ?? -Infinity, Math.min(max ?? Infinity, Number.isFinite(value) ? Math.max(0, value) : 0));
}

export function size(draft: HierarchyDraft, node: LayerNode, width: number, height: number) {
  if (Math.abs(node.width-width) < 1e-9 && Math.abs(node.height-height) < 1e-9) return;
  draft.set(withLayerSize(node, Math.max(0, width), Math.max(0, height)));
}

export function placeLayer(draft: HierarchyDraft, node: LayerNode, x: number, y: number) {
  const box = outerBox(node), m = layerTransform(node);
  const tx = x - box.x, ty = y - box.y;
  if (m[4] !== tx || m[5] !== ty) draft.set(withLayerTransform(node, [m[0],m[1],m[2],m[3],tx,ty]));
}
