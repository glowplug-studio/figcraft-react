import {sameComponentValue} from "./component-groups";
import type {Document} from "./document";
import {bindLayerVariable} from "./layer-variable-bindings";
import {parseString} from "./parameters";
import type {ImportedRecord,PublishedLibrary} from "./published-library";
import {compareScalarKeys} from "./text-breaks";
import {editCollection} from "./variable-collections";
import {setVariableMode} from "./variable-modes";
import {editVariableValue,references} from "./variable-values";
import {emptyVariables,variableIndex,type Variables,type VariableValue} from "./variables";

export const readOnlyLibraryMessage="library components, styles and variables can't be edited in this file: edit them in their library file and publish it";
export function libraryVariableIds(data:Variables,seeds:Iterable<string>) {
  const pending=Array.from(seeds),found=new Set<string>(),index=variableIndex(data).variables;
  while (pending.length && found.size<100_000) {
    const id=pending.pop()!,v=index.get(id);
    if (!v || found.has(id)) continue;
    found.add(id);
    for (const value of Object.values(v.values)) for (const ref of references(value)) pending.push(ref);
  }
  return found;
}
function localKey(lib:string,key:string,taken:Set<string>) {
  const base=lib+":"+key;
  let name=base;
  for (let n=2;taken.has(name) && n<10000;n++) name=base+"#"+n;
  return taken.has(name) ? base : name;
}
function remapValue(value:VariableValue,ids:ReadonlyMap<string,string>):VariableValue | undefined {
  if (references(value).some(id=>!ids.has(id))) return;
  switch (value.type) {
    case "alias":return {type:"alias",value:ids.get(value.value)!};
    case "colorAlpha":return {type:"colorAlpha",value:{...value.value,variable:ids.get(value.value.variable)!}};
    case "colorMix":{
      const {from,to,t}=value.value;
      return {type:"colorMix",value:{t,from:"variable" in from ? {variable:ids.get(from.variable)!} : from,to:"variable" in to ? {variable:ids.get(to.variable)!} : to}};
    }
    default:return value;
  }
}
// A source key retains its original local ID on update. Allocate all IDs before resolving any alias.
export function importLibraryVariables(doc:Document,lib:PublishedLibrary,keys:Iterable<string>,collections:Iterable<string>,update=false) {
  const data=doc.variables ?? emptyVariables,source=lib.document.variables ?? emptyVariables,index=variableIndex(source);
  const vars=[...libraryVariableIds(source,keys)].sort(compareScalarKeys),colls=new Set(collections);
  for (const key of vars) colls.add(index.variables.get(key)!.collection);
  function plan<T extends {id:string}>(list:readonly T[],rows:readonly ImportedRecord[],assets:readonly {id:string;version:string}[],wanted:readonly string[]) {
    const taken=new Set(list.map(x=>x.id)),versions=new Map(assets.map(a=>[a.id,a.version]));
    const previous=new Map(rows.filter(r=>r.library===lib.manifest.id).map(r=>[r.key,r]));
    const map=new Map<string,string>(),pending=new Map<string,ImportedRecord>();
    for (const key of wanted) {
      const record=previous.get(key),exists=record && taken.has(record.local),version=versions.get(key) ?? lib.manifest.version;
      const local=exists ? record.local : localKey(lib.manifest.id,key,taken);
      map.set(key,local);taken.add(local);
      if (!exists || update && BigInt(version)>BigInt(record.version)) pending.set(key,{library:lib.manifest.id,key,local,version});
    }
    function write(make:(key:string,local:string)=>T) {
      if (!pending.size) return {list,rows};
      const items=new Map([...pending].map(([key,r])=>[r.local,make(key,r.local)]));
      const next=list.map(x=>{const replacement=items.get(x.id);items.delete(x.id);return replacement ?? x;});
      for (const value of items.values()) next.push(value);
      const remaining=new Map(pending);
      const records=rows.map(r=>{
        const replacement=r.library===lib.manifest.id && remaining.get(r.key);
        if (replacement) {remaining.delete(r.key);return replacement;}
        return r;
      });
      for (const r of remaining.values()) records.push(r);
      return {list:next,rows:records};
    }
    return {map,write};
  }
  const cp=plan(data.collections,doc.libraryRecords?.collections ?? [],lib.manifest.collections,[...colls].filter(k=>index.collections.has(k)).sort(compareScalarKeys));
  const vp=plan(data.variables,doc.libraryRecords?.variables ?? [],lib.manifest.variables,vars.filter(k=>cp.map.has(index.variables.get(k)!.collection)));
  const c=cp.write((key,id)=>{const {extends:parent,...record}=index.collections.get(key)!;return {...record,id};});
  const v=vp.write((key,id)=>{
    const {extends:parent,overrides,...record}=index.variables.get(key)!;
    const values:Record<string,VariableValue>=Object.create(null);
    for (const [mode,source] of Object.entries(record.values)) {
      const val=remapValue(source,vp.map);if (val) values[mode]=val;
    }
    return {...record,id,collection:cp.map.get(record.collection)!,values};
  });
  return {document:c.list===data.collections && v.list===data.variables ? doc : Object.freeze({...doc,variables:{collections:c.list,variables:v.list},
    libraryRecords:{collections:c.rows,variables:v.rows}}),variables:vp.map,collections:cp.map};
}
export function guardLibraryVariables(before:Document,after:Document) {
  const records=before.libraryRecords;
  if (!records || records!==after.libraryRecords || before.variables===after.variables) return;
  const a=variableIndex(before.variables ?? emptyVariables),b=variableIndex(after.variables ?? emptyVariables);
  for (const kind of ["collections","variables"] as const) for (const r of records[kind]) {
    if (!sameComponentValue(a[kind].get(r.local),b[kind].get(r.local))) throw Error(readOnlyLibraryMessage);
  }
  const collections=new Set(records.collections.map(r=>r.local)),variables=new Set(records.variables.map(r=>r.local));
  if (after.variables?.variables.some(v=>collections.has(v.collection) && !variables.has(v.id))) throw Error(readOnlyLibraryMessage);
}
export function editLibraryVariable(doc:Document,selection:readonly string[],lib:PublishedLibrary,cmd:string,p:Record<string,unknown>) {
  const src=lib.document.variables ?? emptyVariables,m=lib.manifest,rows=src.variables;
  const data=doc.variables ?? emptyVariables;
  if (cmd==="library.extendCollection" || cmd==="library.setVariableMode") {
    const key=parseString(p.collection),published=new Set(m.collections.filter(c=>c.published).map(c=>c.id));
    const colls=src.collections.filter(c=>published.has(c.id));
    const coll=colls.find(c=>c.id===key) ?? colls.find(c=>c.name===key);
    if (!coll) throw Error('"'+m.name+'" publishes no variable collection `'+key+'`');
    const seeds=cmd==="library.extendCollection" ? m.variables.filter(v=>v.collection===coll.id && v.published).map(v=>v.id) : [];
    const imported=importLibraryVariables(doc,lib,seeds,[coll.id]),id=imported.collections.get(coll.id)!;
    if (cmd==="library.extendCollection") {
      const next=editCollection(imported.document.variables!,"variable.extendCollection",{collection:id,name:p.name});
      return {document:{...imported.document,variables:next.data},result:next.result};
    }
    const name=parseString(p.mode),mode=coll.modes.find(x=>x.id===name) ?? coll.modes.find(x=>x.name===name);
    if (!mode) throw Error("no such mode");
    return {document:setVariableMode(imported.document,selection,{ids:p.ids,id:p.id,collection:id,mode:mode.id}),result:{collection:id}};
  }
  const alias=cmd==="library.aliasVariable",key=parseString(alias ? p.alias : p.variable);
  const published=new Set(m.variables.filter(v=>v.published).map(v=>v.id)),list=rows.filter(v=>published.has(v.id));
  const variable=list.find(v=>v.id===key) ?? list.find(v=>v.name===key);
  if (!variable) throw Error('"'+m.name+'" publishes no variable `'+key+'`');
  const imported=importLibraryVariables(doc,lib,[variable.id],[]),id=imported.variables.get(variable.id)!;
  let document=imported.document;
  if (alias) {
    const own=parseString(p.variable),v=data.variables.find(v=>v.id===own) ?? data.variables.find(v=>v.name===own);
    if (!v || doc.libraryRecords?.variables.some(r=>r.local===v.id)) throw Error('no local variable `'+own+'`');
    if (v.resolvedType!==variable.resolvedType) throw Error("the library variable has another type");
    const next=editVariableValue(document.variables!,"variable.set",{variable:v.id,mode:p.mode,value:{alias:id}});
    document={...document,variables:next.data};
  } else if (cmd==="library.bindVariable") document=bindLayerVariable(document,selection,{ids:p.ids,id:p.id,field:p.field,variable:id});
  return {document,result:{variable:id}};
}

export function pruneLibraryVariables(doc:Document,library:string):Document {
  const data=doc.variables,records=doc.libraryRecords;
  if (!data || !records) return doc;
  const imported=new Set(records.variables.map(r=>r.local)),seeds=new Set<string>(),usedCollections=new Set<string>();
  for (const node of Object.values(doc.nodes)) {
    for (const id of Object.values(node.boundVariables ?? {})) seeds.add(id);
    for (const id of Object.keys(node.variableModes ?? {})) usedCollections.add(id);
  }
  for (const v of data.variables) {
    if (v.extends!==undefined) seeds.add(v.extends);
    if (!imported.has(v.id)) for (const value of Object.values(v.values)) for (const ref of references(value)) seeds.add(ref);
  }
  const used=libraryVariableIds(data,seeds),gone=new Set(records.variables.filter(r=>r.library===library && !used.has(r.local)).map(r=>r.local));
  const variables=gone.size ? data.variables.filter(v=>!gone.has(v.id)) : data.variables;
  for (const v of variables) usedCollections.add(v.collection);
  for (const c of data.collections) if (c.extends!==undefined) usedCollections.add(c.extends);
  const unused=new Set(records.collections.filter(r=>r.library===library && !usedCollections.has(r.local)).map(r=>r.local));
  if (!gone.size && !unused.size) return doc;
  const collections=unused.size ? data.collections.filter(c=>!unused.has(c.id)) : data.collections;
  const remaining={variables:records.variables.filter(r=>!gone.has(r.local)),collections:records.collections.filter(r=>!unused.has(r.local))};
  const {variables:previous,libraryRecords:old,...rest}=doc;
  return Object.freeze({...rest,...((variables.length || collections.length) && {variables:{variables,collections}}),
    ...((remaining.variables.length || remaining.collections.length) && {libraryRecords:remaining})});
}
export function pendingVariables(doc:Document,lib:PublishedLibrary) {
  const m=lib.manifest,data=doc.variables ?? emptyVariables,records=doc.libraryRecords,index=variableIndex(data);
  const stale=(kind:"collections"|"variables")=>{
    const versions=new Map(m[kind].map(a=>[a.id,a.version]));
    return (records?.[kind] ?? []).filter(r=>r.library===m.id && index[kind].has(r.local) && BigInt(versions.get(r.key) ?? 0)>BigInt(r.version));
  };
  const variables=stale("variables"),parents=new Set(data.collections.map(c=>c.extends));
  const extended=new Set(records?.collections.filter(r=>r.library===m.id && parents.has(r.local)).map(r=>r.key));
  if (extended.size) {
    const copied=new Set(records?.variables.filter(r=>r.library===m.id && index.variables.has(r.local)).map(r=>r.key));
    for (const v of m.variables) if (v.published && extended.has(v.collection) && !copied.has(v.id))
      variables.push({library:m.id,key:v.id,local:"",version:"0"});
  }
  return {variables,collections:stale("collections")};
}
