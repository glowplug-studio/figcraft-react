import {ZipReader} from "@zip.js/zip.js/lib/zip-core-native.js";
import {rectanglePaints,type Document} from "../../document";
import {fileData} from "../../file-bytes";
import {ArchiveReader,archiveOptions} from "../../file-format";
import {subtreeIds} from "../../hierarchy";
import {missingImagePng} from "../rest/stripes";
import {importFig} from "./archive";

const maxBytes=256*1024**2,alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const bad=(message:string)=>new Error("edit.pasteDesignLayers: "+message);
function decode(text:string) {
  // Reject oversized input before allocating the decoded buffer. Rust's decoder requires zero pad bits.
  const limit=Math.ceil(maxBytes/3)*4;
  if (text.length>limit) {
    let count=0;
    for (let i=0;i<text.length;i++) {
      const ch=text.charCodeAt(i);
      if (ch!==32 && ch!==9 && ch!==10 && ch!==12 && ch!==13 && ++count>limit) return;
    }
  }
  const b64=text.replace(/[ \t\r\n\f]/g,"");
  if (b64.length>limit || /[^A-Za-z0-9+/=]/.test(b64)) return;
  const pad=b64.indexOf("="),length=pad<0 ? b64.length : pad,rem=length%4;
  if (rem===1 || pad>=0 && (b64.length%4!==0 || b64.slice(pad)!=="=".repeat((4-rem)%4))) return;
  if (rem && (alphabet.indexOf(b64[length-1]) & (rem===2 ? 15 : 3))) return;
  try {return fileData(b64,maxBytes);} catch {return;}
}

export async function readDesignClipboard(input:{html?:unknown;data?:unknown},check:()=>void) {
  let bytes:Uint8Array<ArrayBuffer>|undefined;
  if (typeof input.html==="string") {
    const a=input.html.indexOf("(figma)"),b=input.html.indexOf("(/figma)",a+7);
    if (a>=0 && b>=0) bytes=decode(input.html.slice(a+7,b));
  } else if (typeof input.data==="string") {
    bytes=decode(input.data);
    if (!bytes) throw bad("`data` is not base64 of at most 256 MB");
  } else throw bad("pass `html` or `data`");
  if (!bytes) return;
  const zipped=bytes[0]===80 && bytes[1]===75;
  if (zipped) {
    const zip=new ZipReader(new ArchiveReader(bytes),archiveOptions);
    let canvas=false;
    try {
      for await (const entry of zip.getEntriesGenerator()) {check();if (entry.filename==="canvas.fig") {canvas=true;break;}}
    } catch {check();return;} finally {await zip.close();}
    if (!canvas) return;
  } else if (String.fromCharCode(...bytes.subarray(0,4))!=="fig-") return;
  check();
  return importFig(bytes,zipped,"Pasted layers",check);
}

let placeholder:Promise<Uint8Array>|undefined;
export async function missingClipboardImages(doc:Document,roots:readonly string[]) {
  const missing=new Map<string,boolean>(),names=new Set<string>();
  for (const root of roots) for (const id of subtreeIds(doc,root)) {
    const n=doc.nodes[id];
    if (n.kind==="page" || names.has(n.name)) continue;
    for (const p of [...rectanglePaints(n),...n.strokes ?? []]) {
      if (p.type!=="image") continue;
      let absent=missing.get(p.image);
      if (absent===undefined) {
        const resource=doc.images?.[p.image];
        absent=!resource;
        if (resource?.width===256 && resource.height===256) {
          const ref=await (placeholder??=missingImagePng().arrayBuffer().then(b=>new Uint8Array(b)));
          if (resource.bytes.size===ref.length) {
            const bytes=new Uint8Array(await resource.bytes.arrayBuffer());
            absent=ref.every((v,i)=>v===bytes[i]);
          }
        }
        missing.set(p.image,absent);
      }
      if (absent) {names.add(n.name);break;}
    }
    if (names.size>=20) return [...names];
  }
  return [...names];
}
