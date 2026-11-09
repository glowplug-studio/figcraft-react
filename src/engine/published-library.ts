import type {Document} from "./document";
import {fail,id,wireId} from "./native-values";
import type {Paint} from "./solid-paint";
import {isLosslessNumber} from "lossless-json";

interface LibraryEntry {
  readonly id:string;
  readonly name:string;
  readonly version:string;
  readonly published:boolean;
}
interface LibraryComponent extends LibraryEntry { readonly set:boolean }
interface LibraryStyle extends LibraryEntry { readonly type:string }
interface LibraryVariable extends LibraryStyle { readonly collection:string }
export interface LibraryManifest {
  readonly id:string;
  readonly name:string;
  readonly version:string;
  readonly description:string;
  readonly time:string;
  readonly components:readonly LibraryComponent[];
  readonly styles:readonly LibraryStyle[];
  readonly collections:readonly LibraryEntry[];
  readonly variables:readonly LibraryVariable[];
}
export interface LibraryLink {
  readonly id:string;
  readonly name:string;
  readonly path:string;
  readonly version:string;
}
export function readLibraryLinks(value:unknown) {
  return entries(value,r=>{
    const path=string(r.path);
    if (/^(?:figcraft|wss?):\/\//i.test(path.trimStart())) fail("team library share links require online workspace support");
    return {id:string(r.id),name:string(r.name),path,version:uint(r.version)};
  });
}
export interface ImportedRecord {readonly library:string;readonly key:string;readonly local:string;readonly version:string}
export interface ImportedRecords {readonly styles?:readonly ImportedRecord[];readonly collections:readonly ImportedRecord[];readonly variables:readonly ImportedRecord[]}
export function readImportedRecords(r:Record<string,unknown>):ImportedRecords | undefined {
  const read=(value:unknown)=>entries(value,r=>({library:string(r.library),key:string(r.key),local:string(r.local),version:uint(r.version)}));
  const collections=read(r.collections),variables=read(r.variables),styles=read(r.styles);
  return collections.length || variables.length || styles.length ? {collections,variables,...(styles.length && {styles})} : undefined;
}
export function wireLibraryLinks(links:readonly LibraryLink[],records?:ImportedRecords) {
  const wire=(list:readonly ImportedRecord[])=>list.map(r=>({...r,version:wireId(r.version)}));
  return {enabled:links.map(l=>({...l,version:wireId(l.version)})),store:null,components:[],styles:wire(records?.styles ?? []),...(records?.collections.length && {collections:wire(records.collections)}),...(records?.variables.length && {variables:wire(records.variables)})};
}
export interface PublishedLibrary {
  readonly manifest:LibraryManifest;
  readonly document:Document;
  readonly nextId:string;
}
function record(value:unknown):Record<string,unknown> {
  if (!value || typeof value!=="object" || Array.isArray(value) || isLosslessNumber(value)) fail("invalid library manifest record");
  return value as Record<string,unknown>;
}
function string(value:unknown) {
  if (value===undefined) return "";
  if (typeof value!=="string") fail("expected library manifest text");
  return value;
}
function bool(value:unknown) {
  if (value===undefined) return false;
  if (typeof value!=="boolean") fail("expected library manifest boolean");
  return value;
}
function uint(value:unknown) { return value===undefined ? "0" : id(value,"library integer"); }
function entries<T>(value:unknown,parse:(r:Record<string,unknown>)=>T):T[] {
  if (value===undefined) return [];
  if (!Array.isArray(value)) fail("expected library asset list");
  return value.map(raw=>parse(record(raw)));
}
export function readLibraryManifest(value:unknown):LibraryManifest {
  const m=record(value),key=string(m.id);
  if (key.length<1 || key.length>64 || /[^a-zA-Z0-9_-]/.test(key)) fail("the library has an invalid id");
  const common=(r:Record<string,unknown>)=>({name:string(r.name),version:uint(r.version),published:bool(r.published)});
  const asset=(r:Record<string,unknown>)=>({...common(r),id:string(r.id)});
  const clip=(s:string,n:number)=>{
    if (s.length<=n) return s;
    let end=0,count=0;
    for (const ch of s) {if (count++===n) break; end+=ch.length;}
    return s.slice(0,end);
  };
  return {id:key,name:clip(string(m.name),200),description:clip(string(m.description),2000),version:uint(m.version),time:uint(m.time),
    components:entries(m.components,r=>({...common(r),id:id(r.id,"component id"),set:bool(r.set)})),
    styles:entries(m.styles,r=>({...asset(r),type:string(r.type)})),
    collections:entries(m.collections,asset),variables:entries(m.variables,r=>({...asset(r),type:string(r.type),collection:string(r.collection)}))};
}
export function keepLibraryAssets(m:LibraryManifest,doc:Document):LibraryManifest {
  const styles=new Set(doc.styles?.map(s=>s.id)),collections=new Set(doc.variables?.collections.map(c=>c.id));
  const variables=new Map<string,Set<string>>();
  for (const v of doc.variables?.variables ?? []) {
    let members=variables.get(v.collection);
    if (!members) { members=new Set();variables.set(v.collection,members); }
    members.add(v.id);
  }
  return {...m,components:m.components.filter(c=>{const kind=doc.nodes[c.id]?.kind;return kind==="component" || kind==="componentSet";}),
    styles:m.styles.filter(s=>styles.has(s.id)),collections:m.collections.filter(c=>collections.has(c.id)),
    variables:m.variables.filter(v=>variables.get(v.collection)?.has(v.id))};
}
export function wireLibraryManifest(m:LibraryManifest) {
  const asset=<T extends LibraryEntry>(a:T)=>({...a,version:wireId(a.version)});
  return {...m,version:wireId(m.version),time:wireId(m.time),components:m.components.map(c=>({...asset(c),id:wireId(c.id)})),
    styles:m.styles.map(asset),collections:m.collections.map(asset),variables:m.variables.map(asset)};
}
// Only images painted by the publication belong to it. A stale imageIndex may list unused bytes.
export function libraryImageKeys(doc:Document) {
  const keys=new Set<string>();
  function paints(stack:readonly Paint[] | undefined) {
    if (stack) for (const p of stack) if (p.type==="image") keys.add(p.image);
  }
  for (const n of Object.values(doc.nodes)) {
    paints(n.fills);paints(n.strokes);
    if (n.kind==="vector") for (const r of n.network.regions) paints(r.fills);
    if (n.kind==="text") {paints(n.text.style.fills);for (const r of n.text.runs) paints(r.style.fills);}
  }
  for (const style of doc.styles ?? []) if (style.type==="paint") paints(style.paints);
  return keys;
}
