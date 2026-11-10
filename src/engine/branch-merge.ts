import { sameComponentValue as equal } from "./component-groups";
import type { Document, DocumentNode } from "./document";
import { layerSizing } from "./auto-layout";
import { branchDiff, initialPositions, layerFields, nodePropertyOrder, numericOrder, type BranchDelta, type LayerEdit, type WireFields } from "./branch-diff";
import { subtreeIds } from "./hierarchy";

export type BranchSide = "branch" | "main";
export const otherSide = (side: BranchSide) => side === "branch" ? "main" : "branch";
const itemProperties = new Set(["fills", "strokes", "effects", "grids", "exports", "guides", "interactions", "annotations", "devResources", "measurements"]);
export type SetEdit = Extract<LayerEdit, { type: "set" }>;
export function changeKey(edit: LayerEdit) {
  switch (edit.type) {
    case "add": return undefined;
    case "delete": return edit.id + "/layer";
    case "move": return edit.id + "/parent";
    case "set": return edit.id + "/" + edit.property;
  }
}
export interface BranchConflict {
  key: string;
  id?: string;
  property: string;
  field?: string;
  branch: unknown;
  main: unknown;
  deletedBy?: BranchSide;
  affected?: Set<LayerEdit>;
}

function mergeItems(base: unknown, branch: unknown, main: unknown) {
  const original = base ?? [], b = branch ?? [], m = main ?? [];
  if (!Array.isArray(original) || !Array.isArray(b) || !Array.isArray(m) || Math.min(b.length, m.length) < original.length) return;
  const merged: unknown[] = [];
  for (let i = 0; i < original.length; i++) {
    if (equal(b[i], original[i])) merged.push(m[i]);
    else if (equal(m[i], original[i]) || equal(m[i], b[i])) merged.push(b[i]);
    else return;
  }
  const x = b.slice(original.length), y = m.slice(original.length);
  if (x.length && y.length && !equal(x, y)) return;
  return merged.concat(x.length ? x : y);
}

const object = (value: unknown): value is WireFields => !!value && typeof value === "object" && !Array.isArray(value);

function derived(document: Document, edit: SetEdit) {
  const node = document.nodes[edit.id];
  if (!node || node.kind === "page") return false;
  const parent = document.nodes[node.parent];
  const flow = !node.childLayout?.absolute && parent && "layout" in parent && !!parent.layout;
  if (edit.property === "transform" && flow) return true;
  if (edit.property === "width" || edit.property === "height") {
    const horizontal = edit.property === "width";
    const sizing = layerSizing(node);
    if ((horizontal ? sizing.horizontal : sizing.vertical) === "fill" && flow) return true;
    if ((horizontal ? sizing.horizontal : sizing.vertical) === "hug" && "layout" in node && node.layout) return true;
    if (node.kind === "text" && (node.text.autoResize === "widthAndHeight" || !horizontal && node.text.autoResize === "height")) return true;
  }
  const source = node.kind === "instance" ? node.component : node.source;
  return !!source && !!document.nodes[source] && equal(edit.after, layerFields(document.nodes[source])[edit.property]);
}

function affectedByDeletion(base: Document, id: string, delta: BranchDelta) {
  const doomed = new Set(subtreeIds(base, id));
  const affected = new Set<LayerEdit>();
  // Changes may create several generations. Follow the resulting parent chain for additions.
  const inside = (node: DocumentNode | undefined) => {
    let cursor = node?.parent;
    while (cursor) {
      if (doomed.has(cursor)) return true;
      if (base.nodes[cursor]) break;
      cursor = delta.document.nodes[cursor]?.parent;
    }
    return false;
  };
  for (const edit of delta.changes) {
    if (edit.type === "delete") continue;
    if (doomed.has(edit.id) || edit.type === "move" && edit.parent && doomed.has(edit.parent)
      || edit.type === "add" && inside(edit.node)) affected.add(edit);
  }
  return affected;
}

export function planBranch(base: Document, head: Document, current: Document) {
  const positions = initialPositions(base);
  const branch = branchDiff(base, head, positions), main = branchDiff(base, current, positions);
  const conflicts: BranchConflict[] = [];
  const merged = new Map<string, unknown>(), computed = new Set<string>();
  const mainEdits = new Map(main.changes.map(edit => [changeKey(edit), edit]));
  const byNativeProperty = (a: LayerEdit, b: LayerEdit) => numericOrder(a.id, b.id)
    || nodePropertyOrder.indexOf(a.type === "set" ? a.property : "parent") - nodePropertyOrder.indexOf(b.type === "set" ? b.property : "parent");
  for (const b of [...branch.changes].sort(byNativeProperty)) {
    const key = changeKey(b);
    if (!key || b.type === "delete") continue;
    const m = mainEdits.get(key);
    if (!m) continue;
    if (b.type === "move" && m.type === "move") {
      if (b.parent !== m.parent || b.position !== m.position) conflicts.push({ key, id: b.id, property: "parent", branch: b, main: m });
      continue;
    }
    if (b.type !== "set" || m.type !== "set" || equal(b.after, m.after)) continue;
    if (derived(head, b) && derived(current, m) && (b.property !== "transform" || Array.isArray(b.after) && Array.isArray(m.after)
      && equal(b.after.slice(0, 4), m.after.slice(0, 4)))) {
      computed.add(key); continue;
    }
    if (itemProperties.has(b.property)) {
      const list = mergeItems(b.before, b.after, m.after);
      if (list) { merged.set(key, list); continue; }
    }
    if ((b.property === "layout" || b.property === "childLayout") && object(b.before) && object(b.after) && object(m.after)) {
      const fields: WireFields = {};
      const names = new Set([...Object.keys(b.before), ...Object.keys(b.after), ...Object.keys(m.after)]);
      for (const field of [...names].sort()) {
        const old = b.before[field], left = b.after[field], right = m.after[field];
        if (equal(old, left)) fields[field] = right;
        else if (equal(old, right) || equal(left, right)) fields[field] = left;
        else {
          fields[field] = old;
          conflicts.push({ key: key + "." + field, field, id: b.id, property: b.property, branch: left, main: right });
        }
      }
      merged.set(key, fields); continue;
    }
    conflicts.push({ key, id: b.id, property: b.property, branch: b.after, main: m.after });
  }
  for (const [key, b] of branch.files) {
    const m = main.files.get(key);
    if (m && !key.startsWith("image/") && !equal(b.value, m.value)) conflicts.push({ key, property: key, branch: b.value, main: m.value });
  }
  for (const side of ["branch", "main"] as const) {
    const delta = side === "branch" ? branch : main;
    for (const edit of delta.changes) if (edit.type === "delete") {
      const affected = affectedByDeletion(base, edit.id, side === "branch" ? main : branch);
      if (affected.size) conflicts.push({ key: edit.id + "/layer", id: edit.id, property: "layer", deletedBy: side,
        branch: side === "branch" ? "deleted" : "edited", main: side === "main" ? "deleted" : "edited", affected });
    }
  }
  return { base, positions, branch, main, conflicts, computed, merged };
}
export type BranchPlan = ReturnType<typeof planBranch>;
