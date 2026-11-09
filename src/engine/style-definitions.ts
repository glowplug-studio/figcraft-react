import type { DocumentNode } from "./document";
import { readEffects, type Effect } from "./effects";
import { parseNumber, propertyEnum } from "./parameters";
import { readGrids, readParagraph, type SharedStyle, type StyleSlot } from "./shared-styles";
import { readPaints } from "./solid-paint";
import { nodeFills, type ActiveStyleRange } from "./style-application";
import { featureValues, textLength, textSpacing } from "./text-properties";
import { commonParagraphList, textStyleAt } from "./text-ranges";
import { readTextStyle, textRecord, type TextStyle } from "./text-style";

type StripMetadata<T> = T extends SharedStyle ? Omit<T, "id"|"name"|"description"|"bound"> : never;
type Definition = StripMetadata<SharedStyle>;

function asDefinition(value: TextStyle): TextStyle {
  const {link, styleId, ...style} = value;
  return Object.freeze(style);
}

export function styleSlot(type: string): StyleSlot {
  switch (type.toLowerCase()) {
    case "paint": case "color": case "fill": return "fill";
    case "stroke": return "stroke";
    case "text": return "text";
    case "effect": return "effect";
    case "grid": return "grid";
    default: throw new Error("Unknown style type " + type);
  }
}

export function nodeDefinition(slot: StyleSlot, node: DocumentNode, live?: ActiveStyleRange): Definition | undefined {
  switch (slot) {
    case "fill": return {type:"paint", paints:nodeFills(node)};
    case "stroke": return {type:"paint", paints:node.strokes ?? Object.freeze([])};
    case "effect": return {type:"effect", effects:node.effects ?? Object.freeze([])};
    case "grid": return {type:"grid", grids:node.grids ?? Object.freeze([])};
    case "text": {
      if (node.kind !== "text") return undefined;
      const t = node.text;
      const paragraph = readParagraph({paragraph_spacing:t.paragraphSpacing, paragraph_indent:t.paragraphIndent, features:t.features,
        list:(live && commonParagraphList(t, live.start, live.end)?.list) ?? t.list});
      return {type:"text", style:asDefinition(live ? textStyleAt(t,live.start) : t.style), ...(paragraph && {paragraph})};
    }
  }
}

export function explicitDefinition(slot: StyleSlot, input: unknown): Definition {
  if (slot === "fill") return {type:"paint", paints:readPaints(input,true)};
  if (slot === "effect") return {type:"effect", effects:readEffects(input,"archive")};
  if (slot === "grid") return {type:"grid", grids:readGrids(input,true)};
  if (slot === "stroke") throw new Error("Use paint for an explicit stroke style value");
  const value = textRecord(input,"style definition");
  const typeFields: Record<string, unknown> = Object.create(null), paraFields: Record<string, unknown> = Object.create(null);
  for (const [key, raw] of Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0)) {
    const snake = key.replace(/[A-Z]/g, letter => "_" + letter.toLowerCase());
    if (snake === "paragraph_indent" || snake === "paragraph_spacing") paraFields[snake] = Math.max(0,Math.min(10000,parseNumber(raw)));
    else if (key === "listStyle" || key === "list") paraFields.list = propertyEnum(raw, ["none","bulleted","numbered"]);
    else if (["features","openTypeFeatures","fontFeatures","textFeatures"].includes(key)) paraFields.features = featureValues(raw);
    else if (snake === "line_height") typeFields[snake] = textLength(raw);
    else if (snake === "letter_spacing") typeFields[snake] = textSpacing(raw);
    else typeFields[snake] = raw;
  }
  const {fills, ...typography} = typeFields;
  const style = asDefinition({...readTextStyle(typography), ...(fills != null && {fills:readPaints(fills)})});
  const paragraph = readParagraph(paraFields);
  return {type:"text", style, ...(paragraph && {paragraph})};
}

export function styleBindingType(style: SharedStyle, key: string): "color" | "number" | "string" | undefined {
  if (style.type === "text") {
    if (key === "fontFamily" || key === "fontStyle") return "string";
    if (["fontSize","lineHeight","letterSpacing"].includes(key)) return "number";
    return;
  }
  const canonical = ["fill", "fills", "fills/0"].includes(key) ? "fills/0/color" : key;
  const match = /^(fills|effects|layoutGrids)\/(\d+)\/(.+)$/.exec(canonical);
  if (!match) return;
  const [,list,index,field] = match, i = Number(index);
  if (style.type === "grid" && list === "layoutGrids" && style.grids[i] && ["size","count","gutter","offset"].includes(field)) return "number";
  if (style.type === "paint" && list === "fills") {
    const paint = style.paints[i], stop = /^stops\/(\d+)\/color$/.exec(field);
    if (paint?.type === "solid" && field === "color" || paint?.type === "gradient" && stop && paint.stops[Number(stop[1])]) return "color";
  }
  if (style.type === "effect" && list === "effects") {
    return effectBindingType(style.effects[i],field);
  }
}

export function effectBindingType(effect:Effect|undefined,field:string) {
  switch (effect?.type) {
    case "dropShadow": case "innerShadow":
      if (field === "color") return "color";
      if (["radius","spread","offsetX","offsetY"].includes(field)) return "number";
      break;
    case "layerBlur": case "backgroundBlur": if (field === "radius" || field === "startRadius") return "number"; break;
    case "glass": if (["lightAngle","lightIntensity","refraction","depth","dispersion","radius","splay"].includes(field)) return "number";
  }
}
