import type { overlayPositions } from "./prototype-data";

/** Source: upstream doc/src/proto.rs `OverlayAnchor::offset` and ui-egui/src/present/{transition.rs::overlay_rect, present.rs::anchored_overlay_rect}. */
export type OverlayPosition = typeof overlayPositions[number];
export type OverlayAnchor = "screen" | "triggerInside" | "triggerOutside";
export interface Box { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/** Native `OverlayAnchor::offset`: where a position preset puts the overlay from the trigger layer's top-left (none for the screen and manual). */
export function anchorOffset(anchor: OverlayAnchor, position: OverlayPosition, [tw, th]: readonly [number, number], [ow, oh]: readonly [number, number]): [number, number] | undefined {
  if (anchor === "screen" || position === "manual") return undefined;
  const outside = anchor === "triggerOutside";
  const x = position === "topLeft" || position === "bottomLeft" ? 0 : position === "topRight" || position === "bottomRight" ? tw - ow : (tw - ow) / 2;
  const top = position === "topLeft" || position === "topCenter" || position === "topRight";
  const bottom = position === "bottomLeft" || position === "bottomCenter" || position === "bottomRight";
  const y = top ? (outside ? -oh : 0) : bottom ? (outside ? th : th - oh) : (th - oh) / 2;
  return [x, y];
}
/** Native `overlay_rect`: an overlay of `size` placed on the screen `base` (or, manual, from the layer that opened it). */
export function overlayRect(position: OverlayPosition, base: Box, size: readonly [number, number], anchor?: Box, offset?: readonly [number, number]): Box {
  const [w, h] = size, cx = base.x + base.width / 2 - w / 2, cy = base.y + base.height / 2 - h / 2;
  const right = base.x + base.width - w, bottom = base.y + base.height - h;
  const at: Record<OverlayPosition, () => [number, number]> = {
    center: () => [cx, cy], topLeft: () => [base.x, base.y], topCenter: () => [cx, base.y], topRight: () => [right, base.y],
    bottomLeft: () => [base.x, bottom], bottomCenter: () => [cx, bottom], bottomRight: () => [right, bottom],
    manual: () => anchor ? offset ? [anchor.x + offset[0], anchor.y + offset[1]] : [anchor.x, anchor.y + anchor.height] : [cx, cy],
  };
  const [x, y] = at[position]();
  return { x, y, width: w, height: h };
}
/** Native `anchored_overlay_rect`: a preset measured on the layer that opened the overlay, else on the screen. */
export function anchoredOverlayRect(position: OverlayPosition, anchorTo: OverlayAnchor, base: Box, size: readonly [number, number], anchor?: Box, offset?: readonly [number, number]): Box {
  const onTrigger = anchor && anchorOffset(anchorTo, position, [anchor.width, anchor.height], size);
  return onTrigger ? overlayRect("manual", base, size, anchor, onTrigger) : overlayRect(position, base, size, anchor, offset);
}
