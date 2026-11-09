import { remapPatternSources } from "./pattern-sources";
import { insertInstance } from "./component-instances";
import { isFrameLike, isLeaf, layerTransform } from "./document";
import type { Document, NodeId } from "./document";
import { arrangementTargets, moveWorld } from "./arrange";
import { HierarchyDraft, subtreeIds, zSorted } from "./hierarchy";
import { parseBoolean, parseNumber } from "./parameters";
import { validateChangedGeometry } from "./rotation";
import { boundsOf } from "./viewport";

/** Session-only repeat state, corresponding to native Duplicated. */
export interface Duplicated { readonly sources: readonly NodeId[]; readonly copies: readonly NodeId[] }
export function duplicateSelection(previous: Duplicated, selection: readonly NodeId[]): boolean {
  const copies = new Set(previous.copies), selected = new Set(selection);
  return copies.size > 0 && copies.size === selected.size && [...copies].every(id => selected.has(id));
}
function repeatOffset(document: Document, previous?: Duplicated): { x: number; y: number } | undefined {
  if (!previous || [...previous.sources, ...previous.copies].some(id => !document.nodes[id])) return;
  const source = boundsOf(document, previous.sources), copy = boundsOf(document, previous.copies);
  if (!source || !copy) return;
  const x = copy.x - source.x, y = copy.y - source.y;
  return Number.isFinite(x) && Number.isFinite(y) && (x !== 0 || y !== 0) ? { x, y } : undefined;
}
function optionalNumber(value: unknown): number | undefined { try { return parseNumber(value); } catch { return undefined; } }

/** Allocates and copies locally; caller publishes only after complete validation. */
export function executeDuplicate(document: Document, selection: readonly NodeId[], nextId: bigint, params: Record<string, unknown>, previous?: Duplicated) {
  for (const key of Object.keys(params)) if (!["ids", "dx", "dy", "map"].includes(key)) throw new Error(`Unsupported edit.duplicate parameter: ${key}`);
  const sources = zSorted(document, arrangementTargets(document, selection, params));
  const dx = optionalNumber(params.dx), dy = optionalNumber(params.dy);
  const repeat = dx === undefined && dy === undefined && previous && duplicateSelection(previous, sources) ? repeatOffset(document, previous) : undefined;
  const draft = new HierarchyDraft(document);
  const { duplicated, nextId: allocator, map } = copyLayers(draft, sources, nextId);
  for (const [i, sourceId] of sources.entries()) {
    const source = document.nodes[sourceId];
    if (source.kind === "page") throw new Error("Pages are duplicated with page.duplicate");
    const parent = document.nodes[source.parent], copyId = duplicated.copies[i];
    // Explicit offsets are parent-space in native code; repeated steps are page-space.
    const defaultX = isFrameLike(source) && parent.kind === "page" ? source.width + 100 : 0;
    moveWorld(draft, copyId, repeat?.x ?? dx ?? (dy === undefined ? defaultX : 0), repeat?.y ?? dy ?? 0, !repeat);
  }
  draft.normaliseGroups();
  const updated = validateChangedGeometry(draft);
  return { document: updated, nextId: allocator, duplicated, result: parseBoolean(params.map) === true ? { ids: duplicated.copies, map } : { ids: duplicated.copies } };
}

/** Copy in caller order so a pointer drag can place the new layers before layout reflows. */
export function copyLayers(draft: HierarchyDraft, sources: readonly NodeId[], nextId: bigint) {
  const document = draft.originalDocument;
  const map: Record<NodeId, NodeId> = {}, copies: NodeId[] = [];
  let allocator = nextId;
  for (const sourceId of sources) {
    const source = document.nodes[sourceId];
    if (source.kind === "page") throw new Error("Pages are duplicated with page.duplicate");
    const parent = draft.nodes[source.parent];
    if (isLeaf(parent)) throw new Error("Invalid layer parent");
    const index = parent.children.indexOf(sourceId) + 1;
    const subtree = subtreeIds(document, sourceId);
    if (source.kind === "component" && parent.kind !== "componentSet") {
      const instance = insertInstance(draft, source, parent.id, layerTransform(source), allocator, index);
      allocator = instance.nextId;
      copies.push(instance.id);
      const mirrored = subtreeIds(draft.document, instance.id);
      map[sourceId] = instance.id;
      if (subtree.length === mirrored.length) {
        subtree.forEach((id, index) => { map[id] = mirrored[index]; });
      }
      continue;
    }
    const localMap = new Map<NodeId,NodeId>();
    for (const oldId of subtree) {
      const node = document.nodes[oldId];
      if (node.kind === "page") throw new Error("A page cannot be a layer child");
      const allocated = draft.allocateId(allocator); allocator = allocated.nextId;
      const id = allocated.id, parentId = oldId === sourceId ? node.parent : map[node.parent];
      if (!parentId) throw new Error("Invalid subtree parent");
      map[oldId] = id;
      localMap.set(oldId,id);
      draft.insert(isLeaf(node) ? { ...node, id } : { ...node, id, children: Object.freeze([]) }, parentId, oldId === sourceId ? index : undefined);
    }
    for (const id of localMap.values()) {
      const node = draft.nodes[id];
      if (node.kind === "page") continue;
      const copy = remapPatternSources(node, source => localMap.get(source));
      if (copy !== node) draft.set(copy);
    }
    const copyId = map[sourceId];
    copies.push(copyId);
  }
  const duplicated: Duplicated = Object.freeze({ sources: Object.freeze([...sources]), copies: Object.freeze(copies) });
  return { duplicated, nextId: allocator, map: Object.freeze(map) };
}
