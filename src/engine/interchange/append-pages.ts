import { isLeaf, newDocument, type Document, type DocumentNode, type LayerNode, type PageNode } from "../document";
import { subtreeIds } from "../hierarchy";
import { localiseComponent } from "../library-components";
import type { ImportedComponent } from "../library-store";
import { U64_MAX } from "../native-values";
import { remapPatternSources } from "../pattern-sources";
import type { ImportedRecord } from "../published-library";
import { appendedAssets } from "./append-assets";

function appendMissing<T>(existing:readonly T[],incoming:readonly T[],key:(item:T)=>string) {
  const seen=new Set(existing.map(key)), result=[...existing];
  for (const item of incoming) if (!seen.has(key(item))) {result.push(item);seen.add(key(item));}
  return result;
}
const recordKey=(r:{library:string;key:string})=>JSON.stringify([r.library,r.key]);

export function appendPages(doc:Document,other:Document,nextId:bigint,client=0) {
  const nodes:Record<string,DocumentNode>={...doc.nodes}, ids=new Map<string,string>();
  const store=doc.libraryStore ?? {root:undefined,components:[],inserted:[],detached:[]};
  const sourceStore=other.libraryStore,components=[...store.components],fresh:ImportedComponent[]=[];
  const storePage=sourceStore?.root && other.nodes[sourceStore.root];
  const recorded=new Set(sourceStore?.components.map(r=>r.root));
  const cached=storePage && storePage.kind==="page" ? storePage.children.filter(id=>!recorded.has(id)) : [];
  function allocate(minimum=0n) {
    if (minimum>nextId) nextId=minimum;
    while (Object.hasOwn(nodes,String(nextId))) nextId++;
    if (nextId>U64_MAX || client && nextId>>32n!==BigInt(client)) throw new Error("Document identifiers are exhausted");
    return nextId++;
  }
  const assets=appendedAssets(doc,other,client,allocate);
  const assign=(old:string)=>{const id=String(allocate());ids.set(old,id);return id;};
  const visibleRoots=other.pages.flatMap(id=>(other.nodes[id] as PageNode).children);
  const trees=new Map<string,readonly string[]>();
  function reserve(root:string) {
    const layers=subtreeIds(other,root);
    for (const id of layers) assign(id);
    trees.set(root,layers);
  }
  for (const root of visibleRoots) reserve(root);
  for (const root of cached) reserve(root);
  const pages=other.pages.map(assign);
  let targetStore=store.root;
  if (cached.length) targetStore??=String(allocate());
  const known=new Map(components.filter(r=>nodes[r.root]).map(r=>[recordKey(r),r]));
  for (const r of sourceStore?.components ?? []) {
    if (!other.nodes[r.root]) continue;
    const dest=known.get(recordKey(r));
    if (!dest) {reserve(r.root);fresh.push(r);continue;}
    for (const [author,local] of Object.entries(r.ids)) if (dest.ids[author]) ids.set(local,dest.ids[author]);
  }
  if (fresh.length) targetStore??=String(allocate());

  function copyTree(root:string,parent:string,library=false) {
    for (const old of trees.get(root)!) {
      const node=other.nodes[old];
      if (node.kind==="page") throw new Error("A layer cannot contain a page");
      let copy=assets.apply(node);
      if (library) copy=localiseComponent(other,copy,ids);
      else if (node.kind==="instance" && copy.kind==="instance" && ids.has(node.component)) copy={...copy,component:ids.get(node.component)!};
      const layer:LayerNode={...copy,id:ids.get(old)!,parent:old===root ? parent : ids.get(node.parent)!,
        ...(!isLeaf(node) && {children:node.children.map(id=>ids.get(id)!)}),
        ...(node.source && ids.has(node.source) && {source:ids.get(node.source)})};
      nodes[layer.id]=remapPatternSources(layer,id=>ids.get(id));
    }
  }
  for (const id of other.pages) {
    const p=other.nodes[id] as PageNode, target=ids.get(id)!;
    nodes[target]={id:target,kind:"page",name:p.name,parent:null,children:p.children.map(ch=>ids.get(ch)!),background:p.background,
      ...(p.backgroundColor && {backgroundColor:p.backgroundColor}),...(p.prototypeBackground && {prototypeBackground:p.prototypeBackground})};
    for (const root of p.children) copyTree(root,target);
  }
  if (targetStore && (cached.length || fresh.length)) {
    const base=nodes[targetStore] as PageNode|undefined ?? {...newDocument().nodes["1"] as PageNode,id:targetStore,name:"Library components"};
    const added=[...cached,...fresh.map(r=>r.root)];
    nodes[targetStore]={...base,children:[...base.children,...added.map(id=>ids.get(id)!)]};
    for (const root of cached) copyTree(root,targetStore);
    for (const r of fresh) {
      copyTree(r.root,targetStore,true);
      const local=Object.fromEntries(Object.entries(r.ids).flatMap(([k,id])=>ids.has(id) ? [[k,ids.get(id)!]] : []));
      components.push({...r,root:ids.get(r.root)!,ids:local});
    }
  }
  const records=(kind:"styles"|"collections"|"variables",items:readonly {id:string}[])=>{
    const valid=new Set(items.map(item=>item.id));
    return appendMissing<ImportedRecord>(doc.libraryRecords?.[kind] ?? [],other.libraryRecords?.[kind]?.filter(r=>valid.has(r.local)) ?? [],recordKey);
  };
  const styles=records("styles",assets.styles),collections=records("collections",assets.variables.collections),variables=records("variables",assets.variables.variables);
  const links=appendMissing(doc.libraryLinks ?? [],other.libraryLinks ?? [],link=>link.id);
  const result:Document={...doc,nodes:Object.freeze(nodes),pages:[...doc.pages,...pages],
    ...((doc.images || other.images) && {images:{...other.images,...doc.images}}),
    ...(links.length && {libraryLinks:links}),...(targetStore && {libraryStore:{...store,root:targetStore,components}}),
    ...((styles.length || variables.length || collections.length) && {libraryRecords:{styles,collections,variables}}),
    ...(assets.styles.length && {styles:assets.styles}),
    ...((assets.variables.collections.length || assets.variables.variables.length) && {variables:assets.variables})};
  return {document:result,nextId:nextId>U64_MAX ? U64_MAX : nextId,pages};
}
