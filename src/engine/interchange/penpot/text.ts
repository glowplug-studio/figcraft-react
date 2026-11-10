import { colour } from "../../colour";
import { readPaint, solidPaint, type Paint } from "../../solid-paint";
import { compareScalarKeys } from "../../text-breaks";
import { newTextData, type StyleRun, type TextData, wireTextData } from "../../text-data";
import { sameTextStyle } from "../../text-ranges";
import { defaultTextStyle, type TextStyle } from "../../text-style";
import { children, object, string, type JsonObject } from "../rest/values";
import { gradient } from "./appearance";
import { clipped, fingerprint, hex, numberField as num, records } from "./values";

const fields = ["fontFamily","fontId","fontVariantId","fontSize","fontWeight","fontStyle","textDecoration","textTransform","letterSpacing","lineHeight","fills","textAlign"];
const weights: Record<string,string> = {"100":"Thin",thin:"Thin","200":"Extra Light",extralight:"Extra Light","extra-light":"Extra Light",
  "300":"Light",light:"Light","500":"Medium",medium:"Medium","600":"Semi Bold",semibold:"Semi Bold","semi-bold":"Semi Bold","700":"Bold",bold:"Bold",
  "800":"Extra Bold",extrabold:"Extra Bold","extra-bold":"Extra Bold","900":"Black",black:"Black"};

export function penpotStyle(raw: JsonObject, base: TextStyle = defaultTextStyle): TextStyle {
  const family = string(raw.fontFamily) ?? string(raw.fontId);
  const variant = (string(raw.fontVariantId) ?? "").toLowerCase();
  const weight = string(raw.fontWeight) ?? (Number.isInteger(raw.fontWeight) && Number(raw.fontWeight) >= 0 ? String(raw.fontWeight) : /^\d+/.exec(variant)?.[0]);
  let face = weight === undefined ? base.fontStyle : weights[weight.toLowerCase()] ?? "Regular";
  if ((/italic|oblique/.test(variant) || /^(italic|oblique)$/i.test(string(raw.fontStyle) ?? "")) && !face.includes("Italic")) face += " Italic";
  const size = num(raw,"fontSize",base.fontSize), line = num(raw,"lineHeight",1.2);
  const paints: Paint[] = [];
  for (const fill of records(raw.fills)) {
    const g = gradient(object(fill.fillColorGradient)), c = hex(fill.fillColor);
    if (!g && !c) continue;
    const paint = g ? readPaint({type:"gradient",...g}) : solidPaint(c!);
    paints.push({...paint, opacity:Math.fround(paint.opacity * Math.fround(num(fill,"fillOpacity",1,0,1)))});
    if (paints.length === 32) break;
  }
  return {...base,fontStyle:face,fontSize:size>0 && size<=1000 ? size : base.fontSize,
    ...(family!==undefined && {fontFamily:family==="sourcesanspro" ? "Source Sans Pro" : clipped(family,200)}),
    ...(raw.textDecoration==="underline" && {decoration:"underline"}), ...(["line-through","strikethrough"].includes(String(raw.textDecoration)) && {decoration:"strikethrough"}),
    case:raw.textTransform==="uppercase" ? "upper" : raw.textTransform==="lowercase" ? "lower" : raw.textTransform==="capitalize" ? "title" : base.case,
    ...(Object.hasOwn(raw,"letterSpacing") && {letterSpacing:{unit:"pixels",value:num(raw,"letterSpacing",0)}}),
    ...(Object.hasOwn(raw,"lineHeight") && line>0 && {lineHeight:{unit:"percent",value:line*100}}), ...(paints.length && {fills:paints.reverse()})};
}

function ownStyle(value: JsonObject, inherited: JsonObject, legacy = true) {
  const style: Record<string,unknown> = {...inherited};
  for (const key of fields) if (Object.hasOwn(value,key)) style[key]=value[key];
  if (legacy && !Object.hasOwn(value,"fills") && ("fillColor" in value || "fillColorGradient" in value))
    style.fills=[Object.fromEntries(["fillColor","fillOpacity","fillColorGradient"].filter(k=>k in value).map(k=>[k,value[k]]))];
  return style;
}

function fragments(raw: JsonObject) {
  const result: {piece:string;props:JsonObject}[] = [], root=object(raw.content);
  const initial = Object.hasOwn(raw,"content") ? ownStyle(root,ownStyle(raw,{},false),false) : {};
  function walk(v: JsonObject, inherited: JsonObject, depth: number) {
    if (depth >= 64 || result.length >= 10000) return;
    const props=ownStyle(v,inherited);
    if (typeof v.text==="string") result.push({piece:clipped(v.text,100000),props});
    let previous;
    for (const next of records(v.children)) {
      if (v.type==="paragraph-set" && previous) result.push({piece:"\n",props:previous});
      walk(next,props,depth+1);
      if (v.type==="paragraph-set") previous=ownStyle(next,props);
    }
  }
  if (Object.hasOwn(raw,"content")) walk(root,initial,0);
  return {result,initial};
}

export function textLayer(raw: JsonObject, layerFills: readonly unknown[]) {
  const {result,initial}=fragments(raw), base=penpotStyle(initial), runs:StyleRun[]=[];
  let characters="", at=0;
  for (const {piece,props} of result) {
    const length=Array.from(piece).length;
    if (!length || at+length>100000) continue;
    const style=penpotStyle(props,base);
    if (!sameTextStyle(style,base)) runs.push({start:at,end:at+length,style});
    at+=length; characters+=piece;
  }
  const alignment=(result[0]?.props ?? raw).textAlign;
  let text: TextData={...newTextData(characters), style:base,runs,alignH:alignment==="justify" ? "justified" : alignment==="center" || alignment==="right" ? alignment : "left",
    autoResize:raw.growType==="fixed" ? "none" : raw.growType==="auto-height" ? "height" : "widthAndHeight"};
  let end=0;
  const uncovered=runs.some(r=>{if(r.start>end) return true;end=r.end;return false;}) || end<at;
  const paints=runs.map(r=>r.style.fills ?? base.fills);
  if (uncovered) paints.push(base.fills);
  let fills = layerFills;
  if (paints[0] && paints.every(p=>JSON.stringify(p)===JSON.stringify(paints[0]))) {
    fills=paints[0];
    const unpainted=({fills:_,...style}:TextStyle)=>style;
    text={...text,style:unpainted(text.style),runs:runs.map(r=>({...r,style:unpainted(r.style)}))};
  }
  if (!fills.length) fills=[solidPaint(colour(0,0,0))];
  const wire=wireTextData(text);
  const nativeFills=fills.map(p=>{const {colorAlpha,...rest}=object(p);return colorAlpha===1 ? rest : p;});
  return {wire,fills,hash:fingerprint({text:wire,fills:nativeFills},new Set(["start","end"]))};
}

interface FontRef {family:string;id:string;variants:{italic:boolean;weight:number}[]}
const names:Record<string,number>={thin:100,extralight:200,ultralight:200,light:300,regular:400,normal:400,medium:500,semibold:600,demibold:600,bold:700,extrabold:800,ultrabold:800,black:900,heavy:900};
export function fontRefs(source: JsonObject, prefix: string) {
  const result=new Map<string,FontRef>();
  function visit(v:JsonObject, depth:number, parent:{family:string;id:string;weight:number;italic:boolean}) {
    if (depth>32 || result.size>=16) return;
    const ctx={...parent,family:string(v.fontFamily) ?? parent.family,id:string(v.fontId) ?? parent.id};
    const w=String(v.fontWeight ?? "").toLowerCase(), weight=/^\d+$/.test(w) ? Number(w) : names[w];
    if (weight>=1 && weight<=1000) ctx.weight=weight;
    if (typeof v.fontStyle==="string") ctx.italic=/^(italic|oblique)$/i.test(v.fontStyle);
    if (typeof v.fontVariantId==="string") {
      const digits=Number(/^\d+/.exec(v.fontVariantId)?.[0]);
      if (!Object.hasOwn(v,"fontWeight") && digits>=1 && digits<=1000) ctx.weight=digits;
      ctx.italic=/italic|oblique/i.test(v.fontVariantId);
    }
    if (ctx.id.startsWith(prefix) && /^[a-z0-9-]{1,128}$/.test(ctx.id) && ctx.family && new TextEncoder().encode(ctx.family).length<=128) {
      const key=ctx.id+"\0"+ctx.family;
      const ref=result.get(key) ?? {family:ctx.family,id:ctx.id,variants:[]};
      if (ref.variants.length<8 && !ref.variants.some(f=>f.weight===ctx.weight && f.italic===ctx.italic)) ref.variants.push({italic:ctx.italic,weight:ctx.weight});
      result.set(key,ref);
    }
    if (Object.hasOwn(v,"content")) visit(object(v.content),depth+1,ctx);
    for (const child of children(v.children).slice(0,1024)) visit(object(child),depth+1,ctx);
  }
  visit(source,0,{family:"",id:"",weight:400,italic:false});
  return [...result.entries()].sort(([a],[b])=>compareScalarKeys(a,b)).map(([,r])=>({...r,variants:r.variants.sort((a,b)=>a.weight-b.weight || Number(a.italic)-Number(b.italic))}));
}
