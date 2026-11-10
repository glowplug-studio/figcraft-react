import type { RestFolder } from "./engine/interchange/rest/companions";

export interface DroppedDesign {file:File;folder?:RestFolder}
function files(directory:FileSystemDirectoryEntry) {
  const reader=directory.createReader();
  return (async()=>{
    const all:FileSystemEntry[]=[];
    for (;;) {
      const page=await new Promise<FileSystemEntry[]>((resolve,reject)=>reader.readEntries(resolve,reject));
      if (!page.length) return all;
      all.push(...page);
    }
  })();
}
const readFile=(entry:FileSystemEntry)=>new Promise<File>((resolve,reject)=>(entry as FileSystemFileEntry).file(resolve,reject));
function lookup(entries:readonly FileSystemEntry[]) {
  const byName=new Map(entries.filter(e=>e.isFile).map(e=>[e.name,e]));
  return async(name:string)=>{const entry=byName.get(name);return entry ? readFile(entry) : undefined;};
}
/** The browser grants access to entries the user drops. Resolve siblings only inside that directory. */
export function droppedDesigns(data:DataTransfer):Promise<DroppedDesign[]> {
  const items=Array.from(data.items).filter(i=>i.kind==="file").map(i=>({entry:i.webkitGetAsEntry?.(),file:i.getAsFile()}));
  if (!items.some(i=>i.entry?.isDirectory)) return Promise.resolve(Array.from(data.files,file=>({file})));
  return (async()=>{
    const result:DroppedDesign[]=[];
    for (const {entry,file} of items) {
      if (!entry?.isDirectory) {if (file) result.push({file});continue;}
      const entries=await files(entry as FileSystemDirectoryEntry);
      const images=entries.find(e=>e.isDirectory && e.name==="images");
      const folder:RestFolder={file:lookup(entries),image:lookup(images ? await files(images as FileSystemDirectoryEntry) : [])};
      const designs=entries.filter(e=>e.isFile && /\.json$/i.test(e.name) && !/(?:^|\.)variables\.json$/i.test(e.name));
      if (!designs.length) throw new Error("The dropped folder contains no design JSON file");
      for (const e of designs) result.push({file:await readFile(e),folder});
    }
    return result;
  })();
}
