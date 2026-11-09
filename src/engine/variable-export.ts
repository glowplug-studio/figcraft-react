import {toCssHex,toRgba8,type Colour} from "./colour";
import type {Document} from "./document";
import {trimNumber} from "./inspect-text";
import {parseString} from "./parameters";
import {compareScalarKeys,nativeFloat} from "./text-breaks";
import {cssVariableName,numberRoles,variableCssNames} from "./variable-css-names";
import {emptyVariables,resolveVariable,variableIndex,type Collection,type Variable,type Variables,type VariableValue} from "./variables";

function flatten(data:Variables,v:Variable,mode:string,value:VariableValue) {
  return value.type==="colorAlpha" || value.type==="colorMix"
    ? resolveVariable(data,v.id,{[v.collection]:mode},value) : value;
}

// Preserve f64 notation and native sorted map keys, including numeric-looking identifiers.
function pretty(value:unknown,depth=0):string {
  if (typeof value==="number") return nativeFloat(value);
  if (!value || typeof value!=="object") return JSON.stringify(value);
  const array=Array.isArray(value),open=array ? "[" : "{",close=array ? "]" : "}";
  const entries=array ? value.map(v=>pretty(v,depth+1)) : Object.keys(value).sort(compareScalarKeys).map(k=>{
    const v=(value as Record<string,unknown>)[k];
    return JSON.stringify(k)+": "+(depth===0 && k==="status" ? String(v) : pretty(v,depth+1));
  });
  if (!entries.length) return open+close;
  const pad="  ".repeat(depth);
  return open+"\n"+pad+"  "+entries.join(",\n"+pad+"  ")+"\n"+pad+close;
}
function jsonExport(data:Variables,collections:readonly Collection[],groups:Map<string,Variable[]>) {
  const selected=new Set(collections.flatMap(c=>(groups.get(c.id) ?? []).map(v=>v.id)));
  const variableCollections=Object.fromEntries(collections.map(c=>[c.id,{id:c.id,name:c.name,key:c.id,
    modes:c.modes.map(m=>({modeId:m.id,name:m.name})),defaultModeId:c.modes[0]?.id ?? null,
    remote:false,hiddenFromPublishing:false,variableIds:(groups.get(c.id) ?? []).map(v=>v.id)}]));
  const variables:Record<string,unknown>=Object.create(null);
  for (const v of data.variables) {
    if (!selected.has(v.id)) continue;
    const valuesByMode:Record<string,unknown>=Object.create(null);
    for (const [mode,source] of Object.entries(v.values)) {
      const val=source.type==="alias" && !selected.has(source.value) ? resolveVariable(data,source.value) : flatten(data,v,mode,source);
      if (val) valuesByMode[mode]=val.type==="alias" ? {type:"VARIABLE_ALIAS",id:val.value} : val.value;
    }
    variables[v.id]={id:v.id,name:v.name,key:v.id,variableCollectionId:v.collection,
      resolvedType:v.resolvedType==="number" ? "FLOAT" : v.resolvedType.toUpperCase(),valuesByMode,remote:false,
      description:v.description,hiddenFromPublishing:!!v.hiddenFromPublishing,scopes:v.scopes ?? ["ALL_SCOPES"],codeSyntax:v.codeSyntax ?? {}};
  }
  return pretty({error:false,status:200,meta:{variables,variableCollections}});
}

function unresolvedCalculations(data:Variables) {
  const missing=new Set<string>(),readers=new Map<string,string[]>();
  for (const v of data.variables) {
    const collection=variableIndex(data).collections.get(v.collection);
    const fallback=v.values[Object.keys(v.values).sort(compareScalarKeys)[0]];
    if (collection?.modes.some(m=>{
      const source=Object.hasOwn(v.values,m.id) ? v.values[m.id] : fallback;
      return source && !flatten(data,v,m.id,source);
    })) missing.add(v.id);
    for (const source of Object.values(v.values)) if (source.type==="alias") {
      const list=readers.get(source.value);
      if (list) list.push(v.id); else readers.set(source.value,[v.id]);
    }
  }
  for (const id of missing) for (const reader of readers.get(id) ?? []) missing.add(reader);
  return missing;
}
const safeCss=(s:string)=>s.replaceAll("*/","* /").replace(/["\\\n\r\f]/g," ");
function cssColour(c:Colour) {
  if (c.a>=Math.fround(.999)) return toCssHex(c);
  const [r,g,b,a]=toRgba8(c);
  const keeps=(s:string)=>Math.round(Math.fround(Math.fround(Number(s))*255))===a;
  // Rust decimal formatting rounds exact halfway cases to even.
  const fixed=(x:number,n:number)=>{
    const scale=10**n, scaled=x*scale, floor=Math.floor(scaled);
    const rounded=scaled-floor===.5 && floor%2===0 ? floor : Math.round(scaled);
    return (rounded/scale).toFixed(n);
  };
  const alpha=[fixed(c.a,2),fixed(c.a,3)].find(keeps) ?? fixed(Math.fround(a/255),3);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function cssExport(doc:Document,data:Variables,collections:readonly Collection[],groups:Map<string,Variable[]>,tailwind:boolean) {
  const roles=numberRoles(doc,data),names=variableCssNames(data,roles,tailwind),omit=unresolvedCalculations(data);
  const out=tailwind ? ['@import "tailwindcss";\n\n'] : [];
  for (const c of collections) for (const [index,m] of c.modes.entries()) {
    const selector=index ? `[data-${cssVariableName(c.name).replace(/^-+/,"")}="${safeCss(m.name)}"]` : tailwind ? "@theme static" : ":root";
    out.push(`/* ${safeCss(c.name)} · ${safeCss(m.name)} */\n${selector} {\n`);
    for (const v of groups.get(c.id) ?? []) {
      if (!Object.hasOwn(v.values,m.id)) continue;
      const source=v.values[m.id];
      const value=source.type==="alias" && omit.has(source.value) ? resolveVariable(data,v.id,{[c.id]:m.id}) : flatten(data,v,m.id,source);
      if (!value) continue;
      let text:string;
      switch (value.type) {
        case "alias": if (!names.has(value.value)) continue; text="var("+names.get(value.value)+")"; break;
        case "color": text=cssColour(value.value); break;
        case "number": text=trimNumber(value.value)+(roles.get(v.id)==="unitless" ? "" : "px"); break;
        case "string": text='"'+safeCss(value.value)+'"'; break;
        case "boolean": text=String(value.value); break;
      }
      out.push("  "+names.get(v.id)+": "+text+";\n");
    }
    out.push("}\n");
  }
  return out.join("");
}

const reserved=new Set("assert await break case catch class const continue default do else enum extends false final finally for if in is new null rethrow return super switch this throw true try var void while with yield abstract as bool Color covariant deferred double dynamic export extension external factory Function get implements import int interface late library List mixin num Object operator part required set static String typedef".split(" "));
function dartName(name:string,pascal:boolean) {
  let value=(name.match(/[a-z0-9]+/gi) ?? []).map((w,i)=>(i || pascal ? w[0].toUpperCase() : w[0].toLowerCase())+w.slice(1)).join("");
  if (!value || /^[0-9]/.test(value)) value=(pascal ? "V" : "v")+value;
  return reserved.has(value) ? value+"_" : value;
}
function dartString(s:string) {
  return "'"+s.replace(/[\\'$\p{Cc}]/gu,c=>{
    if (c==="\n") return "\\n";
    if (c==="\r") return "\\r";
    return c==="\\" || c==="'" || c==="$" ? "\\"+c : "\\u{"+c.codePointAt(0)!.toString(16)+"}";
  })+"'";
}
function distinct(base:string,taken:Set<string>) {
  let name=base,n=1;
  while (taken.has(name)) name=base+(++n);
  taken.add(name);
  return name;
}
function dartExport(data:Variables,collections:readonly Collection[],groups:Map<string,Variable[]>) {
  const out=["// Variables exported from FigCraft.\n\nimport 'dart:ui';\n"],classes=new Set<string>();
  for (const c of collections) {
    const base=dartName(c.name,true),taken=new Set<string>();
    const members=(groups.get(c.id) ?? []).map(v=>({v,name:distinct(dartName(v.name,false),taken)}));
    for (const [index,m] of c.modes.entries()) {
      const name=distinct(index ? base+dartName(m.name,true) : base,classes);
      out.push("\n/// "+(c.name+" · "+m.name).replace(/\p{Cc}/gu," ")+"\nabstract final class "+name+" {\n");
      for (const {v,name:member} of members) {
        const resolved=resolveVariable(data,v.id,{[c.id]:m.id});
        if (!resolved) continue;
        let type:string,literal:string;
        switch (resolved.type) {
          case "color": {
            const [r,g,b,a]=toRgba8(resolved.value);
            type="Color";literal="Color(0x"+[a,r,g,b].map(x=>x.toString(16).padStart(2,"0")).join("").toUpperCase()+")";
            break;
          }
          case "string": type="String";literal=dartString(resolved.value);break;
          case "boolean": type="bool";literal=String(resolved.value);break;
          case "number": {
            const n=resolved.value;
            type="double";literal=Number.isInteger(n) && Math.abs(n)<1e15 ? Object.is(n,-0) ? "-0" : String(n) :
              Math.abs(n)<1e-4 || Math.abs(n)>=1e16 ? n.toExponential().replace("e+","e") : nativeFloat(n);
            break;
          }
        }
        out.push("  static const "+type+" "+member+" = "+literal+";\n");
      }
      out.push("}\n");
    }
  }
  return out.join("");
}

export function exportVariables(doc:Document,p:Record<string,unknown>):{text:string} {
  for (const key of Object.keys(p)) if (!["collections","format","path"].includes(key)) throw new Error("Unknown export parameter "+key);
  if (parseString(p.path)!==undefined) throw new Error("Use a browser download to save exported variables");
  const data=doc.variables ?? emptyVariables;
  const remote=new Set(doc.libraryRecords?.collections.map(r=>r.local));
  let collections=data.collections.filter(c=>!remote.has(c.id));
  if (p.collections!=null) {
    if (!Array.isArray(p.collections)) throw new Error("Expected collection IDs or names");
    collections=p.collections.map(key=>{
      const found=typeof key==="string" && (data.collections.find(c=>c.id===key) ?? data.collections.find(c=>c.name===key));
      if (!found) throw new Error("Unknown variable collection");
      return found;
    });
  }
  const groups=new Map<string,Variable[]>();
  for (const v of data.variables) {
    const group=groups.get(v.collection);
    if (group) group.push(v); else groups.set(v.collection,[v]);
  }
  switch (parseString(p.format) ?? "json") {
    case "json": return {text:jsonExport(data,collections,groups)};
    case "css": return {text:cssExport(doc,data,collections,groups,false)};
    case "tailwind": return {text:cssExport(doc,data,collections,groups,true)};
    case "dart": return {text:dartExport(data,collections,groups)};
    default: throw new Error("Expected json, css, tailwind or dart");
  }
}
