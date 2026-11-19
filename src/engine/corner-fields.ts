import { isFrameLike, type DocumentNode, type LayerNode } from "./document";
import { zeroCorners, type Radii } from "./corners";

/** Native `NodeKind::has_corner_radius`. */
export const hasCornerRadius = (n: DocumentNode): boolean =>
  n.kind === "rectangle" || isFrameLike(n) || n.kind === "polygon" || n.kind === "star" || n.kind === "vector" || n.kind === "section" || n.kind === "booleanOp";
/** Native `has_independent_corners`: only rectangles, frames and sections round each corner on its own. */
export const hasIndependentCorners = (n: DocumentNode): boolean => n.kind === "rectangle" || isFrameLike(n) || n.kind === "section";
/** Native `has_corner_smoothing`: an open vector's rounded points are drawn without it. */
export const hasCornerSmoothing = (n: DocumentNode): boolean => n.kind === "vector" ? n.network.regions.length > 0 : hasCornerRadius(n);

/** What the Design panel's corner rows show for a selection; `undefined` values read Mixed. */
export interface CornerFields {
  readonly radius: number | undefined;
  readonly independent: boolean;
  readonly smoothing: boolean;
  readonly radii: Radii | undefined;
  readonly smoothingPercent: number | undefined;
}

/** The radius a layer's field shows: a layer with one radius draws its first, whatever the other three hold. */
export function shownRadius(n: LayerNode): number | undefined {
  const radii = (n.corners ?? zeroCorners).radii;
  return hasIndependentCorners(n) ? (radii.every(r => r === radii[0]) ? radii[0] : undefined) : radii[0];
}

/** Native `panels/right/paints.rs::appearance` corner rows. Null when a selected layer takes no corner radius. */
export function cornerFields(nodes: readonly LayerNode[]): CornerFields | null {
  if (!nodes.length || !nodes.every(hasCornerRadius)) return null;
  const shown = nodes.map(n => { const r = shownRadius(n); return r === undefined ? undefined : Math.round(r * 100) / 100; });
  const corners = nodes.map(n => n.corners ?? zeroCorners), first = corners[0];
  return {
    radius: shown.every(r => r === shown[0]) ? shown[0] : undefined,
    independent: nodes.every(hasIndependentCorners),
    smoothing: nodes.every(hasCornerSmoothing),
    radii: corners.every(c => c.radii.every((r, i) => r === first.radii[i])) ? first.radii : undefined,
    smoothingPercent: corners.every(c => c.smoothing === first.smoothing) ? first.smoothing * 100 : undefined,
  };
}
