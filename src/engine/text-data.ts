import { isLosslessNumber, LosslessNumber } from "lossless-json";
import { defaultTextStyle, readTextStyle, textBool, textEnum, textNumber, textRecord, textString, wireTextFloat, wireTextStyle, type TextStyle } from "./text-style";

export interface StyleRun { readonly start: number; readonly end: number; readonly style: TextStyle }
export type ListStyle = "none" | "bulleted" | "numbered";
export interface ParaList {
  readonly list: ListStyle; readonly indent: number; readonly startOffset: number; readonly direction: "auto" | "ltr" | "rtl";
}
export interface TextData {
  readonly characters: string;
  readonly style: TextStyle;
  readonly runs: readonly StyleRun[];
  readonly autoResize: "widthAndHeight" | "height" | "none" | "truncate";
  readonly alignH: "left" | "center" | "right" | "justified";
  readonly alignV: "top" | "middle" | "bottom";
  readonly paragraphSpacing: number; readonly paragraphIndent: number;
  readonly list: ListStyle; readonly paragraphs: readonly ParaList[]; readonly listSpacing: number;
  readonly hangingPunctuation: boolean; readonly hangingList: boolean; readonly leadingTrim: "none" | "capHeight";
  readonly maxLines: number; readonly wrapStyle: "auto" | "balance" | "pretty";
  readonly features: Readonly<Record<string,boolean>>;
  readonly path?: Readonly<{d:string; start:number; flip:boolean}>;
  readonly savedBreaks?: Readonly<{starts:readonly number[];width:number;forText:string}>;
}
const empty = Object.freeze([]);
const defaultFeatures: Readonly<Record<string,boolean>> = Object.freeze(Object.create(null));
export function newTextData(characters = ""): TextData {
  return Object.freeze({characters:textString(characters,"characters"),style:defaultTextStyle,runs:empty,
    autoResize:"widthAndHeight",alignH:"left",alignV:"top",paragraphSpacing:0,paragraphIndent:0,
    list:"none",paragraphs:empty,listSpacing:0,hangingPunctuation:false,hangingList:false,leadingTrim:"none",
    maxLines:0,wrapStyle:"auto",features:defaultFeatures});
}
function uint(value: unknown, field: string, maximum = 0xffffffff) {
  const n = textNumber(value,field);
  if (!Number.isInteger(n) || n < 0 || n > maximum) throw new Error("Invalid native text " + field);
  return n;
}
function array<T>(value: unknown, field: string, read: (v: unknown)=>T): readonly T[] {
  if (value === undefined) return empty;
  if (!Array.isArray(value)) throw new Error("Invalid native text " + field);
  return Object.freeze(value.map(read));
}
function list(v: unknown) {
  return textEnum(v,["none","bulleted","numbered"],"list");
}
function paragraph(value: unknown): ParaList {
  const p = textRecord(value,"paragraph");
  return Object.freeze({list:p.list===undefined?"none":list(p.list),indent:p.indent===undefined?0:uint(p.indent,"indent",255),
    startOffset:p.start_offset===undefined?0:uint(p.start_offset,"start offset"),
    direction:p.direction===undefined?"auto":textEnum(p.direction,["auto","ltr","rtl"],"direction")});
}
function textPath(value: unknown) {
  const p = textRecord(value,"path");
  return Object.freeze({d:p.d===undefined?"":textString(p.d,"path data"), start:p.start===undefined?0:textNumber(p.start,"path start"),
    flip:p.flip===undefined?false:textBool(p.flip,"path flip")});
}
function breaks(value: unknown) {
  const b = textRecord(value,"saved breaks"), v = b.for_text === undefined ? 0 : b.for_text;
  const hash = isLosslessNumber(v) ? v.value : typeof v === "number" && Number.isSafeInteger(v) ? String(v) : "";
  if (!/^(0|[1-9][0-9]{0,19})$/.test(hash) || BigInt(hash) > 0xffffffffffffffffn) throw new Error("Invalid native text layout key");
  return Object.freeze({starts:array(b.starts,"break starts",v=>uint(v,"break start")),width:b.width===undefined?0:textNumber(b.width,"break width"),forText:hash});
}

export function readTextData(value: unknown): TextData {
  const v = textRecord(value,"record");
  const number = (key: string) => v[key] === undefined ? 0 : textNumber(v[key],key);
  const flag = (key: string) => v[key] === undefined ? false : textBool(v[key],key);
  const features = v.features === undefined ? defaultFeatures : Object.freeze(Object.fromEntries(
    Object.entries(textRecord(v.features,"features")).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,b])=>[textString(k,"feature tag"),textBool(b,"feature")])));
  return Object.freeze({
    characters:v.characters === undefined ? "" : textString(v.characters,"characters"),
    style:v.style === undefined ? defaultTextStyle : readTextStyle(v.style),
    runs:array(v.runs,"runs",value=>{
      const r = textRecord(value,"run");
      return Object.freeze({start:uint(r.start,"run start"),end:uint(r.end,"run end"),style:readTextStyle(r.style)});
    }),
    autoResize:v.auto_resize===undefined?"widthAndHeight":textEnum(v.auto_resize,["widthAndHeight","height","none","truncate"],"resize"),
    alignH:v.align_h===undefined?"left":textEnum(v.align_h,["left","center","right","justified"],"horizontal alignment"),
    alignV:v.align_v===undefined?"top":textEnum(v.align_v,["top","middle","bottom"],"vertical alignment"),
    paragraphSpacing:number("paragraph_spacing"),paragraphIndent:number("paragraph_indent"),
    list:v.list===undefined?"none":list(v.list),paragraphs:array(v.paragraphs,"paragraphs",paragraph),listSpacing:number("list_spacing"),
    hangingPunctuation:flag("hanging_punctuation"),hangingList:flag("hanging_list"),
    leadingTrim:v.leading_trim===undefined?"none":textEnum(v.leading_trim,["none","capHeight"],"leading trim"),
    maxLines:v.max_lines===undefined?0:uint(v.max_lines,"max lines"),
    wrapStyle:v.wrap_style===undefined?"auto":textEnum(v.wrap_style,["auto","balance","pretty"],"wrap style"),
    features,...(v.path!=null && {path:textPath(v.path)}),...(v.saved_breaks!=null && {savedBreaks:breaks(v.saved_breaks)}),
  });
}
export function wireTextData(t: TextData) {
  return {characters:t.characters,style:wireTextStyle(t.style),
    ...(t.runs.length && {runs:t.runs.map(r=>({start:r.start,end:r.end,style:wireTextStyle(r.style)}))}),
    ...(t.autoResize!=="widthAndHeight" && {auto_resize:t.autoResize}),...(t.alignH!=="left" && {align_h:t.alignH}),
    ...(t.alignV!=="top" && {align_v:t.alignV}),...(t.paragraphSpacing && {paragraph_spacing:t.paragraphSpacing}),
    ...(t.paragraphIndent && {paragraph_indent:t.paragraphIndent}),...(t.list!=="none" && {list:t.list}),
    ...(t.paragraphs.length && {paragraphs:t.paragraphs.map(p=>({list:p.list,indent:p.indent,
      ...(p.startOffset && {start_offset:p.startOffset}),...(p.direction!=="auto" && {direction:p.direction})}))}),
    ...(t.listSpacing && {list_spacing:t.listSpacing}),...(t.hangingPunctuation && {hanging_punctuation:true}),
    ...(t.hangingList && {hanging_list:true}),...(t.leadingTrim!=="none" && {leading_trim:t.leadingTrim}),
    ...(t.maxLines && {max_lines:t.maxLines}),...(t.wrapStyle!=="auto" && {wrap_style:t.wrapStyle}),
    ...(Object.keys(t.features).length && {features:t.features}),
    ...(t.path && {path:{d:t.path.d,start:wireTextFloat(t.path.start),...(t.path.flip && {flip:true})}}),
    ...(t.savedBreaks && {saved_breaks:{starts:t.savedBreaks.starts,width:t.savedBreaks.width,for_text:new LosslessNumber(t.savedBreaks.forText)}})};
}
