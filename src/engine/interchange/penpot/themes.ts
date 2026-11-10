import { compareScalarKeys } from "../../text-breaks";
import type { Variable, VariableType, VariableValue } from "../../variables";
import { children, entries, object, string, type JsonObject } from "../rest/values";
import { clipped } from "./values";
import { tokenNumber,TokenWork } from "./token-expression";
import { flattenTokens,tokenKind,tokenAlias,scalarToken,type PenpotTokens } from "./tokens";

type Theme={id:string; name:string; sets:string[]};
type ModePlan={id:string;name:string;sets:Set<number>};
type Plan={id:string;name:string;modes:ModePlan[]};
const utf8=new TextEncoder();
const strings=(v:unknown)=>children(v).filter((x):x is string=>typeof x==="string");

export function themedTokens(root:JsonObject,base:string,data:PenpotTokens,warn:(s:string)=>void) {
  const meta=object(root.$metadata),order=new Map<string,number>();
  strings(meta.tokenSetOrder).forEach((name,i)=>{if (!order.has(name)) order.set(name,i);});
  const names=entries(root).filter(([k,v])=>!k.startsWith("$") && v!==null && typeof v==="object" && !Array.isArray(v)).map(([k])=>k)
    .sort((a,b)=>(order.get(a) ?? Infinity)-(order.get(b) ?? Infinity)).slice(0,512);
  if (!names.length) return false;
  const sets=names.map(name=>new Map(flattenTokens(root[name])));
  const index=new Map<string,{set:number;token:JsonObject}[]>();
  sets.forEach((s,i)=>{for (const [path,token] of s) {
    const list=index.get(path);
    if (list) list.push({set:i,token});else index.set(path,[{set:i,token}]);
  }});
  const groups=new Map<string,Theme[]>(),known=new Set(names);
  for (const t of children(root.$themes).slice(0,256).map(object)) {
    if (typeof t.name!=="string") continue;
    const group=string(t.group)?.trim() ? String(t.group) : "Themes";
    const theme={name:t.name,id:clipped(string(t.id) ?? t.name,80),sets:entries(t.selectedTokenSets)
      .filter(([name,state])=>(state==="source" || state==="enabled") && known.has(name)).map(([k])=>k)};
    const list=groups.get(group);
    if (list) list.push(theme);else groups.set(group,[theme]);
  }
  const switches=[...groups].filter(([,ts])=>ts.length>1),themed=new Set(switches.flatMap(([,ts])=>ts.flatMap(t=>t.sets)));
  const active=new Set(strings(meta.activeSets)),baseSets=groups.size ? new Set([...groups.values()].filter(ts=>ts.length===1).flatMap(ts=>ts[0].sets)
    .concat([...active].filter(s=>!themed.has(s)))) : new Set(names.filter(s=>!active.size || active.has(s)));
  const selected=(s:Set<string>)=>new Set(names.flatMap((name,i)=>s.has(name)?[i]:[]));
  const prefix="penpot:tokens:"+base+":",cid=(group:string)=>prefix+"collection:"+group;
  const baseMode={id:cid("base")+":default",name:"Default",sets:selected(baseSets)};
  const plans:Plan[]=[{id:cid("base"),name:"Tokens",modes:[baseMode]}];
  for (const [g,ts] of switches) plans.push({id:cid(g),name:clipped(g,120),modes:ts.map(t=>({id:cid(g)+":"+t.id,
    name:clipped(t.name,120),sets:selected(new Set([...baseSets,...t.sets]))}))});
  const budget=new TokenWork();
  const exhausted=()=>{warn("Penpot token lookup work budget exhausted; skipped themed tokens");return false;};
  const owner=new Map<string,number>();
  for (let i=plans.length-1;i>=0;i--) for (const mode of plans[i].modes) for (const s of mode.sets) {
    if (i && baseSets.has(names[s])) continue;
    for (const path of sets[s].keys()) {
      if (!budget.spend(1)) return exhausted();
      owner.set(path,i);
    }
  }
  const paths=[...owner.keys()].sort(compareScalarKeys);
  function lookup(path:string,mode:ModePlan) {
    const list=index.get(path)!;
    for (let i=list.length-1;i>=0;i--) {
      if (!budget.spend(1)) return;
      if (mode.sets.has(list[i].set)) return list[i].token;
    }
  }
  for (let round=0;round<Math.min(paths.length,64);round++) {
    const moves:[string,number][]=[];
    for (const path of paths) if (!owner.get(path)) {
      if (!budget.spend(1)) return exhausted();
      const t=lookup(path,baseMode);
      if (!t || tokenAlias(t)) continue;
      const text=string(t.$value ?? t.value);
      if (!text) continue;
      if (!budget.spend(utf8.encode(text).length)) return exhausted();
      for (const ref of text.split("{").slice(1)) {
        const end=ref.indexOf("}");
        const id=end<0 ? undefined : owner.get(ref.slice(0,end).trim());
        if (id) {moves.push([path,id]);break;}
      }
    }
    if (!budget.remaining) return exhausted();
    if (!moves.length) break;
    for (const [p,i] of moves) owner.set(p,i);
  }
  const kinds=new Map<string,VariableType>(),used=new Set<number>();
  for (const path of paths) {
    const candidates=index.get(path)!;
    for (let i=candidates.length-1;i>=0;i--) {
      if (!budget.spend(1)) return exhausted();
      const kind=tokenKind(candidates[i].token);
      if (kind) {kinds.set(path,kind);break;}
    }
  }
  const resolved=new Map<string,Variable>(),dependants=new Map<string,string[]>(),drop=new Set<string>();
  let skipped=0,converted=0;
  for (const path of paths) {
    const kind=kinds.get(path);
    if (!kind) {skipped++;continue;}
    const plan=plans[owner.get(path)!], values=new Map<string,VariableValue>();
    let fallback;
    for (const mode of plan.modes) {
      const t=lookup(path,mode);
      if (!t) continue;
      const alias=tokenAlias(t);
      let value:VariableValue|undefined;
      if (alias) {
        if (kinds.get(alias)===kind) value={type:"alias",value:prefix+alias};
      } else {
        value=scalarToken(t);
        if (value?.type!==kind) value=undefined;
        if (!value && kind==="number") {
          const n=tokenNumber(path,[...mode.sets].map(i=>sets[i]),budget);
          if (Number.isFinite(n)) value={type:"number",value:n};
        }
      }
      if (value) {values.set(mode.id,value);fallback ??= value;}
    }
    if (!budget.remaining) return exhausted();
    if (!fallback) {skipped++;continue;}
    for (const mode of plan.modes) if (!values.has(mode.id)) values.set(mode.id,fallback);
    for (const v of values.values()) if (v.type==="alias") {
      const target=v.value.slice(prefix.length),deps=dependants.get(target);
      if (deps) deps.push(path);else dependants.set(target,[path]);
    }
    resolved.set(path,{id:prefix+path,name:plan.name+"/"+path,collection:plan.id,resolvedType:kind,
      values:Object.fromEntries([...values].sort(([a],[b])=>compareScalarKeys(a,b))),description:""});
  }
  for (const [p,deps] of dependants) if (!resolved.has(p)) for (const dep of deps) drop.add(dep);
  for (const p of drop) for (const dep of dependants.get(p) ?? []) drop.add(dep);
  for (const p of drop) if (resolved.delete(p)) skipped++;
  for (const [path,v] of resolved) {
    if (data.variables.length>=8192) {skipped++;continue;}
    let description;
    const list=index.get(path)!;
    for (let i=list.length-1;i>=0;i--) {
      if (!budget.spend(1)) break;
      const t=list[i].token;
      description=string(t.$description) ?? string(t.description);
      if (description!==undefined) break;
    }
    if (!budget.remaining) {warn("Penpot token lookup work budget exhausted; remaining descriptions were skipped");break;}
    data.variables.push({...v,description:clipped(description ?? "",1024)});used.add(owner.get(path)!);converted++;
  }
  plans.forEach((plan,i)=>{if (used.has(i) && data.collections.length<256) data.collections.push({id:plan.id,name:plan.name,modes:plan.modes.map(({id,name})=>({id,name}))});});
  const activeThemes=new Set(strings(meta.activeThemes));
  for (const [group,ts] of switches) {
    const t=ts.find(t=>activeThemes.has(group+"/"+t.name));
    if (t) data.modes[cid(group)]=cid(group)+":"+t.id;
  }
  if (converted) warn("Imported "+converted+" Penpot design tokens as native variables in "+used.size+" collection(s); theme groups became modes");
  if (skipped) warn(skipped+" Penpot tokens (math expressions, composite typography/shadow values or mismatched references) were not converted; original JSON retained when possible");
  return true;
}
