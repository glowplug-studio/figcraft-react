import { tiffDirectory } from "./tiff-directory";
import { validPngChunk } from "./image-profile";

export const MAX_ICC_BYTES = 4 * 1024 * 1024;

async function inflateProfile(compressed: Uint8Array<ArrayBuffer>) {
  const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_ICC_BYTES) { await reader.cancel(); return; }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const profile = new Uint8Array(size);
  let at = 0;
  for (const part of parts) { profile.set(part,at); at+=part.length; }
  return profile;
}

async function pngIcc(bytes:Uint8Array<ArrayBuffer>,view:DataView) {
  for (let at=8; at+12<=bytes.length;) {
    const size=view.getUint32(at), tag=view.getUint32(at+4), data=at+8;
    if (size>bytes.length-at-12 || tag===0x49444154 || tag===0x49454e44) return;
    if (tag===0x69434350) {
      const end=data+size, zero=bytes.subarray(data,Math.min(end,data+80)).indexOf(0);
      if (zero<1 || data+zero+2>=end || bytes[data+zero+1]!==0 || !validPngChunk(bytes,at,size,view)) return;
      const profile=await inflateProfile(bytes.subarray(data+zero+2,end));
      if (profile) return {profile,grey:bytes[25]===0 || bytes[25]===4};
      return;
    }
    at+=size+12;
  }
}

function jpegIcc(bytes:Uint8Array<ArrayBuffer>,view:DataView) {
  const parts=new Map<number,Uint8Array>();
  let count=0, size=0, grey=false;
  for (let at=2; at+1<bytes.length;) {
    if (bytes[at++]!==255) break;
    while(bytes[at]===255) at++;
    const tag=bytes[at++];
    if (tag===217 || tag===218) break;
    if (tag===1 || (tag>=208 && tag<=216)) continue;
    if (at+2>bytes.length) return;
    const length=view.getUint16(at);
    if (length<2 || length>bytes.length-at) return;
    if (tag>=192 && tag<=207 && ![196,200,204].includes(tag) && length>=8) grey=bytes[at+7]===1;
    if (tag===226 && length>=16 && String.fromCharCode(...bytes.subarray(at+2,at+14))==="ICC_PROFILE\0") {
      const part=bytes[at+14], total=bytes[at+15];
      size+=length-16;
      if (!part || part>total || count && total!==count || parts.has(part) || size>MAX_ICC_BYTES) return;
      parts.set(part,bytes.subarray(at+16,at+length));
      count=total;
    }
    at+=length;
  }
  if (!count || parts.size!==count) return;
  const profile=new Uint8Array(size);
  let at=0;
  for(let i=1;i<=count;i++){ const part=parts.get(i)!; profile.set(part,at); at+=part.length; }
  return {profile,grey};
}

export async function embeddedIcc(bytes: Uint8Array<ArrayBuffer>, mime:string) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  try {
    if(mime==="image/png") return await pngIcc(bytes,view);
    if(mime==="image/jpeg") return jpegIcc(bytes,view);
    if(mime==="image/tiff") {
      const {byteField,value}=tiffDirectory(bytes);
      const profile=byteField(34675);
      if (profile && profile.length<=MAX_ICC_BYTES) return {profile,grey:value(262)<=1};
    }
    if(mime==="image/webp") {
      const end=Math.min(bytes.length,8+view.getUint32(4,true));
      for(let at=12;at+8<=end;) {
        const size=view.getUint32(at+4,true);
        if(size>end-at-8) return;
        if(view.getUint32(at)===0x49434350) {
          if(size<=MAX_ICC_BYTES) return {profile:bytes.subarray(at+8,at+8+size),grey:false};
          return;
        }
        at+=8+size+(size%2);
      }
    }
  } catch { /* An unreadable embedded profile leaves the encoded image usable. */ }
}
