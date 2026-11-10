import { bytesToHex } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { colour } from "../../colour";
import { type SharedStyle } from "../../shared-styles";
import { nativeFloat } from "../../text-breaks";
import { defaultTextStyle } from "../../text-style";
import { type Collection, type Variable, type Variables, type VariableType, type VariableValue } from "../../variables";
import { entries, object, string, type JsonObject } from "../rest/values";
import { PenpotArchive } from "./archive";
import { themedTokens } from "./themes";
import { penpotStyle } from "./text";
import { clipped, hex, sourceJson } from "./values";

type Warn = (message:string)=>void;
const utf8 = new TextEncoder();
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const numericKinds = new Set(["number","numeric","dimension","sizing","spacing","borderRadius","opacity","fontSizes","fontWeights","borderWidth","letterSpacing","rotation","lineHeights","paragraphSpacing"]);
const stringKinds = new Set(["string","fontFamily","fontFamilies","fontWeight","textCase","textDecoration"]);
const payload = (t:JsonObject) => Object.hasOwn(t,"value") ? t.value : t.$value;
export function tokenKind(t:JsonObject): VariableType | undefined {
  const k=string(t.type) ?? string(t.$type);
  if (k==="color" || k==="boolean") return k;
  if (k && numericKinds.has(k)) return "number";
  if (k && stringKinds.has(k)) return "string";
}
export function tokenAlias(t:JsonObject) {
  const path=string(payload(t))?.match(/^\{([^{}]+)\}$/)?.[1];
  return path && utf8.encode(path).length<=256 ? path : undefined;
}
function measurement(v:unknown,limit:number) {
  const raw=typeof v==="string" ? v.replace(/px$/,"").trim() : undefined;
  const n=typeof v==="number" ? v : raw && decimal.test(raw) ? Number(raw) : NaN;
  return Math.abs(n)<=limit ? n : undefined;
}
export function tokenColour(v:unknown) {
  if (typeof v!=="string") return;
  const raw=v.trim();
  if (raw.toLowerCase()==="transparent") return colour(0,0,0,0);
  const args=/^rgba?\(([\s\S]*)\)$/.exec(raw);
  if (!args) return hex(raw);
  const parts=args[1].split(/[, /]+/).filter(Boolean).map(p=>decimal.test(p.trim()) ? Number(p.trim()) : NaN);
  if (parts.length>=3 && parts.every(Number.isFinite)) return colour(parts[0]/255,parts[1]/255,parts[2]/255,parts[3] ?? 1);
}
export function scalarToken(t:JsonObject): VariableValue | undefined {
  const kind=tokenKind(t),v=payload(t);
  if (typeof v==="string" && v.startsWith("{") && v.endsWith("}")) return;
  switch (kind) {
    case "number": {const n=measurement(v,1e6);if (n!==undefined) return {type:kind,value:n};break;}
    case "color": {const c=tokenColour(v);if (c) return {type:kind,value:c};break;}
    case "string": if (typeof v==="string" && utf8.encode(v).length<=4096) return {type:kind,value:v};break;
    case "boolean": if (typeof v==="boolean") return {type:kind,value:v};break;
  }
}
export function flattenTokens(source:unknown) {
  const result: [string,JsonObject][]=[];
  function visit(v:JsonObject,path:string,depth:number) {
    if (depth>=16 || result.length>=4096) return;
    if (Object.hasOwn(v,"value") || Object.hasOwn(v,"$value")) {
      if (path) result.push([path,v]);
      return;
    }
    for (const [key,item] of entries(v)) {
      if (result.length>=4096) break;
      if (key.startsWith("$") || ["id","name","type"].includes(key)) continue;
      const name=path ? path+"."+key : key;
      if (utf8.encode(name).length<=256) visit(object(item),name,depth+1);
    }
  }
  visit(object(source),"",0);
  return result;
}
function validAlias(name:string,token:JsonObject,all:Map<string,JsonObject>,kind:VariableType) {
  let target=tokenAlias(token);
  const visited=new Set([name]);
  for (let depth=0;target && depth<32;depth++) {
    if (visited.has(target)) return false;
    visited.add(target);
    const t=all.get(target);
    if (!t || tokenKind(t)!==kind) return false;
    target=tokenAlias(t);
    if (!target) return scalarToken(t)?.type===kind;
  }
  return false;
}

function compound(token:JsonObject,meta:{id:string;name:string;description:string}):SharedStyle | undefined {
  const type=string(token.type) ?? string(token.$type),raw=payload(token),v=object(raw);
  const n=(v:unknown)=>measurement(typeof v==="string"?v.trim():v,1e5);
  if (type==="typography") {
    if (!Object.hasOwn(v,"fontSize") && !Object.hasOwn(v,"fontFamily")) return;
    const fields:Record<string,unknown>={};
    let base=defaultTextStyle;
    if (typeof v.fontFamily==="string") {
      if (v.fontFamily.includes("{") || utf8.encode(v.fontFamily).length>200) return;
      fields.fontFamily=v.fontFamily;
    }
    const size=n(v.fontSize);
    if (size!==undefined) {
      if (size<=0 || size>1000) return;
      fields.fontSize=size;
    }
    if (Object.hasOwn(v,"fontWeight")) {
      if (string(v.fontWeight)?.includes("{")) return;
      fields.fontWeight=string(v.fontWeight) ?? JSON.stringify(v.fontWeight);
    }
    if (Object.hasOwn(v,"letterSpacing")) {
      fields.letterSpacing=n(v.letterSpacing);
      if (fields.letterSpacing===undefined) return;
    }
    if (Object.hasOwn(v,"lineHeight")) {
      const height=n(v.lineHeight);
      if (height===undefined) return;
      if (height>0) {
        if (string(v.lineHeight)?.trim().endsWith("px")) base={...base,lineHeight:{unit:"pixels",value:height}};
        else if (height<=10) fields.lineHeight=height;
        else return;
      }
    }
    return {...meta,type:"text",style:penpotStyle(fields,base)};
  }
  if (type!=="boxShadow" && type!=="shadow") return;
  const effects=[];
  for (const item of (Array.isArray(raw)?raw.slice(0,32):[raw]).map(object)) {
    const c=tokenColour(item.color), x=n(item.x ?? item.offsetX), y=n(item.y ?? item.offsetY), radius=n(item.blur);
    const spread=Object.hasOwn(item,"spread") ? n(item.spread) : 0;
    if (!c || x===undefined || y===undefined || radius===undefined || radius<0 || spread===undefined) return;
    const type=["innerShadow","inner","inset"].includes(String(item.type)) ? "innerShadow" as const : "dropShadow" as const;
    effects.push({type,visible:true,color:c,offset:[x,y] as const,radius,spread,blend:"normal" as const,showBehind:false});
  }
  if (effects.length) return {...meta,type:"effect",effects};
}

export class PenpotTokens {
  readonly collections:Collection[]=[];
  readonly variables:Variable[]=[];
  readonly sources:Record<string,string>=Object.create(null);
  readonly modes:Record<string,string>=Object.create(null);
  async read(archive:PenpotArchive,base:string,file:string,styles:SharedStyle[],warn:Warn) {
    const path=base+"/tokens.json";
    if (!archive.has(path)) return;
    let value;
    try {value=await archive.json(path);} catch {archive.check();warn("Penpot tokens.json could not be read; tokens not imported");return;}
    const v=object(value),sets=entries(v.sets), flattened=sets.slice(0,256).map(([name,def])=>{
      const entry=object(def);
      return {name,hasTokens:Object.hasOwn(entry,"tokens"),tokens:flattenTokens(entry.tokens)};
    });
    let count=0,skipped=0;
    for (const set of flattened) for (const [name,t] of set.tokens) {
      if (!["typography","boxShadow","shadow"].includes(String(t.$type ?? t.type))) continue;
      const style=styles.length<8192 && compound(t,{id:"penpot:token-style:"+base+":"+set.name+":"+name,
        name:clipped("Penpot tokens/"+set.name+"/"+name,256),description:"Imported from a literal compound Penpot token; theme aliases remain source metadata"});
      if (style) {styles.push(style);count++;} else skipped++;
    }
    if (count) warn("Imported "+count+" literal Penpot typography/shadow tokens as reusable styles");
    if (skipped) warn(skipped+" compound tokens could not be converted safely; source JSON preserved when possible");
    const raw=sourceJson(value,archive.numbers);
    if (utf8.encode(raw).length<=256*1024) this.sources["penpot.tokens."+file]=raw;
    else warn("Penpot tokens library exceeds 256 KiB metadata retention budget; only supported native variables will be saved");
    if (!v.sets || typeof v.sets!=="object" || Array.isArray(v.sets)) {
      if (!themedTokens(v,base,this,warn)) warn("Unrecognized Penpot token sets format; original JSON retained when possible");
      return;
    }
    count=0;skipped=0;
    for (const set of flattened) {
      if (this.collections.length>=256) {warn("Penpot variable collections capped at 256 across the document");break;}
      if (!set.hasTokens) {skipped++;continue;}
      const id="penpot:tokens:"+base+":"+set.name,mode=id+":default";
      const eligible=set.tokens.slice(0,8192-this.variables.length), index=new Map(eligible);
      let converted=0;
      for (const [name,t] of eligible) {
        const kind=tokenKind(t),alias=tokenAlias(t);
        const value=alias ? kind && validAlias(name,t,index,kind) ? {type:"alias" as const,value:id+":"+alias} : undefined : scalarToken(t);
        if (!kind || !value) {skipped++;continue;}
        this.variables.push({id:id+":"+name,name:set.name+"/"+name,collection:id,resolvedType:kind,values:{[mode]:value},
          description:clipped(string(t.description) ?? string(t.$description) ?? "",1024)});
        converted++;count++;
      }
      if (converted) this.collections.push({id,name:"Penpot/"+set.name,modes:[{id:mode,name:"Default"}]});
    }
    if (sets.length>256 || this.variables.length>=8192) warn("Penpot token import capped at 256 sets and 8192 scalar variables");
    if (skipped) warn(skipped+" unsupported or unresolved Penpot tokens were not converted to native variables; original JSON retained when possible");
    if (v.themes!=null) warn("Penpot themes and active set combinations are preserved as source metadata, not editable FigCraft modes");
    if (count) warn("Imported "+count+" Penpot scalar/alias design tokens as native variables; matching layer bindings will be linked when unambiguous");
  }
  data():Variables {return {collections:this.collections,variables:this.variables};}
}

function f32(value:number) {
  for (let precision=1;precision<=9;precision++) {
    const short=Number(value.toPrecision(precision));
    if (Math.fround(short)===value) return nativeFloat(short);
  }
  return nativeFloat(value);
}
export function variableFingerprint(variables:Variables) {
  function encode(value:unknown,channel=false):string {
    if (typeof value==="number") return channel ? f32(value) : nativeFloat(value);
    if (Array.isArray(value)) return "["+value.map(item=>encode(item)).join(",")+"]";
    if (value && typeof value==="object") return "{"+Object.entries(value).map(([k,v])=>JSON.stringify(k)+":"+encode(v,["r","g","b","a"].includes(k))).join(",")+"}";
    return JSON.stringify(value);
  }
  return bytesToHex(sha256(utf8.encode(encode(variables)))).slice(0,32);
}
