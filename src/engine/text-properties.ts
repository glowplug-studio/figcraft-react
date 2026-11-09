import { clearTextHeightLimit } from "./child-layout-properties";
import type { TextNode } from "./document";
import { parseColour } from "./colour-css";
import { parseNumber, parseString, propertyEnum } from "./parameters";
import { readPaints } from "./solid-paint";
import { validOpenTypeTag } from "./text-case";
import { normaliseTextLines, type TextData } from "./text-data";
import { familyStyles } from "./text-node-layout";
import { editParagraphLists, paragraphSpan, replaceTextRange, restyleRange, scalarCount } from "./text-ranges";
import { setFontStyle, styleWeight, textBool, textItalic, textRecord, textWeight, type TextStyle } from "./text-style";

const weightNames = ["Thin", "Extra Light", "Light", "Regular", "Medium", "Semi Bold", "Bold", "Extra Bold", "Black"];
const styleKeys = new Set(("fontFamily fontStyle fontWeight fontSize lineHeight letterSpacing textDecoration textCase hyperlink " +
  "textFills fontVariations variationSettings textDecorationStyle textDecorationThickness textDecorationOffset textDecorationSkipInk " +
  "textDecorationColor").split(" "));
export function weightName(weight:number) {
  return weightNames[Math.max(0, Math.min(8, Math.floor((weight + 50) / 100) - 1))];
}
export function styledName(name:string, italic:boolean) {
  return italic ? name === "Regular" ? "Italic" : name + " Italic" : name;
}
const textKeys = new Set([...styleKeys, ...("characters text textAlign textAlignHorizontal textAlignVertical textAutoResize paragraphSpacing " +
  "paragraphIndent listStyle indentation textDirection direction listSpacing hangingPunctuation hangingList leadingTrim wrapStyle textWrap " +
  "maxLines features textFeatures fontFeatures openTypeFeatures").split(" ")]);
export const isTextKey = (key: string) => textKeys.has(key);

export function textCommandProperties(command: "text.style" | "text.set", params: Record<string,unknown>) {
  const props = Object.entries(params).filter(([key]) => key !== "id" && key !== "ids");
  for (const [key] of props) {
    const allowed = command === "text.set" ? key === "characters" || key === "text" : styleKeys.has(key) || key === "start" || key === "end";
    if (!allowed) throw new Error(command + " does not take " + key);
  }
  if (command === "text.set") {
    const characters = parseString(params.characters) ?? parseString(params.text);
    if (characters === undefined) throw new Error("text.set requires characters");
    return {characters};
  }
  return Object.fromEntries(props);
}

const clamp = (v: number, low: number, high: number) => Math.max(low, Math.min(high, v));
function optionalNumber(value: unknown, fallback: number) {
  try { return parseNumber(value); } catch { return fallback; }
}
function stringValue(value: unknown, key: string) {
  const string = typeof value === "boolean" ? undefined : parseString(value);
  if (string === undefined) throw new Error(key + " must be a string");
  return string;
}

export function textSpacing(value: unknown): TextStyle["letterSpacing"] {
  if (typeof value === "object" && value !== null) {
    const part = textRecord(value, "spacing");
    if ((part.unit !== "pixels" && part.unit !== "percent") || typeof part.value !== "number" || !Number.isFinite(part.value))
      throw new Error("Expected a pixel or percentage length");
    return Object.freeze({unit:part.unit, value:part.value});
  }
  if (typeof value === "string" && value.trim().endsWith("%")) {
    const raw = value.trim().replace(/%+$/, "").trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)) throw new Error("Invalid percentage");
    return Object.freeze({unit:"percent", value:parseNumber(raw)});
  }
  return Object.freeze({unit:"pixels", value:parseNumber(value)});
}
const auto = Object.freeze({unit:"auto"} as const);
export function textLength(value: unknown): TextStyle["lineHeight"] {
  if (typeof value === "string" && value.toLowerCase() === "auto" ||
    value && typeof value === "object" && "unit" in value && value.unit === "auto" && (!("value" in value) || value.value == null)) return auto;
  return textSpacing(value);
}
function tagValues<T>(value: unknown, parse: (value: unknown, tag: string) => T) {
  const pairs = Object.entries(textRecord(value, "OpenType settings")).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const result: Record<string,T> = Object.create(null);
  for (const [tag, raw] of pairs) {
    if (!validOpenTypeTag(tag)) throw new Error("Invalid OpenType tag " + tag);
    if (raw !== null) result[tag] = parse(raw, tag);
  }
  return Object.freeze(result);
}
export function featureValues(value:unknown) {
  return tagValues(value, (raw, tag) => typeof raw === "boolean" ? raw : parseNumber(raw, tag) !== 0);
}
export function variationValues(value:unknown) {
  return tagValues(value === null ? {} : value, (raw, tag) => {
    const n = parseNumber(raw, tag);
    if (Math.abs(n) > 1e6) throw new Error("Axis value exceeds native range");
    return n;
  });
}
type Look = NonNullable<TextStyle["decorationLook"]>;
const defaultLook: Look = Object.freeze({style:"solid", thickness:auto, offset:auto, skipInk:false});
function withLook(style: TextStyle, patch: Partial<Look>): TextStyle {
  const look = {...defaultLook, ...style.decorationLook, ...patch};
  const isDefault = look.style === "solid" && look.thickness.unit === "auto" && look.offset.unit === "auto" &&
    !look.skipInk && look.color === undefined;
  return {...style, decorationLook:isDefault ? undefined : Object.freeze(look)};
}

function styleEdit(key: string, value: unknown): (style: TextStyle) => TextStyle {
  switch (key) {
    case "fontFamily": {
      const family = stringValue(value, key), styles = familyStyles(family);
      return s => {
        if (!styles.length || styles.includes(s.fontStyle)) return {...s, fontFamily:family};
        const distance = (name: string) => Math.abs(styleWeight(name) - textWeight(s));
        return {...s, fontFamily:family, fontStyle:styles.reduce((best, name) => distance(name) < distance(best) ? name : best)};
      };
    }
    case "fontStyle": {
      const name = stringValue(value, key);
      return s => setFontStyle(s, name);
    }
    case "fontWeight": {
      const weight = Math.trunc(clamp(parseNumber(value, key), 1, 1000));
      const name = weightName(weight);
      return s => setFontStyle(s, styledName(name, textItalic(s)));
    }
    case "textDecorationStyle": {
      const style = propertyEnum(value, ["solid", "dotted", "wavy"] as const);
      return s => withLook(s, {style});
    }
    case "textDecorationThickness": case "textDecorationOffset": {
      const measure = textLength(value);
      if (measure.unit !== "auto" && Math.abs(measure.value) > 10000) throw new Error(key + " exceeds 10000");
      return s => withLook(s, key === "textDecorationOffset" ? {offset:measure} : {thickness:measure});
    }
    case "textDecorationSkipInk": {
      const skipInk = textBool(value, key);
      return s => withLook(s, {skipInk});
    }
    case "textDecorationColor": {
      if (value === null || typeof value === "string" && value.toLowerCase() === "auto") return s => withLook(s, {color:undefined});
      const color = parseColour(value);
      if (!color) throw new Error("Expected a decoration colour");
      return s => withLook(s, {color});
    }
  }
  const patch = (): Partial<TextStyle> => {
    switch (key) {
      case "fontSize": return {fontSize:clamp(parseNumber(value, key), 1, 5000)};
      case "lineHeight": return {lineHeight:textLength(value)};
      case "letterSpacing": return {letterSpacing:textSpacing(value)};
      case "textDecoration": return {decoration:propertyEnum(value, ["none", "underline", "strikethrough"] as const)};
      case "textCase": return {case:propertyEnum(value, ["original", "upper", "lower", "title", "smallCaps"] as const)};
      case "hyperlink": return {link:typeof value === "boolean" ? undefined : parseString(value)};
      case "textFills": return {fills:value === null ? undefined : readPaints(value, true)};
      case "fontVariations": case "variationSettings":
        return {variations:variationValues(value)};
      default: throw new Error("Unsupported text property " + key);
    }
  };
  const change = patch();
  return s => ({...s, ...change});
}

function applyProperty(t: TextData, key: string, value: unknown, start: number, end: number): TextData {
  switch (key) {
    case "text": case "characters": return replaceTextRange(t, 0, scalarCount(t.characters), normaliseTextLines(stringValue(value, key)));
    case "textAlign": case "textAlignHorizontal": return {...t, alignH:propertyEnum(value, ["left", "center", "right", "justified"] as const)};
    case "textAlignVertical": return {...t, alignV:propertyEnum(value, ["top", "middle", "bottom"] as const)};
    case "textAutoResize": return {...t, autoResize:propertyEnum(value, ["widthAndHeight", "height", "none", "truncate"] as const)};
    case "wrapStyle": case "textWrap": return {...t, wrapStyle:propertyEnum(value, ["auto", "balance", "pretty"] as const)};
    case "leadingTrim": return {...t, leadingTrim:propertyEnum(value, ["none", "capHeight"] as const)};
    case "paragraphSpacing": case "paragraphIndent": return {...t, [key]:Math.max(0, optionalNumber(value, 0))};
    case "listSpacing": return {...t, listSpacing:clamp(optionalNumber(value, 0), 0, 10000)};
    case "maxLines": return {...t, maxLines:Math.trunc(clamp(optionalNumber(value, 0), 0, 10000))};
    case "hangingPunctuation": case "hangingList": return {...t, [key]:textBool(value, key)};
    case "listStyle": {
      const list = propertyEnum(value, ["none", "bulleted", "numbered"] as const);
      return editParagraphLists(t, paragraphSpan(t,start,end), p => ({...p, list}));
    }
    case "indentation": {
      const indent = Math.trunc(clamp(parseNumber(value, key), 0, 8));
      return editParagraphLists(t, paragraphSpan(t,start,end), p => ({...p, indent}));
    }
    case "direction": case "textDirection": {
      const direction = propertyEnum(value, ["auto", "ltr", "rtl"] as const);
      return editParagraphLists(t, paragraphSpan(t,start,end), p => ({...p, direction}));
    }
    case "features": case "textFeatures": case "fontFeatures": case "openTypeFeatures":
      return {...t, features:featureValues(value)};
    default: {
      const apply = styleEdit(key, value);
      return restyleRange(t, start, end, style => Object.freeze(apply(style)));
    }
  }
}

export function setTextProperties(node: TextNode, props: Record<string,unknown>, keys: readonly string[]): TextNode {
  let text = node.text, overridden = node.charactersOverridden;
  for (const key of keys) {
    const count = scalarCount(text.characters);
    const start = Math.trunc(clamp(optionalNumber(props.start, 0), 0, count));
    const end = Math.trunc(clamp(optionalNumber(props.end, count), 0, count));
    text = Object.freeze(applyProperty(text, key, props[key], start, end));
    if (key === "maxLines" && text.maxLines > 0) node = clearTextHeightLimit(node);
    if (key === "text" || key === "characters") overridden = true;
  }
  return Object.freeze({...node, text, ...(overridden ? {charactersOverridden:true as const} : {})});
}
