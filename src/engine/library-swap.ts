import {isLosslessNumber} from "lossless-json";
import {swapInstance} from "./component-assets";
import {defaultMain,owningInstance} from "./component-tree";
import type {Document,DocumentNode,InstanceNode} from "./document";
import {HierarchyDraft,subtreeIds} from "./hierarchy";
import {componentRoot} from "./library-component-source";
import {importLibraryComponents} from "./library-components";
import {importLibraryStyles,pruneLibraryAssets,styleLinks} from "./library-styles";
import {importLibraryVariables,remapVariableReferences} from "./library-variables";
import {wireId} from "./native-values";
import {parseNodeId} from "./parameters";
import type {PublishedLibrary} from "./published-library";
import {withStyleRef,type StyleSlot} from "./shared-styles";
import {propagateStyle} from "./style-application";
import {styleForLayer} from "./style-variables";
import type {TextStyle} from "./text-style";
import {references} from "./variable-values";
import {emptyVariables,variableIndex,type Variables} from "./variables";

type IdMap=ReadonlyMap<string,string>;
function firstBy<T>(values:readonly T[],key:(v:T)=>string) {
  const entries=new Map<string,T>();
  for (const value of values) {
    const id=key(value);
    if (!entries.has(id)) entries.set(id,value);
  }
  return entries;
}
function importedIds(keys:IdMap,ids:IdMap) {
  const local=new Map<string,string>();
  for (const [old,key] of keys) {
    const id=ids.get(key);
    if (id) local.set(old,id);
  }
  return local;
}

function swapComponents(doc:Document,from:string,to:PublishedLibrary,outside:readonly DocumentNode[],nextId:bigint,unmatched:string[]) {
  const instances=outside.filter((n):n is InstanceNode=>n.kind==="instance" && !owningInstance(doc,n.id,false));
  const shown=new Set(instances.map(n=>componentRoot(doc,n.component)));
  const offered=firstBy(to.manifest.components.filter(c=>c.published),c=>c.name);
  const keys=new Map<string,string>();
  for (const r of doc.libraryStore?.components ?? []) if (r.library===from && shown.has(r.root)) {
    const name=doc.nodes[r.root].name,match=offered.get(name);
    if (match) keys.set(r.root,match.id); else unmatched.push("component "+name);
  }
  if (!keys.size) return {document:doc,nextId,count:0};
  const imported=importLibraryComponents(doc,to,[...keys.values()],nextId);
  const document=imported.document,roots=importedIds(keys,imported.ids),mains=new Map<string,string>();
  let count=0;
  for (const [old,id] of roots) {
    const source=doc.nodes[old],target=document.nodes[id],size=mains.size;
    const variants=target.kind==="componentSet" ? firstBy(target.children.map(i=>document.nodes[i]).filter(n=>n.kind==="component"),n=>n.name) : undefined;
    for (const key of source.kind==="componentSet" ? source.children : [old]) {
      const name=doc.nodes[key].name;
      const main=variants && key!==old ? variants.get(name) : defaultMain(document,id);
      if (main) mains.set(key,main.id);else unmatched.push("variant "+name);
    }
    if (mains.size>size) count++;
  }
  const draft=new HierarchyDraft(document);
  for (const n of instances) {
    const id=mains.get(n.component),main=id && document.nodes[id];
    if (!main || main.kind!=="component") continue;
    swapInstance(draft,n.id,main);
    const node=draft.nodes[n.id];
    if (node.kind!=="instance") continue;
    const props={...node.props};
    for (const [key,def] of Object.entries(main.props)) if (def.type==="instanceSwap") {
      const v=props[key],old=parseNodeId(isLosslessNumber(v) ? v.value : v);
      const target=old && (mains.get(old) ?? roots.get(old));
      if (target) props[key]=wireId(target);
    }
    draft.set({...node,props});
  }
  return {document:draft.finish(),nextId:imported.nextId,count};
}

function swapStyles(doc:Document,from:string,to:PublishedLibrary,linked:ReadonlySet<string>,unmatched:string[]) {
  const offered=firstBy(to.manifest.styles.filter(s=>s.published),s=>JSON.stringify([s.name,s.type]));
  const source=new Map(doc.styles?.map(s=>[s.id,s])),keys=new Map<string,string>();
  for (const r of doc.libraryRecords?.styles ?? []) if (r.library===from && linked.has(r.local)) {
    const style=source.get(r.local);
    if (!style) continue;
    const match=offered.get(JSON.stringify([style.name,style.type]));
    if (match) keys.set(r.local,match.id);else unmatched.push("style "+style.name);
  }
  const imported=importLibraryStyles(doc,to,keys.values());
  return {document:imported.document,ids:importedIds(keys,imported.styles)};
}

function swapVariables(doc:Document,from:string,to:PublishedLibrary,used:Set<string>,unmatched:string[]) {
  const data=doc.variables ?? emptyVariables,index=variableIndex(data),target=to.document.variables ?? emptyVariables;
  const records=doc.libraryRecords,remote=new Set(records?.variables.map(r=>r.local));
  const offeredCollections=new Set(to.manifest.collections.filter(c=>c.published).map(c=>c.id));
  const offeredVariables=new Set(to.manifest.variables.filter(v=>v.published).map(v=>v.id));
  const byName=firstBy(target.collections.filter(c=>offeredCollections.has(c.id)),c=>c.name);
  const offered=firstBy(target.variables.filter(v=>offeredVariables.has(v.id)),v=>JSON.stringify([v.collection,v.name,v.resolvedType]));
  for (const v of data.variables) if (!remote.has(v.id))
    for (const value of Object.values(v.values)) for (const id of references(value)) used.add(id);
  const keys=new Map<string,string>(),collections=new Map<string,string>(),sourceCollections=new Set<string>();
  for (const r of records?.collections ?? []) if (r.library===from) {
    sourceCollections.add(r.local);
    const c=index.collections.get(r.local),match=c && byName.get(c.name);
    if (match) collections.set(r.local,match.id);
  }
  for (const r of records?.variables ?? []) if (r.library===from && used.has(r.local)) {
    const v=index.variables.get(r.local);
    if (!v) continue;
    const name=index.collections.get(v.collection)?.name ?? "",c=byName.get(name);
    const match=c && offered.get(JSON.stringify([c.id,v.name,v.resolvedType]));
    if (match) keys.set(r.local,match.id);else unmatched.push("variable "+name+"/"+v.name);
  }
  const imports=importLibraryVariables(doc,to,keys.values(),collections.values());
  const ids=importedIds(keys,imports.variables),modes=new Map<string,{collection:string;ids:IdMap}>();
  const local=variableIndex(imports.document.variables ?? emptyVariables);
  for (const [old,id] of importedIds(collections,imports.collections)) {
    const a=index.collections.get(old),b=local.collections.get(id);
    if (!a || !b) continue;
    const names=firstBy(b.modes,m=>m.name),map=new Map<string,string>();
    for (const mode of a.modes) {
      const match=names.get(mode.name);
      if (match) map.set(mode.id,match.id);
    }
    modes.set(old,{collection:id,ids:map});
  }
  for (const c of data.collections) if (c.extends && sourceCollections.has(c.extends)) unmatched.push("extended collection "+c.name);
  return {document:imports.document,ids,modes,remote};
}

function repointLocalValues(data:Variables,ids:IdMap,remote:ReadonlySet<string>) {
  if (!ids.size) return data;
  let changed=false;
  const variables=data.variables.map(v=>{
    if (remote.has(v.id)) return v;
    const values={...v.values};
    let edited=false;
    for (const [mode,value] of Object.entries(values)) if (references(value).some(id=>ids.has(id))) {
      values[mode]=remapVariableReferences(value,id=>ids.get(id) ?? id);edited=true;
    }
    if (!edited) return v;
    changed=true;return {...v,values};
  });
  return changed ? {...data,variables} : data;
}

export function swapLibrary(before:Document,from:string,to:PublishedLibrary,nextId:bigint) {
  if (to.manifest.id===from) throw Error("`from` and `to` are the same library");
  const doc=pruneLibraryAssets(before,from),unmatched:string[]=[];
  const hidden=new Set(doc.libraryStore?.root ? subtreeIds(doc,doc.libraryStore.root) : []);
  const outside=Object.values(doc.nodes).filter(n=>!hidden.has(n.id));
  const components=swapComponents(doc,from,to,outside,nextId,unmatched);
  const linked=new Set<string>(),used=new Set<string>();
  for (const original of outside) {
    const node=components.document.nodes[original.id];
    for (const id of styleLinks(node)) linked.add(id);
    for (const id of Object.values(node.boundVariables ?? {})) used.add(id);
  }
  const styles=swapStyles(components.document,from,to,linked,unmatched);
  const vars=swapVariables(styles.document,from,to,used,unmatched);
  let document=vars.document;
  if (document.variables) {
    const data=repointLocalValues(document.variables,vars.ids,vars.remote);
    if (data!==document.variables) document={...document,variables:data};
  }
  const definitions=new Map(document.styles?.map(s=>[s.id,s]));
  const draft=new HierarchyDraft(document);
  const textStyle=(s:TextStyle)=>s.styleId && styles.ids.has(s.styleId) ? {...s,styleId:styles.ids.get(s.styleId)} : s;
  for (const original of outside) {
    const node=draft.nodes[original.id];
    let next=node;
    if (node.boundVariables && Object.values(node.boundVariables).some(id=>vars.ids.has(id)))
      next={...next,boundVariables:Object.fromEntries(Object.entries(node.boundVariables).map(([k,id])=>[k,vars.ids.get(id) ?? id]))};
    if (node.variableModes && Object.keys(node.variableModes).some(k=>vars.modes.has(k)))
      next={...next,variableModes:Object.fromEntries(Object.entries(node.variableModes).map(([k,id])=>{
        const group=vars.modes.get(k),mode=group?.ids.get(id);
        return mode && group ? [group.collection,mode] : [k,id];
      }))};
    const replaced=new Set<string>();
    for (const key of styleLinks(node)) {
      const id=styles.ids.get(key);
      if (id) replaced.add(id);
    }
    if (replaced.size) {
      for (const [slot,key] of Object.entries(node.styles ?? {})) if (key && styles.ids.has(key))
        next=withStyleRef(next,slot as StyleSlot,styles.ids.get(key)!);
      if (next.kind==="text") next={...next,text:{...next.text,style:textStyle(next.text.style),runs:next.text.runs.map(r=>({...r,style:textStyle(r.style)}))}};
      draft.set(next);
      for (const id of replaced) next=propagateStyle(next,id,styleForLayer(draft.document,definitions.get(id),next.id));
    }
    if (next!==node) draft.set(next);
  }
  document=pruneLibraryAssets(draft.finish(),from);
  const remaining=document.libraryRecords;
  const removed=![document.libraryStore?.components,remaining?.styles,remaining?.variables,remaining?.collections].some(rows=>rows?.some(r=>r.library===from));
  if (removed) document={...document,libraryLinks:document.libraryLinks?.filter(l=>l.id!==from)};
  return {document,nextId:components.nextId,result:{components:components.count,styles:styles.ids.size,variables:vars.ids.size,unmatched,removed}};
}
