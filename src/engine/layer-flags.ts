import { requiredTargets } from "./arrange";
import { ancestorIds, lockedIn } from "./canvas-selection";
import type { Document, NodeId } from "./document";
import { parseBoolean } from "./parameters";

export const layerFlagSpecs = Object.freeze({
  "object.toggleVisible": { label: "Show/Hide selection", undo: true },
  "object.toggleLock": { label: "Lock/Unlock selection", undo: true },
});
export type LayerFlagCommand = keyof typeof layerFlagSpecs;

/** Native `cmd/edit/select.rs::toggle`: show or hide, or lock or unlock, the targets together. Without an explicit
 * value: if any is visible all are hidden, and if any is unlocked all are locked. A child of a locked layer counts
 * as locked, and Lock/Unlock leaves its own flag alone, as its padlock does, so that the flag still holds once the
 * parent is unlocked; an explicit `locked` sets it anyway. Locking clears the selection. */
export function toggleLayerFlag(command: LayerFlagCommand, document: Document, selection: readonly NodeId[], params: Record<string, unknown>):
  { document: Document; selection: readonly NodeId[]; result: Record<string, boolean> } {
  const what = command === "object.toggleLock" ? "locked" : "visible";
  for (const key of Object.keys(params)) if (key !== "id" && key !== "ids" && key !== what) throw new Error(`Unsupported ${command} parameter: ${key}`);
  const ids = requiredTargets(document, selection, params), explicit = parseBoolean(params[what]);
  const value = explicit ?? (what === "visible"
    ? !ids.every(id => { const node = document.nodes[id]; return node.kind !== "page" && node.visible !== false; })
    : !ids.every(id => lockedIn(document, id)));
  const underLock = (id: NodeId) => ancestorIds(document, id).some(a => { const node = document.nodes[a]; return node && node.kind !== "page" && node.locked === true; });
  const nodes = { ...document.nodes };
  let changed = false;
  for (const id of ids) {
    const node = nodes[id];
    if (node.kind === "page" || what === "locked" && explicit === undefined && underLock(id)) continue;
    if (what === "visible" ? (node.visible !== false) === value : (node.locked === true) === value) continue;
    nodes[id] = Object.freeze({ ...node, [what]: value }); changed = true;
  }
  return {
    document: changed ? Object.freeze({ ...document, nodes: Object.freeze(nodes) }) : document,
    selection: what === "locked" && value ? Object.freeze([]) : selection,
    result: { [what]: value },
  };
}
