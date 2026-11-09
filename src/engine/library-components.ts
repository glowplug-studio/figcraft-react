import {isLosslessNumber} from "lossless-json";
import {isLeaf,newDocument,type Document,type DocumentNode,type LayerNode,type PageNode} from "./document";
import {subtreeIds} from "./hierarchy";
import {collectNodeAssets,componentRoot,libraryComponentUnits} from "./library-component-source";
import {importLibraryStyles} from "./library-styles";
import type {ImportedComponent,LibraryStore} from "./library-store";
import {importLibraryVariables} from "./library-variables";
import {U64_MAX,wireId} from "./native-values";
import {parseNodeId} from "./parameters";
import {remapPatternSources} from "./pattern-sources";
import {libraryImageKeys,type PublishedLibrary} from "./published-library";
import type {StyleRefs} from "./shared-styles";
import type {TextStyle} from "./text-style";

type IdMap=ReadonlyMap<string,string>;

function localiseComponent(source:Document,node:LayerNode,ids:IdMap):LayerNode {
  switch (node.kind) {
    case "instance": {
      const {component,props,...frame}=node,main=source.nodes[component],local=ids.get(component);
      if (!local) return {...frame,kind:"frame"};
      const values={...props};
      if (main?.kind==="component") for (const [key,def] of Object.entries(main.props)) if (def.type==="instanceSwap" && Object.hasOwn(values,key)) {
        const value=values[key],id=parseNodeId(isLosslessNumber(value) ? value.value : value);
        const mapped=id && ids.get(id);
        if (mapped) values[key]=wireId(mapped);else delete values[key];
      }
      return {...node,component:local,props:values};
    }
    case "component": {
      const props={...node.props};
      for (const [key,prop] of Object.entries(props)) {
        if (prop.type!=="instanceSwap" && prop.type!=="slot") continue;
        const preferred=prop.preferred.flatMap(id=>ids.get(id) ?? []);
        if (prop.type==="slot") props[key]={...prop,preferred};
        else {
          const target=ids.get(prop.default);
          if (target) props[key]={...prop,default:target,preferred};else delete props[key];
        }
      }
      return {...node,props};
    }
    default:return node;
  }
}

function localiseNode(source:Document,node:LayerNode,parent:string,ids:IdMap,styles:IdMap,variables:IdMap,collections:IdMap):LayerNode {
  const main=localiseComponent(source,node,ids);
  const {boundVariables,variableModes,source:mirror,styles:links,...base}=main;
  const bound=Object.fromEntries(Object.entries(boundVariables ?? {}).flatMap(([key,remote])=>variables.has(remote) ? [[key,variables.get(remote)!]] : []));
  const modes=Object.fromEntries(Object.entries(variableModes ?? {}).flatMap(([key,mode])=>collections.has(key) ? [[collections.get(key)!,mode]] : []));
  const refs=links && Object.fromEntries(Object.entries(links).map(([slot,key])=>[slot,key && styles.get(key) || null])) as StyleRefs|undefined;
  let copy:LayerNode={...base,parent,id:ids.get(node.id)!,...(!isLeaf(node) && {children:node.children.map(id=>ids.get(id)!)}),
    ...(mirror && ids.has(mirror) && {source:ids.get(mirror)}),...(Object.keys(bound).length && {boundVariables:bound}),
    ...(Object.keys(modes).length && {variableModes:modes}),...(refs && Object.values(refs).some(Boolean) && {styles:refs})};
  if (copy.kind==="text") {
    const localStyle=(s:TextStyle)=>{
      if (s.styleId===undefined) return s;
      const {styleId,...base}=s,local=styles.get(styleId);
      return local ? {...base,styleId:local} : base;
    };
    copy={...copy,text:{...copy.text,style:localStyle(copy.text.style),runs:copy.text.runs.map(run=>({...run,style:localStyle(run.style)}))}};
  }
  return remapPatternSources(copy,id=>ids.get(id));
}

export function importLibraryComponents(doc:Document,lib:PublishedLibrary,keys:readonly string[],nextId:bigint,update=false) {
  const src=lib.document,roots=keys.flatMap(id=>componentRoot(src,id) ?? []);
  if (!roots.length) throw Error("no such component in the library");
  const units=libraryComponentUnits(src,roots),m=lib.manifest;
  const prior=doc.libraryStore ?? {components:[],inserted:[],detached:[]} as LibraryStore;
  const records=new Map(prior.components.filter(r=>r.library===m.id && doc.nodes[r.root]).map(r=>[r.key,r]));
  const versions=new Map(m.components.map(c=>[c.id,c.version])),ids=new Map<string,string>();
  const used=new Set<string>();
  function allocate() {
    while (nextId<=U64_MAX && (doc.nodes[String(nextId)] || used.has(String(nextId)))) nextId++;
    if (nextId>U64_MAX) throw Error("Document identifiers are exhausted");
    const id=String(nextId);
    if (nextId<U64_MAX) nextId++;
    used.add(id);return id;
  }
  const store=prior.root ?? allocate(),write=new Map<string,readonly string[]>();
  for (const [root,sub] of units) {
    const old=records.get(root);
    if (!old || update && BigInt(versions.get(root) ?? m.version)>BigInt(old.version)) write.set(root,sub);
    else for (const [key,id] of Object.entries(old.ids)) {ids.set(key,id);used.add(id);}
  }
  if (!write.size) return {document:doc,ids,nextId};
  const removed=new Set<string>(),replace=new Map<string,ImportedComponent>();
  const linked=new Set<string>(),bound=new Set<string>(),modes=new Set<string>();
  const sourceNodes:Record<string,DocumentNode>=Object.create(null);
  for (const [root,sub] of write) {
    const old=records.get(root),previous=new Set(old ? subtreeIds(doc,old.root) : []);
    for (const local of previous) removed.add(local);
    const mapping:Record<string,string>=Object.create(null);
    for (const key of sub) {
      const reuse=old?.ids[key];
      const id=reuse && !used.has(reuse) && (previous.has(reuse) || !doc.nodes[reuse]) ? reuse : allocate();
      used.add(id);ids.set(key,id);mapping[key]=id;
      sourceNodes[key]=src.nodes[key];collectNodeAssets(src.nodes[key],linked,bound,modes);
    }
    replace.set(root,{library:m.id,key:root,root:ids.get(root)!,version:versions.get(root) ?? m.version,ids:mapping});
  }
  const styles=importLibraryStyles(doc,lib,linked,update);
  const vars=importLibraryVariables(styles.document,lib,bound,modes,update);
  const nodes={...vars.document.nodes};
  for (const id of removed) delete nodes[id];
  const page=prior.root ? nodes[store] as PageNode : {...newDocument().nodes["1"] as PageNode,id:store,name:"Library components"};
  nodes[store]={...page,children:[...page.children.filter(id=>!removed.has(id)),...[...replace.values()].map(r=>r.root)]};
  for (const [root,sub] of write) for (const key of sub) {
    const node=src.nodes[key];
    if (node.kind==="page") throw Error("library component contains a page");
    const layer=localiseNode(src,node,key===root ? store : ids.get(node.parent)!,ids,styles.styles,vars.variables,vars.collections);
    nodes[layer.id]=layer;
  }
  const components=prior.components.map(r=>{
    const replacement=r.library===m.id && replace.get(r.key);
    if (!replacement) return r;
    replace.delete(r.key);return replacement;
  });
  components.push(...replace.values());
  const images=Object.fromEntries([...libraryImageKeys({...src,nodes:sourceNodes,styles:[]})]
    .filter(key=>!vars.document.images?.[key] && src.images?.[key]).map(key=>[key,src.images![key]]));
  const document:Document={...vars.document,nodes,libraryStore:{...prior,root:store,components},
    ...(Object.keys(images).length && {images:{...vars.document.images,...images}})};
  return {document,ids,nextId};
}
