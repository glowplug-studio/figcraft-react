import { parseIndex, parseString } from "./parameters";
import { U64_MAX } from "./native-values";
import { compareScalarKeys } from "./text-breaks";
import { sameComponentValue } from "./component-groups";
import { emptyVariables, ownVariableValue, type Collection, type Variable, type Variables } from "./variables";

export const collectionSpecs = {
  "variable.createCollection":{label:"Create variable collection",undo:true},
  "variable.renameCollection":{label:"Rename collection",undo:true},
  "variable.extendCollection":{label:"Extend collection",undo:true},
  "variable.addMode":{label:"Add mode",undo:true},
  "variable.renameMode":{label:"Rename mode",undo:true},
  "variable.removeMode":{label:"Delete mode",undo:true},
  "variable.moveMode":{label:"Move mode",undo:true},
} as const;

export function nextVariableId(records:readonly {id:string}[],prefix:string) {
  let highest=0n;
  for (const {id} of records) {
    if (!id.startsWith(prefix)) continue;
    const digits=id.slice(prefix.length);
    if (!/^\d+$/.test(digits)) continue;
    const n=BigInt(digits);
    if (n<=U64_MAX && n>highest) highest=n;
  }
  return prefix+String(highest===U64_MAX ? U64_MAX : highest+1n);
}
function required(params:Record<string,unknown>,field:string) {
  const value=parseString(params[field]);
  if (value===undefined) throw new Error(field+" is required");
  return value;
}
function nameOf(params:Record<string,unknown>,limit?:number) {
  const value=required(params,"name").trim();
  if (!value.length) throw new Error("Name cannot be empty");
  return limit===undefined ? value : Array.from(value).slice(0,limit).join("");
}

/** Inherit through the entire collection chain, parents first, keeping overridden mode values. */
export function syncExtensions(data:Variables):Variables {
  if (!data.collections.some(c=>c.extends!==undefined)) return data;
  const collections=[...data.collections], variables=[...data.variables];
  const byId=new Map(collections.map(c=>[c.id,c]));
  function depth(c:Collection) {
    let parent=c.extends, n=0;
    const seen=new Set<string>([c.id]);
    while (parent!==undefined && byId.has(parent)) {
      if (seen.has(parent)) return Infinity;
      seen.add(parent); n++; parent=byId.get(parent)!.extends;
    }
    return n;
  }
  const extended=collections.flatMap((c,i)=>c.extends!==undefined ? [{i,depth:depth(c)}] : []).sort((a,b)=>a.depth-b.depth);
  for (const entry of extended) {
    const c=collections[entry.i], parent=Number.isFinite(entry.depth) ? byId.get(c.extends!) : undefined;
    const parents=new Map(variables.filter(v=>parent && v.collection===parent.id).map(v=>[v.id,v]));
    const modeIds=parent?.modes.map(m=>m.id) ?? [];
    const inherited=new Set<string>();
    for (const [i,v] of variables.entries()) {
      if (v.collection!==c.id) continue;
      const source=v.extends!==undefined && parents.get(v.extends);
      const {extends:link,overrides:previous,...base}=v;
      let next:Variable;
      if (source) {
        inherited.add(source.id);
        const overrides=source.resolvedType===v.resolvedType ? previous?.filter(m=>modeIds.includes(m)) : undefined;
        const own=new Set(overrides);
        const values=Object.fromEntries(Object.entries(source.values).map(([m,x])=>[m,own.has(m) ? ownVariableValue(v.values,m) ?? x : x]));
        next={...base,name:source.name,resolvedType:source.resolvedType,extends:source.id,
          ...(overrides?.length && {overrides:Object.freeze(overrides)}),values:Object.freeze(values)};
      } else if (!parent) next=base;
      else {
        const first=modeIds.map(m=>ownVariableValue(v.values,m)).find(x=>x!==undefined) ?? v.values[Object.keys(v.values).sort(compareScalarKeys)[0]];
        const values=Object.fromEntries(modeIds.flatMap(m=>{
          const val=ownVariableValue(v.values,m) ?? first;
          return val ? [[m,val]] : [];
        }));
        next={...base,values:Object.freeze(values)};
      }
      if (!sameComponentValue(v,next)) variables[i]=Object.freeze(next);
    }
    const {extends:link,...unlinked}=c;
    const next=parent ? {...c,modes:parent.modes} : unlinked;
    if (!sameComponentValue(c,next)) collections[entry.i]=Object.freeze(next);
    byId.set(c.id,collections[entry.i]);
    for (const v of parents.values()) if (!inherited.has(v.id)) {
      const {overrides,hiddenFromPublishing,...base}=v;
      variables.push(Object.freeze({...base,id:nextVariableId(variables,"VariableID:"),collection:c.id,extends:v.id}));
    }
  }
  return Object.freeze({collections:Object.freeze(collections),variables:Object.freeze(variables)});
}

const collectionParams:Record<keyof typeof collectionSpecs,readonly string[]> = {
  "variable.createCollection":["name","modes"],"variable.renameCollection":["collection","name"],
  "variable.extendCollection":["collection","name"],"variable.addMode":["collection","name","from"],
  "variable.renameMode":["collection","mode","name"],"variable.removeMode":["collection","mode"],
  "variable.moveMode":["collection","mode","to"],
};

export function editCollection(data:Variables=emptyVariables,command:string,p:Record<string,unknown>) {
  const allowed=collectionParams[command as keyof typeof collectionSpecs];
  for (const key of Object.keys(p)) if (!allowed?.includes(key)) throw new Error("Unknown "+command+" parameter "+key);
  const collections=[...data.collections];
  let variables=data.variables, result:Record<string,unknown>={ok:true};
  const id=()=>nextVariableId(collections,"VariableCollectionId:");
  if (command==="variable.createCollection") {
    const name=nameOf(p);
    const names=Array.isArray(p.modes) ? p.modes.filter((s):s is string=>typeof s==="string").map(s=>s.trim()) : ["Mode 1"];
    if (!names.length || names.some(s=>!s)) throw new Error("A collection needs named modes");
    if (collections.some(c=>c.name===name)) throw new Error("Collection name already exists");
    const cid=id(), modes=names.map((name,i)=>Object.freeze({id:cid+"/mode"+(i+1),name}));
    collections.push(Object.freeze({id:cid,name,modes:Object.freeze(modes)})); result={id:cid};
  } else {
    const key=required(p,"collection"), i=collections.findIndex(c=>c.id===key || c.name===key);
    if (i===-1) throw new Error("No such collection");
    const c=collections[i];
    if (command==="variable.extendCollection") {
      const base=Array.from(parseString(p.name)?.trim() ?? "").slice(0,200).join("") || c.name+" (extended)";
      const names=new Set(collections.map(c=>c.name));
      let name=base;
      for (let n=2; names.has(name) && n<=1000; n++) name=n===1000 ? base : base+" "+n;
      const cid=id();
      collections.push(Object.freeze({id:cid,name,modes:Object.freeze([]),extends:c.id})); result={id:cid};
    } else if (command==="variable.renameCollection") {
      const name=nameOf(p,200);
      if (collections.some((other,index)=>index!==i && other.name===name)) throw new Error("Collection name already exists");
      collections[i]=Object.freeze({...c,name});
    } else {
      if (c.extends!==undefined) throw new Error("Edit these modes in the parent collection");
      const modes=[...c.modes];
      if (command==="variable.addMode") {
        const from=parseString(p.from);
        const source=from===undefined ? modes[0] : modes.find(m=>m.id===from) ?? modes.find(m=>m.name===from);
        if (from!==undefined && !source) throw new Error("No such source mode");
        let n=modes.length+1;
        while (modes.some(m=>m.id===c.id+"/mode"+n)) n++;
        const mid=c.id+"/mode"+n;
        modes.push(Object.freeze({id:mid,name:required(p,"name")}));
        variables=variables.map(v=>{
          const val=v.collection===c.id && source && ownVariableValue(v.values,source.id);
          return val ? Object.freeze({...v,values:Object.freeze({...v.values,[mid]:val})}) : v;
        });
        result={id:mid};
      } else {
        const mode=required(p,"mode"), at=modes.findIndex(m=>m.id===mode || m.name===mode);
        if (at<0) throw new Error("No such mode");
        const m=modes[at];
        if (command==="variable.renameMode") modes[at]=Object.freeze({...m,name:nameOf(p,200)});
        else if (command==="variable.moveMode") {
          const to=parseIndex(p.to,"to");
          modes.splice(at,1); modes.splice(Math.min(to,modes.length),0,m);
        } else {
          if (modes.length<2) throw new Error("A collection keeps at least one mode");
          modes.splice(at,1);
          variables=variables.map(v=>{
            if (v.collection!==c.id || !Object.hasOwn(v.values,m.id)) return v;
            const {[m.id]:discard,...rest}=v.values;
            return Object.freeze({...v,values:Object.freeze(rest)});
          });
        }
      }
      collections[i]=Object.freeze({...c,modes:Object.freeze(modes)});
    }
  }
  const next={collections:Object.freeze(collections),variables:Object.freeze(variables)};
  return {data:sameComponentValue(data,next) ? data : syncExtensions(Object.freeze(next)),result};
}
