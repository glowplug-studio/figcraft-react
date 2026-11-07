import type { LayerNode } from "./document";
import { cornerPath, hasRoundedCorners, type PathCommand } from "./corners";
import { polygonPoints, starPoints, smoothedPolygon } from "./polygon";
import { ellipsePath } from "./ellipse";
import { vectorFillPath, vectorStrokePath } from "./vector-path";
import { drawnVectorNetwork } from "./vector-rounded";
const paths = new Map<string, readonly PathCommand[]>();
export function shapePath(node: LayerNode): readonly PathCommand[] {
  if (node.kind === "vector") { const drawn = drawnVectorNetwork(node), fill = vectorFillPath(drawn); return fill.length ? fill : vectorStrokePath(drawn); }
  if (node.kind === "line") return [["M", 0, 0], ["L", node.width, 0]];
  if (node.kind !== "ellipse" && node.kind !== "polygon" && node.kind !== "star") return cornerPath(node);
  const key = `${node.kind}:${node.width}:${node.height}:` + (node.kind === "ellipse" ? `${node.start}:${node.sweep}:${node.inner}` : `${node.count}:${node.kind === "star" ? node.innerRatio : ""}:${node.corners?.radii[0] ?? 0}:${node.corners?.smoothing ?? 0}`);
  let path = paths.get(key);
  if (!path) { path = node.kind === "ellipse" ? ellipsePath(node.width, node.height, node) : smoothedPolygon(node.kind === "star" ? starPoints(node.width, node.height, node.count, node.innerRatio) : polygonPoints(node.width, node.height, node.count), node.corners?.radii[0] ?? 0, node.corners?.smoothing ?? 0); if (paths.size >= 256) paths.clear(); paths.set(key, path); }
  return path;
}
export const hasShapePath = (node: LayerNode): boolean => node.kind === "vector" || node.kind === "line" || node.kind === "ellipse" || node.kind === "polygon" || node.kind === "star" || hasRoundedCorners(node);
export const strokeGeometry = (node: LayerNode): readonly PathCommand[] => node.kind === "vector" ? vectorStrokePath(drawnVectorNetwork(node)) : shapePath(node);
export const isClosedShape = (node: LayerNode): boolean => node.kind !== "line" && (node.kind !== "vector" || node.network.regions.length > 0);
