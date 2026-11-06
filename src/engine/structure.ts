import { inverse, transformBounds } from "./affine";
import { type Document, type GroupNode, type NodeId } from "./document";
import { HierarchyDraft, pageForNode, rootIds, worldTransform, zSorted } from "./hierarchy";
import { parseNodeId, parseNumber, parseString } from "./parameters";

export const structureSpecs = Object.freeze({
  "object.group": { label: "Group selection", undo: true },
  "object.ungroup": { label: "Ungroup selection", undo: true },
  "node.reparent": { label: "Move layer into", undo: true },
  "edit.delete": { label: "Delete", undo: true },
});
const maximumId = 18446744073709551615n;
export function nextLayerName(document: Document, base: string): string {
  const taken = new Set<bigint>();
  let max = 0n;
  for (const node of Object.values(document.nodes)) {
    if (!node.name.startsWith(`${base} `)) continue;
    const suffix = node.name.slice(base.length + 1);
    if (!/^\+?\d+$/.test(suffix)) continue;
    const value = BigInt(suffix);
    if (value > maximumId) continue;
    taken.add(value); if (value > max) max = value;
  }
  let next = max + 1n;
  if (next > maximumId) { next = 1n; while (taken.has(next)) next++; }
  return `${base} ${next}`;
}

export function executeStructure(command: string, document: Document, selection: readonly NodeId[], nextId: bigint, params: Record<string, unknown>) {
  const allowed = command === "object.group" ? ["ids", "id", "name"] : command === "node.reparent" ? ["ids", "id", "parent", "index"] : ["ids", "id"];
  if (!Object.hasOwn(structureSpecs, command)) throw new Error(`Unsupported structure command: ${command}`);
  for (const key of Object.keys(params)) if (!allowed.includes(key)) throw new Error(`Unsupported ${command} parameter: ${key}`);
  const raw = params.ids ?? params.id;
  if (params.ids !== undefined && !Array.isArray(params.ids)) throw new Error("ids must be an array");
  const targets = raw === undefined ? [...selection] : (Array.isArray(raw) ? raw : [raw]).map(parseNodeId).filter((id): id is string => id !== undefined);
  if (!targets.length) throw new Error("Nothing selected");
  for (const id of targets) if (!document.nodes[id]) throw new Error(`No node ${id}`);
  const draft = new HierarchyDraft(document);
  let selected: readonly NodeId[] = selection;
  let allocator = nextId;
  let result: Record<string, unknown> = { ok: true };
  if (command === "object.group") {
    const ids = zSorted(document, rootIds(document, targets));
    const top = document.nodes[ids.at(-1)!];
    if (!top.parent) throw new Error("Cannot group a page");
    const parent = draft.nodes[top.parent];
    if (parent.kind === "rectangle") throw new Error("Parent cannot contain layers");
    const boxes = ids.map(id => {
      const node = document.nodes[id];
      if (node.kind === "page") throw new Error("Cannot group a page");
      return transformBounds(worldTransform(document, id), node.width, node.height);
    });
    const x = Math.min(...boxes.map(box => box.x)), y = Math.min(...boxes.map(box => box.y));
    const width = Math.max(...boxes.map(box => box.x + box.width)) - x, height = Math.max(...boxes.map(box => box.y + box.height)) - y;
    const inv = inverse(worldTransform(document, parent.id));
    const local = transformBounds([inv[0], inv[1], inv[2], inv[3], inv[0] * x + inv[2] * y + inv[4], inv[1] * x + inv[3] * y + inv[5]], width, height);
    if (allocator > maximumId || draft.nodes[String(allocator)]) throw new Error("Document identifiers are exhausted");
    const id = String(allocator);
    const group: GroupNode = Object.freeze({ id, kind: "group", name: parseString(params.name) ?? nextLayerName(document, "Group"), parent: parent.id,
      children: Object.freeze([]), x: local.x, y: local.y, width: local.width, height: local.height, fill: "transparent", blend: "passThrough" });
    draft.insert(group, parent.id, parent.children.indexOf(top.id) + 1);
    for (const child of ids) draft.reparent(child, id);
    draft.fitToChildren(id);
    if (allocator < maximumId) allocator++;
    selected = [id]; result = { id };
  } else if (command === "object.ungroup") {
    const out: NodeId[] = [];
    for (const id of targets) {
      const group = draft.nodes[id];
      if (!group || group.kind !== "group") continue;
      const parent = draft.nodes[group.parent];
      if (parent.kind === "rectangle") throw new Error("Parent cannot contain layers");
      const index = parent.children.indexOf(id);
      for (const [offset, child] of group.children.entries()) {
        draft.reparent(child, parent.id, index + offset);
        const node = draft.nodes[child];
        if (node.kind !== "page" && (group.opacity ?? 1) < 1) draft.set({ ...node, opacity: Math.fround((node.opacity ?? 1) * (group.opacity ?? 1)) });
        out.push(child);
      }
      draft.remove(id);
    }
    selected = out; result = { ids: out };
  } else if (command === "node.reparent") {
    const parentId = parseNodeId(params.parent), parent = parentId === undefined ? undefined : draft.nodes[parentId];
    if (!parent || parent.kind === "rectangle") throw new Error("A container parent is required");
    const ids = zSorted(document, rootIds(document, targets));
    const index = params.index === undefined ? undefined : Math.max(0, Math.trunc(parseNumber(params.index, "index")));
    const above = index === undefined ? undefined : parent.children.filter(id => !ids.includes(id))[index];
    for (const id of ids) {
      const current = draft.nodes[parent.id];
      if (current.kind === "rectangle") throw new Error("A container parent is required");
      draft.reparent(id, parent.id, above === undefined ? undefined : current.children.indexOf(above));
    }
  } else {
    const ids = rootIds(document, targets);
    for (const id of ids) if (draft.nodes[id].kind !== "page") draft.remove(id);
    selected = []; result = { deleted: ids, hidden: [] };
  }
  draft.normaliseGroups();
  const updated = draft.finish();
  return { document: updated, selection: Object.freeze(selected.filter(id => updated.nodes[id]?.kind !== "page" && pageForNode(updated, id) === updated.currentPage)), nextId: allocator, result };
}
