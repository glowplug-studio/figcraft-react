import { sameComponentValue } from "./component-groups";
import type { Document, DocumentNode } from "./document";
import { wireNode } from "./file-format";
import { positionKeys, siblingPositions } from "./branch-position";

// Names follow the native collaboration protocol. Data specific to a node kind is one property.
const fields = {
  name: "name", visible: "visible", locked: "locked", opacity: "opacity", blend: "blend", transform: "transform",
  width: "width", height: "height", fills: "fills", strokes: "strokes", stroke: "stroke", effects: "effects",
  corners: "corners", constraints: "constraints", layout: "layout", childLayout: "child_layout", clip: "clip",
  isMask: "is_mask", maskType: "mask_type", grids: "grids", guides: "guides", exports: "exports", interactions: "interactions",
  overflow: "overflow", scrollPosition: "scroll_position", styles: "styles", bound: "bound", varModes: "var_modes",
  boolOp: "bool_op", constrainProportions: "constrain_proportions", source: "source", exposed: "exposed",
  devStatus: "dev_status", devChanged: "dev_changed", devNote: "dev_note", overrides: "overrides", propRefs: "prop_refs", pluginData: "plugin_data", annotations: "annotations", codeLinks: "code_links",
  devResources: "dev_resources", measurements: "measurements", board: "board",
} as const;
export const nodePropertyOrder = ["name", "kind", ...Object.keys(fields).slice(1), "parent"];
const standardFields = new Set<string>(["id", "parent", "children", ...Object.values(fields)]);
export type WireFields = Record<string, unknown>;

export function layerFields(node: DocumentNode): WireFields {
  const wire: WireFields = wireNode(node.id, node), result: WireFields = {};
  for (const [key, native] of Object.entries(fields)) if (native in wire) result[key] = wire[native];
  result.kind = Object.fromEntries(Object.entries(wire).filter(([key]) => !standardFields.has(key)));
  return result;
}

export function rawLayerFields(values: WireFields) {
  const raw: WireFields = { ...(values.kind as WireFields) };
  for (const [key, native] of Object.entries(fields)) if (values[key] !== undefined) raw[native] = values[key];
  return raw;
}

export type LayerEdit =
  | { type: "add"; id: string; node: DocumentNode }
  | { type: "delete"; id: string }
  | { type: "set"; id: string; property: string; before: unknown; after: unknown }
  | { type: "move"; id: string; parent: string | null; position: string; parentChanged: boolean };

export interface FileEdit { key: string; value: unknown; before: unknown; operation: "added" | "removed" | "changed" }

const empty: readonly string[] = [];
export function childrenOf(document: Document, parent: string | null): readonly string[] {
  if (!parent) return document.pages;
  const node = document.nodes[parent];
  return node && "children" in node ? node.children : empty;
}
export const numericOrder = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);

export function initialPositions(document: Document) {
  const positions = new Map<string, string>();
  const assign = (ids: readonly string[]) => {
    const keys = positionKeys(undefined, undefined, ids.length);
    ids.forEach((id, i) => positions.set(id, keys[i]));
  };
  assign(document.pages);
  for (const node of Object.values(document.nodes)) {
    if ("children" in node) assign(node.children);
    if (!node.parent && !positions.has(node.id)) positions.set(node.id, "a0");
  }
  return positions;
}

export function fileChanges(base: Document, to: Document) {
  const changes = new Map<string, FileEdit>();
  const add = (key: string, before: unknown, value: unknown) => {
    if (sameComponentValue(before, value)) return;
    changes.set(key, { key, before, value, operation: before === undefined ? "added" : value === undefined ? "removed" : "changed" });
  };
  add("doc/documentColors", base.documentColours, to.documentColours);
  add("doc/colorProfile", base.colourProfile, to.colourProfile);
  add("doc/imagePresets", base.imagePresets, to.imagePresets);
  const libraries = (doc: Document) => ({ libraryLinks: doc.libraryLinks, libraryStore: doc.libraryStore, libraryRecords: doc.libraryRecords });
  add("doc/libraries", libraries(base), libraries(to));
  const list = (kind: string, from: readonly { id: string }[] = [], next: readonly { id: string }[] = []) => {
    if (from === next) return;
    const previous = new Map(from.map(item => [item.id, item])), current = new Map(next.map(item => [item.id, item]));
    for (const item of next) add(kind + "/" + item.id, previous.get(item.id), item);
    for (const item of from) if (!current.has(item.id)) add(kind + "/" + item.id, item, undefined);
    const natural = [...from.filter(item => current.has(item.id)), ...next.filter(item => !previous.has(item.id))];
    if (!natural.every((item, i) => item.id === next[i].id)) add("doc/" + kind + "Order", from.map(item => item.id), next.map(item => item.id));
  };
  list("style", base.styles, to.styles);
  if (base.comments !== to.comments) {
    const repeated = (items: Document["comments"]) => items && new Set(items.map(item => item.id)).size !== items.length;
    if (repeated(base.comments) || repeated(to.comments)) add("doc/comments", base.comments, to.comments);
    else list("comment", base.comments, to.comments);
  }
  list("collection", base.variables?.collections, to.variables?.collections);
  list("variable", base.variables?.variables, to.variables?.variables);
  if (base.images !== to.images) {
    for (const key of new Set([...Object.keys(base.images ?? {}), ...Object.keys(to.images ?? {})])) {
      const before = base.images?.[key], after = to.images?.[key];
      if (!before || !after || before.digest !== after.digest) add("image/" + key, before, after);
    }
  }
  return changes;
}

export function branchDiff(base: Document, to: Document, initial: ReadonlyMap<string, string>) {
  const changes: LayerEdit[] = [], parents = new Set<string | null>(), positions = new Map(initial);
  const ids = Object.keys(to.nodes).sort(numericOrder);
  const added = new Set<string>();
  for (const id of ids) {
    const previous = base.nodes[id], next = to.nodes[id];
    if (previous === next) continue;
    if (!previous) { added.add(id); changes.push({ type: "add", id, node: next }); parents.add(next.parent); continue; }
    const before = layerFields(previous), after = layerFields(next);
    for (const property of nodePropertyOrder) if (!sameComponentValue(before[property], after[property])) {
      changes.push({ type: "set", id, property, before: before[property], after: after[property] });
    }
    if (previous.parent !== next.parent) parents.add(next.parent);
    if ("children" in next && !sameComponentValue(childrenOf(base, id), next.children)) parents.add(id);
  }
  if (!sameComponentValue(base.pages, to.pages)) parents.add(null);
  for (const parent of parents) {
    const children = childrenOf(to, parent);
    const old = (id: string) => base.nodes[id]?.parent === parent ? initial.get(id) : undefined;
    for (const [id, position] of siblingPositions(children, old)) {
      positions.set(id, position);
      if (!added.has(id) && old(id) !== position) {
        changes.push({ type: "move", id, parent, position, parentChanged: base.nodes[id]?.parent !== parent });
      }
    }
  }
  for (const id of added) if (!positions.has(id)) positions.set(id, "a0");
  for (const [id, node] of Object.entries(base.nodes)) if (!to.nodes[id]) {
    positions.delete(id);
    if (!node.parent || to.nodes[node.parent]) changes.push({ type: "delete", id });
  }
  const files = fileChanges(base, to);
  const count = changes.length + changes.filter(c => c.type === "move" && c.parentChanged).length + files.size;
  return { changes, positions, files, count, document: to };
}
export type BranchDelta = ReturnType<typeof branchDiff>;
