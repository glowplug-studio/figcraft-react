import type { Document, NodeId } from "./document";
import { effectTypes, readEffect, withEffects, type Effect } from "./effects";
import { HierarchyDraft } from "./hierarchy";
import { parseIndex, parseNodeId, parseString } from "./parameters";

export const effectSpecs = {
  "effect.add": { label: "Add effect", undo: true },
  "effect.remove": { label: "Remove effect", undo: true },
  "effect.set": { label: "Set effect", undo: true },
  "effect.move": { label: "Move effect", undo: true },
  "effect.copy": { label: "Copy effect", undo: false },
  "effect.paste": { label: "Paste effect", undo: true },
} as const;

type Params = Record<string, unknown>;
function effectToAdd(params: Params) {
  if (params.effect != null) return readEffect(params.effect, "command");
  const name = (parseString(params.type) ?? "dropShadow").toLowerCase().replace(/[_ -]/g, "");
  const type = name === "blur" ? "layerBlur" : effectTypes.find(type => type.toLowerCase() === name);
  if (!type) throw new Error("Unknown effect type " + name);
  return readEffect({ type }, "command");
}

export function copyEffect(document: Document, selection: readonly NodeId[], params: Params) {
  const first = Array.isArray(params.ids) ? params.ids.map(parseNodeId).find(id => id !== undefined)
    : parseNodeId(params.id) ?? selection[0];
  if (!first) throw new Error("Select a layer");
  const node = document.nodes[first];
  if (!node) throw new Error("No node " + first);
  const effects = node.effects ?? [];
  const index = params.index == null ? Math.max(0, effects.length - 1) : parseIndex(params.index);
  if (!effects[index]) throw new Error("No effect at index " + index);
  return effects[index];
}

export function editEffects(command: string, document: Document, selection: readonly NodeId[], params: Params, copied?: Effect) {
  if (command === "effect.paste" && !copied) throw new Error("No copied effect");
  const index = command === "effect.set" || command === "effect.remove" || command === "effect.paste" && params.index != null
    ? parseIndex(params.index) : undefined;
  const effect = command === "effect.add" ? effectToAdd(params)
    : command === "effect.set" ? readEffect(params.effect, "command") : copied;
  const from = command === "effect.move" ? parseIndex(params.from, "from") : undefined;
  const to = command === "effect.move" ? parseIndex(params.to, "to") : undefined;
  if (params.ids != null && !Array.isArray(params.ids)) throw new Error("ids must be an array");
  const targets = Array.isArray(params.ids) ? params.ids : params.id != null ? [params.id] : selection;
  if (!targets.length) throw new Error("Select a layer");
  const draft = new HierarchyDraft(document);
  for (const target of targets) {
    const id = parseNodeId(target);
    if (!id) throw new Error("Invalid effect target");
    const node = draft.nodes[id];
    if (!node && command === "effect.move") continue;
    if (!node) throw new Error("No node " + id);
    const before = node.effects ?? [];
    if (index !== undefined && index >= before.length) continue;
    const after = [...before];
    if (from !== undefined && to !== undefined) {
      if (from >= after.length || to >= after.length || from === to) continue;
      after.splice(to, 0, after.splice(from, 1)[0]);
    } else if (command === "effect.remove" && index !== undefined) after.splice(index, 1);
    else if (effect && index !== undefined) after[index] = effect;
    else if (effect) after.push(effect);
    draft.set(withEffects(node, Object.freeze(after)));
  }
  return draft.finish();
}
