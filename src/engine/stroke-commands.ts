import type { Document, NodeId } from "./document";
import { fromRgba8, withAlpha } from "./colour";
import { parseColour } from "./colour-css";
import { HierarchyDraft } from "./hierarchy";
import { parseBoolean, parseNodeId, parseNumber, parseString } from "./parameters";
import { readSolidPaint, solidPaint, type SolidPaint } from "./solid-paint";
import { setStrokeProperties } from "./stroke";

export const strokeSpecs = Object.freeze({
  "stroke.add": { label: "Add stroke", undo: true },
  "stroke.remove": { label: "Remove stroke", undo: true },
  "stroke.set": { label: "Set stroke", undo: true },
  "stroke.move": { label: "Move stroke", undo: true },
  "stroke.widthProfile": { label: "Width profile", undo: true },
});
const indexOf = (value: unknown, key: string): number => {
  const result = parseNumber(value, key);
  if (!Number.isInteger(result) || result < 0 || result >= 1e9) throw new Error(`${key} must be a whole index from 0 to less than 1e9`);
  return result;
};
const unsupportedBlends = new Set(["darken", "multiply", "plusdarker", "colorburn", "lighten", "screen", "pluslighter", "colordodge", "overlay", "softlight", "hardlight", "difference", "exclusion", "hue", "saturation", "color", "luminosity"]);
function blend(value: unknown): SolidPaint["blend"] | undefined {
  const key = parseString(value)?.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (key === "normal") return "normal"; if (key === "passthrough") return "passThrough";
  if (key && unsupportedBlends.has(key)) throw new Error("This paint blend mode is not supported yet");
  return undefined;
}
/** Source cmd/edit/props.rs and cmd/lists.rs: independent per-target paint stacks. */
export function executeStrokeList(command: string, document: Document, selection: readonly NodeId[], params: Record<string, unknown>): Document {
  if (!Object.hasOwn(strokeSpecs, command)) throw new Error(`Unknown stroke command: ${command}`);
  if (params.ids != null && !Array.isArray(params.ids)) throw new Error("ids must be an array");
  const raw = params.ids ?? (params.id == null ? selection : [params.id]);
  const ids = (raw as readonly unknown[]).map(value => { const id = parseNodeId(value); if (id === undefined || !document.nodes[id] || document.nodes[id].kind === "page") throw new Error("A stroke target must be an editable layer"); return id; });
  if (!ids.length) throw new Error("Nothing selected");
  if (command === "stroke.widthProfile") {
    const draft = new HierarchyDraft(document), value = params.preset ?? params.points ?? null;
    for (const id of ids) {
      const node = draft.nodes[id]; if (node.kind === "page") throw new Error("Cannot stroke a page");
      draft.set(setStrokeProperties(node, { widthProfile: value }));
    }
    return draft.finish();
  }
  const index = (command === "stroke.remove" || command === "stroke.set") && params.index != null ? indexOf(params.index, "index") : undefined;
  const from = command === "stroke.move" ? indexOf(params.from, "from") : 0, to = command === "stroke.move" ? indexOf(params.to, "to") : 0;
  const draft = new HierarchyDraft(document);
  const black = solidPaint(fromRgba8(0, 0, 0));
  const supplied = command === "stroke.add" ? params.paint ?? params.color : command === "stroke.set" ? params.paint : undefined;
  const replacement = supplied == null ? undefined : readSolidPaint(supplied, true);
  const colour = command === "stroke.set" ? parseColour(params.color) : undefined;
  let opacity: number | undefined;
  if (command === "stroke.set" && params.opacity != null) {
    try { let number = parseNumber(params.opacity); if (number > 1 || typeof params.opacity === "string" && params.opacity.trim().endsWith("%")) number /= 100; opacity = Math.fround(Math.max(0, Math.min(1, number))); } catch { /* Native optional invalid opacity is ignored. */ }
  }
  const visible = command === "stroke.set" ? parseBoolean(params.visible) : undefined, mode = command === "stroke.set" ? blend(params.blend) : undefined;
  for (const id of ids) {
    const node = draft.nodes[id]; if (node.kind === "page") throw new Error("Cannot stroke a page");
    const strokes = [...node.strokes ?? []];
    if (command === "stroke.add") strokes.push(replacement ?? black);
    else if (command === "stroke.remove") {
      const at = index ?? Math.max(0, strokes.length - 1); if (at >= strokes.length) continue; strokes.splice(at, 1);
    } else if (command === "stroke.move") {
      if (from >= strokes.length || to >= strokes.length || from === to) continue;
      const [paint] = strokes.splice(from, 1); strokes.splice(to, 0, paint);
    } else {
      const at = index ?? Math.max(0, strokes.length - 1); if (!strokes.length) strokes.push(black);
      const old = strokes[at]; if (!old) throw new Error(`No paint at index ${at}`);
      let next = replacement ?? old;
      if (colour) next = { ...next, color: withAlpha(colour, 1), ...(colour.a < 1 ? { opacity: colour.a, colorAlpha: colour.a } : {}) };
      if (opacity !== undefined) next = { ...next, opacity, colorAlpha: 1 };
      if (visible !== undefined) next = { ...next, visible };
      if (mode !== undefined) next = { ...next, blend: mode };
      strokes[at] = Object.freeze(next);
    }
    if (JSON.stringify(strokes) !== JSON.stringify(node.strokes ?? [])) draft.set({ ...node, strokes: Object.freeze(strokes) });
  }
  return draft.finish();
}
