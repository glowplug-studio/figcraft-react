import { editPaintBindings } from "./list-variable-bindings";
import type { Document, NodeId } from "./document";
import { fromRgba8 } from "./colour";
import { paintStackEdit } from "./paint-stack";
import { HierarchyDraft } from "./hierarchy";
import { parseNodeId } from "./parameters";
import { samePaints, solidPaint } from "./solid-paint";
import { setStrokeProperties } from "./stroke";

export const strokeSpecs = Object.freeze({
  "stroke.copy": { label: "Copy stroke", undo: false },
  "stroke.paste": { label: "Paste stroke", undo: true },
  "stroke.add": { label: "Add stroke", undo: true },
  "stroke.remove": { label: "Remove stroke", undo: true },
  "stroke.set": { label: "Set stroke", undo: true },
  "stroke.move": { label: "Move stroke", undo: true },
  "stroke.widthProfile": { label: "Width profile", undo: true },
  "stroke.brush": { label: "Brush", undo: true },
});
/** Source cmd/edit/props.rs and cmd/lists.rs: independent per-target paint stacks. */
export function executeStrokeList(command: string, document: Document, selection: readonly NodeId[], params: Record<string, unknown>): Document {
  if (!Object.hasOwn(strokeSpecs, command)) throw new Error(`Unknown stroke command: ${command}`);
  if (params.ids != null && !Array.isArray(params.ids)) throw new Error("ids must be an array");
  const raw = params.ids ?? (params.id == null ? selection : [params.id]);
  const ids = (raw as readonly unknown[]).map(value => { const id = parseNodeId(value); if (id === undefined || !document.nodes[id] || document.nodes[id].kind === "page") throw new Error("A stroke target must be an editable layer"); return id; });
  if (!ids.length) throw new Error("Nothing selected");
  if (command === "stroke.widthProfile" || command === "stroke.brush") {
    const draft = new HierarchyDraft(document), brush = command === "stroke.brush";
    const values = brush ? { brush: params.preset == null ? null : params } : { widthProfile: params.preset ?? params.points ?? null };
    for (const id of ids) {
      const node = draft.nodes[id]; if (node.kind === "page") throw new Error("Cannot stroke a page");
      const next = setStrokeProperties(node, values);
      draft.set(brush && next.stroke?.brush && !next.strokes?.length ? { ...next, strokes: Object.freeze([solidPaint(fromRgba8(0, 0, 0))]) } : next);
    }
    return draft.finish();
  }
  const action = command.slice("stroke.".length) as "add" | "remove" | "set" | "move";
  const apply = paintStackEdit(action, params), draft = new HierarchyDraft(document);
  const black = solidPaint(fromRgba8(0, 0, 0));
  for (const id of ids) {
    const node = draft.nodes[id]; if (node.kind === "page") throw new Error("Cannot stroke a page");
    const before = node.strokes ?? [], strokes = apply(before, black);
    const updated=editPaintBindings(node,"strokes",action,params,before,strokes);
    if (!samePaints(before,strokes)) draft.set({ ...updated, strokes: Object.freeze(strokes) });
    else if (updated!==node) draft.set(updated);
  }
  return draft.finish();
}
