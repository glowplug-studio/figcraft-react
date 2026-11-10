import { styleName } from "../fig/text";
import { children, clamp, entries, numeric, object, string, type JsonObject } from "../rest/values";
import { sketchColour, type SketchNode } from "./geometry";
import type { SketchStyleContext } from "./style";

export interface SketchTextContext extends SketchStyleContext {
  font?: (postscript: string) => { family: string; style: string } | undefined;
}
const maxChars = 1 << 20;
const maxRuns = 10000;
function fontFromName(ps: string) {
  const dash = ps.indexOf("-"), prefix = dash < 0 ? ps : ps.slice(0,dash);
  const suffix = dash < 0 ? "" : ps.slice(dash+1);
  const words = (s:string) => s.replace(/(\p{Ll})(\p{Lu})/gu,"$1 $2").replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu,"$1 $2");
  let family;
  if (!prefix) family = "Helvetica";
  else if ([".SFNSText",".SFUIText","SanFranciscoText",".SFProText"].includes(prefix)) family = "SF Pro Text";
  else if ([".SFNSDisplay",".SFUIDisplay","SanFranciscoDisplay",".SFProDisplay"].includes(prefix)) family = "SF Pro Display";
  else if (/^PingFang(SC|TC|HK)$/.test(prefix)) family = "PingFang "+prefix.slice(8);
  else if (/^SF\p{Lu}/u.test(prefix)) family = "SF "+words(prefix.slice(2));
  else family = words(prefix.replace(/^\.+/,""));
  return { family, style:suffix ? styleName(suffix) : "Regular" };
}
function fontOf(a: JsonObject) { return object(object(a.MSAttributedStringFontAttribute).attributes); }
function variations(input: unknown) {
  const axes: Record<string,number> = Object.create(null);
  for (const [key,raw] of entries(input).slice(0,64)) {
    const axis = Number(key), val = numeric(raw);
    if (!/^\+?\d+$/.test(key) || axis > 0xffffffff || val === undefined) continue;
    const tag = String.fromCharCode(axis>>>24,(axis>>>16)&255,(axis>>>8)&255,axis&255);
    if (/^[!-~]{4}$/.test(tag)) axes[tag] = clamp(val,-1e5,1e5);
  }
  return axes;
}
export function sketchTypeStyle(cx: SketchTextContext, a: JsonObject): SketchNode {
  const font = fontOf(a), ps = string(font.name) ?? "", size = numeric(font.size) ?? 0;
  const name = (ps && cx.font?.(ps)) || fontFromName(ps);
  if (!ps) cx.warn("text without a font uses Helvetica");
  const paragraph = object(a.paragraphStyle);
  const line = [paragraph.maximumLineHeight,paragraph.minimumLineHeight].map(numeric).find(n => n !== undefined && n > 0);
  const raw = object(a.MSAttributedStringColorAttribute), id = string(raw.swatchID);
  const mark = (v:unknown) => Number.isInteger(v) && v !== 0;
  return { fontFamily:name.family, fontStyle:name.style, fontSize:Math.min(size>0 ? size : 12,1e4), fontVariations:variations(font.variation),
    ...(line ? {lineHeightPx:Math.min(line,1e4),lineHeightUnit:"PIXELS"} : {lineHeightUnit:"INTRINSIC_%"}),
    letterSpacing:clamp(numeric(a.kerning) ?? 0,-1e4,1e4),
    textDecoration:mark(a.underlineStyle) ? "UNDERLINE" : mark(a.strikethroughStyle) ? "STRIKETHROUGH" : "NONE",
    textCase:a.MSAttributedStringTextTransformAttribute === 1 ? "UPPER" : a.MSAttributedStringTextTransformAttribute === 2 ? "LOWER" : "ORIGINAL",
    fills:[{ type:"SOLID", color:sketchColour(raw) ?? {r:0,g:0,b:0,a:1},
      ...(id !== undefined && cx.swatches.has(id) && {boundVariables:{color:{type:"VARIABLE_ALIAS",id}}}) }] };
}
export function sketchBaselineShift(layer: JsonObject) {
  const run = object(children(object(layer.attributedString).attributes)[0]), a = object(run.attributes), p = object(a.paragraphStyle);
  const size = numeric(fontOf(a).size) ?? 0, line = numeric(Object.hasOwn(p,"maximumLineHeight") ? p.maximumLineHeight : p.minimumLineHeight) ?? 0;
  if (size <= 0 || line <= 0) return 0;
  const delta = clamp(line-size*1.2,-1e4,1e4)/2;
  return layer.lineSpacingBehaviour === 0 ? delta : layer.lineSpacingBehaviour === 1 ? -delta : 0;
}
export function sketchText(cx: SketchTextContext, layer: JsonObject, node: SketchNode) {
  const attributed = object(layer.attributedString), t = object(object(layer.style).textStyle);
  const rawText = string(attributed.string) ?? "";
  let text = rawText;
  if (text.length > maxChars) {
    let count=0, end=0;
    for (const ch of rawText) { if (count++ === maxChars) break; end+=ch.length; }
    text=rawText.slice(0,end);
  }
  const runs = children(attributed.attributes);
  if (runs.length>maxRuns) cx.warn("text with more than 10000 styled runs keeps the first ones");
  const styles = runs.slice(0,maxRuns).flatMap(value => {
    const r = object(value), start = numeric(r.location), length = numeric(r.length);
    if (start === undefined || length === undefined || !Number.isInteger(start) || !Number.isInteger(length) ||
        start<0 || length<0 || !Object.hasOwn(r,"attributes")) return [];
    return [{ start:Math.min(start,text.length), end:Math.min(start+length,text.length), style:sketchTypeStyle(cx,object(r.attributes)) }];
  });
  const base = styles[0]?.style ?? sketchTypeStyle(cx,object(t.encodedAttributes));
  const paragraph = object(object(object(runs[0]).attributes ?? t.encodedAttributes).paragraphStyle);
  const behaviour = layer.textBehaviour;
  const resize = Number.isInteger(behaviour) ? behaviour===1 ? "HEIGHT" : behaviour===2 ? "NONE" : "WIDTH_AND_HEIGHT"
    : !Object.hasOwn(layer,"horizontalSizing") || layer.horizontalSizing===1 ? "WIDTH_AND_HEIGHT" : layer.verticalSizing===1 ? "HEIGHT" : "NONE";
  const style: SketchNode = { ...base, textAutoResize:resize,
    textAlignHorizontal:["LEFT","RIGHT","CENTER","JUSTIFIED"][Number(paragraph.alignment)] ?? "LEFT",
    textAlignVertical:["TOP","CENTER","BOTTOM"][Number(t.verticalAlignment)] ?? "TOP" };
  delete style.fills;
  const spacing = numeric(paragraph.paragraphSpacing);
  if (spacing !== undefined && spacing>0) style.paragraphSpacing=Math.min(spacing,1e4);
  Object.assign(node,{ characters:text, style, fills:base.fills });
  const canonical = JSON.stringify(base), table: Record<number,SketchNode> = {};
  let id=0, work=0, ids:number[] | undefined;
  for (const r of styles) {
    if (r.style === base || JSON.stringify(r.style) === canonical) continue;
    work+=r.end-r.start;
    if (work>16*maxChars) { cx.warn("text whose styled runs overlap a great deal keeps the first runs' styles"); break; }
    ids ??= Array<number>(text.length).fill(0);
    table[++id]=r.style;
    ids.fill(id,r.start,r.end);
  }
  if (ids) Object.assign(node,{characterStyleOverrides:ids, styleOverrideTable:table});
}
