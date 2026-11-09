import { toCssHex } from "./colour";
import { pixelRound } from "./geometry";
import { appearanceValue } from "./native-values";
import type { TextData } from "./text-data";
import { scalarToUtf16, textSpans } from "./text-ranges";
import { wireTextStyle, type TextStyle } from "./text-style";

/** Native trim_num rounds to hundredths and formats large values without exponential notation. */
export function trimNumber(value:number) {
  return Math.abs(value) >= 9e18 ? value.toLocaleString("en-US",{useGrouping:false,maximumFractionDigits:0})
    : String(pixelRound(value*100)/100);
}

function spacingLabel(length: TextStyle["lineHeight"]) {
  if (length.unit === "auto") return "Auto";
  const {value} = length;
  const n = trimNumber(value);
  return length.unit === "percent" ? n+"%" : n;
}

export function inspectText(text: TextData, outline: boolean, wants: (key: string)=>boolean, put: (key: string,value:unknown)=>void) {
  const {style, paragraphs} = text;
  if (wants("characters")) {
    const limit = outline ? scalarToUtf16(text.characters,120) : text.characters.length;
    put("characters",limit < text.characters.length ? text.characters.slice(0,limit)+"..." : text.characters);
  }
  put("fontFamily",style.fontFamily); put("fontStyle",style.fontStyle); put("fontSize",style.fontSize);
  if (Object.keys(style.variations).length) put("fontVariations",style.variations);
  if (wants("lineHeight")) put("lineHeight",spacingLabel(style.lineHeight));
  if (wants("letterSpacing")) put("letterSpacing",spacingLabel(style.letterSpacing));
  put("textAlign",text.alignH); put("textAutoResize",text.autoResize);
  if (text.maxLines>0) put("maxLines",text.maxLines);
  if (text.path) put("textPath",{d:text.path.d,start:text.path.start,...(text.path.flip && {flip:true})});
  if (style.decoration!=="none") put("textDecoration",style.decoration);
  const look=style.decorationLook;
  if (look) {
    put("textDecorationStyle",look.style);
    if (wants("textDecorationThickness")) put("textDecorationThickness",spacingLabel(look.thickness));
    if (wants("textDecorationOffset")) put("textDecorationOffset",spacingLabel(look.offset));
    put("textDecorationSkipInk",look.skipInk);
    if (wants("textDecorationColor")) put("textDecorationColor",look.color ? toCssHex(look.color).slice(0,7) : "auto");
  }
  if (paragraphs.length) {
    if (wants("lineTypes")) put("lineTypes",paragraphs.map(p=>p.list));
    if (wants("lineIndentations")) put("lineIndentations",paragraphs.map(p=>p.indent));
    if (wants("listStartOffsets") && paragraphs.some(p=>p.startOffset>0)) put("listStartOffsets",paragraphs.map(p=>p.startOffset));
    if (wants("textDirection") || wants("lineDirections")) {
      const first=paragraphs[0].direction;
      if (first!=="auto" && paragraphs.every(p=>p.direction===first)) put("textDirection",first);
      else if (paragraphs.some(p=>p.direction!=="auto")) put("lineDirections",paragraphs.map(p=>p.direction));
    }
  } else if (text.list!=="none") put("listStyle",text.list);
  if (text.listSpacing!==0) put("listSpacing",text.listSpacing);
  if (text.hangingPunctuation) put("hangingPunctuation",true);
  if (text.hangingList) put("hangingList",true);
  if (text.leadingTrim!=="none") put("leadingTrim",text.leadingTrim);
  if (text.wrapStyle!=="auto") put("wrapStyle",text.wrapStyle);
  if (text.runs.length && wants("styledRuns")) put("styledRuns",text.runs.map(r=>({start:r.start,end:r.end,style:appearanceValue(wireTextStyle(r.style))})));
  if (wants("textStyleRanges") && (style.styleId!==undefined || text.runs.some(r=>r.style.styleId!==undefined))) {
    const linked=textSpans(text).filter(r=>r.style.styleId!==undefined).map(r=>[r.start,r.end,r.style.styleId]);
    if (linked.length) put("textStyleRanges",linked);
  }
}
