import { roundedRect, zeroCorners, type PathCommand, type Radii } from "./corners";
import type { LayerNode } from "./document";
import { ellipsePath, fullSweep, TAU } from "./ellipse";
import { defaultStroke } from "./stroke";

/** Native render::stroke_area's exact ring shortcut, before generic path offsetting.
 * In particular, an elliptical inset is another ellipse, not a normal-distance offset.
 * Undefined requests generic stroking; an empty path paints nothing.
 */
export function closedStrokeRing(node: LayerNode): readonly PathCommand[] | undefined {
  const props = node.stroke ?? defaultStroke, corners = node.corners ?? zeroCorners;
  if (node.kind === "line" || node.kind === "group" || props.align === "center" || props.dashes.length || props.widthProfile?.points.length || props.brush) return undefined;
  if (!(props.weight > 0 && Number.isFinite(props.weight))) return [];
  if (props.align === "outside" && props.join !== "miter" && corners.radii.includes(0)) return undefined;
  const rectangle = (node.kind === "rectangle" || node.kind === "frame") && corners.smoothing === 0;
  const ellipse = node.kind === "ellipse" && fullSweep(node.sweep) && node.inner === 0;
  if (!rectangle && !ellipse) return undefined;
  const ring = (inset: number): PathCommand[] | undefined => {
    const width = node.width - 2 * inset, height = node.height - 2 * inset;
    if (width <= 0 || height <= 0) return undefined;
    const path = rectangle ? roundedRect(width, height, { radii: corners.radii.map(r => r > 0 ? Math.max(0, r - inset) : 0) as unknown as Radii, smoothing: 0 })
      : ellipsePath(width, height, { start: 0, sweep: TAU, inner: 0 });
    return path.map(c => c[0] === "Z" ? c : c[0] === "C" ? ["C", c[1] + inset, c[2] + inset, c[3] + inset, c[4] + inset, c[5] + inset, c[6] + inset] : [c[0], c[1] + inset, c[2] + inset]);
  };
  const outer = ring(props.align === "inside" ? 0 : -props.weight);
  if (!outer) return undefined;
  return [...outer, ...(ring(props.align === "inside" ? props.weight : 0) ?? [])];
}
