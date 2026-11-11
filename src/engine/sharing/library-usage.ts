import type {Document} from "../document";
import {libraryComponent} from "../library-store";
import {styleLinks} from "../library-styles";
import {compareScalarKeys} from "../text-breaks";
import {cleanOnlineName} from "./publication";

export type LibraryCounts = readonly (readonly [string,number])[];
export interface LibraryUsageReport {
  file:string;
  components:LibraryCounts;
  inserted?:LibraryCounts;
  detached?:LibraryCounts;
  styles?:LibraryCounts;
  variables?:LibraryCounts;
}
export interface LibraryUsageData {
  files: {file:string; updated:number; components:LibraryCounts; detached:LibraryCounts; styles:LibraryCounts; variables:LibraryCounts}[];
  weeks: {week:number;component:string;insertions:number;detachments:number}[];
}

const utf8=new TextEncoder();
const numericIds=(a:string,b:string)=>a.length-b.length || compareScalarKeys(a,b);
const bump=(map:Map<string,number>,id:string)=>map.set(id,Math.min(0xffffffff,(map.get(id) ?? 0)+1));
function topAssets(counts:Map<string,number>) {
  return [...counts].sort(([a,n],[b,m])=>m-n || compareScalarKeys(a,b)).slice(0,250);
}

/** Count live document uses, excluding the private library store and component-owned style links. */
export function libraryUsageReport(doc: Document, library: string): LibraryUsageReport {
  const components=new Map<string,number>(),styles=new Map<string,number>(),variables=new Map<string,number>();
  const styleKeys=new Map(doc.libraryRecords?.styles?.filter(r=>r.library===library).map(r=>[r.local,r.key]));
  const variableKeys=new Map(doc.libraryRecords?.variables.filter(r=>r.library===library).map(r=>[r.local,r.key]));
  const withAssets=styleKeys.size+variableKeys.size>0, store=doc.libraryStore;
  const withComponents=store?.components.some(record=>record.library===library);
  const roots=new Map<string,ReturnType<typeof libraryComponent>>();
  const pending=withAssets || withComponents ? doc.pages.filter(id=>id!==store?.root).map(id=>({id,insideInstance:false})) : [];
  while (pending.length) {
    const {id,insideInstance}=pending.pop()!;
    const node=doc.nodes[id];
    if (!node) continue;
    if ("children" in node) for (const child of node.children) pending.push({id:child,insideInstance:insideInstance || node.kind==="instance"});
    if (node.kind==="instance") {
      if (!roots.has(node.component)) roots.set(node.component,libraryComponent(doc,node.component));
      const record=roots.get(node.component);
      if (record?.library===library) bump(components,record.key);
    } else if (withAssets && !insideInstance) {
      const foundStyles=new Set<string>(),foundVariables=new Set<string>();
      for (const key of styleLinks(node)) {const remote=styleKeys.get(key);if (remote) foundStyles.add(remote);}
      for (const key of Object.values(node.boundVariables ?? {})) {const remote=variableKeys.get(key);if (remote) foundVariables.add(remote);}
      for (const id of foundStyles) bump(styles,id);
      for (const id of foundVariables) bump(variables,id);
    }
  }
  const counts=(kind:"inserted"|"detached")=>store?.[kind].filter(c=>c.library===library && c.count>0)
    .slice(0,10000).map(c=>[c.key,c.count] as const);
  const inserted=counts("inserted"),detached=counts("detached");
  return {file:doc.name,components:[...components].sort(([a],[b])=>numericIds(a,b)).slice(0,10000),
    ...(inserted?.length && {inserted}),...(detached?.length && {detached}),
    ...(withAssets && {styles:topAssets(styles),variables:topAssets(variables)})};
}

/** Rust cleaned sorts tuples, keeps the least positive count per key, then truncates. */
function readCounts(value:unknown, assets:boolean):LibraryCounts {
  if (!Array.isArray(value) || value.length>10000) throw new Error("Invalid library report");
  const counts=new Map<string,number>();
  let considered=0;
  for (const pair of value) {
    if (!Array.isArray(pair) || pair.length!==2 || typeof pair[0]!=="string" || !Number.isInteger(pair[1]) ||
      pair[1]<0 || pair[1]>0xffffffff) throw new Error("Invalid library count");
    const [id,n]=pair;
    if (assets) {
      if (utf8.encode(id).length>64) continue;
      if (++considered>250) break;
    } else if (!/^(0|[1-9][0-9]{0,19})$/.test(id) || BigInt(id)>18446744073709551615n) throw new Error("Invalid component ID");
    if (n===0) continue;
    if (!assets && ++considered>4000) break;
    counts.set(id,Math.min(n,counts.get(id) ?? n));
  }
  return [...counts].sort(([a],[b])=>assets ? compareScalarKeys(a,b) : numericIds(a,b)).slice(0,1000);
}
export function readLibraryUsageReport(value:unknown):LibraryUsageReport {
  if (!value || typeof value!=="object" || !("file" in value) || typeof value.file!=="string" || !("components" in value)) {
    throw new Error("Invalid library report");
  }
  return {file:cleanOnlineName(value.file),components:readCounts(value.components,false),
    ...("inserted" in value && {inserted:readCounts(value.inserted,false)}),
    ...("detached" in value && {detached:readCounts(value.detached,false)}),
    ...("styles" in value && {styles:readCounts(value.styles,true)}),
    ...("variables" in value && {variables:readCounts(value.variables,true)})};
}

/** Usage is current across files. Action totals count only the weeks overlapping the chosen period. */
export function summariseLibraryUsage(data:LibraryUsageData, maxAssetRows=Infinity) {
  type Totals={id:string;instances:number;files:number;detached:number;insertions:number;detachments:number};
  const components=new Map<string,Totals>(), weeks=new Map<number,{week:number;insertions:number;detachments:number}>();
  const get=(id:string)=>{
    let row=components.get(id);
    if (!row) {row={id,instances:0,files:0,detached:0,insertions:0,detachments:0};components.set(id,row);}
    return row;
  };
  const files=data.files.filter(f=>f.updated>0).map(f=>{
    let instances=0;
    for (const [id,count] of f.components) {const c=get(id);c.instances+=count;c.files++;instances+=count;}
    return {name:f.file,updated:f.updated,instances,detached:f.detached.reduce((sum,[,n])=>sum+n,0)};
  });
  for (const f of data.files) for (const [id,count] of f.detached) get(id).detached+=count;
  for (const w of data.weeks) {
    const c=get(w.component);c.insertions+=w.insertions;c.detachments+=w.detachments;
    const total=weeks.get(w.week) ?? {week:w.week,insertions:0,detachments:0};
    total.insertions+=w.insertions;total.detachments+=w.detachments;weeks.set(w.week,total);
  }
  const rows=[...components.values()].sort((a,b)=>b.instances-a.instances || b.detached-a.detached || numericIds(a.id,b.id));
  const assets=(kind:"styles"|"variables")=>{
    const assetRows=new Map<string,{id:string;layers:number;files:number}>();
    for (const file of data.files) for (const [id,n] of file[kind]) {
      const row=assetRows.get(id) ?? {id,layers:0,files:0};
      row.layers+=n;row.files++;assetRows.set(id,row);
    }
    return [...assetRows.values()].sort((a,b)=>b.layers-a.layers || compareScalarKeys(a.id,b.id));
  };
  return {files,components:rows.slice(0,maxAssetRows),weeks:[...weeks.values()].sort((a,b)=>a.week-b.week),
    instances:rows.reduce((sum,c)=>sum+c.instances,0),detached:rows.reduce((sum,c)=>sum+c.detached,0),
    insertions:rows.reduce((sum,c)=>sum+c.insertions,0),detachments:rows.reduce((sum,c)=>sum+c.detachments,0),
    styles:assets("styles").slice(0,maxAssetRows),variables:assets("variables").slice(0,maxAssetRows)};
}

export type LibraryUsageSummary=ReturnType<typeof summariseLibraryUsage>;
