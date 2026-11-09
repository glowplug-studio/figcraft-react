import {createContext,useContext} from "react";
import type {SharedStyle} from "./engine/shared-styles";
import type {Document} from "./engine/document";
import type {PublishedLibrary} from "./engine/published-library";
import {emptyVariables,type Variables} from "./engine/variables";

interface LibraryCatalogue {
  id:string;
  name:string;
  styles:readonly SharedStyle[];
  offered:Variables;
  data:Variables;
}
const offeredCache=new WeakMap<PublishedLibrary,LibraryCatalogue>();
function catalogue(lib:PublishedLibrary):LibraryCatalogue {
  const cached=offeredCache.get(lib);
  if (cached) return cached;
  const m=lib.manifest,data=lib.document.variables ?? emptyVariables;
  const cs=new Set(m.collections.filter(x=>x.published).map(x=>x.id)),vs=new Set(m.variables.filter(x=>x.published).map(x=>x.id));
  const ids=new Set(m.styles.filter(s=>s.published).map(s=>s.id));
  const styles=(lib.document.styles ?? []).filter(s=>ids.has(s.id));
  const source={id:m.id,name:m.name,data,styles,offered:{collections:data.collections.filter(c=>cs.has(c.id)),variables:data.variables.filter(v=>vs.has(v.id))}};
  offeredCache.set(lib,source);
  return source;
}
export function libraryCatalogues(links:Document["libraryLinks"],records:Document["libraryRecords"],lookup:(path:string)=>PublishedLibrary|undefined) {
  const sources:LibraryCatalogue[]=[];
  for (const link of links ?? []) {
    const source=lookup(link.path);
    if (source?.manifest.id===link.id) sources.push(catalogue(source));
  }
  return {sources,remoteCollections:new Set(records?.collections.map(r=>r.local)),remoteVariables:new Set(records?.variables.map(r=>r.local))};
}
export const LibraryVariablesContext=createContext(libraryCatalogues(undefined,undefined,()=>undefined));
export const useLibraryVariables=()=>useContext(LibraryVariablesContext);
