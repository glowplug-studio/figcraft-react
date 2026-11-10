import {colour} from "./colour";
import {compareScalarKeys} from "./text-breaks";
import {variableScopes} from "./variable-metadata";
import type {Collection,Mode,Variable,VariableType,VariableValue,Variables} from "./variables";

type RecordValue=Record<string,unknown>;
const record=(x:unknown):x is RecordValue=>x!==null && typeof x==="object" && !Array.isArray(x);
const list=(x:unknown):readonly unknown[]=>Array.isArray(x) ? x : [];
const text=(x:unknown)=>typeof x==="string" ? x : undefined;
function clip(s:string,n=200) {
  if (s.length<=n) return s;
  let end=0,count=0;
  for (const ch of s) {if (count++===n) break;end+=ch.length;}
  return s.slice(0,end);
}
function entries(value:unknown,max:number) {
  return record(value) ? Object.keys(value).sort(compareScalarKeys).slice(0,max).map(k=>[k,value[k]] as const) : [];
}
const kinds=new Map<string,VariableType>([["COLOR","color"],["FLOAT","number"],["STRING","string"],["BOOLEAN","boolean"]]);
export function readRestVariableValue(kind:VariableType,raw:unknown):VariableValue|undefined {
  if (record(raw) && raw.type==="VARIABLE_ALIAS" && typeof raw.id==="string" && raw.id) return {type:"alias",value:clip(raw.id)};
  switch (kind) {
    case "number": if (typeof raw==="number" && Number.isFinite(raw)) return {type:kind,value:Math.max(-1e9,Math.min(1e9,raw))}; break;
    case "string": if (typeof raw==="string") return {type:kind,value:clip(raw,10000)};break;
    case "boolean": if (typeof raw==="boolean") return {type:kind,value:raw};break;
    case "color": {
      if (record(raw) && typeof raw.r==="number" && Number.isFinite(raw.r) && typeof raw.g==="number" && Number.isFinite(raw.g)
        && typeof raw.b==="number" && Number.isFinite(raw.b)) return {type:kind,value:colour(raw.r,raw.g,raw.b,typeof raw.a==="number" && Number.isFinite(raw.a) ? raw.a : 1)};
    }
  }
}
function order<T extends Mode>(records:T[],raw:unknown) {
  if (!Array.isArray(raw)) return records;
  const rank=new Map(list(raw).slice(0,256).filter((k):k is string=>typeof k==="string").map((k,i)=>[k,i]));
  return records.sort((a,b)=>(rank.get(a.id) ?? Infinity)-(rank.get(b.id) ?? Infinity));
}
export function hasRestVariables(input:unknown) {
  return record(input) && [input.meta,input].some(h=>record(h) && record(h.variableCollections));
}
export function readRestVariables(input:unknown, prior?:Variables) {
  const root=typeof input==="string" ? JSON.parse(input) as unknown : input;
  if (!record(root)) throw new Error("Expected a local variables JSON object");
  const holders=[root.meta,root].filter(record),src=holders.find(h=>record(h.variableCollections));
  if (!src) throw new Error("Expected variableCollections in the local variables JSON");
  const counts=new Map<string,number>();
  const warn=(s:string)=>counts.set(s,(counts.get(s) ?? 0)+1);
  const collections:Collection[]=[...(prior?.collections ?? [])],modeSets=new Map(collections.map(c=>[c.id,new Set(c.modes.map(m=>m.id))])),listed=new Set<string>();
  const priorKinds=new Map(prior?.variables.map(v=>[v.id,v.resolvedType]));
  let listedCount=0;
  for (const [key,value] of entries(src.variableCollections,10000)) {
    const c=record(value) ? value : {},id=clip(text(c.id) ?? key);
    if (listedCount<100000) for (const v of list(c.variableIds).slice(0,256)) if (typeof v==="string") {
      listed.add(clip(v));if (++listedCount>=100000) break;
    }
    if (!id || modeSets.has(id)) continue;
    const modes:Mode[]=[],set=new Set<string>();
    for (const m of list(c.modes).slice(0,256)) {
      if (!record(m) || typeof m.modeId!=="string" || !m.modeId) continue;
      const mid=clip(m.modeId);
      if (!set.has(mid)) {set.add(mid);modes.push({id:mid,name:clip(text(m.name)?.trim() ? String(m.name) : "Mode "+(modes.length+1))});}
    }
    if (!modes.length) {warn("variable collections without modes were skipped");continue;}
    const first=modes.findIndex(m=>m.id===c.defaultModeId);
    if (first>0) modes.unshift(...modes.splice(first,1));
    modeSets.set(id,set);
    collections.push({id,name:text(c.name)?.trim() ? clip(String(c.name)) : "Collection",modes});
  }
  const holder=[src,...holders].find(h=>record(h.variables));
  type Imported=Variable & {values:Record<string,VariableValue>};
  let vars:Imported[]=[];
  const seen=new Set<string>();
  for (const [key,value] of entries(holder?.variables,100000)) {
    const v=record(value) ? value : {},id=clip(text(v.id) ?? key);
    if (!id || priorKinds.has(id)) continue;
    const kind=kinds.get(text(v.resolvedType) ?? "");
    if (!kind) {warn("variables of unknown types were skipped");continue;}
    const cid=text(v.variableCollectionId),modes=cid===undefined ? undefined : modeSets.get(cid);
    if (!modes || cid===undefined) {warn("variables whose collection isn't in the variables JSON were skipped");continue;}
    const values:Record<string,VariableValue>=Object.create(null);
    let unreadable=false;
    for (const [mid,raw] of entries(v.valuesByMode,1000)) if (modes.has(mid)) {
      const val=readRestVariableValue(kind,raw);
      if (val) values[mid]=Object.freeze(val);else unreadable=true;
    }
    if (unreadable) warn("variable values that don't match their type (or composed colours) were skipped");
    if (!Object.keys(values).length) {warn("variables without readable values were skipped");continue;}
    if (seen.has(id)) continue;
    seen.add(id);
    const allowed=variableScopes[kind];
    const scopes=Array.isArray(v.scopes) ? [...new Set(v.scopes.filter((s):s is string=>typeof s==="string" &&
      (s==="ALL_SCOPES" || kind==="color" && s==="ALL_FILLS" || allowed.includes(s))))] : undefined;
    const all=scopes?.includes("ALL_SCOPES") || allowed.length>0 && allowed.every(k=>scopes?.includes(k));
    const code=Object.fromEntries(entries(v.codeSyntax,16).flatMap(([k,s])=>
      ["WEB","iOS","ANDROID"].includes(k) && typeof s==="string" && s.trim() ? [[k,clip(s)]] : []));
    vars.push({id,name:text(v.name)?.trim() ? clip(String(v.name)) : "Variable",collection:cid,resolvedType:kind,values,
      description:clip(text(v.description) ?? "",10000),...(scopes && !all && {scopes:Object.freeze(scopes)}),...(v.hiddenFromPublishing===true && {hiddenFromPublishing:true}),
      ...(Object.keys(code).length && {codeSyntax:Object.freeze(code)})});
  }
  let dropped=false;
  for (let pass=0;pass<8;pass++) {
    const types=new Map([...priorKinds,...vars.map(v=>[v.id,v.resolvedType] as const)]);
    let removed=false;
    for (const v of vars) for (const [mid,val] of Object.entries(v.values)) if (val.type==="alias" && types.get(val.value)!==v.resolvedType) {
      delete v.values[mid];removed=true;
    }
    if (!removed) break;
    dropped=true;vars=vars.filter(v=>Object.keys(v.values).length);
  }
  if (dropped) warn("variable aliases to variables that aren't in the variables JSON (or of another type) were skipped");
  const encoder=new TextEncoder(),collIndex=new Map(collections.map(c=>[c.id,c]));
  const byteCosts=new Map(collections.map(c=>[c.id,64+Math.max(...c.modes.map(m=>encoder.encode(m.id).length))]));
  let budget=64*1024*1024;
  for (const v of vars) {
    const modes=collIndex.get(v.collection)!.modes;
    const fallback=v.values[modes[0].id] ?? v.values[Object.keys(v.values).sort(compareScalarKeys)[0]];
    const cost=byteCosts.get(v.collection)!+(typeof fallback.value==="string" ? encoder.encode(fallback.value).length : 0);
    for (const m of modes) if (!Object.hasOwn(v.values,m.id)) {
      if (cost>budget) break;
      v.values[m.id]=fallback;budget-=cost;
    }
  }
  const warnings=Array.from(counts,([s,count])=>count>1 ? s+" (×"+count+")" : s);
  if (prior) return {collections:order(collections,src.collectionOrder),variables:[...prior.variables,...order(vars,src.variableOrder)],warnings};
  if (!vars.length) warnings.push("no variables found: expected `meta.variables` (an object of variables by id, next to `meta.variableCollections`)");
  else {
    const imported=new Set(vars.map(v=>v.id));
    const absent=Array.from(listed).filter(id=>!imported.has(id)).length;
    if (absent) warnings.push(absent+" of the "+listed.size+" variables the collections list in `variableIds` weren't imported");
  }
  return {collections:order(collections,src.collectionOrder),variables:order(vars,src.variableOrder),warnings};
}
