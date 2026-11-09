import { fontGeometryCache } from "./font-generation";
import { transformPoint } from "./affine";
import { booleanResult, paintedStrokePath } from "./boolean-result";
import { flattenContours, type PathCommand } from "./corners";
import { isLeaf, type Document, type LayerNode, type NodeId } from "./document";
import type { Point, Rectangle } from "./geometry";
import { ancestors, rootIds, worldTransform, zSorted } from "./hierarchy";
import { parseNodeId } from "./parameters";
import { arrangementFaces, maxArrangementInputs, type ArrangementInput } from "./path-arrangement";
import { isClosedShape, shapePath } from "./shape-path";
import { pathBounds, pathWinding, vectorFillPath, vectorRegionPath } from "./vector-path";
import { hasRegionPaints } from "./vector-presentation";
import { mapVectorPath } from "./vector-region-selection";
import { drawnVectorNetwork } from "./vector-rounded";

export interface BuilderPart {
  id: NodeId;
  stroke: boolean;
  region?: number;
}

export interface BuilderRegion {
  path: readonly PathCommand[];
  parts: readonly BuilderPart[];
  sources: readonly NodeId[];
  bounds: Rectangle;
  point?: Point;
}

export interface BuilderArrangement {
  sources: readonly NodeId[];
  parts: readonly BuilderPart[];
  regions: readonly BuilderRegion[];
}

export function builderTargets(params: Record<string, unknown>, selection: readonly NodeId[]) {
  if (Array.isArray(params.ids)) return params.ids.map(parseNodeId).filter((id): id is NodeId => id !== undefined);
  const id = parseNodeId(params.id);
  return id === undefined ? selection : [id];
}

function eligible(document: Document, ids: readonly NodeId[]) {
  const layers: NodeId[] = [];
  const collect = (id: NodeId, depth: number) => {
    const node = document.nodes[id];
    if (node.kind === "group") {
      if (depth < 64) for (const child of node.children) collect(child, depth + 1);
    } else if (node.kind !== "page" && (isLeaf(node) || node.kind === "booleanOp") && node.visible !== false && !node.locked
        && !ancestors(document, id).some(parent => ["booleanOp","instance"].includes(document.nodes[parent].kind))) {
      layers.push(id);
    }
  };
  for (const id of rootIds(document, ids.filter(id => document.nodes[id]))) collect(id, 0);
  return zSorted(document, layers).slice(0, maxArrangementInputs);
}

/** Probe seven scanlines and use the widest interior span, including holes in the scan. */
function interiorPoint(path: readonly PathCommand[], bounds: Rectangle): Point | undefined {
  const tolerance = Math.max(bounds.width, bounds.height) * 0.001;
  const lines = flattenContours(path, tolerance);
  let widest = 1e-9, point: Point | undefined;
  for (const fraction of [0.5, 0.3, 0.7, 0.15, 0.85, 0.05, 0.95]) {
    const y = bounds.y + bounds.height * (fraction + 0.0001234567);
    const crossings: number[] = [];
    for (const points of lines) {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        if ((a.y <= y && y < b.y) || (b.y <= y && y < a.y)) {
          crossings.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y));
        }
      }
    }
    crossings.sort((a, b) => a - b);
    for (let i = 1; i < crossings.length; i += 2) {
      const width = crossings[i] - crossings[i - 1];
      const candidate = { x: (crossings[i] + crossings[i - 1]) / 2, y };
      if (width > widest && pathWinding(path, candidate) !== 0) {
        widest = width;
        point = candidate;
      }
    }
  }
  return point;
}

function build(document: Document, ids: readonly NodeId[]): BuilderArrangement {
  const parts: BuilderPart[] = [], inputs: ArrangementInput[] = [], sources: NodeId[] = [];
  for (const id of eligible(document, ids)) {
    const node = document.nodes[id] as LayerNode, world = worldTransform(document, id);
    const collect = (path: readonly PathCommand[] | undefined, evenOdd: boolean, stroke: boolean, region?: number) => {
      if (!path?.length) return;
      const transformed = mapVectorPath(path, p => transformPoint(world, p));
      if (!transformed.every(c => c.slice(1).every(n => Number.isFinite(n) && Math.abs(Number(n)) <= 1.5e9))) return;
      if (parts.length >= maxArrangementInputs) throw new Error("shape builder: too many fill regions and strokes to process safely");
      inputs.push({ path: transformed, evenOdd });
      parts.push({ id, stroke, region });
    };
    const before = parts.length;
    const vector = node.kind === "booleanOp" ? booleanResult(document, node) : node.kind === "vector" ? node : undefined;
    if (vector) {
      const drawn = drawnVectorNetwork(vector);
      if (node.kind === "vector" && hasRegionPaints(node)) {
        drawn.regions.forEach((r, i) => collect(vectorRegionPath(drawn, i), r.winding === "evenOdd", false, i));
      } else {
        collect(vectorFillPath(drawn), drawn.regions.some(r => r.winding === "evenOdd"), false);
      }
    } else if (node.kind !== "booleanOp" && isClosedShape(node)) {
      collect(shapePath(node), false, false);
    }
    collect(paintedStrokePath(document, node), false, true);
    if (parts.length > before) sources.push(id);
  }
  const regions = arrangementFaces(inputs).filter(face => face.area > 1e-4).map(face => {
    const covering = face.cover.map(index => parts[index]).reverse();
    const bounds = pathBounds(face.path)!;
    return { path: face.path, parts: covering, sources: [...new Set(covering.map(p => p.id))],
      bounds, point: interiorPoint(face.path, bounds) };
  });
  regions.sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
  return { parts, sources, regions };
}

const cache = fontGeometryCache<Document, { ids: readonly NodeId[]; result: BuilderArrangement | Error }>();
export function builderArrangement(document: Document, ids: readonly NodeId[]): BuilderArrangement {
  const prior = cache.get(document);
  if (prior && prior.ids.length === ids.length && ids.every((id, index) => id === prior.ids[index])) {
    if (prior.result instanceof Error) throw prior.result;
    return prior.result;
  }
  try {
    const result = build(document, ids);
    cache.set(document, { ids: [...ids], result });
    return result;
  } catch (error) {
    if (error instanceof Error) cache.set(document, { ids: [...ids], result: error });
    throw error;
  }
}

/** A refused selection still lets the user pick other layers with the tool. */
export function availableBuilderArrangement(document: Document, ids: readonly NodeId[]) {
  try { return builderArrangement(document, ids); }
  catch { return undefined; }
}

export function builderRegionAt(arrangement: BuilderArrangement, point: Point) {
  return arrangement.regions.findIndex(({ bounds, path }) =>
    point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height && pathWinding(path, point) !== 0);
}

export function readBuilderRegions(arrangement: BuilderArrangement) {
  return { sources: [...arrangement.sources], regions: arrangement.regions.map((region, index) => ({
    index, path: region.path.map(c => c.join(" ")).join(" "), sources: [...region.sources],
    parts: region.parts.map(({ id, stroke }) => ({ id, stroke })),
    bounds: [region.bounds.x, region.bounds.y, region.bounds.width, region.bounds.height],
    point: region.point ? [region.point.x, region.point.y] : null,
  })) };
}
