import { remapInteractions } from "./prototype-data";
import { pageOf, type Document, type LayerNode, type NodeId } from "./document";
import { ancestors } from "./hierarchy";
import type { Paint } from "./solid-paint";

export function checkPatternTarget(document: Document, ids: readonly NodeId[], source: NodeId) {
  const parents = new Set([source, ...ancestors(document, source)]);
  if (ids.some(id => parents.has(id))) throw new Error("A layer can't be filled with itself or a layer inside it");
}

export function patternSources(document: Document, targets: readonly NodeId[]): LayerNode[] {
  const excluded = new Set(targets.flatMap(id => [id, ...ancestors(document, id)]));
  const selected = new Set(targets), sources: LayerNode[] = [];
  for (const id of pageOf(document).children) {
    const node = document.nodes[id];
    if (node && node.kind !== "page" && !excluded.has(id) && !ancestors(document,id).some(parent => selected.has(parent))) {
      sources.push(node);
      if (sources.length === 64) break;
    }
  }
  return sources;
}

/** Rewrite only references whose source was included in the duplication. */
function remapPatternSources(node: LayerNode, lookup: (id: NodeId) => NodeId | undefined): LayerNode {
  function remap(stack: readonly Paint[] | undefined) {
    if (!stack?.some(p => p.type === "pattern" && lookup(p.source) !== undefined)) return stack;
    return Object.freeze(stack.map(p => {
      const source = p.type === "pattern" && lookup(p.source);
      return source ? Object.freeze({...p, source}) : p;
    }));
  }
  const fills = remap(node.fills), strokes = remap(node.strokes);
  if (fills !== node.fills || strokes !== node.strokes) node = Object.freeze({...node, ...(fills && {fills}), ...(strokes && {strokes})});
  if (node.kind !== "vector") return node;
  const regions = node.network.regions.map(region => {
    const fills = remap(region.fills);
    return fills === region.fills ? region : Object.freeze({...region, fills});
  });
  return regions.some((r,i) => r !== node.network.regions[i])
    ? Object.freeze({...node, network:Object.freeze({...node.network, regions:Object.freeze(regions)})}) : node;
}

/** References carried with a copied subtree keep external targets and adopt copied target IDs. */
export function remapLayerReferences(node: LayerNode, lookup: (id: NodeId) => NodeId | undefined): LayerNode {
  const copy = remapPatternSources(node, lookup);
  return copy.interactions?.length ? Object.freeze({...copy, interactions:remapInteractions(copy.interactions,lookup)}) : copy;
}
