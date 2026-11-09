import { isLosslessNumber } from "lossless-json";
import { colour, type Colour } from "./colour";
import { parseColour } from "./colour-css";
import type { Document } from "./document";
import { readEffects, wireEffect, type Effect } from "./effects";
import { appearanceValue, fail, number, wirePaints } from "./native-values";
import { inspectedId, parseString } from "./parameters";
import { readPaints, type Paint } from "./solid-paint";
import type { ListStyle } from "./text-data";
import { readTextStyle, textBool, textEnum, textRecord, textString, wireTextStyle, type TextStyle } from "./text-style";

export interface LayoutGrid {
  readonly kind: "grid" | "columns" | "rows";
  readonly size: number;
  readonly count: number;
  readonly gutter: number;
  readonly offset: number;
  readonly align: "stretch" | "min" | "center" | "max";
  readonly color: Colour;
  readonly visible: boolean;
}

const slots = ["fill", "stroke", "effect", "grid", "text"] as const;
export type StyleRefs = Readonly<Record<typeof slots[number], string | null>>;
export interface LayerStyles {
  readonly styles?: StyleRefs;
  readonly grids?: readonly LayoutGrid[];
}

interface ParagraphStyle {
  readonly paragraph_spacing?: number;
  readonly paragraph_indent?: number;
  readonly list?: ListStyle;
  readonly features?: Readonly<Record<string, boolean>>;
}

interface StyleMetadata {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly bound?: Readonly<Record<string, string>>;
}
export type SharedStyle = StyleMetadata & (
  | { readonly type: "paint"; readonly paints: readonly Paint[] }
  | { readonly type: "effect"; readonly effects: readonly Effect[] }
  | { readonly type: "grid"; readonly grids: readonly LayoutGrid[] }
  | { readonly type: "text"; readonly style: TextStyle; readonly paragraph?: ParagraphStyle }
);

function checkFields(record: Record<string, unknown>, supported: readonly string[], field: string) {
  for (const key of Object.keys(record)) {
    if (!supported.includes(key)) fail(field + "/" + key + " is not supported yet");
  }
}

function readMap<T>(value: unknown, field: string, read: (v: unknown, key: string) => T) {
  if (value === undefined) return undefined;
  const entries = Object.entries(textRecord(value, field));
  return entries.length ? Object.freeze(Object.fromEntries(entries.map(([k, v]) => [textString(k, field), read(v, k)]))) as Readonly<Record<string, T>> : undefined;
}

function readGrids(value: unknown): readonly LayoutGrid[] {
  if (!Array.isArray(value)) fail("grids must be an array");
  return Object.freeze(value.map(raw => {
    const v = textRecord(raw, "layout grid");
    checkFields(v, ["kind", "size", "count", "gutter", "offset", "align", "color", "visible"], "layout grid");
    const count = v.count === undefined ? 5 : number(v.count, "grid count");
    if (!Number.isInteger(count) || count < 0 || count > 0xffffffff) fail("grid count must be an unsigned 32-bit integer");
    const color = v.color === undefined ? colour(1, 0, 0, 0.1) : parseColour(appearanceValue(v.color));
    if (!color) fail("invalid layout grid colour");
    return Object.freeze({
      kind: v.kind === undefined ? "grid" : textEnum(v.kind, ["grid", "columns", "rows"], "grid kind"),
      size: v.size === undefined ? 10 : number(v.size, "grid size"), count,
      gutter: v.gutter === undefined ? 20 : number(v.gutter, "grid gutter"),
      offset: v.offset === undefined ? 0 : number(v.offset, "grid offset"),
      align: v.align === undefined ? "stretch" : textEnum(v.align, ["stretch", "min", "center", "max"], "grid alignment"),
      color, visible: v.visible === undefined ? true : textBool(v.visible, "grid visibility"),
    });
  }));
}

export function readLayerStyles(node: Record<string, unknown>): LayerStyles {
  const grids = node.grids === undefined ? undefined : readGrids(node.grids);
  let styles: StyleRefs | undefined;
  if (node.styles !== undefined) {
    const refs = textRecord(node.styles, "layer style links");
    checkFields(refs, slots, "layer style links");
    if (slots.some(slot => refs[slot] != null)) {
      styles = Object.freeze(Object.fromEntries(slots.map(slot => [slot,
        refs[slot] == null ? null : textString(refs[slot], slot + " style link")])) as Record<typeof slots[number], string | null>);
    }
  }
  return { ...(grids?.length && { grids }), ...(styles && { styles }) };
}

function readParagraph(value: unknown): ParagraphStyle | undefined {
  if (value === undefined) return undefined;
  const v = textRecord(value, "style paragraph");
  checkFields(v, ["paragraph_spacing", "paragraph_indent", "list", "features"], "style paragraph");
  const spacing = v.paragraph_spacing === undefined ? 0 : number(v.paragraph_spacing, "paragraph spacing");
  const indent = v.paragraph_indent === undefined ? 0 : number(v.paragraph_indent, "paragraph indent");
  const list = v.list === undefined ? "none" : textEnum(v.list, ["none", "bulleted", "numbered"], "paragraph list");
  const features = readMap(v.features, "paragraph features", textBool);
  if (!spacing && !indent && list === "none" && !features) return undefined;
  return Object.freeze({ ...(spacing !== 0 && { paragraph_spacing: spacing }), ...(indent !== 0 && { paragraph_indent: indent }),
    ...(list !== "none" && { list }), ...(features && { features }) });
}

export function readSharedStyles(value: unknown): readonly SharedStyle[] {
  if (!Array.isArray(value)) fail("styles must be an array");
  return Object.freeze(value.map(raw => {
    const v = textRecord(raw, "shared style");
    const bound = readMap(v.bound, "style bindings", textString);
    const metadata = { id: textString(v.id, "style ID"), name: textString(v.name, "style name"),
      description: v.description === undefined ? "" : textString(v.description, "style description"), ...(bound && { bound }) };
    const type = textEnum(v.type, ["paint", "text", "effect", "grid"], "style type");
    const valueFields = type === "text" ? ["style", "paragraph"] : [type === "paint" ? "paints" : type === "effect" ? "effects" : "grids"];
    checkFields(v, ["id", "name", "description", "type", "bound", ...valueFields], "shared style");
    switch (type) {
      case "paint": return Object.freeze({ ...metadata, type, paints: readPaints(appearanceValue(v.paints)) });
      case "effect": return Object.freeze({ ...metadata, type, effects: readEffects(appearanceValue(v.effects), "archive") });
      case "grid": return Object.freeze({ ...metadata, type, grids: readGrids(v.grids) });
      case "text": {
        const paragraph = readParagraph(v.paragraph);
        return Object.freeze({ ...metadata, type, style: readTextStyle(v.style), ...(paragraph && { paragraph }) });
      }
    }
  }));
}

export function wireSharedStyle(style: SharedStyle) {
  switch (style.type) {
    case "paint": return { ...style, paints: wirePaints(style.paints).map(({colorAlpha, ...paint}) =>
      colorAlpha === 1 ? paint : {...paint, colorAlpha}) };
    case "text": return { ...style, style: wireTextStyle(style.style) };
    case "effect": return { ...style, effects: style.effects.map(wireEffect) };
    case "grid": return style;
  }
}

// Public inspection uses ordinary JS numbers, or a decimal string for large native IDs.
function inspectValue(value: unknown): unknown {
  if (isLosslessNumber(value)) return /^\d+$/.test(value.value) ? inspectedId(value.value) : Number(value.value);
  if (Array.isArray(value)) return value.map(inspectValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, inspectValue(v)]));
  return value;
}

export function listStyles(doc: Document, filter?: unknown): Record<string, unknown>[] {
  const type = parseString(filter);
  return (doc.styles ?? []).filter(style => type === undefined || style.type === type)
    .map(style => inspectValue(wireSharedStyle(style)) as Record<string, unknown>);
}
