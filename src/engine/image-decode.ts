import type { ImageResource } from "./image-resource";
import { decodeTiff } from "./tiff-image";

/** Placement and painting must accept the same pixels, including TIFF on Chromium. */
export async function decodeImageBitmap(resource: ImageResource, width?: number, height?: number): Promise<ImageBitmap> {
  if (resource.unsupportedJpegSampling) throw new Error("Unsupported progressive JPEG component sampling");
  if (!resource.width || !resource.height || resource.width * resource.height * 4 > 512 * 1024 * 1024) throw new Error("Image pixels exceed the browser working limit");
  const options: ImageBitmapOptions = { imageOrientation: "none", resizeQuality: "high",
    ...(width && height ? { resizeWidth: width, resizeHeight: height } : {}) };
  // The native reader assumes sRGB for unknown profiles, including ignored BMP/GIF metadata.
  options.colorSpaceConversion = !resource.icc && resource.profileName?.startsWith("Gamma ") ? "default" : "none";
  const source = resource.bytes.type === "image/tiff"
    ? await decodeTiff(new Uint8Array(await resource.bytes.arrayBuffer())).then(({rgba,width,height}) =>
        createImageBitmap(new ImageData(rgba,width,height),options))
    : await createImageBitmap(resource.bytes,options);
  if (!resource.icc) return source;
  try {
    const {openIccTransform}=await import("./icc-transform");
    const transform=await openIccTransform(new Uint8Array(await resource.icc.bytes.arrayBuffer()),resource.icc.grey);
    if (!transform) throw Error("Could not restore the colour transform");
    try {
      const canvas=new OffscreenCanvas(source.width,source.height);
      const ctx=canvas.getContext("2d",{willReadFrequently:true});
      if(!ctx) throw Error("Could not create the image colour surface");
      ctx.drawImage(source,0,0);
      source.close();
      const rows=Math.max(1,Math.floor(262144/canvas.width));
      for(let y=0;y<canvas.height;y+=rows){
        if(y) await new Promise<void>(resolve=>setTimeout(resolve,0));
        const strip=ctx.getImageData(0,y,canvas.width,Math.min(rows,canvas.height-y));
        transform.convert(strip.data);
        ctx.putImageData(strip,0,y);
      }
      return canvas.transferToImageBitmap();
    } finally {transform.close();}
  } finally {source.close();}
}
