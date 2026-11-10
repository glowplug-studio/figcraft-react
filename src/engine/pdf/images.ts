import { multiply, type Affine } from "../affine";
import { decodeVariant } from "../image-renderer";
import type { ImageResource } from "../image-resource";
import { jpegHeader } from "../jpeg-header";
import type { ImagePaint } from "../solid-paint";
import { pdfMatrix } from "./graphics";
import { PdfObjects, PdfSurface, ref } from "./objects";

export interface PdfImage {id:number;width:number;height:number}
export class PdfImages {
  private originals=new WeakMap<ImageResource,Map<string,Promise<PdfImage | undefined>>>();
  constructor(private file:PdfObjects) {}
  async pixels(canvas:HTMLCanvasElement,cmyk:boolean,interpolate=false):Promise<PdfImage | undefined> {
    const {width,height}=canvas, ctx=canvas.getContext("2d",{willReadFrequently:true});
    if (!ctx || !width || !height) return;
    const common="/Type /XObject /Subtype /Image /Width "+width+" /Height "+height+" /BitsPerComponent 8"+(interpolate ? " /Interpolate true" : "");
    // Compress in strips with native streams. Holding complete RGBA, CMYK and soft-mask copies
    // at the same time would be particularly expensive for placed photographs.
    const colorStream=new CompressionStream("deflate"), alphaStream=new CompressionStream("deflate");
    const colorBlob=new Response(colorStream.readable).blob(), alphaBlob=new Response(alphaStream.readable).blob();
    const colorOut=colorStream.writable.getWriter(), alphaOut=alphaStream.writable.getWriter();
    let opaque=true, visible=false;
    try {
      const rows=Math.max(1,Math.floor(262144/width));
      for (let y=0;y<height;y+=rows) {
        const pixels=ctx.getImageData(0,y,width,Math.min(rows,height-y)).data, count=pixels.length/4;
        const color=new Uint8Array(count*(cmyk ? 4 : 3)),alpha=new Uint8Array(count);
        for (let i=0,j=0;i<count;i++) {
          const [r,g,b,a]=[pixels[i*4],pixels[i*4+1],pixels[i*4+2],pixels[i*4+3]];
          if (cmyk) {
            const m=Math.max(r,g,b);
            color[j++]=m ? Math.round(255*(m-r)/m) : 0; color[j++]=m ? Math.round(255*(m-g)/m) : 0;
            color[j++]=m ? Math.round(255*(m-b)/m) : 0; color[j++]=255-m;
          } else {color[j++]=r; color[j++]=g; color[j++]=b;}
          alpha[i]=a;if (a!==255) opaque=false;if (a!==0) visible=true;
        }
        await Promise.all([colorOut.write(color),alphaOut.write(alpha)]);
      }
    } finally { await Promise.all([colorOut.close(),alphaOut.close()]); }
    const [colours,alphas]=await Promise.all([colorBlob,alphaBlob]);
    if (!visible) return;
    const mask=opaque ? "" : " /SMask "+ref(this.file.encodedStream(common+" /ColorSpace /DeviceGray",alphas,"FlateDecode"));
    const id=this.file.encodedStream(common+" /ColorSpace /"+(cmyk ? "DeviceCMYK" : "DeviceRGB")+mask,colours,"FlateDecode");
    return {id,width,height};
  }
  placed(resource:ImageResource,p:ImagePaint,cmyk:boolean) {
    let cache=this.originals.get(resource);
    if (!cache) {cache=new Map();this.originals.set(resource,cache);}
    const key=JSON.stringify([p.filters,cmyk]);
    let pending=cache.get(key);
    if (!pending) {pending=this.decode(resource,p,cmyk);cache.set(key,pending);}
    return pending;
  }
  private async decode(resource:ImageResource,p:ImagePaint,cmyk:boolean) {
    const {width,height}=resource;
    if (!width || !height || width>16384 || height>16384 || width*height>134217728) return;
    let bitmap:ImageBitmap;
    try {bitmap=await decodeVariant({resource,width,height,filters:p.filters,profile:"srgb",screen:false},()=>true);}
    catch {return;}
    const canvas=document.createElement("canvas");
    try {
      if (!cmyk && resource.bytes.type==="image/jpeg" && !resource.icc && !Object.values(p.filters).some(Boolean)) {
        const header=jpegHeader(new Uint8Array(await resource.bytes.slice(0,1024*1024).arrayBuffer()));
        if (header && (header.sampling.length===1 || header.sampling.length===3)) {
          const id=this.file.encodedStream("/Type /XObject /Subtype /Image /Interpolate true /BitsPerComponent 8 /Width "+width+
            " /Height "+height+" /ColorSpace /"+(header.sampling.length===1 ? "DeviceGray" : "DeviceRGB"),resource.bytes,"DCTDecode");
          return {id,width,height};
        }
      }
      canvas.width=width;canvas.height=height;
      canvas.getContext("2d")!.drawImage(bitmap,0,0);
      return await this.pixels(canvas,cmyk,true);
    } finally {bitmap.close();canvas.width=canvas.height=0;}
  }
}
export function placeImage(s:PdfSurface,image:PdfImage,xf:Affine) {
  const {width,height}=image;
  s.ops.push("q",pdfMatrix(multiply(xf,[width,0,0,-height,0,height])),s.use("XObject",image.id)+" Do","Q");
}
