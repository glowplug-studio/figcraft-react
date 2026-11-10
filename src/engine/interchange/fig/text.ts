import {items,num,obj,paints} from "./fields";
import type {KiwiObject} from "./kiwi";
import {figLetterSpacing} from "../rest/text";

const weights=["Thin","Extra Light","Ultra Light","Light","Regular","Medium","Semi Bold","Demi Bold","Bold","Extra Bold","Ultra Bold","Black"];
const compact=(s:string)=>s.replace(/[ _-]/g,"").toLowerCase();
function styleName(s:string) {
  const text=compact(s), italic=text.endsWith("italic"), base=italic ? text.slice(0,-6) : text;
  const weight=weights.find(w=>compact(w)===base) ?? (!base && italic ? "Regular" : undefined);
  return weight ? italic ? weight==="Regular" ? "Italic" : weight+" Italic" : weight : s;
}
function textStyle(n:KiwiObject, parentSize?:number) {
  const font=obj(n.fontName), spacing=obj(n.letterSpacing), lh=obj(n.lineHeight);
  const style:Record<PropertyKey,unknown>={
    fontFamily:font.family,fontStyle:typeof font.style==="string" ? styleName(font.style) : undefined,fontSize:n.fontSize,
    textCase:n.textCase,textDecoration:n.textDecoration,textDecorationSkipInk:n.textDecorationSkipInk,leadingTrim:n.leadingTrim,
    paragraphSpacing:n.paragraphSpacing,paragraphIndent:n.paragraphIndent,listSpacing:n.listSpacing,hangingList:n.hangingList,hangingPunctuation:n.hangingPunctuation
  };
  if (n.letterSpacing) {
    const amount=num(spacing.value) ?? 0, size=num(n.fontSize) ?? parentSize ?? 12;
    style.letterSpacing=spacing.units==="PIXELS" ? amount : (spacing.units==="PERCENT" ? amount/100 : amount)*size;
    if (spacing.units==="PERCENT") style[figLetterSpacing]=amount;
  }
  if (n.lineHeight) {
    const value=num(lh.value) ?? 100;
    if (lh.units==="PIXELS") {style.lineHeightUnit="PIXELS";style.lineHeightPx=value;}
    else if (lh.units==="PERCENT" && Math.abs(value-100)<1e-6) style.lineHeightUnit="INTRINSIC_%";
    else {style.lineHeightUnit="FONT_SIZE_%";style.lineHeightPercentFontSize=lh.units==="PERCENT" ? value : value*100;}
  }
  const url=obj(n.hyperlink).url;
  if (typeof url==="string") style.hyperlink={type:"URL",url};
  return style;
}
export function textLayer(n:KiwiObject,warn:(s:string)=>void,linked?:KiwiObject) {
  const data=obj(n.textData), style=textStyle(linked ? {...n,...linked} : n), out:Record<string,unknown>={characters:data.characters ?? "",style};
  for (const key of ["textAlignHorizontal","textAlignVertical","textAutoResize","textTruncation","maxLines"]) style[key]=n[key];
  const ids=items(data.characterStyleIDs).map(num).filter((i):i is number=>i!==undefined);
  if (ids.some(v=>v!==0)) {
    const table:Record<string,unknown>=Object.create(null);
    for (const value of items(data.styleOverrideTable)) {
      const e=obj(value), id=num(e.styleID);
      if (id===undefined) continue;
      const s=textStyle(e,num(n.fontSize));
      if (e.fillPaints) s.fills=paints(e.fillPaints,warn);
      table[String(Math.max(0,Math.trunc(id)))]=s;
    }
    out.characterStyleOverrides=ids;out.styleOverrideTable=table;
  }
  const lines=items(data.lines).map(obj);
  const types=lines.map(l=>l.lineType==="ORDERED_LIST" ? "ORDERED" : l.lineType==="UNORDERED_LIST" ? "UNORDERED" : "NONE");
  const dirs=lines.map(l=>l.sourceDirectionality==="LTR" || l.sourceDirectionality==="RTL" ? l.sourceDirectionality : "AUTO");
  const offsets=lines.map(l=>num(l.listStartOffset) ?? 0);
  if (types.some(t=>t!=="NONE")) out.lineTypes=types;
  if (dirs.some(d=>d!=="AUTO")) out.lineDirections=dirs;
  if (offsets.some(n=>n>0)) out.listStartOffsets=offsets;
  return out;
}

/** Convert saved UTF-16 offsets to scalar indices. Invalid or stale baselines cannot constrain wrapping. */
export function lineStarts(n:KiwiObject,characters:string) {
  const baselines=items(obj(n.derivedTextData).baselines);
  if (!baselines.length) return;
  const starts:number[]=[];
  let unit=0,scalar=0,prior=-1;
  for (const baseline of baselines) {
    const next=num(obj(baseline).firstCharacter);
    if (next===undefined || !Number.isInteger(next) || next>=characters.length || (prior<0 ? next!==0 : next<=prior)) return;
    while (unit<next) {unit+=characters.codePointAt(unit)!>0xffff ? 2 : 1;scalar++;}
    if (unit!==next) return;
    if (scalar && characters[next-1]!=="\n" && characters[next-1]!=="\u2028") starts.push(scalar);
    prior=next;
  }
  return starts;
}
