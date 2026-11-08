import { rectanglePaints, withRectanglePaints, type Document, type LayerNode, type NodeId } from "./document";
import { placementCrop } from "./image-placement";
import { HierarchyDraft } from "./hierarchy";
import { imageFilterPresets, readImageFilters, type ImageFilters } from "./image-filters";
import { parseIndex, parseNodeId, parseNumber, parseString } from "./parameters";
import { readPaint, type Paint } from "./solid-paint";

export const imageEditSpecs = Object.freeze({
  "image.adjust": { label: "Adjust image", undo: true },
  "image.savePreset": { label: "Save image preset", undo: true },
  "image.deletePreset": { label: "Delete image preset", undo: true },
});
type Params = Record<string, unknown>;

function editsStrokes(p: Params) {
  const target = parseString(p.target) ?? "fill";
  if (target === "stroke" || target === "strokes") return true;
  if (target === "fill" || target === "fills") return false;
  throw new Error("target: fill|stroke");
}
function paints(node: LayerNode, stroke: boolean) {
  return stroke ? node.strokes ?? [] : rectanglePaints(node);
}
function targets(selection: readonly NodeId[], p: Params, required: boolean): readonly NodeId[] {
  if (required && p.ids != null && !Array.isArray(p.ids)) throw new Error("ids must be an array");
  const ids = Array.isArray(p.ids) ? p.ids : parseNodeId(p.id) !== undefined || required && p.id != null ? [p.id] : selection;
  const parsed: NodeId[] = [];
  for (const raw of ids) {
    const id = parseNodeId(raw);
    if (id !== undefined) parsed.push(id);
    else if (required) throw new Error("Expected a node id");
  }
  if (required && !parsed.length) throw new Error("Nothing selected");
  return parsed;
}
function withValues(base: ImageFilters, values: unknown): ImageFilters {
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("filters must be an object");
  const filters = { ...base };
  for (const [key, value] of Object.entries(values)) {
    if (!Object.hasOwn(base, key)) throw new Error("Unknown image adjustment: " + key);
    filters[key as keyof ImageFilters] = Math.fround(parseNumber(value, key));
  }
  for (const key of Object.keys(filters) as (keyof ImageFilters)[]) {
    filters[key] = Number.isFinite(filters[key]) ? Math.max(-1, Math.min(1, filters[key])) : 0;
  }
  return Object.freeze(filters);
}
export function findImagePreset(document: Document, name: string) {
  const key = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
  const saved = document.imagePresets?.find(p => p.name === name);
  const query = key(name);
  const preset = saved ?? imageFilterPresets.find(p => key(p.id) === query || key(p.label) === query);
  if (!preset) throw new Error("No preset named " + name);
  return preset.filters;
}

/** Replace addresses the top image by default. Adjust addresses every image, including hidden paints. */
export function editImagePaints(document: Document, selection: readonly NodeId[], p: Params, replacement?: string) {
  const ids = targets(selection, p, true);
  const stroke = editsStrokes(p), index = p.index == null ? undefined : parseIndex(p.index);
  const name = replacement === undefined ? parseString(p.preset) : undefined;
  const preset = name === undefined ? undefined : findImagePreset(document, name);
  if (replacement === undefined && !preset && p.filters == null) throw new Error("Pass preset or filters");
  const draft = new HierarchyDraft(document);
  let changed = 0;
  for (const id of ids) {
    const node = draft.nodes[id];
    if (!node) throw new Error("No node " + id);
    if (node.kind === "page") continue;
    const list = paints(node, stroke);
    let at = index;
    if (replacement !== undefined && at === undefined) {
      for (let i = list.length - 1; i >= 0; i--) if (list[i].type === "image") { at = i; break; }
      if (at === undefined) continue;
    }
    const before = changed;
    const next = list.map((paint, i): Paint => {
      if (at !== undefined && i !== at) return paint;
      if (replacement !== undefined) {
        changed++;
        if (paint.type === "image") return Object.freeze({ ...paint, image: replacement });
        const { opacity, visible, blend, colorAlpha } = paint;
        return readPaint({ type: "image", image: replacement, opacity, visible, blend, colorAlpha });
      }
      if (paint.type !== "image") return paint;
      const base = preset ?? paint.filters;
      changed++;
      return Object.freeze({ ...paint, filters: p.filters == null ? base : withValues(base, p.filters) });
    });
    if (changed !== before) draft.set(stroke ? { ...node, strokes: Object.freeze(next) } : withRectanglePaints(node, next));
  }
  if (!changed) throw new Error(index === undefined ? "The layers have no image paints" : "No matching paint at that index");
  return { document: draft.finish(), result: { changed } };
}

export function editImagePreset(command: string, document: Document, selection: readonly NodeId[], p: Params) {
  const supplied = parseString(p.name);
  if (supplied === undefined) throw new Error("name must be a string");
  const saved = document.imagePresets ?? [];
  if (command === "image.deletePreset") {
    const presets = saved.filter(preset => preset.name !== supplied);
    if (presets.length === saved.length) throw new Error("No preset named " + supplied);
    return { document: Object.freeze({ ...document, imagePresets: Object.freeze(presets) }), result: { ok: true } };
  }
  const name = Array.from(supplied.trim().replace(/\p{Cc}/gu, "")).slice(0, 100).join("");
  if (!name) throw new Error("Preset name is empty");
  let filters: ImageFilters | undefined;
  if (p.filters != null) filters = withValues(readImageFilters({}), p.filters);
  else {
    const stroke = editsStrokes(p);
    let index: number | undefined;
    try {
      const n = parseNumber(p.index);
      if (n >= 0) index = Math.trunc(n);
    } catch { /* Native preset capture treats an unparsable optional index as absent. */ }
    for (const id of targets(selection, p, false)) {
      const node = document.nodes[id];
      if (!node || node.kind === "page") continue;
      const paint = paints(node, stroke).find((paint, i) => paint.type === "image" && (index === undefined || i === index));
      if (paint?.type === "image") { filters = paint.filters; break; }
    }
  }
  if (!filters) throw new Error("Pass filters or select a layer with an image paint");
  const preset = Object.freeze({ name, filters });
  const presets = [...saved], index = saved.findIndex(entry => entry.name === name);
  if (index >= 0) presets[index] = preset;
  else {
    if (saved.length >= 500) throw new Error("A file keeps at most 500 presets");
    presets.push(preset);
  }
  return { document: Object.freeze({ ...document, imagePresets: Object.freeze(presets) }), result: preset };
}

export interface CropTarget {readonly id:NodeId; readonly index:number}

export function topImageFill(node:LayerNode) {
  const fills = rectanglePaints(node);
  for (let i=fills.length-1; i>=0; i--) if (fills[i].type==="image" && fills[i].visible) return i;
  return undefined;
}

/** A native command operates on the layer's own fill. Region handles follow the open picker separately. */
export function startImageCrop(document:Document, selection:readonly NodeId[], p:Params) {
  const ids = targets(selection,p,true);
  if (ids.length !== 1) throw new Error("Select one layer to crop its image");
  const id=ids[0], node=document.nodes[id];
  if (!node || node.kind === "page") throw new Error("The layer has no image fill to crop");
  const index=p.index == null ? topImageFill(node) : parseIndex(p.index);
  if (index===undefined) throw new Error("The layer has no image fill to crop");
  const fills=rectanglePaints(node), paint=fills[index];
  if (!paint || paint.type!=="image") throw new Error("The selected fill is not an image");
  const target:CropTarget=Object.freeze({id,index});
  if (paint.scale_mode==="crop") return {document,target};
  const resource=document.images?.[paint.image];
  if (!resource) throw new Error("The image data is missing");
  const crop=placementCrop(paint,resource.width,resource.height,node.width,node.height);
  const next=[...fills]; next[index]=Object.freeze({...paint,scale_mode:"crop",crop:Object.freeze(crop)});
  const draft=new HierarchyDraft(document);
  draft.set(withRectanglePaints(node,next));
  return {document:draft.finish(),target};
}
