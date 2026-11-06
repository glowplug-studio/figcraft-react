import { inverse, multiply, transformBounds, type Affine } from "./affine";
import { layerTransform, withLayerTransform, type Document, type NodeId } from "./document";
import { HierarchyDraft, rootIds, worldTransform, zSorted } from "./hierarchy";
import { parseBoolean, parseNodeId, parseNumber } from "./parameters";
import { boundsOf } from "./viewport";

export const arrangeSpecs = Object.freeze({
  "transform.move": { label: "Move", undo: true }, "transform.moveTo": { label: "Move to", undo: true },
  "transform.nudge": { label: "Nudge", undo: true },
  "align.left": { label: "Align left", undo: true }, "align.hcenter": { label: "Align horizontal centers", undo: true },
  "align.right": { label: "Align right", undo: true }, "align.top": { label: "Align top", undo: true },
  "align.vcenter": { label: "Align vertical centers", undo: true }, "align.bottom": { label: "Align bottom", undo: true },
  "distribute.horizontal": { label: "Distribute horizontal spacing", undo: true }, "distribute.vertical": { label: "Distribute vertical spacing", undo: true },
  "arrange.packH": { label: "Pack horizontal", undo: true }, "arrange.packV": { label: "Pack vertical", undo: true },
  "arrange.tidy": { label: "Tidy up", undo: true },
  "arrange.front": { label: "Bring to front", undo: true }, "arrange.forward": { label: "Bring forward", undo: true },
  "arrange.backward": { label: "Send backward", undo: true }, "arrange.back": { label: "Send to back", undo: true },
});

/** Native req_targets: explicit malformed identifiers never silently disappear. */
function targets(document: Document, selection: readonly NodeId[], params: Record<string, unknown>): NodeId[] {
  if (params.ids != null && !Array.isArray(params.ids)) throw new Error("ids must be an array");
  const raw: unknown[] = Array.isArray(params.ids) ? params.ids : params.id != null ? [params.id] : [...selection];
  const ids = raw.map(value => {
    const id = parseNodeId(value);
    if (id === undefined) throw new Error("Every target must be a node id");
    const node = document.nodes[id];
    if (!node) throw new Error(`No node ${id}`);
    if (node.kind === "page") throw new Error("Arrange layers, not pages");
    return id;
  });
  if (!ids.length) throw new Error("Nothing selected");
  return rootIds(document, ids);
}
function optionalNumber(value: unknown): number | undefined { try { return parseNumber(value); } catch { return undefined; } }

/** Shift in page space; nudge deliberately uses the parent's axes instead. */
function move(draft: HierarchyDraft, id: NodeId, dx: number, dy: number, local = false): void {
  if (dx === 0 && dy === 0) return;
  const node = draft.nodes[id];
  if (node.kind === "page") throw new Error("Cannot move a page");
  const shift: Affine = [1, 0, 0, 1, dx, dy];
  const parent = worldTransform(draft.document, node.parent);
  const matrix = multiply(local ? shift : multiply(multiply(inverse(parent), shift), parent), layerTransform(node));
  transformBounds(multiply(parent, matrix), node.width, node.height);
  draft.set(withLayerTransform(node, matrix));
}

export function canAlign(document: Document, selection: readonly NodeId[]): boolean {
  const ids = rootIds(document, selection);
  if (ids.length > 1) return true;
  const node = document.nodes[ids[0]];
  return Boolean(node?.parent && document.nodes[node.parent]?.kind !== "page");
}

export function executeArrange(command: string, document: Document, selection: readonly NodeId[], params: Record<string, unknown>): Document {
  if (!Object.hasOwn(arrangeSpecs, command)) throw new Error(`Unsupported arrangement: ${command}`);
  const allowed = ["id", "ids", ...(command === "transform.move" ? ["dx", "dy"] : command === "transform.moveTo" ? ["x", "y"] : command === "transform.nudge" ? ["dx", "dy", "big"] : command.startsWith("distribute.") || command === "arrange.tidy" ? ["spacing"] : [])];
  for (const key of Object.keys(params)) if (!allowed.includes(key)) throw new Error(`Unsupported ${command} parameter: ${key}`);
  const ids = targets(document, selection, params), draft = new HierarchyDraft(document);
  const number = (key: string, fallback: number) => optionalNumber(params[key]) ?? fallback;
  if (command === "transform.move" || command === "transform.moveTo" || command === "transform.nudge") {
    const box = boundsOf(document, ids)!;
    const k = command === "transform.nudge" && parseBoolean(params.big) === true ? 10 : 1;
    const dx = command === "transform.moveTo" ? number("x", box.x) - box.x : number("dx", 0) * k;
    const dy = command === "transform.moveTo" ? number("y", box.y) - box.y : number("dy", 0) * k;
    for (const id of ids) move(draft, id, dx, dy, command === "transform.nudge");
  } else if (command.startsWith("align.")) {
    if (!canAlign(document, ids)) return document;
    const box = boundsOf(document, ids.length === 1 ? [document.nodes[ids[0]].parent!] : ids)!;
    for (const id of ids) {
      const own = boundsOf(document, [id])!;
      const dx = command === "align.left" ? box.x - own.x : command === "align.right" ? box.x + box.width - own.x - own.width : command === "align.hcenter" ? box.x + box.width / 2 - own.x - own.width / 2 : 0;
      const dy = command === "align.top" ? box.y - own.y : command === "align.bottom" ? box.y + box.height - own.y - own.height : command === "align.vcenter" ? box.y + box.height / 2 - own.y - own.height / 2 : 0;
      move(draft, id, dx, dy);
    }
  } else if (command.startsWith("distribute.") || command === "arrange.packH" || command === "arrange.packV") {
    const horizontal = command === "distribute.horizontal" || command === "arrange.packH";
    const spacing = command.startsWith("arrange.pack") ? 0 : optionalNumber(params.spacing);
    if (ids.length < 3 && spacing === undefined) return document;
    const items = ids.map(id => ({ id, box: boundsOf(document, [id])! })).sort((a, b) => horizontal ? a.box.x - b.box.x : a.box.y - b.box.y);
    const start = horizontal ? items[0].box.x : items[0].box.y;
    const end = items.reduce((maximum, { box }) => Math.max(maximum, horizontal ? box.x + box.width : box.y + box.height), -Infinity);
    const total = items.reduce((sum, { box }) => sum + (horizontal ? box.width : box.height), 0);
    const gap = spacing ?? (end - start - total) / Math.max(1, items.length - 1);
    let at = start;
    for (const { id, box } of items) {
      move(draft, id, horizontal ? at - box.x : 0, horizontal ? 0 : at - box.y);
      at += (horizontal ? box.width : box.height) + gap;
    }
  } else if (command === "arrange.tidy") {
    if (ids.length < 2) return document;
    const items = ids.map(id => ({ id, box: boundsOf(document, [id])! })).sort((a, b) => a.box.y - b.box.y);
    const rows: (typeof items)[] = [];
    for (const item of items) {
      const row = rows.at(-1), middle = item.box.y + item.box.height / 2;
      if (row?.some(({ box }) => middle > box.y && middle < box.y + box.height)) row.push(item);
      else rows.push([item]);
    }
    const origin = boundsOf(document, ids)!;
    const maxWidth = items.reduce((max, { box }) => Math.max(max, box.width), 0), maxHeight = items.reduce((max, { box }) => Math.max(max, box.height), 0);
    const gap = optionalNumber(params.spacing) ?? Math.max(10, ...rows.filter(row => row.length > 1).map(row => {
      const left = Math.min(...row.map(({ box }) => box.x)), right = Math.max(...row.map(({ box }) => box.x + box.width));
      return (right - left - row.reduce((sum, { box }) => sum + box.width, 0)) / (row.length - 1);
    }));
    for (const [y, row] of rows.entries()) for (const [x, { id, box }] of row.sort((a, b) => a.box.x - b.box.x).entries()) {
      move(draft, id, origin.x + x * (maxWidth + gap) - box.x, origin.y + y * (maxHeight + gap) - box.y);
    }
  } else {
    const ordered = zSorted(document, ids), selected = new Set(ordered), parents = new Set(ordered.map(id => document.nodes[id].parent!));
    for (const parentId of parents) {
      const parent = draft.nodes[parentId];
      if (parent.kind === "rectangle") throw new Error("Invalid layer parent");
      const children = [...parent.children];
      let next: NodeId[];
      if (command === "arrange.front") next = [...children.filter(id => !selected.has(id)), ...children.filter(id => selected.has(id))];
      else if (command === "arrange.back") next = [...children.filter(id => selected.has(id)), ...children.filter(id => !selected.has(id))];
      else {
        const forward = command === "arrange.forward", step = forward ? 1 : -1;
        for (const id of forward ? [...ordered].reverse() : ordered) {
          const at = children.indexOf(id), neighbour = at + step;
          if (at >= 0 && neighbour >= 0 && neighbour < children.length && !selected.has(children[neighbour])) [children[at], children[neighbour]] = [children[neighbour], children[at]];
        }
        next = children;
      }
      if (next.some((id, index) => id !== parent.children[index])) draft.set({ ...parent, children: Object.freeze(next) });
    }
    return draft.finish();
  }
  draft.normaliseGroups();
  return draft.finish();
}
