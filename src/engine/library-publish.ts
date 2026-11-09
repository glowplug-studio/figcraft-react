import {isLosslessNumber} from "lossless-json";
import {sameComponentValue} from "./component-groups";
import {newDocument,withLayerTransform,layerTransform,type Document,type DocumentNode} from "./document";
import {ancestors,subtreeIds,worldTransform} from "./hierarchy";
import {U64_MAX} from "./native-values";
import {parseNodeId,inspectedId,parseString} from "./parameters";
import {libraryImageKeys,type LibraryManifest,type PublishedLibrary} from "./published-library";
import {libraryVariableIds} from "./library-variables";
import {emptyVariables} from "./variables";

const kinds=["components","styles","collections"] as const;
type Kind=typeof kinds[number];
type Selection=Record<Kind,string[]>;
const blank=():Selection=>({components:[],styles:[],collections:[]});
const order=(a:string,b:string)=>a.length-b.length || (a<b ? -1 : a>b ? 1 : 0);
const asset=(n:DocumentNode | undefined)=>n?.kind==="component" || n?.kind==="componentSet";
function byId<T extends {id:string}>(rows:readonly T[] | undefined) {
  const map=new Map<string,T>();
  for (const row of rows ?? []) if (!map.has(row.id)) map.set(row.id,row);
  return map;
}
export function publishChoices(doc:Document) {
  const previous=doc.published?.manifest;
  const choices=(kind:Kind,assets:readonly {id:string;name:string}[])=>{
    const old=byId(previous?.[kind]);
    return assets.map(({id,name})=>{
      const last=old.get(id);
      return {id,name,selected:!(/^[._]/.test(name)) && (!last || last.published || /^[._]/.test(last.name))};
    });
  };
  const components=Object.values(doc.nodes).filter(n=>asset(n) && !ancestors(doc,n.id).some(id=>asset(doc.nodes[id]) || doc.nodes[id].kind==="instance"))
    .sort((a,b)=>order(a.id,b.id));
  const remote=new Set(doc.libraryRecords?.collections.map(r=>r.local));
  return {components:choices("components",components),styles:choices("styles",doc.styles ?? []),collections:choices("collections",doc.variables?.collections.filter(c=>!remote.has(c.id)) ?? [])};
}
function selection(doc:Document,p:Record<string,unknown>) {
  const all=publishChoices(doc), byKey={components:byId(all.components),styles:byId(all.styles),collections:byId(all.collections)};
  const names=new Map<string,{kind:Kind;id:string}[]>();
  for (const kind of kinds) for (const {name,id} of all[kind]) {
    const group=names.get(name);
    if (group) group.push({kind,id}); else names.set(name,[{kind,id}]);
  }
  function pick(key:string) {
    const selected=blank(),values=p[key];
    if (!Array.isArray(values)) throw Error(key+" must be an array of component ids and style or variable collection ids or names");
    for (const value of values) {
      const text=typeof value==="string" ? value.trim() : undefined;
      const node=parseNodeId(value);
      if (text!==undefined && byKey.styles.has(text)) selected.styles.push(text);
      else if (text!==undefined && byKey.collections.has(text)) selected.collections.push(text);
      else if (node!==undefined && byKey.components.has(node)) selected.components.push(node);
      else if (text!==undefined && names.has(text)) for (const {kind,id} of names.get(text)!) selected[kind].push(id);
      else throw Error(JSON.stringify(value)+" is not a local component, component set, style or variable collection of this file");
    }
    return selected;
  }
  const selected=Object.hasOwn(p,"include") ? pick("include") : blank();
  if (!Object.hasOwn(p,"include")) for (const kind of kinds) selected[kind]=all[kind].filter(a=>a.selected).map(a=>a.id);
  if (Object.hasOwn(p,"exclude")) {
    const excluded=pick("exclude");
    for (const kind of kinds) {const keys=new Set(excluded[kind]);selected[kind]=selected[kind].filter(id=>!keys.has(id));}
  }
  return selected;
}
function componentDependencies(doc:Document,ids:readonly string[]) {
  const needed=new Set<string>();
  for (const id of ids) {
    const n=doc.nodes[id];
    if (n.kind==="component") for (const prop of Object.values(n.props)) {
      if (prop.type==="instanceSwap") needed.add(prop.default);
      if (prop.type==="instanceSwap" || prop.type==="slot") for (const other of prop.preferred) needed.add(other);
    }
    if (n.kind==="instance") {
      needed.add(n.component);
      const main=doc.nodes[n.component];
      if (main?.kind==="component") for (const [key,prop] of Object.entries(main.props)) if (prop.type==="instanceSwap") {
        const v=n.props[key],target=parseNodeId(isLosslessNumber(v) ? v.value : v);
        if (target) needed.add(target);
      }
    }
  }
  return [...needed].sort(order);
}
function buildSnapshot(doc:Document,sel:Selection) {
  const stack=sel.components.slice().reverse(),units=new Map<string,readonly string[]>(),nodes:Record<string,DocumentNode>=Object.create(null);
  const styles=new Set(sel.styles),colls=new Set(sel.collections),bound=new Set<string>();
  let max=1n;
  while (stack.length && units.size<100_000) {
    const root=stack.pop()!;
    if (units.has(root)) continue;
    const ids=subtreeIds(doc,root);
    units.set(root,ids);
    for (const id of ids) {
      const n=doc.nodes[id];nodes[id]=n;
      const numeric=BigInt(id);if (numeric>max) max=numeric;
      for (const link of Object.values(n.styles ?? {})) if (link) styles.add(link);
      if (n.kind==="text") {
        if (n.text.style.styleId) styles.add(n.text.style.styleId);
        for (const r of n.text.runs) if (r.style.styleId) styles.add(r.style.styleId);
      }
      for (const v of Object.values(n.boundVariables ?? {})) bound.add(v);
      for (const c of Object.keys(n.variableModes ?? {})) colls.add(c);
    }
    for (const dep of componentDependencies(doc,ids)) {
      if (!doc.nodes[dep]) continue;
      const owner=[dep,...ancestors(doc,dep)].filter(id=>asset(doc.nodes[id])).at(-1);
      if (owner && !units.has(owner)) stack.push(owner);
    }
  }
  if (max===U64_MAX) throw Error("No node id is available for the library page");
  const page=String(max+1n),base=newDocument(doc.name),roots=[...units.keys()];
  nodes[page]={...base.nodes["1"],id:page,name:"Library",children:roots} as DocumentNode;
  for (const root of roots) {
    const node=nodes[root];
    if (node.kind!=="page") nodes[root]=withLayerTransform({...node,parent:page},worldTransform(doc,root));
  }
  const data=doc.variables ?? emptyVariables,offeredCollections=new Set(sel.collections);
  const offered=new Set(data.variables.filter(v=>offeredCollections.has(v.collection) && !v.hiddenFromPublishing).map(v=>v.id));
  const vars=libraryVariableIds(data,[...offered,...bound]);
  const variables=data.variables.filter(v=>vars.has(v.id));
  for (const v of variables) colls.add(v.collection);
  const collections=data.collections.filter(c=>colls.has(c.id));
  const snap={name:doc.name,nodes:Object.freeze(nodes),pages:[page],currentPage:page,
    styles:doc.styles?.filter(s=>styles.has(s.id)),variables:{variables,collections}} satisfies Document;
  const images=Object.fromEntries([...libraryImageKeys(snap)].filter(k=>doc.images && Object.hasOwn(doc.images,k)).map(k=>[k,doc.images![k]]));
  return {document:Object.freeze({...snap,...(Object.keys(images).length && {images})}),units,offered,offeredCollections,nextId:String(max>=U64_MAX-1n ? U64_MAX : max+2n)};
}
function sameAsset(previous:Document,next:Document,root:string,ids:readonly string[]) {
  const old=previous.nodes[root],node=next.nodes[root];
  if (!old || old.kind==="page" || node.kind==="page") return false;
  const aligned=withLayerTransform({...old,parent:node.parent},layerTransform(node));
  return sameComponentValue(aligned,node) && ids.every(id=>id===root || sameComponentValue(previous.nodes[id],next.nodes[id]));
}
export function publishLibrary(doc:Document,p:Record<string,unknown>) {
  const sel=selection(doc,p),previous=doc.published;
  if (!kinds.some(k=>sel[k].length)) throw Error("nothing to publish: the file has no components, styles or variables to offer");
  const {document,units,offered,offeredCollections,nextId}=buildSnapshot(doc,sel);
  const old=previous?.manifest,last=BigInt(old?.version ?? 0),version=String(last===U64_MAX ? last : last+1n);
  const componentsChosen=new Set(sel.components),stylesChosen=new Set(sel.styles);
  const oldComponents=byId(old?.components);
  const components=[...units].map(([id,ids])=>{
    const n=document.nodes[id],before=oldComponents.get(id);
    return {id,name:n.name,set:n.kind==="componentSet",published:componentsChosen.has(id),
      version:before && previous && sameAsset(previous.document,document,id,ids) ? before.version : version};
  });
  function stamp<T extends {id:string}>(rows:readonly T[] | undefined,assets:readonly {id:string;version:string}[] | undefined) {
    const prior=byId(rows),manifest=byId(assets);
    return (row:T)=>sameComponentValue(row,prior.get(row.id)) ? manifest.get(row.id)?.version ?? version : version;
  }
  const styleVersion=stamp(previous?.document.styles,old?.styles),collVersion=stamp(previous?.document.variables?.collections,old?.collections),
    varVersion=stamp(previous?.document.variables?.variables,old?.variables);
  const description=parseString(p.description)?.trim();
  const manifest:LibraryManifest={id:old?.id ?? crypto.randomUUID().replaceAll("-","").slice(0,16),name:doc.name,version,time:String(Math.floor(Date.now()/1000)),
    description:description===undefined ? old?.description ?? "" : Array.from(description).slice(0,2000).join(""),components,
    styles:(document.styles ?? []).map(s=>({id:s.id,name:s.name,type:s.type,version:styleVersion(s),published:stylesChosen.has(s.id)})),
    collections:document.variables.collections.map(c=>({id:c.id,name:c.name,version:collVersion(c),published:offeredCollections.has(c.id)})),
    variables:document.variables.variables.map(v=>({id:v.id,name:v.name,type:v.resolvedType,collection:v.collection,version:varVersion(v),published:offered.has(v.id)}))};
  if (old && sameComponentValue(old,{...manifest,version:old.version,time:old.time})) throw Error("no changes to publish since version "+old.version);
  const published:PublishedLibrary=Object.freeze({document,manifest,nextId});
  return {document:Object.freeze({...doc,published}),result:{id:manifest.id,version:inspectedId(version),components:sel.components.length,
    styles:sel.styles.length,collections:sel.collections.length,variables:manifest.variables.filter(v=>v.published).length}};
}
export function publishedSummary(lib:PublishedLibrary,withAssets:boolean) {
  const m=lib.manifest,colls=byId(lib.document.variables?.collections);
  const common=(a:{id:string;name:string;version:string})=>({id:a.id,name:a.name,version:inspectedId(a.version)});
  const components=m.components.filter(c=>c.published),styles=m.styles.filter(s=>s.published),
    collections=m.collections.filter(c=>c.published),variables=m.variables.filter(v=>v.published);
  const assets=withAssets ? {
    components:components.map(c=>({...common(c),id:inspectedId(c.id),set:c.set})),styles:styles.map(s=>({...common(s),type:s.type})),
    collections:collections.map(c=>({...common(c),modes:colls.get(c.id)?.modes ?? null})),
    variables:variables.map(v=>({...common(v),type:v.type,collection:v.collection}))} : undefined;
  return {id:m.id,name:m.name,version:inspectedId(m.version),description:m.description,time:inspectedId(m.time),
    components:components.length,styles:styles.length,collections:collections.length,variables:variables.length,...(assets && {assets})};
}
export function listLibraries(doc:Document,withAssets:boolean) {
  const choices=withAssets ? publishChoices(doc) : undefined;
  return {libraries:[],published:doc.published ? publishedSummary(doc.published,withAssets) : null,
    ...(choices && {publishable:{...choices,components:choices.components.map(c=>({...c,id:inspectedId(c.id)}))}})};
}
