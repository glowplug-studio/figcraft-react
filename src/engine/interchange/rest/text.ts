import { newTextData, wireTextData, type ParaList, type StyleRun, type TextData } from "../../text-data";
import { withLook } from "../../text-properties";
import { editParagraphLists, normaliseRuns, paragraphSpan, scalarToUtf16 } from "../../text-ranges";
import { defaultTextStyle, textItalic, textWeight, type TextStyle } from "../../text-style";
import { restPaints, type ImportImages } from "./paint";
import { children,clamp,clipped,entries,finite,numeric,object,restColour,string,type ImportWarnings,type JsonObject } from "./values";

type Look=NonNullable<TextStyle["decorationLook"]>;
const styles=["Thin","Extra Light","Light","Regular","Medium","Semi Bold","Bold","Extra Bold","Black"];
const cases=new Map<string,TextStyle["case"]>([["ORIGINAL","original"],["UPPER","upper"],["LOWER","lower"],["TITLE","title"],["SMALL_CAPS","smallCaps"],["SMALL_CAPS_FORCED","smallCaps"]]);
function length(value:unknown):Look["offset"]|undefined {
  const {unit,value:n}=object(value);
  if (unit==="AUTO") return {unit:"auto"};
  if ((unit==="PERCENT" || unit==="PIXELS") && finite(n) && Math.abs(n)<=10000) return {unit:unit==="PERCENT" ? "percent" : "pixels",value:n};
}
function typeStyle(s:JsonObject,base:TextStyle,images:ImportImages,warnings:ImportWarnings):TextStyle {
  let t={...base};
  const family=string(s.fontFamily), name=string(s.fontStyle);
  if (family?.trim()) t.fontFamily=clipped(family);
  if (name?.trim()) t.fontStyle=clipped(name);
  else if (Object.hasOwn(s,"fontWeight") || Object.hasOwn(s,"italic")) {
    const weight=numeric(s.fontWeight) ?? textWeight(base), italic=typeof s.italic==="boolean" ? s.italic : textItalic(base);
    const style=styles[clamp(Math.floor((weight-50)/100),0,8)];
    t.fontStyle=italic ? style==="Regular" ? "Italic" : style+" Italic" : style;
  }
  if (s.fontVariations!==null && typeof s.fontVariations==="object" && !Array.isArray(s.fontVariations)) {
    t.variations=Object.fromEntries(entries(s.fontVariations).slice(0,64).flatMap(([tag,value])=>/^[\x00-\x7f]{4}$/.test(tag) && finite(value) ? [[tag,clamp(value,-1e5,1e5)]] : []));
  }
  if (finite(s.fontSize) && s.fontSize>0) t.fontSize=clamp(s.fontSize,.5,10000);
  const px=numeric(s.lineHeightPx), pct=numeric(s.lineHeightPercentFontSize);
  if (s.lineHeightUnit==="INTRINSIC_%") t.lineHeight={unit:"auto"};
  else if (s.lineHeightUnit!=="PIXELS" && pct!==undefined) t.lineHeight={unit:"percent",value:clamp(pct,0,1e6)};
  else if (s.lineHeightUnit!=="FONT_SIZE_%" && px!==undefined) t.lineHeight={unit:"pixels",value:clamp(px,0,1e6)};
  if (finite(s.letterSpacing)) t.letterSpacing=s.letterSpacing===0 ? {unit:"percent",value:0} : {unit:"pixels",value:clamp(s.letterSpacing,-1e4,1e4)};
  t.case=cases.get(string(s.textCase) ?? "") ?? t.case;
  if (s.textDecoration==="NONE" || s.textDecoration==="UNDERLINE" || s.textDecoration==="STRIKETHROUGH") t.decoration=s.textDecoration.toLowerCase() as TextStyle["decoration"];
  const ds=s.textDecorationStyle, thickness=length(s.textDecorationThickness), offset=length(s.textDecorationOffset);
  t=withLook(t,{...(ds==="SOLID" || ds==="DOTTED" || ds==="WAVY" ? {style:ds.toLowerCase() as Look["style"]} : {}),
    ...(thickness && {thickness}),...(offset && {offset}),...(typeof s.textDecorationSkipInk==="boolean" && {skipInk:s.textDecorationSkipInk}),
    ...(Object.hasOwn(s,"textDecorationColor") && {color:restColour(object(object(s.textDecorationColor).value).color)})});
  if (Array.isArray(s.fills)) t.fills=restPaints(s.fills,images,warnings);
  const h=object(s.hyperlink);
  if ((typeof h.type!=="string" || h.type==="URL") && typeof h.url==="string") t.link=h.url || undefined;
  return t;
}
const clean=(s:TextStyle)=>s.decoration!=="underline" && s.decorationLook?.skipInk ? withLook(s,{skipInk:false}) : s;
export function textFields(n:JsonObject,images:ImportImages,warnings:ImportWarnings) {
  const raw=string(n.characters) ?? "";
  const chars=raw.length<=1048576 ? raw : raw.slice(0,scalarToUtf16(raw,1048576));
  if (chars.length<raw.length) warnings.add("very long text was cut to 1,048,576 characters");
  const s=object(n.style), base=typeStyle(s,defaultTextStyle,images,warnings),style=clean(base);
  const ids=children(n.characterStyleOverrides), table=object(n.styleOverrideTable),cache=new Map<number,TextStyle>(),runs:StyleRun[]=[];
  const hasTable=Object.keys(table).length>0;
  let count=0,offset=0,start=0,last=0;
  function close(end:number) {
    if (!last || !hasTable) return;
    const key=String(last);
    if (!Object.hasOwn(table,key)) {warnings.add("text style overrides refer to missing table entries");return;}
    let override=cache.get(last);
    if (!override) {override=clean(typeStyle(object(table[key]),base,images,warnings));cache.set(last,override);}
    runs.push({start,end,style:override});
  }
  for (const ch of chars) {
    const rawId=ids[offset],id=typeof rawId==="number" && Number.isInteger(rawId) && rawId>0 && rawId<2**64 ? rawId : 0;
    if (id!==last) {close(count);start=count;last=id;}
    offset+=ch.length;count++;
  }
  close(count);
  const ending=s.textTruncation==="ENDING", maxLines=ending && finite(s.maxLines) && s.maxLines>=1 ? Math.trunc(Math.min(s.maxLines,10000)) : 0;
  let autoResize:TextData["autoResize"]=s.textAutoResize==="HEIGHT" ? "height" : s.textAutoResize==="WIDTH_AND_HEIGHT" ? "widthAndHeight" : s.textAutoResize==="TRUNCATE" ? "truncate" : "none";
  if (ending && (autoResize==="none" || !maxLines)) autoResize="truncate";
  const lines=chars.split("\n").length, types=children(n.lineTypes),dirs=children(n.lineDirections),indents=children(n.lineIndentations),starts=children(n.listStartOffsets);
  const paragraphs:ParaList[]=Array.from({length:Math.min(lines,Math.max(types.length,dirs.length))},(_,i)=>({
    list:types[i]==="ORDERED" ? "numbered" : types[i]==="UNORDERED" ? "bulleted" : "none",
    direction:dirs[i]==="LTR" ? "ltr" : dirs[i]==="RTL" ? "rtl" : "auto",indent:Math.trunc(clamp(numeric(indents[i]) ?? 0,0,255)),
    startOffset:Math.trunc(clamp(numeric(starts[i]) ?? 0,0,4294967295))}));
  const features=Object.fromEntries(entries(s.openTypeFlags).slice(0,64).flatMap(([k,v])=>/^[\x20-\x7e]{4}$/.test(k) ? [[k.toLowerCase(),v===true || finite(v) && v!==0]] : []));
  const data:TextData={...newTextData(chars),style,runs:normaliseRuns(runs,style,count),maxLines,autoResize,paragraphs,features,
    alignH:s.textAlignHorizontal==="JUSTIFIED" ? "justified" : s.textAlignHorizontal==="CENTER" ? "center" : s.textAlignHorizontal==="RIGHT" ? "right" : "left",
    alignV:s.textAlignVertical==="CENTER" ? "middle" : s.textAlignVertical==="BOTTOM" ? "bottom" : "top",
    paragraphSpacing:clamp(numeric(s.paragraphSpacing) ?? 0,0,1e6),paragraphIndent:clamp(numeric(s.paragraphIndent) ?? 0,0,1e6),
    listSpacing:clamp(numeric(s.listSpacing) ?? 0,0,10000),hangingList:s.hangingList===true,hangingPunctuation:s.hangingPunctuation===true,
    leadingTrim:s.leadingTrim==="CAP_HEIGHT" ? "capHeight" : "none"};
  return wireTextData(paragraphs.length ? editParagraphLists(data,paragraphSpan(data,0,count),p=>p) : data);
}
