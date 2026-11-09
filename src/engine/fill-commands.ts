import type { CopiedPaint } from "./paint-clipboard";
import { arrangementTargets } from "./arrange";
import { fromRgba8 } from "./colour";
import { rectanglePaints, withRectanglePaints, type Document, type LayerNode, type NodeId } from "./document";
import { HierarchyDraft } from "./hierarchy";
import { paintStackEdit } from "./paint-stack";
import { checkPatternTarget } from "./pattern-sources";
import { parseIndex, parseNodeId, parseNumber } from "./parameters";
import { samePaints, solidPaint, type Paint } from "./solid-paint";
import type { VectorEditState } from "./vector-edit";

export const fillSpecs = Object.freeze({
  "fill.add": { label: "Add fill", undo: true },
  "fill.remove": { label: "Remove fill", undo: true },
  "fill.move": { label: "Move fill", undo: true },
  "fill.pattern": { label: "Pattern fill", undo: true },
  "fill.set": { label: "Set fill", undo: true },
  "fill.copy": { label: "Copy fill", undo: false },
  "fill.paste": { label: "Paste fill", undo: true },
});
type WriteCommand = Exclude<keyof typeof fillSpecs, "fill.copy">;
const grey = solidPaint(fromRgba8(217, 217, 217)), white = solidPaint(fromRgba8(255, 255, 255));

/** Undefined selects layer fills. Null denotes mixed selected regions. */
export function selectedRegionFills(node: LayerNode, state?: VectorEditState): readonly Paint[] | null | undefined {
  if (node.kind !== "vector" || state?.id !== node.id || !state.regions.length) return undefined;
  const inherited = rectanglePaints(node);
  let first: readonly Paint[] | undefined;
  for (const i of state.regions) {
    const region = node.network.regions[i]; if (!region) continue;
    const stack = region.fills ?? inherited;
    if (first && !samePaints(first, stack)) return null;
    first ??= stack;
  }
  return first;
}

function fillRegions(document: Document, ids: readonly NodeId[], explicit: unknown, state?: VectorEditState): ReadonlySet<number> | undefined {
  if (explicit == null) return ids.length === 1 && ids[0] === state?.id && state.regions.length ? new Set(state.regions) : undefined;
  if (ids.length !== 1) throw new Error("regions requires one vector layer");
  const node = document.nodes[ids[0]];
  if (node.kind !== "vector") throw new Error("regions requires a vector layer");
  if (!Array.isArray(explicit) || !explicit.length) throw new Error("regions requires a non-empty array of indices");
  const count = node.network.regions.length;
  if (explicit.some(i => !Number.isSafeInteger(i) || i < 0 || i >= count)) throw new Error(`regions requires indices below ${count}`);
  return new Set(explicit);
}

export function copyPaint(list: CopiedPaint["list"], document: Document, selection: readonly NodeId[], params: Record<string, unknown>, state?: VectorEditState): CopiedPaint {
  const id = Array.isArray(params.ids) ? params.ids.map(parseNodeId).find(id => id !== undefined) : parseNodeId(params.id) ?? selection[0];
  const node = id && document.nodes[id];
  if (!node || node.kind === "page") throw new Error("Select a layer to copy a " + list);
  const selected = list === "fill" ? selectedRegionFills(node, state) : undefined;
  if (selected === null) throw new Error("The selected regions' fills differ");
  const paints = list === "stroke" ? node.strokes ?? [] : selected ?? rectanglePaints(node);
  const at = params.index == null ? Math.max(0, paints.length - 1) : parseIndex(params.index);
  const paint = paints[at];
  if (!paint) throw new Error(`No ${list} at index ${at}`);
  const images = document.images;
  const image = paint.type === "image" && images && Object.hasOwn(images,paint.image) ? images[paint.image] : undefined;
  return {list, paint, image, stroke: list === "stroke" ? node.stroke : undefined};
}

export function writeFill(command: WriteCommand, document: Document, selection: readonly NodeId[], params: Record<string, unknown>,
  state?: VectorEditState, clipboard?: Paint): Document {
  const ids = arrangementTargets(document, selection, params, false);
  const selected = fillRegions(document, ids, params.regions, state);
  const regions = command === "fill.pattern" ? undefined : selected;
  if (command === "fill.pattern") {
    const source = parseNodeId(params.source), node = source && document.nodes[source];
    if (!node || node.kind === "page") throw new Error("Pattern source must be a layer");
    checkPatternTarget(document, ids, node.id);
    let scale = 1;
    try { scale = Math.max(.01, Math.min(100, parseNumber(params.scale))); } catch { /* Optional native scale defaults to one. */ }
    params = {...params, paint:{type:"pattern", source:node.id, tile:params.tile, align:params.align, spacing:params.spacing, scale}};
    command = "fill.set";
  }
  if (command === "fill.paste" && !clipboard) throw new Error("No copied fill");
  const action = command === "fill.paste" ? (params.index == null ? "add" : "set") : command.slice(5) as "set" | "add" | "remove" | "move";
  const values = command === "fill.paste" ? { paint: clipboard, index: params.index } : params;
  const apply = paintStackEdit(action, values), draft = new HierarchyDraft(document);
  for (const id of ids) {
    const node = draft.nodes[id]; if (node.kind === "page") throw new Error("Cannot fill a page");
    const inherited = rectanglePaints(node);
    if (regions && node.kind === "vector") {
      const next = node.network.regions.map((region, i) => {
        if (!regions.has(i)) return region;
        const before = region.fills ?? inherited, fills = apply(before, grey);
        return samePaints(before, fills) ? region : Object.freeze({ ...region, fills: Object.freeze(fills) });
      });
      if (next.some((region, i) => region !== node.network.regions[i])) {
        draft.set({ ...node, network: Object.freeze({ ...node.network, regions: Object.freeze(next) }) });
      }
    } else {
      const fills = apply(inherited, node.kind === "frame" && action === "add" ? white : grey);
      if (!samePaints(inherited, fills)) draft.set(withRectanglePaints(node, fills));
    }
  }
  return draft.finish();
}
