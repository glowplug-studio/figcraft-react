import { isLosslessNumber, LosslessNumber } from "lossless-json";
import { appearanceValue, wirePaints } from "./native-values";
import { parseColour } from "./colour-css";
import type { Colour } from "./colour";
import { readPaints, type Paint } from "./solid-paint";

export type TextCase = "original" | "upper" | "lower" | "title" | "smallCaps";
type Spacing = Readonly<{unit:"pixels" | "percent"; value:number}>;
type Length = Readonly<{unit:"auto"}> | Spacing;
interface DecorationLook {
  readonly style: "solid" | "dotted" | "wavy";
  readonly thickness: Length;
  readonly offset: Length;
  readonly skipInk: boolean;
  readonly color?: Colour;
}
export interface TextStyle {
  readonly fontFamily: string;
  readonly fontStyle: string;
  readonly fontSize: number;
  readonly lineHeight: Length;
  readonly letterSpacing: Spacing;
  readonly decoration: "none" | "underline" | "strikethrough";
  readonly decorationLook?: DecorationLook;
  readonly case: TextCase;
  readonly fills?: readonly Paint[];
  readonly link?: string;
  readonly variations: Readonly<Record<string, number>>;
  readonly styleId?: string;
}
const auto = Object.freeze({unit:"auto"} as const);
const zeroSpacing = Object.freeze({unit:"percent", value:0} as const);
const noAxes: Readonly<Record<string,number>> = Object.freeze(Object.create(null));
export const defaultTextStyle: TextStyle = Object.freeze({
  fontFamily:"Inter", fontStyle:"Regular", fontSize:12, lineHeight:auto, letterSpacing:zeroSpacing,
  decoration:"none", case:"original", variations:noAxes,
});

function invalid(field: string): never { throw new Error("Invalid native text " + field); }
export function textRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isLosslessNumber(value)) return invalid(field);
  return value as Record<string,unknown>;
}
export function textString(value: unknown, field: string) {
  if (typeof value !== "string" || /[\uD800-\uDFFF]/u.test(value)) return invalid(field);
  return value;
}
export function textNumber(value: unknown, field: string) {
  const n = isLosslessNumber(value) ? Number(value.value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : invalid(field);
}
export function textBool(value: unknown, field: string) {
  return typeof value === "boolean" ? value : invalid(field);
}
export function textEnum<T extends string>(value: unknown, values: readonly T[], field: string): T {
  return values.includes(value as T) ? value as T : invalid(field);
}
function spacing(value: unknown): Spacing {
  const v = textRecord(value,"spacing");
  return Object.freeze({unit:textEnum(v.unit,["pixels","percent"],"spacing unit"),value:textNumber(v.value,"spacing value")});
}
function length(value: unknown): Length {
  const v = textRecord(value,"length");
  return v.unit === "auto" ? auto : spacing(v);
}
function decorationLook(value: unknown): DecorationLook {
  const v = textRecord(value,"decoration look");
  const color = v.color == null ? undefined : parseColour(appearanceValue(v.color)) ?? invalid("decoration colour");
  return Object.freeze({
    style: v.style === undefined ? "solid" : textEnum(v.style,["solid","dotted","wavy"],"decoration style"),
    thickness: v.thickness === undefined ? auto : length(v.thickness), offset: v.offset === undefined ? auto : length(v.offset),
    skipInk: v.skip_ink === undefined ? false : textBool(v.skip_ink,"skip ink"), ...(color && {color}),
  });
}

export function readTextStyle(value: unknown): TextStyle {
  const v = textRecord(value,"style");
  const axes = v.variations === undefined ? noAxes : Object.freeze(Object.fromEntries(
    Object.entries(textRecord(v.variations,"variation axes")).sort(([a],[b])=>a<b?-1:a>b?1:0)
      .map(([k,n])=>[textString(k,"axis tag"),textNumber(n,"axis value")])));
  return Object.freeze({
    fontFamily:v.font_family === undefined ? "Inter" : textString(v.font_family,"font family"),
    fontStyle:v.font_style === undefined ? "Regular" : textString(v.font_style,"font style"),
    fontSize:v.font_size === undefined ? 12 : textNumber(v.font_size,"font size"),
    lineHeight:v.line_height === undefined ? auto : length(v.line_height),
    letterSpacing:v.letter_spacing === undefined ? zeroSpacing : spacing(v.letter_spacing),
    decoration:v.decoration === undefined ? "none" : textEnum(v.decoration,["none","underline","strikethrough"],"decoration"),
    ...(v.decoration_look != null && {decorationLook:decorationLook(v.decoration_look)}),
    case:v.case === undefined ? "original" : textEnum(v.case,["original","upper","lower","title","smallCaps"],"case"),
    ...(v.fills != null && {fills:readPaints(appearanceValue(v.fills))}), ...(v.link != null && {link:textString(v.link,"link")}),
    variations:axes, ...(v.style_id != null && {styleId:textString(v.style_id,"style id")}),
  });
}

// Preserve the native IEEE sign when saving a text field used by its layout key.
export function wireTextFloat(value: number) {
  return Object.is(value,-0) ? new LosslessNumber("-0.0") : value;
}

function wireLength(length: Length) {
  return length.unit !== "auto" && Object.is(length.value,-0)
    ? {...length,value:wireTextFloat(length.value)} : length;
}

export function wireTextStyle(s: TextStyle) {
  const d = s.decorationLook;
  return {font_family:s.fontFamily,font_style:s.fontStyle,font_size:wireTextFloat(s.fontSize),line_height:wireLength(s.lineHeight),
    letter_spacing:wireLength(s.letterSpacing),decoration:s.decoration,...(d && {decoration_look:{style:d.style,
      thickness:d.thickness,offset:d.offset,skip_ink:d.skipInk,color:d.color ?? null}}),
    case:s.case,fills:s.fills ? wirePaints(s.fills) : null,link:s.link ?? null,
    ...(Object.keys(s.variations).length > 0 && {variations:Object.fromEntries(Object.entries(s.variations).map(([k,v])=>[k,wireTextFloat(v)]))}),...(s.styleId !== undefined && {style_id:s.styleId})};
}

const namedWeights: readonly (readonly [string,number])[] = [
  ["thin",100],["hairline",100],["extralight",200],["ultralight",200],["light",300],["medium",500],["semibold",600],
  ["demibold",600],["extrabold",800],["ultrabold",800],["black",900],["bold",700],["heavy",900],
];
export function textWeight(s: TextStyle) {
  const weight = s.variations.wght;
  if (Number.isFinite(weight)) return Math.max(1,Math.min(1000,Math.round(weight)));
  return styleWeight(s.fontStyle);
}
export function styleWeight(fontStyle: string) {
  const name = fontStyle.toLowerCase().replace(/[ -]/g,"");
  const number = Number(/^\d+/.exec(name)?.[0]);
  if (number >= 1 && number <= 1000) return number;
  return namedWeights.find(([label])=>name.includes(label))?.[1] ?? 400;
}
export function textItalic(s: TextStyle) {
  return s.fontStyle.toLowerCase().includes("italic") || s.variations.ital >= .5 || (s.variations.slnt ?? 0) !== 0;
}
export function setFontStyle(s: TextStyle, name: string): TextStyle {
  const {wght, ital, slnt, ...others} = s.variations;
  return Object.freeze({...s,fontStyle:name,variations:Object.freeze(others)});
}
export const textSize = (s: TextStyle) => Number.isFinite(s.fontSize) ? Math.max(0.5,Math.min(5000,s.fontSize)) : 12;
export function lineHeightPx(s: TextStyle, naturalRatio: number, size=s.fontSize) {
  const h = s.lineHeight;
  return h.unit === "auto" ? size*naturalRatio : h.unit === "pixels" ? Math.max(0,h.value) : size*Math.max(0,h.value)/100;
}
export function letterSpacingPx(s: TextStyle, size = s.fontSize) {
  return s.letterSpacing.unit === "pixels" ? s.letterSpacing.value : size*s.letterSpacing.value/100;
}
