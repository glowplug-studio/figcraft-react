import {ZipReader,type FileEntry} from "@zip.js/zip.js/lib/zip-core-native.js";
import {bytesToHex} from "@noble/hashes/utils.js";
import {ArchiveReader,archiveOptions,readMember} from "../../file-format";
import {MAX_IMAGE_BYTES} from "../../image-resource";
import {readFigCanvas} from "./decode";
import {items,num,obj} from "./fields";
import {figScene} from "./scene";
import type {KiwiValue} from "./kiwi";

function embeddedImages(message:KiwiValue) {
  const blobs=items(obj(message).blobs);
  const found=new Map<string,Uint8Array>();
  const stack:KiwiValue[]=[message];
  while (stack.length) {
    const v=stack.pop()!;
    if (Array.isArray(v)) {for (const child of v) stack.push(child);continue;}
    if (typeof v!=="object" || v instanceof Uint8Array) continue;
    const img=obj(v.image), hash=img.hash,index=num(img.dataBlob);
    if (hash instanceof Uint8Array && hash.length>0 && hash.length<=64 && index!==undefined) {
      const bytes=obj(blobs[index]).bytes,key=bytesToHex(hash);
      if (!found.has(key) && bytes instanceof Uint8Array && bytes.length && bytes.length<=MAX_IMAGE_BYTES) found.set(key,bytes);
    }
    for (const [key,field] of Object.entries(v)) if (key!=="blobs" && field!==undefined && typeof field==="object") stack.push(field);
  }
  return found;
}

type Source=Blob | Uint8Array;
const bareLimit=256 * 1024 ** 2;
const sourceSize=(source:Source)=>source instanceof Blob ? source.size : source.length;
async function bytes(source:Source) {
  return source instanceof Blob ? new Uint8Array(await source.arrayBuffer()) : Uint8Array.from(source);
}

export async function importFig(source:Source, zipped:boolean, filename:string, checkCurrent:()=>void) {
  const archive=zipped ? new ZipReader(new ArchiveReader(source),archiveOptions) : undefined;
  try {
    let canvas:Source=source;
    const members=new Map<string,FileEntry>();
    let meta:FileEntry|undefined, member:FileEntry|undefined;
    let remaining=1024 ** 3, skipped=0;
    let name=filename.split(/[\\/]/).at(-1)?.replace(/\.[^.]*$/,"") || "Untitled";
    if (archive) {
      for await (const e of archive.getEntriesGenerator()) {
        if (e.directory) continue;
        if (e.filename==="canvas.fig") member=e;
        else if (e.filename==="meta.json") meta=e;
        else if (/^images\/[\da-fA-F]{1,128}$/.test(e.filename)) members.set(e.filename.slice(7),e);
      }
      if (!member) return;
      if (member.uncompressedSize>bareLimit) throw new Error("canvas.fig exceeds the 256 MiB member limit");
      canvas=await readMember(member);
      if (meta && meta.uncompressedSize<=1024**2) {
        try {
          const parsed=JSON.parse(await (await readMember(meta)).text()) as {file_name?:unknown};
          if (typeof parsed?.file_name==="string" && parsed.file_name.trim()) name=parsed.file_name;
        } catch { /* Optional metadata may be absent or damaged. */ }
      }
    }
    checkCurrent();
    const data=await bytes(canvas), packed=Math.min(data.length,sourceSize(source));
    const board=new TextDecoder().decode(data.subarray(0,8))==="fig-jam.";
    const msg=await readFigCanvas(data,packed,checkCurrent);
    if (board) throw new Error("FigJam boards require the board document model");
    const embedded=embeddedImages(msg);
    const cached=new WeakMap<Uint8Array,File>();
    const image=async(key:string)=>{
      if (!/^[\da-fA-F]{1,128}$/.test(key)) return;
      const file=members.get(key);
      if (file && file.uncompressedSize<=MAX_IMAGE_BYTES) {
        if (file.uncompressedSize>remaining) skipped++;
        else {
          remaining-=file.uncompressedSize;
          try {return new File([await readMember(file)],key);} catch { /* Fall back to embedded bytes. */ }
        }
      }
      const binary=embedded.get(key);
      if (!binary) return;
      let blob=cached.get(binary);
      if (!blob) {blob=new File([Uint8Array.from(binary)],key);cached.set(binary,blob);}
      return blob;
    };
    const result=await figScene(msg,name,checkCurrent,Math.min(2000000,Math.max(200000,Math.floor(packed/8))),{file:async()=>undefined,image});
    if (skipped) result.issues.push(skipped+" ZIP image(s) skipped by the total ZIP image byte budget (1073741824 bytes)");
    return result;
  } finally {await archive?.close();}
}
