import {pendingVariables,pruneLibraryVariables} from "./library-variables";
import type {Document} from "./document";
import {inspectedId} from "./parameters";
import {publishedSummary} from "./library-publish";
import type {LibraryLink,PublishedLibrary} from "./published-library";

export const MAX_CACHED_LIBRARIES=64;

export function enableLibrary(doc:Document,path:string,source:PublishedLibrary) {
  const m=source.manifest;
  if (doc.published?.manifest.id===m.id) throw Error('this file is the library "'+m.name+'"');
  const links=doc.libraryLinks ?? [],before=links.find(link=>link.id===m.id);
  const link={id:m.id,name:m.name,path,version:before?.version ?? m.version};
  const document=before && before.name===m.name && before.path===path ? doc :
    Object.freeze({...doc,libraryLinks:before ? links.map(l=>l===before ? link : l) : [...links,link]});
  const result={...publishedSummary(source,true).assets,id:m.id,name:m.name,version:inspectedId(m.version),path};
  return {document,result};
}
export function removeLibrary(doc:Document,key:string) {
  const links=doc.libraryLinks ?? [],link=links.find(l=>l.id===key) ?? links.find(l=>l.name===key || l.path===key);
  if (!link) throw Error("no enabled library `"+key+"`");
  const rest=links.filter(l=>l.id!==link.id),{libraryLinks:previous,...base}=doc;
  return {document:pruneLibraryVariables(Object.freeze({...base,...(rest.length && {libraryLinks:rest})}),link.id),result:{removed:link.id}};
}
export function describeLibrary(doc:Document,link:LibraryLink,source:PublishedLibrary | undefined,withAssets:boolean) {
  const info={id:link.id,name:link.name,path:link.path,server:false,seenVersion:inspectedId(link.version)};
  if (!source) return {...info,error:"Choose the published library file to read its assets."};
  if (source.manifest.id!==link.id) return {...info,error:'the file now holds another library ("'+source.manifest.name+'")'};
  const pending=pendingVariables(doc,source);
  return {...info,version:inspectedId(source.manifest.version),description:source.manifest.description,updates:pending.variables.length+pending.collections.length,
    ...(withAssets && publishedSummary(source,true).assets)};
}
