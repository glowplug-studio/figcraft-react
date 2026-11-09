import type {Document,DocumentNode} from "./document";
import {pruneLibraryComponents} from "./library-store";
import {HierarchyDraft} from "./hierarchy";
import {planLibraryRecords} from "./library-records";
import {importLibraryVariables,pruneLibraryVariables} from "./library-variables";
import type {PublishedLibrary} from "./published-library";
import {editStyleLinks,propagateStyle,type ActiveStyleRange} from "./style-application";
import {styleForLayer} from "./style-variables";
import {compareScalarKeys} from "./text-breaks";

export function localStyles(doc:Document) {
  const styles=doc.styles ?? [],records=doc.libraryRecords?.styles;
  if (!records?.length) return styles;
  const remote=new Set(records.map(r=>r.local));
  return styles.filter(s=>!remote.has(s.id));
}

export function styleLinks(node:DocumentNode) {
  const ids=new Set(Object.values(node.styles ?? {}).filter((id):id is string=>typeof id==="string"));
  if (node.kind==="text") {
    if (node.text.style.styleId) ids.add(node.text.style.styleId);
    for (const run of node.text.runs) if (run.style.styleId) ids.add(run.style.styleId);
  }
  return ids;
}

export function importLibraryStyles(doc:Document,lib:PublishedLibrary,keys:Iterable<string>,update=false) {
  const source=new Map(lib.document.styles?.map(style=>[style.id,style]));
  const wanted=[...new Set(keys)].filter(key=>source.has(key)).sort(compareScalarKeys);
  const plan=planLibraryRecords(lib,doc.styles ?? [],doc.libraryRecords?.styles ?? [],lib.manifest.styles,wanted,update);
  const seeds=new Set<string>();
  for (const key of plan.pending.keys()) for (const id of Object.values(source.get(key)!.bound ?? {})) seeds.add(id);
  const imported=importLibraryVariables(doc,lib,seeds,[],update);
  let document=imported.document;
  if (plan.pending.size) {
    const styles=plan.write((key,id)=>{
      const {bound,...style}=source.get(key)!;
      const mapped:Record<string,string>=Object.create(null);
      for (const [field,ref] of Object.entries(bound ?? {})) {
        const local=imported.variables.get(ref);
        if (local) mapped[field]=local;
      }
      return {...style,id,...(Object.keys(mapped).length && {bound:mapped})};
    });
    document={...document,styles:styles.list,libraryRecords:{collections:[],variables:[],...document.libraryRecords,styles:styles.rows}};
  }
  const images:Record<string,NonNullable<Document["images"]>[string]>=Object.create(null);
  for (const key of wanted) {
    const style=source.get(key)!;
    if (style.type==="paint") for (const paint of style.paints) {
      if (paint.type!=="image" || document.images?.[paint.image]) continue;
      const image=lib.document.images?.[paint.image];
      if (image) images[paint.image]=image;
    }
  }
  if (Object.keys(images).length) document={...document,images:{...document.images,...images}};
  if (update && plan.pending.size) {
    const changed=new Set([...plan.pending.values()].map(r=>r.local));
    const definitions=new Map(document.styles!.filter(style=>changed.has(style.id)).map(style=>[style.id,style]));
    const draft=new HierarchyDraft(document);
    for (const node of Object.values(document.nodes)) {
      if (!node.styles && node.kind!=="text") continue;
      let next=node;
      for (const id of styleLinks(node)) {
        const style=definitions.get(id);
        if (style) next=propagateStyle(next,id,styleForLayer(document,style,node.id));
      }
      if (next!==node) draft.set(next);
    }
    document=draft.finish();
  }
  return {document,styles:plan.map};
}

export function applyLibraryStyle(doc:Document,selection:readonly string[],lib:PublishedLibrary,p:Record<string,unknown>,live?:ActiveStyleRange) {
  const choices=lib.manifest.styles.filter(s=>s.published);
  const style=choices.find(s=>s.id===p.style) ?? choices.find(s=>s.name===p.style);
  if (!style) throw Error('"'+lib.manifest.name+'" publishes no style `'+p.style+'`');
  const imported=importLibraryStyles(doc,lib,[style.id]),local=imported.styles.get(style.id);
  if (!local) throw Error("the style didn't import");
  const document=editStyleLinks(imported.document,selection,{id:p.id,ids:p.ids,target:p.target,style:local},false,live);
  return {document,result:{style:local}};
}

export function pruneLibraryAssets(doc:Document,library:string) {
  doc=pruneLibraryComponents(doc,library);
  const records=doc.libraryRecords;
  if (records?.styles?.some(r=>r.library===library)) {
    const linked=new Set<string>();
    for (const node of Object.values(doc.nodes)) if (node.styles || node.kind==="text")
      for (const id of styleLinks(node)) linked.add(id);
    const unused=new Set(records.styles.filter(r=>r.library===library && !linked.has(r.local)).map(r=>r.local));
    if (unused.size) {
      const {styles:old,libraryRecords:previous,...base}=doc;
      const styles=old?.filter(s=>!unused.has(s.id)),remote=records.styles.filter(r=>!unused.has(r.local));
      const {styles:oldRecords,...other}=records;
      doc={...base,...(styles?.length && {styles}),...((remote.length || other.variables.length || other.collections.length) &&
        {libraryRecords:{...other,...(remote.length && {styles:remote})}})};
    }
  }
  return pruneLibraryVariables(doc,library);
}
