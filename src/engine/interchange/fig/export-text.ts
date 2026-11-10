import {paragraphList,textSpans,textStyleKey} from "../../text-ranges";
import type {TextData} from "../../text-data";
import type {TextStyle} from "../../text-style";
import type {Paint} from "../../solid-paint";
import {styleName} from "./text";
import type {FigPaintWriter} from "./export-paint";
import type {KiwiObject} from "./kiwi";

function fields(s:TextStyle):KiwiObject {
  const family=s.fontFamily,regular=styleName(s.fontStyle),style=family==="Inter" || family.startsWith("Inter ") ? regular : regular.replace(/(Extra|Ultra|Semi|Demi) /g,"$1");
  const lh=s.lineHeight,ls=s.letterSpacing;
  return {fontName:{family,style,postscript:""},fontSize:s.fontSize,
    lineHeight:lh.unit==="auto" ? {value:100,units:"PERCENT"} : {value:lh.unit==="percent" ? lh.value/100 : lh.value,units:lh.unit==="percent" ? "RAW" : "PIXELS"},
    letterSpacing:{value:ls.value,units:ls.unit.toUpperCase()},textCase:s.case==="smallCaps" ? "SMALL_CAPS" : s.case.toUpperCase(),
    textDecoration:s.decoration.toUpperCase(),textDecorationSkipInk:!!s.decorationLook?.skipInk || s.decoration!=="underline",
    ...(s.link!==undefined && {hyperlink:{url:s.link}})};
}
export async function wireText(t:TextData,fills:readonly Paint[],paints:FigPaintWriter):Promise<KiwiObject> {
  const ids:number[]=[],table:TextStyle[]=[],indices=new Map<string,number>([[textStyleKey(t.style),0]]);
  const spans=textSpans(t).map(r=>{
    const key=textStyleKey(r.style);
    let id=indices.get(key);
    if (id===undefined) {id=table.push(r.style);indices.set(key,id);}
    return {end:r.end,id};
  });
  let scalar=0,span=0,characters="";
  for (const ch of t.characters) {
    if (scalar===1048576) {paints.warn("text longer than 1,048,576 characters was cut");break;}
    while (span<spans.length && scalar>=spans[span].end) span++;
    scalar++;
    if (ch==="\0") continue;
    characters+=ch;
    if (table.length) for (let j=0;j<ch.length;j++) ids.push(spans[span]?.id ?? 0);
  }
  const data:KiwiObject={characters};
  if (table.length) {
    const styles=[];
    for (const [i,s] of table.entries()) {
      const row:KiwiObject={styleID:i+1,...fields(s)};
      if (s.link===undefined && t.style.link!==undefined) row.hyperlink={url:""};
      const runPaints=s.fills ?? (t.style.fills ? fills : undefined);
      if (runPaints) row.fillPaints=await paints.list(runPaints);
      styles.push(row);
    }
    data.characterStyleIDs=ids;data.styleOverrideTable=styles;
  }
  let prior="",start=0,nested=false;
  const paragraphs=t.characters.split("\n");
  data.lines=paragraphs.map((_,i)=>{
    const p=paragraphList(t,i),listed=p.list!=="none",first=listed && prior!==p.list;
    if (first) start=p.startOffset;
    prior=p.list;nested ||= p.indent>0;
    return {lineType:p.list==="numbered" ? "ORDERED_LIST" : p.list==="bulleted" ? "UNORDERED_LIST" : "PLAIN",styleId:0,
      indentationLevel:Number(listed),sourceDirectionality:p.direction.toUpperCase(),listStartOffset:p.list==="numbered" ? start : 0,isFirstLineOfList:first};
  });
  if (nested) paints.warn("nested list levels were written as the first level");
  if ([t.style,...t.runs.map(r=>r.style)].some(s=>Object.keys(s.variations).length || s.decorationLook &&
    (s.decorationLook.style!=="solid" || s.decorationLook.thickness.unit!=="auto" || s.decorationLook.offset.unit!=="auto" || s.decorationLook.color)))
    paints.warn("text decoration looks and variable font settings were left out");
  if (t.path) paints.warn("text on a path was written as plain text");
  if (t.listSpacing || t.hangingPunctuation || t.hangingList || t.leadingTrim!=="none" || Object.keys(t.features).length)
    paints.warn("list spacing, hanging punctuation, leading trim and OpenType features were left out");
  return {...fields(t.style),textData:data,textAlignHorizontal:t.alignH.toUpperCase(),textAlignVertical:t.alignV==="middle" ? "CENTER" : t.alignV.toUpperCase(),
    textAutoResize:t.autoResize==="widthAndHeight" ? "WIDTH_AND_HEIGHT" : t.autoResize==="height" ? "HEIGHT" : "NONE",
    paragraphSpacing:t.paragraphSpacing,paragraphIndent:t.paragraphIndent,autoRename:false,fontVariantCommonLigatures:true,fontVariantContextualLigatures:true,fontVersion:"",
    textUserLayoutVersion:5,textExplicitLayoutVersion:1,textBidiVersion:1,textTracking:0,emojiImageSet:"APPLE",
    ...((t.autoResize==="truncate" || t.maxLines>0) && {textTruncation:"ENDING"}),...(t.maxLines>0 && {maxLines:t.maxLines})};
}
