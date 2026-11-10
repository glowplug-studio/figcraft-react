import {rectanglePaints,type TextNode} from "../../document";
import {wireTextData,type TextData} from "../../text-data";
import {sameTextStyle} from "../../text-ranges";
import type {TextStyle} from "../../text-style";
import {textFingerprint} from "./text";
import type {PenpotPaintWriter} from "./write-appearance";
import {numberText,sourceValue,type Fields} from "./write-geometry";

const weights:readonly [string,number][]=[
  ["extra light",200],["ultra light",200],["extra bold",800],["ultra bold",800],["semi bold",600],["demi bold",600],
  ["extralight",200],["extrabold",800],["semibold",600],["thin",100],["light",300],["medium",500],["bold",700],["black",900],["heavy",900],
];
function fontId(node:TextNode,family:string) {
  for (const key of ["penpot.googleFontRefs","penpot.customFontRefs"]) {
    const saved=node.sourceMetadata?.[key];
    if (!saved) continue;
    try {
      const refs=JSON.parse(saved);
      const ref=Array.isArray(refs) && refs.find(r=>r?.family===family);
      if (typeof ref?.id==="string") return ref.id as string;
    } catch { /* Malformed optional metadata falls back to the family name. */ }
  }
  if (family==="Source Sans Pro") return "sourcesanspro";
  return "gfont-"+family.replace(/[A-Z]/g,c=>c.toLowerCase()).replace(/[^a-z0-9]/gu,"-");
}

// Last stored run wins for Penpot export. A successor table skips previously assigned scalars
// even when an older native file contains many completely overlapping runs.
function stylesAt(text:TextData,length:number) {
  if (!text.runs.length) return ()=>text.style;
  const style=new Uint32Array(length+1),next=new Uint32Array(length+1);
  for (let i=0;i<=length;i++) next[i]=i;
  function free(i:number) {
    while (i!==next[i]) {next[i]=next[next[i]];i=next[i];}
    return i;
  }
  for (let r=text.runs.length-1;r>=0;r--) {
    const {start,end}=text.runs[r];
    for (let i=free(Math.min(start,length));i<Math.min(end,length);i=next[i]) {
      style[i]=r+1;
      next[i]=free(i+1);
    }
  }
  return (i:number)=>style[i] ? text.runs[style[i]-1].style : text.style;
}

export async function writeText(node:TextNode,paints:PenpotPaintWriter,fields:Fields) {
  const t=node.text,layerFills=rectanglePaints(node);
  fields.growType=t.autoResize==="widthAndHeight" ? "auto-width" : t.autoResize==="height" ? "auto-height" : "fixed";
  if (node.sourceMetadata?.["penpot.fp.text"] && node.sourceMetadata["penpot.fp.text"]===textFingerprint(wireTextData(t),layerFills)) {
    const content=sourceValue(node,"content");
    if (content!==undefined) {
      fields.content=content;
      const positions=sourceValue(node,"positionData");
      if (positions!==undefined) fields.positionData=positions;
      return;
    }
  }

  const align=t.alignH==="justified" ? "justify" : t.alignH,cache=new Map<TextStyle,Fields>();
  async function attrs(s:TextStyle) {
    const saved=cache.get(s);
    if (saved) return saved;
    const face=s.fontStyle.toLowerCase().replace(/[-_]/g," ");
    const weight=weights.find(([name])=>face.includes(name))?.[1] ?? 400,italic=/italic|oblique/.test(face);
    const line=s.lineHeight,spacing=s.letterSpacing;
    const props={fontFamily:s.fontFamily,fontId:fontId(node,s.fontFamily),fontVariantId:weight===400 ? (italic ? "italic" : "regular") : weight+(italic ? "italic" : ""),
      fontSize:numberText(s.fontSize),fontWeight:String(weight),fontStyle:italic ? "italic" : "normal",
      lineHeight:numberText(line.unit==="percent" ? line.value/100 : line.unit==="pixels" && s.fontSize>0 ? line.value/s.fontSize : 1.2),
      letterSpacing:numberText(spacing.unit==="pixels" ? spacing.value : spacing.value*s.fontSize/100),
      textDecoration:s.decoration==="strikethrough" ? "line-through" : s.decoration,
      textTransform:s.case==="upper" ? "uppercase" : s.case==="lower" ? "lowercase" : s.case==="title" ? "capitalize" : "none",
      textAlign:align,fills:await paints.paints(s.fills ?? layerFills)};
    cache.set(s,props);
    return props;
  }
  const chars=Array.from(t.characters),at=stylesAt(t,chars.length),paragraphs:Fields[]=[];
  let start=0;
  while (start<=chars.length) {
    let end=chars.indexOf("\n",start);
    if (end<0) end=chars.length;
    const leaves:Fields[]=[];
    for (let i=start;i<end;) {
      const style=at(i);
      let j=i+1;
      while (j<end && sameTextStyle(style,at(j))) j++;
      leaves.push({...await attrs(style),text:chars.slice(i,j).join("")});
      i=j;
    }
    const para=await attrs(at(start<end ? start : Math.max(0,start-1)));
    if (!leaves.length) leaves.push({...para,text:""});
    paragraphs.push({...para,type:"paragraph",children:leaves});
    start=end+1;
  }
  const {fills,...root}=await attrs(t.style);
  fields.content={...root,type:"root",children:[{type:"paragraph-set",children:paragraphs}],
    ...(t.alignV!=="top" && {verticalAlign:t.alignV==="middle" ? "center" : "bottom"})};
}
