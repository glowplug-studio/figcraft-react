import type { Document, NodeId } from "./document";
import { characterFills } from "./text-layer-fills";

/** Native property_rows.rs: which list of the Design panel a highlighted row belongs to. */
export type PropertyKind = "fill" | "stroke" | "effect";
/** The row highlighted in the Design panel: it belongs to the layers selected when it was clicked. */
export interface PropertyRow { readonly kind: PropertyKind; readonly index: number; readonly ids: readonly NodeId[] }

export const propertyCopyCommand = (kind: PropertyKind) => kind + ".copy";
export const propertyPasteCommand = (kind: PropertyKind) => kind + ".paste";
/** What the system clipboard gets when a copy has no text of its own (native `PropertyKind::marker`). */
export const propertyMarker = (kind: PropertyKind) => "figcraft://clipboard/" + kind;

/** How many rows the `kind` list of `id` shows, as the Design panel lists them; undefined when it shows none (mixed). */
export function propertyListLength(document: Document, id: NodeId | undefined, kind: PropertyKind) {
  const node = id === undefined ? undefined : document.nodes[id];
  if (!node || node.kind === "page") return;
  if (kind === "effect") return (node.effects ?? []).length;
  if (kind === "stroke") return (node.strokes ?? []).length;
  return characterFills(node)?.length;
}

/** Native `follow` (lists::moved_index, removed_index): the row's index after `from` moved to `to`, or was removed (`to` undefined). */
export function followIndex(index: number, from: number, to?: number): number | undefined {
  if (to === undefined) return index === from ? undefined : index > from ? index - 1 : index;
  if (index === from) return to;
  if (from < index && index <= to) return index - 1;
  if (to <= index && index < from) return index + 1;
  return index;
}
