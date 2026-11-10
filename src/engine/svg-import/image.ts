import { prepareImage } from "../image-import";
import type { ImageResource } from "../image-resource";
import { svgBytes,svgXml } from "./xml";

type Raster=Awaited<ReturnType<typeof prepareImage>>;
type Source={kind:"svg";root:Element} | {kind:"raster";image:Raster};
const maxEmbedded=32<<20;
const maxDepth=4;

// The upstream SVG importer names unmodified image bytes with two FNV-1a lanes.
export function svgImageKey(bytes:Uint8Array) {
  const lane=(high:number,low:number,indexed:boolean)=>{
    for(let i=0;i<bytes.length;i++) {
      const bits=(low^(bytes[i]+(indexed ? i : 0)))>>>0;
      const product=bits*435;
      high=(Math.imul(high,435)+(bits<<8)+Math.floor(product/0x100000000))>>>0;
      low=product>>>0;
    }
    return high.toString(16).padStart(8,"0")+low.toString(16).padStart(8,"0");
  };
  return lane(0xcbf29ce4,0x84222325,false)+lane(0x84222325,0xcbf29ce4,true);
}

function dataUri(href:string) {
  const i=href.indexOf(",");
  if (!href.startsWith("data:") || i<5) return;
  const params=href.slice(5,i).toLowerCase().split(";");
  const mime=params[0] || "text/plain";
  if (!["image/jpeg","image/jpg","image/png","image/webp","image/gif","image/svg+xml","text/plain"].includes(mime)) return;
  let data=href.slice(i+1);
  if (params.includes("base64")) {
    if (data.includes("%")) data=decodeURIComponent(data);
    return {mime,bytes:Uint8Array.from(atob(data),c=>c.charCodeAt(0))};
  }
  const raw=new TextEncoder().encode(data);
  const bytes=new Uint8Array(raw.length);
  let j=0;
  for(let k=0;k<raw.length;k++) {
    if (raw[k]===37 && k+2<raw.length) {
      const digits=String.fromCharCode(raw[k+1],raw[k+2]);
      if (/^[0-9a-f]{2}$/i.test(digits)) {bytes[j++]=parseInt(digits,16);k+=2;continue;}
    }
    bytes[j++]=raw[k];
  }
  return {mime,bytes:bytes.subarray(0,j)};
}

export function svgImages() {
  const rasters=new Map<string,Raster|null>();
  let left=maxEmbedded;
  return async function resolve(el:Element,depth:number,existing?:Readonly<Record<string,ImageResource>>):Promise<Source|undefined> {
    const href=el.getAttribute("href") ?? el.getAttributeNS("http://www.w3.org/1999/xlink","href");
    if (!href?.startsWith("data:")) return;
    if (rasters.has(href)) {
      const image=rasters.get(href);
      return image ? {kind:"raster",image} : undefined;
    }
    let data;
    try {data=dataUri(href);} catch {return;}
    if (!data) return;
    const {bytes,mime}=data;
    const raster=mime!=="image/svg+xml" && (mime!=="text/plain" || bytes[0]===137 || bytes[0]===255 || bytes[0]===71 || String.fromCharCode(...bytes.subarray(8,12))==="WEBP");
    if (raster) {
      try {
        const prepared=await prepareImage(bytes,existing);
        const key=svgImageKey(bytes),previous=existing?.[key];
        const image=!previous || previous.digest===prepared.hash ? {...prepared,hash:key,resource:previous ?? prepared.resource} : prepared;
        rasters.set(href,image);
        return {kind:"raster",image};
      } catch {rasters.set(href,null);return;}
    }
    if (depth>=maxDepth || !left) return;
    let plain:Uint8Array;
    try {plain=await svgBytes(bytes,left);} catch {left=0;return;}
    left-=plain.length;
    try {return {kind:"svg",root:svgXml(plain)};} catch {return;}
  };
}
