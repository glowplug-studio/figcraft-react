import {sameComponentValue} from "./component-groups";
import {compareScalarKeys} from "./text-breaks";
import {nextVariableId,syncExtensions} from "./variable-collections";
import {readRestVariables} from "./variable-rest";
import {references,refersBack,variableDefaults} from "./variable-values";
import type {Collection,Mode,Variable,Variables,VariableValue} from "./variables";

function allocate(records:readonly {id:string}[],prefix:string) {
  let n=BigInt(nextVariableId(records,prefix).slice(prefix.length));
  return ()=>prefix+String(n++);
}
export function importVariables(data:Variables,p:Record<string,unknown>) {
  if (Object.keys(p).some(k=>k!=="variables")) throw new Error("Unknown variable import parameter");
  const src=readRestVariables(p.variables);
  const result={collections:0,variables:0,updated:0,warnings:src.warnings};
  const collections=new Map(data.collections.map(c=>[c.id,c]));
  const variables=new Map(data.variables.map(v=>[v.id,v]));
  const nextCollection=allocate(data.collections,"VariableCollectionId:"),nextVariable=allocate(data.variables,"VariableID:");
  const localNames=new Map<string,string>(),allNames=new Set<string>();
  const members=new Map<string,Map<string,Variable>>(),memberIds=new Map<string,string[]>();
  for (const c of data.collections) {
    allNames.add(c.name);
    if (!c.extends && !localNames.has(c.name)) localNames.set(c.name,c.id);
  }
  function register(v:Variable) {
    const ids=memberIds.get(v.collection);
    if (ids) ids.push(v.id); else memberIds.set(v.collection,[v.id]);
    let group=members.get(v.collection);
    if (!group) {group=new Map();members.set(v.collection,group);}
    if (!group.has(v.name)) group.set(v.name,v);
  }
  for (const v of data.variables) register(v);
  const importedCollections=new Map<string,{id:string;modes:Map<string,string>}>();
  for (const c of src.collections) {
    let target:Collection|undefined=collections.get(localNames.get(c.name) ?? "");
    if (!target) {
      let name=c.name;
      for (let n=2;n<1000 && allNames.has(name);n++) name=c.name+" "+n;
      if (allNames.has(name)) name=c.name;
      target={id:nextCollection(),name,modes:[]};
      allNames.add(name);localNames.set(name,target.id);result.collections++;
    }
    const cid=target.id;
    const modes=[...target.modes],mapped=new Map<string,string>(),existingModes=new Map<string,Mode>();
    const modeIds=new Set(modes.map(m=>m.id));
    for (const m of modes) if (!existingModes.has(m.name)) existingModes.set(m.name,m);
    const addedModes:string[]=[];
    for (const mode of c.modes) {
      let local=existingModes.get(mode.name);
      if (!local) {
        let n=modes.length+1;
        while (modeIds.has(cid+"/mode"+n)) n++;
        local=Object.freeze({id:target.id+"/mode"+n,name:mode.name});
        modeIds.add(local.id);existingModes.set(local.name,local);addedModes.push(local.id);
        modes.push(local);
      }
      mapped.set(mode.id,local.id);
    }
    const first=target.modes[0]?.id;
    if (first && addedModes.length) for (const id of memberIds.get(cid) ?? []) {
      const v=variables.get(id)!;
      if (!Object.hasOwn(v.values,first)) continue;
      const values:Record<string,VariableValue>=Object.assign(Object.create(null),v.values);
      for (const mode of addedModes) values[mode]=values[first];
      variables.set(id,Object.freeze({...v,values:Object.freeze(values)}));
    }
    if (target.modes.length!==modes.length) target=Object.freeze({...target,modes:Object.freeze(modes)});
    collections.set(target.id,target);
    importedCollections.set(c.id,{id:target.id,modes:mapped});
  }
  const mapping=new Map<string,string>();
  for (const v of src.variables) {
    const cid=importedCollections.get(v.collection)!.id,existing=members.get(cid)?.get(v.name);
    if (existing && existing.resolvedType!==v.resolvedType) {
      result.warnings.push("`"+v.name+"` is a "+existing.resolvedType+" variable in this file: the "+v.resolvedType+" one was skipped");
    } else if (existing) {
      mapping.set(v.id,existing.id);result.updated++;
    } else {
      const copy={...v,id:nextVariable(),collection:cid,values:{}};
      mapping.set(v.id,copy.id);variables.set(copy.id,copy);register(copy);result.variables++;
    }
  }
  // A chain can return to its owner only if an existing value references that ID.
  // Keep a conservative set as imports add edges, avoiding a traversal per sequential alias.
  const referenced=new Set<string>();
  for (const v of data.variables) for (const val of Object.values(v.values))
    for (const id of references(val)) referenced.add(id);
  for (const v of src.variables) {
    const id=mapping.get(v.id);
    if (id===undefined) continue;
    const target=variables.get(id)!,mapped=importedCollections.get(v.collection)!;
    const values:Record<string,VariableValue>=Object.assign(Object.create(null),target.values);
    variables.set(id,{...target,values});
    for (const mode of Object.keys(v.values).sort(compareScalarKeys)) {
      const mid=mapped.modes.get(mode);
      if (mid===undefined) continue;
      let val=v.values[mode];
      if (val.type==="alias") {
        const alias=mapping.get(val.value);
        if (alias===undefined || alias===id || referenced.has(id) && refersBack(variables,alias,id)) {
          result.warnings.push("`"+v.name+"`: "+(alias===undefined ? "its alias target wasn't imported" : "the alias would refer back to itself"));continue;
        }
        referenced.add(alias);
        val={type:"alias",value:alias};
      }
      values[mid]=Object.freeze(val);
    }
    const modes=collections.get(mapped.id)!.modes;
    const first=modes.find(m=>Object.hasOwn(values,m.id));
    const fallback=first ? values[first.id] : variableDefaults[v.resolvedType];
    for (const m of modes) if (!Object.hasOwn(values,m.id)) values[m.id]=fallback;
    Object.freeze(values);
    variables.set(id,Object.freeze({...target,values}));
  }
  const next=syncExtensions({collections:Object.freeze([...collections.values()]),variables:Object.freeze([...variables.values()].map(v=>{
    if (Object.isFrozen(v)) return v;
    return Object.freeze({...v,values:Object.freeze(v.values)});
  }))});
  return {data:sameComponentValue(data,next) ? data : next,result};
}
