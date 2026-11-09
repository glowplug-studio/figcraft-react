import type {Document} from "./document";
import {ancestors,subtreeIds} from "./hierarchy";
import {readOnlyLibraryMessage} from "./library-variables";

export interface ImportedComponent {
  readonly library:string;
  readonly key:string;
  readonly root:string;
  readonly version:string;
  readonly ids:Readonly<Record<string,string>>;
}
export interface ComponentCount {readonly library:string;readonly key:string;readonly count:number}
export interface LibraryStore {
  readonly root?:string;
  readonly components:readonly ImportedComponent[];
  readonly inserted:readonly ComponentCount[];
  readonly detached:readonly ComponentCount[];
}
const componentsByRoot=new WeakMap<readonly ImportedComponent[],ReadonlyMap<string,ImportedComponent>>();
export function libraryComponent(doc:Document,id:string) {
  const store=doc.libraryStore;
  if (!store?.root || !doc.nodes[id]) return;
  const chain=[id,...ancestors(doc,id)];
  if (chain.at(-1)!==store.root) return;
  const root=chain.reverse().find(key=>doc.nodes[key]?.kind==="component" || doc.nodes[key]?.kind==="componentSet");
  if (!root) return;
  let index=componentsByRoot.get(store.components);
  if (!index) {
    index=new Map(store.components.map(r=>[r.root,r]));
    componentsByRoot.set(store.components,index);
  }
  return index.get(root);
}
export function guardLibraryStore(before:Document,after:Document) {
  const root=before.libraryStore?.root;
  if (!root || before.nodes===after.nodes) return;
  // Every addition or move into the store changes the child list of an existing parent.
  for (const id of subtreeIds(before,root)) if (before.nodes[id]!==after.nodes[id]) throw Error(readOnlyLibraryMessage);
}

export function countLibraryInstances(doc:Document,roots:readonly string[],kind:"inserted"|"detached",before=doc):Document {
  const store=doc.libraryStore;
  if (!store?.components.length) return doc;
  const pending=[...roots],counts=[...store[kind]];
  let changed=false;
  while (pending.length) {
    const node=before.nodes[pending.pop()!];
    if (!node) continue;
    if (node.kind!=="instance") {
      if (kind==="inserted" && "children" in node) for (const child of node.children) pending.push(child);
      continue;
    }
    const record=libraryComponent(before,node.component);
    if (!record) continue;
    const at=counts.findIndex(c=>c.library===record.library && c.key===record.key);
    if (at>=0) counts[at]={...counts[at],count:Math.min(0xffffffff,counts[at].count+1)};
    else if (counts.length<1000) counts.push({library:record.library,key:record.key,count:1});
    else continue;
    changed=true;
  }
  return changed ? {...doc,libraryStore:{...store,[kind]:counts}} : doc;
}

export function pruneLibraryComponents(document:Document,library:string) {
  const store=document.libraryStore;
  if (!store?.root || !store.components.some(r=>r.library===library)) return document;
  let doc=document,components=store.components;
  while (components.some(r=>r.library===library)) {
    const used=new Set<string>();
    for (const node of Object.values(doc.nodes)) if (node.kind==="instance") {
      const parent=libraryComponent(doc,node.component);
      if (parent && !ancestors(doc,node.id).includes(parent.root)) used.add(parent.root);
    }
    const unused=new Set(components.filter(r=>r.library===library && !used.has(r.root)).map(r=>r.root));
    if (!unused.size) break;
    const nodes={...doc.nodes},page=nodes[store.root];
    if (page?.kind!=="page") throw Error("Missing library store");
    for (const id of unused) if (page.children.includes(id)) {
      for (const child of subtreeIds(doc,id)) delete nodes[child];
    }
    nodes[page.id]={...page,children:page.children.filter(id=>!unused.has(id))};
    components=components.filter(r=>r.library!==library || !unused.has(r.root));
    doc={...doc,nodes,libraryStore:{...store,components}};
  }
  return doc;
}
