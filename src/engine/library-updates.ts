import type {Document} from "./document";
import {inspectedId} from "./parameters";
import type {LibraryLink,PublishedLibrary} from "./published-library";
import {importLibraryStyles,pruneLibraryAssets} from "./library-styles";
import {importLibraryVariables,pendingVariables} from "./library-variables";
import {syncExtensions} from "./variable-collections";

export function findLibrary(doc:Document,key:unknown) {
  const links=doc.libraryLinks ?? [];
  return links.find(l=>l.id===key) ?? links.find(l=>l.name===key || l.path===key);
}
export function linkedPublication(link:LibraryLink,source:(path:string)=>PublishedLibrary|undefined) {
  const lib=source(link.path);
  if (!lib) throw Error("Choose the published library file to read its assets.");
  if (lib.manifest.id!==link.id) throw Error('The file now holds another library ("'+lib.manifest.name+'")');
  return lib;
}
export function pendingLibraryAssets(doc:Document,lib:PublishedLibrary) {
  const versions=new Map(lib.manifest.styles.map(s=>[s.id,s.version]));
  const locals=new Set(doc.styles?.map(s=>s.id));
  const styles=(doc.libraryRecords?.styles ?? []).filter(r=>r.library===lib.manifest.id && locals.has(r.local) &&
    BigInt(versions.get(r.key) ?? 0)>BigInt(r.version));
  return {...pendingVariables(doc,lib),styles};
}
export function libraryUpdates(doc:Document,source:(path:string)=>PublishedLibrary|undefined) {
  let count=0;
  const libraries=[],errors=[];
  for (const link of doc.libraryLinks ?? []) {
    let lib;
    try {lib=linkedPublication(link,source);}
    catch (e) {errors.push({id:link.id,name:link.name,error:(e as Error).message});continue;}
    const pending=pendingLibraryAssets(doc,lib),total=pending.styles.length+pending.variables.length+pending.collections.length;
    if (!total) continue;
    const m=lib.manifest;
    const rows=(kind:"styles"|"variables"|"collections")=>{
      const names=new Map(m[kind].map(a=>[a.id,a.name]));
      return pending[kind].map(r=>({id:r.local || null,key:r.key,name:names.get(r.key) ?? null}));
    };
    count+=total;
    libraries.push({id:m.id,name:m.name,version:inspectedId(m.version),components:[],styles:rows("styles"),collections:rows("collections"),variables:rows("variables")});
  }
  return {count,libraries,errors};
}
export function acceptLibraryUpdates(doc:Document,source:(path:string)=>PublishedLibrary|undefined,ids:unknown) {
  const keys=Array.isArray(ids) ? ids.filter((v):v is string=>typeof v==="string") : typeof ids==="string" ? [ids] : undefined;
  if (ids!==undefined && !keys) throw Error("ids must be an array of library ids");
  const links=keys ? keys.map(k=>{const l=findLibrary(doc,k);if (!l) throw Error("no enabled library `"+k+"`");return l;}) : doc.libraryLinks ?? [];
  let document=doc,styles=0,variables=0,collections=0;
  const skipped=[];
  for (const link of links) {
    let lib;
    try {lib=linkedPublication(link,source);}
    catch (e) {if(keys) throw e;skipped.push({id:link.id,name:link.name,error:(e as Error).message});continue;}
    const pending=pendingLibraryAssets(document,lib);
    styles+=pending.styles.length;
    if (pending.styles.length) document=importLibraryStyles(document,lib,pending.styles.map(s=>s.key),true).document;
    variables+=pending.variables.length;collections+=pending.collections.length;
    if (pending.variables.length || pending.collections.length) {
      document=importLibraryVariables(document,lib,pending.variables.map(v=>v.key),pending.collections.map(c=>c.key),true).document;
    }
    if (document.variables) {
      const synced=syncExtensions(document.variables);
      if (synced!==document.variables) document={...document,variables:synced};
    }
    if (link.version!==lib.manifest.version || link.name!==lib.manifest.name) document={...document,
      libraryLinks:document.libraryLinks!.map(l=>l.id===link.id ? {...l,name:lib.manifest.name,version:lib.manifest.version} : l)};
    document=pruneLibraryAssets(document,link.id);
  }
  return {document,result:{components:0,styles,collections,variables,skipped}};
}
