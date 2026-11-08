import { identity, inverse, multiply, transformPoint, type Affine } from "./affine";
import type { PathCommand } from "./corners";
import { commonProperties, isLeaf, rectanglePaints, withRectanglePaints, type Document, type LayerNode, type NodeId, type VectorNode } from "./document";
import { ancestors, HierarchyDraft, worldTransform } from "./hierarchy";
import { parseNumber } from "./parameters";
import { unionFaces } from "./path-arrangement";
import { builderArrangement, builderRegionAt, builderTargets, type BuilderArrangement, type BuilderPart } from "./shape-builder";
import { refitVector } from "./vector-edit";
import { appendNetwork, freezeNetwork, networkFromPath, regionPaintFrame, type VectorRegion, type VectorVertex, type VectorSegment } from "./vector-network";
import { mapVectorPath } from "./vector-region-selection";

type Path = readonly PathCommand[];
function numberOrNaN(value: unknown) {
  try { return parseNumber(value); } catch { return NaN; }
}
function picked(params: Record<string, unknown>, arrangement: BuilderArrangement) {
  const result = new Set<number>();
  if (Array.isArray(params.regions)) for (const raw of params.regions) {
    const i = numberOrNaN(raw);
    if (Number.isInteger(i) && i >= 0 && i < arrangement.regions.length) result.add(i);
  }
  if (Array.isArray(params.points)) for (const point of params.points.slice(0, 10_000)) {
    if (!Array.isArray(point)) continue;
    const i = builderRegionAt(arrangement, { x: numberOrNaN(point[0]), y: numberOrNaN(point[1]) });
    if (i >= 0) result.add(i);
  }
  return [...result];
}

function builderInverse(matrix: Affine) {
  if (Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]) <= 1e-12) throw new Error("Cannot reshape a layer scaled to nothing");
  return inverse(matrix);
}

function localNetwork(path: Path, local: Affine) {
  const commands = mapVectorPath(path, point => transformPoint(local, point));
  if (commands.some(c => c.slice(1).some(n => !Number.isFinite(n) || Math.abs(Number(n)) > 1.5e9))) throw new Error("Invalid Shape Builder geometry");
  const net = networkFromPath(commands);
  return { ...net, regions: net.regions.map(r => ({ ...r, winding: "evenOdd" as const })) };
}

function sourceRegion(node: LayerNode, part: BuilderPart) {
  return node.kind === "vector" && part.region !== undefined ? node.network.regions[part.region] : undefined;
}

function createMerged(draft: HierarchyDraft, id: NodeId, part: BuilderPart, path: Path) {
  const node = draft.nodes[part.id] as LayerNode, parent = draft.nodes[node.parent];
  if (isLeaf(parent)) throw new Error("Invalid Shape Builder parent");
  const document = draft.document, toParent = builderInverse(worldTransform(document, parent.id));
  const net = localNetwork(path, toParent), region = sourceRegion(node, part);
  const space = region ? regionPaintFrame(region, node.width, node.height) : { width: node.width, height: node.height, transform: identity };
  const transform = multiply(toParent, multiply(worldTransform(document, node.id), space.transform));
  const network = freezeNetwork({ ...net, regions: net.regions.map(r => ({ ...r, fills: region?.fills, paintSpace: { ...space, transform } })) });
  const vector = withRectanglePaints<VectorNode>({
    kind: "vector", id, parent: parent.id, name: node.name, x: 0, y: 0, width: 0, height: 0, network,
    fill: "transparent", opacity: node.opacity, blend: node.blend === "passThrough" ? "normal" : node.blend,
    strokes: part.stroke ? undefined : node.strokes, stroke: part.stroke ? undefined : node.stroke,
  }, part.stroke ? node.strokes ?? [] : rectanglePaints(node));
  draft.insert(refitVector(vector), parent.id, parent.children.indexOf(node.id) + 1);
}

function reshape(draft: HierarchyDraft, node: LayerNode, areas: readonly { part: BuilderPart; path: Path }[]) {
  const local = builderInverse(worldTransform(draft.document, node.id));
  const result = { vertices: [] as VectorVertex[], segments: [] as VectorSegment[], regions: [] as VectorRegion[] };
  for (const { part, path } of areas) {
    const net = localNetwork(path, local), region = sourceRegion(node, part);
    appendNetwork(result, region ? { ...net, regions: net.regions.map(r => ({
      ...r, fills: region.fills, paintSpace: regionPaintFrame(region, node.width, node.height),
    })) } : net);
  }
  if (node.kind === "booleanOp") for (const child of node.children) draft.remove(child);
  draft.set(refitVector({ ...commonProperties(node), kind: "vector", corners: undefined, network: freezeNetwork(result) }));
}

export function applyBuilder(command: string, document: Document, selection: readonly NodeId[], nextId: bigint, params: Record<string, unknown>) {
  const ids = builderTargets(params, selection), a = builderArrangement(document, ids);
  const regions = picked(params, a), selected = new Set(regions);
  if (!regions.length) throw new Error(`${command}: no region picked: pass regions or points inside regions`);
  const parts = new Set(regions.flatMap(i => a.regions[i].parts));
  const touched = new Set([...parts].map(p => p.id));
  const merge = command === "shapeBuilder.merge";
  const changed: NodeId[] = [], removed: NodeId[] = [], outlines: NodeId[] = [];
  let id: NodeId | null = null;
  if (merge && touched.size === 1 && [...parts].filter(p => !p.stroke).length <= 1
      && a.regions.every((r, i) => selected.has(i) || !r.sources.some(src => touched.has(src)))) {
    return { document, selection, nextId, result: { id, changed, removed, outlines, regions } };
  }
  const draft = new HierarchyDraft(document);
  const create = (part: BuilderPart, path: Path) => {
    while (draft.nodes[String(nextId)] && nextId <= 18446744073709551615n) nextId++;
    if (nextId > 18446744073709551615n) throw new Error("Node ID space exhausted");
    const newId = String(nextId);
    if (nextId < 18446744073709551615n) nextId++;
    createMerged(draft, newId, part, path);
    return newId;
  };
  if (merge) id = create(a.regions[regions[0]].parts[0], unionFaces(regions.map(i => a.regions[i].path)));
  const keep = (part: BuilderPart) => unionFaces(a.regions.filter((r, i) => !selected.has(i) && r.parts.includes(part)).map(r => r.path));
  const selectedOutlines: NodeId[] = [];
  for (const src of a.sources) {
    if (!touched.has(src)) continue;
    const stroke = a.parts.find(p => p.id === src && p.stroke);
    if (stroke) {
      const path = keep(stroke);
      if (path.length) {
        const outline = create(stroke, path);
        outlines.push(outline);
        if (ids.includes(src)) selectedOutlines.push(outline);
      }
      draft.set({ ...draft.nodes[src] as LayerNode, strokes: [] });
    }
    const fills = a.parts.filter(p => p.id === src && !p.stroke);
    if (fills.length && !fills.some(p => parts.has(p))) {
      changed.push(src);
      continue;
    }
    const areas = fills.map(part => ({ part, path: keep(part) })).filter(area => area.path.length);
    if (areas.length) {
      reshape(draft, draft.nodes[src] as LayerNode, areas);
      changed.push(src);
    } else {
      draft.remove(src);
      removed.push(src);
    }
  }
  draft.normaliseGroups();
  const updated = draft.finish();
  const nextSelection = [...new Set([...ids, ...selectedOutlines].filter(key => updated.nodes[key]))];
  if (id && !ancestors(updated, id).some(key => nextSelection.includes(key))) nextSelection.push(id);
  return { document: updated, selection: nextSelection, nextId, result: { id, changed, removed, outlines, regions } };
}
