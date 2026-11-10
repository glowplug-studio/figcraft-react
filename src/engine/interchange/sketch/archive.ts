import SketchJsonWorker from "./json-worker?worker&inline";
import {parseSketchJson} from "./json";
import {ZipReader,type FileEntry} from "@zip.js/zip.js/lib/zip-core-native.js";
import {ArchiveReader,archiveOptions,readMember} from "../../file-format";
import {compareScalarKeys} from "../../text-breaks";
import {object,type JsonObject} from "../rest/values";

const MiB=1024**2;
export const sketchTooOld="saved by a Sketch older than 48; open it in a newer Sketch and save it again";
const sketchError=(s:string)=>new Error("not a valid FigCraft file: Sketch file: "+s);
const validId=(s:string)=>/^[A-Za-z0-9_-]{1,128}$/.test(s);
type Source=Uint8Array|Blob;
type Budget={used:number;limit:number};
export interface SketchArchive {
  document:JsonObject;
  pages:{id:string;page:JsonObject}[];
  version:number;
  warnings:string[];
  image:(name:string)=>Promise<Uint8Array<ArrayBuffer>|undefined>;
}
export function sketchFontNote(document:JsonObject) {
  if (!Array.isArray(document.fontReferences)) return;
  const names=new Set<string>();
  let references=0;
  for (const item of document.fontReferences) {
    const ref=object(item);
    if (Object.hasOwn(ref,"fontData") && typeof ref.fontFamilyName==="string") {
      names.add(Array.from(ref.fontFamilyName).slice(0,64).join(""));
      if (++references===20) break;
    }
  }
  const families=[...names].sort(compareScalarKeys);
  if (families.length) return "the file has embedded fonts FigCraft doesn't use ("+families.join(", ")+"); install them to see the text as designed";
}

/** Read named members only. Charge failed decompressions as well as successful reads. */
export async function withSketchArchive<T>(source:Source,checkCurrent:()=>void,consume:(archive:SketchArchive)=>Promise<T>) {
  const archive=new ZipReader(new ArchiveReader(source),archiveOptions);
  try {
    const entries=new Map<string,FileEntry>();
    for (const member of await archive.getEntries()) if (!member.directory) entries.set(member.filename,member);
    if (!entries.has("document.json") || !entries.has("meta.json")) return;
    const jsonBudget={used:0,limit:512*MiB},imageBudget={used:0,limit:256*MiB};
    async function member(name:string,limit:number,budget:Budget) {
      const f=entries.get(name);
      if (!f) throw sketchError(name+": specified file not found in archive");
      const allowed=Math.min(limit,Math.max(16*MiB,100*f.compressedSize),budget.limit-budget.used);
      if (f.uncompressedSize>allowed) throw sketchError(name+" is too large");
      budget.used+=f.uncompressedSize;
      checkCurrent();
      const blob=await readMember(f,source instanceof Blob ? source : undefined);
      checkCurrent();
      return blob;
    }
    async function json(name:string) {
      const bytes=await (await member(name,512*MiB,jsonBudget)).arrayBuffer();
      checkCurrent();
      if (bytes.byteLength<256*1024 || typeof Worker==="undefined") return parseSketchJson(bytes,name);
      const worker=new SketchJsonWorker();
      let timer:ReturnType<typeof setInterval>|undefined;
      try {
        return await new Promise<unknown>((resolve,reject)=>{
          timer=setInterval(()=>{try {checkCurrent();} catch (error) {reject(error);}},32);
          worker.onmessage=(event:MessageEvent<{value:unknown}|{error:string}>)=>{
            if ("error" in event.data) reject(new Error(event.data.error)); else resolve(event.data.value);
          };
          worker.onerror=e=>{e.preventDefault();reject(new Error(e.message || "Sketch JSON worker failed"));};
          worker.onmessageerror=()=>reject(new Error("Cannot read decoded Sketch JSON"));
          worker.postMessage({bytes,name},[bytes]);
        });
      } finally {clearInterval(timer);worker.terminate();checkCurrent();}
    }
    const isObject=(v:unknown):v is JsonObject=>v!==null && typeof v==="object" && !Array.isArray(v);
    const meta=await json("meta.json");
    if (!isObject(meta)) throw sketchError("meta.json is not an object");
    const first=typeof meta.appVersion==="string" ? meta.appVersion.split(".")[0].trim() : "";
    if (/^\+?\d+$/.test(first) && Number(first)<48) throw new Error(sketchTooOld);
    const version=typeof meta.version==="number" && Number.isInteger(meta.version) && meta.version>=0 ? meta.version : 0;
    const warnings:string[]=[];
    if (version>139) warnings.push("the file was saved by a newer Sketch than the import was checked with; some layers may differ");
    const reason=(e:unknown)=>String(e instanceof Error ? e.message : e).replace(/^not a valid FigCraft file: /,"");
    let document:JsonObject;
    try {
      const raw=await json("document.json");
      if (!isObject(raw)) throw new Error("not an object");
      document=raw;
    } catch (e) {
      checkCurrent();
      warnings.push("the document's shared styles and library symbols were skipped: "+reason(e));
      document={pages:[...entries.keys()].filter(p=>p.startsWith("pages/") && p.endsWith(".json")).map(p=>({_ref:p.slice(0,-5)}))};
    }
    const refs=Array.isArray(document.pages) ? document.pages : [],pages:SketchArchive["pages"]=[],seen=new Set<string>();
    for (const ref of refs.slice(0,1000)) {
      const path=object(ref)._ref,id=typeof path==="string" && path.startsWith("pages/") ? path.slice(6) : "";
      if (!validId(id)) {warnings.push("pages the document lists without a valid reference were skipped");continue;}
      if (seen.has(id)) continue;
      seen.add(id);
      try {
        const page=await json(path+".json");
        if (isObject(page)) pages.push({id,page});
        else warnings.push("pages that aren't JSON objects were skipped");
      } catch (e) {checkCurrent();warnings.push("a page was skipped: "+reason(e));}
    }
    if (refs.length>1000) warnings.push("the file has more than 1000 pages; the rest were skipped");
    const image=async(ref:string)=>{
      const name=ref.replace(/^images\//,""),parts=name.split(".");
      if (!validId(parts[0]) || parts.length>2) return;
      try {return new Uint8Array(await (await member("images/"+name,256*MiB,imageBudget)).arrayBuffer());}
      catch {checkCurrent();return;}
    };
    return await consume({document,pages,version,warnings,image});
  } finally {await archive.close();}
}
