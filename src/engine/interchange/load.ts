import { decodeFigcraft, MAX_DOCUMENT_BYTES } from "../file-format";
import { siblingVariables,type RestFolder } from "./rest/companions";
import { importRestDocument } from "./rest/document";

type Source=Blob|Uint8Array;
const marker=/"document"\s*:/;
async function textOf(source:Source) {
  const bytes=source instanceof Blob ? await source.arrayBuffer() : source;
  return new TextDecoder("utf-8",{fatal:true}).decode(bytes);
}

/** serde_json refuses the 128th nested container, including ones outside the document tree. */
async function checkNesting(json:string,checkCurrent:()=>void) {
  let depth=0,quoted=false,yielded=performance.now();
  for (let i=0;i<json.length;i++) {
    if ((i & 65535)===0 && performance.now()-yielded>12) {
      await new Promise<void>(resolve=>setTimeout(resolve,0));checkCurrent();yielded=performance.now();
    }
    const c=json.charCodeAt(i);
    if (quoted && c===92) {i++;continue;}
    if (c===34) quoted=!quoted;
    else if (!quoted && (c===123 || c===91)) {
      if (++depth>=128) throw new Error("Cannot open REST API file JSON: recursion limit exceeded");
    } else if (!quoted && (c===125 || c===93)) depth--;
  }
}

/** Prefer the streaming native reader for native JSON and archives. Only external JSON needs a full JS object. */
export async function loadDesignDocument(source:Source,variables:unknown,checkCurrent:()=>void,folder?:RestFolder,name="") {
  const size=source instanceof Blob ? source.size : source.byteLength;
  if (/\.penpot$/i.test(name)) {
    const {withPenpotArchive}=await import("./penpot/archive");
    const {penpotScene}=await import("./penpot/scene");
    return {decoded:await withPenpotArchive(source,checkCurrent,penpotScene),external:true};
  }
  const first=source instanceof Blob ? new Uint8Array(await source.slice(0,16384).arrayBuffer()) : source.subarray(0,16384);
  const prefix=new TextDecoder().decode(first), start=prefix.trimStart()[0];
  const native=async()=>({decoded:await decodeFigcraft(source),external:false});
  if (size>MAX_DOCUMENT_BYTES) return native();
  const zipped=first[0]===0x50 && first[1]===0x4b;
  const bare=prefix.startsWith("fig-");
  if (bare || zipped) {
    const {importFig}=await import("./fig/archive");
    const decoded=await importFig(source,zipped,name,checkCurrent);
    if (decoded) return {decoded,external:true};
  }
  if (zipped || prefix.startsWith("SQLite format 3\0")) {
    const {withSketchArchive,sketchTooOld}=await import("./sketch/archive");
    if (!zipped) throw new Error(sketchTooOld);
    const decoded=await withSketchArchive(source,checkCurrent,async archive=>{
      const {sketchScene}=await import("./sketch/scene");
      const filename=name.split(/[\\/]/).at(-1) || "Untitled";
      const stem=filename.lastIndexOf(".")>0 ? filename.slice(0,filename.lastIndexOf(".")) : filename;
      return sketchScene(archive,stem,Math.min(2000000,Math.max(200000,Math.floor(size/8))),checkCurrent);
    });
    if (decoded) return {decoded,external:true};
  }
  if (start && start!=="{") return native();
  const external=async()=>{
    const json=await textOf(source);
    checkCurrent();
    if (!marker.test(json)) return;
    await checkNesting(json,checkCurrent);
    let value:unknown;
    try {value=JSON.parse(json);}
    catch (error) {
      if (json.includes('"DOCUMENT"')) throw new Error("Cannot open REST API file JSON: "+(error instanceof Error ? error.message : "invalid JSON"));
      return;
    }
    const companion=variables ?? (folder && await siblingVariables(folder,name));
    const decoded=await importRestDocument(value,checkCurrent,undefined,companion,folder);
    return decoded && {decoded,external:true};
  };
  if (marker.test(prefix) && !/"format"\s*:\s*"figcraft"/.test(prefix)) return await external() ?? native();
  try {return await native();}
  catch (error) {
    checkCurrent();
    const imported=await external();
    if (imported) return imported;
    throw error;
  }
}
