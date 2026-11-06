import { isLeaf } from "./document";
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
  const draft = new HierarchyDraft(document), map: Record<NodeId, NodeId> = {}, copies: NodeId[] = [];
  const maximum = 18446744073709551615n;
  let allocator = nextId;
  const allocate = (): NodeId => {
    if (allocator < 0n || allocator > maximum) throw new Error("Document identifiers are exhausted");
    while (draft.nodes[String(allocator)]) {
      if (allocator === maximum) throw new Error("Document identifiers are exhausted");
      allocator++;
    }
    const id = String(allocator);
    if (allocator < maximum) allocator++;
    return id;
  };
  for (const sourceId of sources) {
    const source = document.nodes[sourceId];
    if (source.kind === "page") throw new Error("Pages are duplicated with page.duplicate");
    const parent = draft.nodes[source.parent];
    if (isLeaf(parent)) throw new Error("Invalid layer parent");
    const index = parent.children.indexOf(sourceId) + 1;
    for (const oldId of subtreeIds(document, sourceId)) {
      const node = document.nodes[oldId];
      if (node.kind === "page") throw new Error("A page cannot be a layer child");
      const id = allocate(), parentId = oldId === sourceId ? node.parent : map[node.parent];
      if (!parentId) throw new Error("Invalid subtree parent");
      map[oldId] = id;
      draft.insert(isLeaf(node) ? { ...node, id } : { ...node, id, children: Object.freeze([]) }, parentId, oldId === sourceId ? index : undefined);
    }
    const copyId = map[sourceId];
    // Explicit offsets are parent-space in native code; repeated steps are page-space.
    const defaultX = source.kind === "frame" && parent.kind === "page" ? source.width + 100 : 0;
    moveWorld(draft, copyId, repeat?.x ?? dx ?? (dy === undefined ? defaultX : 0), repeat?.y ?? dy ?? 0, !repeat);
    copies.push(copyId);
  }
  draft.normaliseGroups();
  const updated = validateChangedGeometry(draft);
  const duplicated: Duplicated = Object.freeze({ sources: Object.freeze(sources), copies: Object.freeze(copies) });
  return { document: updated, nextId: allocator, duplicated, result: parseBoolean(params.map) === true ? { ids: duplicated.copies, map: Object.freeze(map) } : { ids: duplicated.copies } };
}
