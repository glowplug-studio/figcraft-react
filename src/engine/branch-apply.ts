import { type Document, type DocumentNode } from "./document";
import { changeKey, otherSide, type BranchPlan, type BranchSide } from "./branch-merge";
import { layerFields, numericOrder, rawLayerFields, type FileEdit, type LayerEdit, type WireFields } from "./branch-diff";
import { readNode, validateFileTree } from "./file-format";
import { subtreeIds, HierarchyDraft } from "./hierarchy";
import { validateChangedGeometry } from "./rotation";
import { wireId } from "./native-values";
import { sameComponentValue as equal } from "./component-groups";
import type { ImageResource } from "./image-resource";

// Entries without an explicit order change stay in order, with newly inserted entries appended.
function mergeEntries<T extends { id: string }>(list: readonly T[], changes: ReadonlyMap<string, FileEdit>,
  kind: string, source: readonly T[]): readonly T[] {
  const entries = new Map(list.map(value => [value.id, value])), values = new Map(source.map(value => [value.id, value]));
  for (const change of changes.values()) {
    if (!change.key.startsWith(kind + "/")) continue;
    const id = change.key.slice(kind.length + 1);
    const next = values.get(id);
    if (next) entries.set(id, next); else entries.delete(id);
  }
  const order = changes.get("doc/" + kind + "Order")?.value as string[] | undefined;
  if (!order) return [...entries.values()];
  const ordered: T[] = [];
  for (const id of order) {
    const value = entries.get(id);
    if (value) { ordered.push(value); entries.delete(id); }
  }
  return [...ordered, ...entries.values()];
}

function applyFileFields(to: Document, from: Document, changes: Map<string, FileEdit>) {
  if (!changes.size) return to;
  const result = { ...to };
  const take = <K extends "libraryLinks" | "libraryRecords" | "libraryStore" | "imagePresets" | "documentColours" | "colourProfile">(key: K) => {
    if (from[key] === undefined) delete result[key]; else result[key] = from[key];
  };
  if (changes.has("doc/libraries")) { take("libraryLinks"); take("libraryRecords"); take("libraryStore"); }
  if (changes.has("doc/imagePresets")) take("imagePresets");
  if (changes.has("doc/documentColors")) take("documentColours");
  if (changes.has("doc/colorProfile")) take("colourProfile");
  const changed = (kind: string) => [...changes.keys()].some(key => key.startsWith(kind + "/") || key === "doc/" + kind + "Order");
  if (changed("style")) {
    const styles = mergeEntries(to.styles ?? [], changes, "style", from.styles ?? []);
    if (styles.length) result.styles = Object.freeze(styles); else delete result.styles;
  }
  if (changed("collection") || changed("variable")) {
    const collections = mergeEntries(to.variables?.collections ?? [], changes, "collection", from.variables?.collections ?? []);
    const variables = mergeEntries(to.variables?.variables ?? [], changes, "variable", from.variables?.variables ?? []);
    if (collections.length || variables.length) result.variables = Object.freeze({ collections: Object.freeze(collections), variables: Object.freeze(variables) });
    else delete result.variables;
  }
  const images: Record<string, ImageResource> = Object.assign(Object.create(null), to.images);
  for (const key of changes.keys()) if (key.startsWith("image/")) {
    const id = key.slice(6), resource = from.images?.[id];
    if (resource) images[id] = resource;
  }
  if (Object.keys(images).length) result.images = Object.freeze(images);
  return result;
}

export function applyBranch(plan: BranchPlan, side: BranchSide, resolutions: Record<string, unknown>) {
  const source = plan[side], into = plan[otherSide(side)], target = into.document;
  const skip = new Set<LayerEdit>(), skipKeys = new Set<string>(), fields = new Map(plan.merged);
  const missing = plan.conflicts.filter(c => resolutions[c.key] !== "branch" && resolutions[c.key] !== "main");
  if (missing.length) throw new Error('Resolve every conflict first ("branch" or "main" in resolutions): ' + missing.map(c => c.key).join(", "));
  const nodes: Record<string, DocumentNode> = Object.assign(Object.create(null), target.nodes);
  const positions = new Map(into.positions);
  const touched = new Set<string>();
  for (const conflict of plan.conflicts) {
    const pick = resolutions[conflict.key] as BranchSide;
    if (conflict.field !== undefined) {
      const key = conflict.id + "/" + conflict.property;
      fields.set(key, { ...(fields.get(key) as WireFields), [conflict.field]: conflict[pick] });
    } else if (conflict.deletedBy && conflict.id) {
      if (pick !== side) {
        if (side === conflict.deletedBy) skipKeys.add(conflict.key);
        else for (const edit of conflict.affected!) skip.add(edit);
      } else if (side !== conflict.deletedBy) {
        for (const id of subtreeIds(plan.base, conflict.id)) if (!nodes[id]) {
          nodes[id] = plan.base.nodes[id]; positions.set(id, plan.positions.get(id)!); touched.add(id);
        }
      }
    } else if (pick !== side) skipKeys.add(conflict.key);
  }
  const deletes = new Set<string>(), patches = new Map<string, WireFields>();
  for (const edit of source.changes) {
    const key = changeKey(edit);
    if (skip.has(edit) || key && (skipKeys.has(key) || plan.computed.has(key))) continue;
    touched.add(edit.id);
    if (edit.type === "add") {
      if (nodes[edit.id]) throw new Error("Duplicate layer identifier in branch merge");
      nodes[edit.id] = edit.node; positions.set(edit.id, source.positions.get(edit.id)!);
    } else if (edit.type === "delete") deletes.add(edit.id);
    else if (edit.type === "move") {
      const node = nodes[edit.id];
      if (node && node.kind !== "page" && edit.parent !== null) nodes[edit.id] = Object.freeze({ ...node, parent: edit.parent });
      positions.set(edit.id, edit.position);
    } else if (nodes[edit.id]) {
      let patch = patches.get(edit.id);
      if (!patch) { patch = layerFields(nodes[edit.id]); patches.set(edit.id, patch); }
      patch[edit.property] = fields.has(key!) ? fields.get(key!) : edit.after;
    }
  }
  for (const [id, values] of patches) {
    const node = nodes[id], raw = rawLayerFields(values);
    nodes[id] = readNode(id, { ...raw, id: wireId(id), ...(node.parent !== null && { parent: wireId(node.parent) }),
      ...("children" in node && { children: node.children.map(wireId) }) });
  }
  const byParent = new Map<string | null, string[]>();
  for (const node of Object.values(nodes)) {
    let children = byParent.get(node.parent);
    if (!children) { children = []; byParent.set(node.parent, children); }
    children.push(node.id);
  }
  const pending = [...deletes];
  while (pending.length) {
    const id = pending.pop()!;
    if (!nodes[id]) continue;
    delete nodes[id];
    for (const child of byParent.get(id) ?? []) pending.push(child);
  }
  const result = applyFileFields(target, source.document, new Map([...source.files].filter(([key]) => !skipKeys.has(key))));
  const ordered = (ids: readonly string[]) => ids.filter(id => nodes[id]).sort((a, b) => {
    const x = positions.get(a) ?? "a0", y = positions.get(b) ?? "a0";
    return x === y ? numericOrder(a, b) : x < y ? -1 : 1;
  });
  for (const node of Object.values(nodes)) if ("children" in node) {
    const children = ordered(byParent.get(node.id) ?? []);
    if (!equal(node.children, children)) { nodes[node.id] = Object.freeze({ ...node, children: Object.freeze(children) }); touched.add(node.id); }
  }
  const pages = ordered(byParent.get(null) ?? []).filter(id => id !== result.libraryStore?.root);
  validateFileTree(nodes, pages, result.libraryStore?.root);
  const document: Document = Object.freeze({ ...result, nodes: Object.freeze(nodes), pages: Object.freeze(pages),
    currentPage: pages.includes(target.currentPage) ? target.currentPage : pages[0] });
  const draft = new HierarchyDraft(document, target);
  draft.markChanged(touched);
  return validateChangedGeometry(draft);
}
