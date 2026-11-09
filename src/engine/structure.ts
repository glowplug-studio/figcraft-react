import { setChildProperty } from "./child-layout-properties";
import { editLayoutStructure } from "./layout-structure";
import { withMaskProperties, booleanOperations, isBooleanOperation, isLeaf, rectanglePaints, withRectanglePaints, type BooleanNode, type BooleanOperation } from "./document";
import { fromRgba8 } from "./colour";
import { solidPaint } from "./solid-paint";
import { inverse, transformBounds } from "./affine";
import { type Document, type GroupNode, type FrameNode, type NodeId } from "./document";
import { HierarchyDraft, pageForNode, rootIds, worldTransform, zSorted } from "./hierarchy";
import { parseIndex, parseNodeId, parseNumber, parseString } from "./parameters";

export const structureSpecs = Object.freeze({
  "layout.add": { label: "Add auto layout", undo: true },
  "layout.remove": { label: "Remove auto layout", undo: true },
  "layout.removeAll": { label: "Remove all auto layout", undo: true },
  "layout.suggest": { label: "Suggest auto layout", undo: true },
  "bool.union": { label: "Union selection", undo: true },
  "bool.subtract": { label: "Subtract selection", undo: true },
  "bool.intersect": { label: "Intersect selection", undo: true },
  "bool.exclude": { label: "Exclude selection", undo: true },
  "object.mask": { label: "Use as mask", undo: true },
  "object.releaseMask": { label: "Release mask", undo: true },
  "object.group": { label: "Group selection", undo: true },
  "object.frameSelection": { label: "Frame selection", undo: true },
  "object.removeFrame": { label: "Remove frame", undo: true },
  "object.convertToFrame": { label: "Convert to frame", undo: true },
  "object.convertToGroup": { label: "Convert to group", undo: true },
  "object.ungroup": { label: "Ungroup selection", undo: true },
  "node.reorder": { label: "Reorder layer", undo: true },
  "node.reparent": { label: "Move layer into", undo: true },
  "edit.delete": { label: "Delete", undo: true },
});
export const booleanLabel = (op: BooleanOperation) => op[0].toUpperCase() + op.slice(1);
function clearOperand(draft: HierarchyDraft, id: NodeId) {
  const node = draft.nodes[id];
  if (node.kind !== "page" && node.boolOp !== undefined) {
    const { boolOp: _op, ...rest } = node;
    draft.set(rest);
  }
}
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
  if (command === "node.reorder") {
    const id = parseNodeId(params.id);
    if (id === undefined) throw new Error("`id` must be a node id");
    const index = parseIndex(params.index);
    const node = document.nodes[id];
    if (!node) throw new Error(`No node ${id}`);
    if (node.parent === null) throw new Error("Cannot reorder a page as a layer");
    const parent = document.nodes[node.parent];
    if (!parent || isLeaf(parent)) throw new Error("A container parent is required");
    const draft = new HierarchyDraft(document);
    const position = Math.min(index, parent.children.length - 1);
    if (parent.children[position] !== id) {
      const children = parent.children.filter(child => child !== id);
      children.splice(position, 0, id);
      draft.set(Object.freeze({ ...parent, children: Object.freeze(children) }));
      if (children.some(child=>document.nodes[child]?.isMask)) draft.normaliseGroups();
    }
    return { document: draft.finish(), selection, nextId, result: { ok: true } };
  }
  const suffix = command.startsWith("bool.") ? command.slice(5) : undefined;
  const operation = isBooleanOperation(suffix) ? suffix : undefined;
  const mask = command === "object.mask", releaseMask = command === "object.releaseMask";
  const layoutCommand = command.startsWith("layout.");
  const strictTargets = !!operation || mask || releaseMask || layoutCommand;
  const wraps = mask || command === "object.group" || command === "object.frameSelection" || operation !== undefined;
  const allowed = command === "layout.add" || command === "layout.suggest" ? ["id","ids","direction"] : wraps && !mask ? ["ids", "id", "name"] : command === "node.reparent" ? ["ids", "id", "parent", "index"] : ["ids", "id"];
  if (!Object.hasOwn(structureSpecs, command)) throw new Error(`Unsupported structure command: ${command}`);
  for (const key of Object.keys(params)) if (!allowed.includes(key)) throw new Error(`Unsupported ${command} parameter: ${key}`);
  const raw = params.ids ?? params.id;
  if ((mask || releaseMask) && params.ids == null && params.id != null && parseNodeId(params.id) === undefined) throw new Error("id must be a node id");
  if ((strictTargets ? params.ids != null : params.ids !== undefined) && !Array.isArray(params.ids)) throw new Error("ids must be an array");
  if (strictTargets && raw != null && (Array.isArray(raw) ? raw : [raw]).some(v => parseNodeId(v) === undefined)) throw new Error("Every target must be a node id");
  const targets = (raw === undefined || (strictTargets && raw === null)) ? [...selection] : (Array.isArray(raw) ? raw : [raw]).map(parseNodeId).filter((id): id is string => id !== undefined);
  if (!targets.length) throw new Error("Nothing selected");
  for (const id of targets) if (!document.nodes[id]) throw new Error(`No node ${id}`);
  const draft = new HierarchyDraft(document);
  let selected: readonly NodeId[] = selection;
  let allocator = nextId;
  let result: Record<string, unknown> = { ok: true };
  const wrapLayers = (items: readonly NodeId[], frame: boolean) => {
    const document = draft.document;
    const ids = zSorted(document, rootIds(document, items));
    const top = document.nodes[ids.at(-1)!];
    if (!top.parent) throw new Error("Cannot group a page");
    const parent = draft.nodes[top.parent];
    if (isLeaf(parent)) throw new Error("Parent cannot contain layers");
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
    let group: GroupNode | FrameNode | BooleanNode = Object.freeze({ id, ...(frame ? { kind: "frame" as const, clip: true } : { kind: "group" as const }), name: mask ? "Mask group" : parseString(params.name) ?? nextLayerName(document, frame ? "Frame" : "Group"), parent: parent.id,
      children: Object.freeze([]), x: local.x, y: local.y, width: local.width, height: local.height, fill: frame ? "#ffffff" : "transparent", blend: "passThrough" });
    if (operation) {
      const source = document.nodes[operation === "subtract" ? ids[0] : top.id];
      if (source.kind === "page") throw new Error("Cannot group a page");
      const paints = rectanglePaints(source);
      group = withRectanglePaints({ ...group, kind: "booleanOp", op: operation, name: parseString(params.name) ?? booleanLabel(operation), blend: "normal",
        ...(source.stroke ? { stroke: source.stroke } : {}), ...(source.strokes ? { strokes: source.strokes } : {}) }, paints.length ? paints : [solidPaint(fromRgba8(217,217,217))]);
    }
    draft.insert(group, parent.id, parent.children.indexOf(top.id) + 1);
    for (const child of ids) {
      draft.reparent(child, id);
      if (operation) clearOperand(draft, child);
    }
    if (mask) draft.set(withMaskProperties(draft.nodes[ids[0]],true));
    if (!frame) draft.fitToChildren(id);
    if (allocator < maximumId) allocator++;
    return id;
  };
  const convertGroup = (id: NodeId) => {
    const node = draft.nodes[id];
    if (node.kind !== "group") throw new Error("Expected a group");
    const {strokes, ...rest} = node;
    draft.set({...rest,kind:"frame",clip:false,fill:"transparent",fills:Object.freeze([])});
  };
  if (operation) {
    const first = draft.nodes[targets[0]];
    if (targets.length === 1 && first.kind === "booleanOp") {
      const name = booleanOperations.some(op => booleanLabel(op) === first.name) ? booleanLabel(operation) : first.name;
      if (first.op !== operation || first.name !== name) draft.set({ ...first, op: operation, name });
      for (const id of first.children) clearOperand(draft, id);
      return { document: draft.finish(), selection, nextId, result: { id: first.id, operation } };
    }
    const operands = targets.map(id => draft.nodes[id]);
    if (operands.every(n => n.parent && draft.nodes[n.parent]?.kind === "booleanOp")) {
      for (const node of operands) {
        if (node.kind === "page") continue;
        const group = draft.nodes[node.parent] as BooleanNode;
        if (operation === group.op) clearOperand(draft, node.id);
        else if (node.boolOp !== operation) draft.set({ ...node, boolOp: operation });
      }
      return { document: draft.finish(), selection, nextId, result: { ids: targets, operation } };
    }
  }
  if (layoutCommand) {
    const edit = editLayoutStructure(command,draft,targets,params.direction,ids => {
      const id = wrapLayers(ids,true), frame = draft.nodes[id] as FrameNode;
      draft.set({...frame,clip:false,fill:"transparent",fills:Object.freeze([])});
      return id;
    },convertGroup);
    if (edit.selected) selected = edit.selected;
    result = edit.result;
  } else if (releaseMask || mask && targets.length === 1) {
    for (const id of targets) {
      const node = draft.nodes[id];
      draft.set(withMaskProperties(node,!releaseMask && !node.isMask));
    }
  } else if (wraps) {
    const id = wrapLayers(targets,command === "object.frameSelection");
    selected = [id]; result = { id };
  } else if (command === "object.ungroup" || command === "object.removeFrame") {
    const out: NodeId[] = [];
    for (const id of targets) {
      const group = draft.nodes[id];
      if (!group || isLeaf(group) || group.kind === "page") continue;
      const parent = draft.nodes[group.parent];
      if (isLeaf(parent)) throw new Error("Parent cannot contain layers");
      const index = parent.children.indexOf(id);
      for (const [offset, child] of group.children.entries()) {
        draft.reparent(child, parent.id, index + offset);
        if (group.kind === "booleanOp") clearOperand(draft, child);
        const node = draft.nodes[child];
        if (node.kind !== "page" && (group.opacity ?? 1) < 1) draft.set({ ...node, opacity: Math.fround((node.opacity ?? 1) * (group.opacity ?? 1)) });
        out.push(child);
      }
      draft.remove(id);
    }
    selected = out; result = { ids: out };
  } else if (command === "object.convertToFrame" || command === "object.convertToGroup") {
    const toFrame = command === "object.convertToFrame", converted: NodeId[] = [];
    for (const id of targets) {
      const node = draft.nodes[id];
      if (node.kind !== "frame" && node.kind !== "group") throw new Error(`"${node.name}" is neither a frame nor a group`);
      if (!toFrame && node.kind === "frame" && node.children.length === 0) throw new Error(`"${node.name}" is empty: a group needs layers`);
      if (toFrame === (node.kind === "frame")) continue;
      if (toFrame) convertGroup(id);
      else {
        const { clip, layout, strokes, corners, ...group } = node as FrameNode;
        draft.set({ ...group, kind: "group", fill: "transparent", fills: Object.freeze([]) });
        for (const child of group.children) {
          const layer = draft.nodes[child];
          if (layer.kind !== "page" && layer.childLayout?.absolute) draft.set(setChildProperty(draft,layer,"absolute",false));
        }
        draft.fitToChildren(id);
      }
      converted.push(id);
    }
    result = { ids: converted };
  } else if (command === "node.reparent") {
    const parentId = parseNodeId(params.parent), parent = parentId === undefined ? undefined : draft.nodes[parentId];
    if (!parent || isLeaf(parent)) throw new Error("A container parent is required");
    const ids = zSorted(document, rootIds(document, targets));
    const index = params.index === undefined ? undefined : Math.max(0, Math.trunc(parseNumber(params.index, "index")));
    const above = index === undefined ? undefined : parent.children.filter(id => !ids.includes(id))[index];
    for (const id of ids) {
      const current = draft.nodes[parent.id];
      if (isLeaf(current)) throw new Error("A container parent is required");
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
