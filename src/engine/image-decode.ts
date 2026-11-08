import type { ImageResource } from "./image-resource";
import { decodeTiff } from "./tiff-image";

/** Placement and painting must accept the same pixels, including TIFF on Chromium. */
export async function decodeImageBitmap(resource: ImageResource, width?: number, height?: number): Promise<ImageBitmap> {
  if (resource.unsupportedJpegSampling) throw new Error("Unsupported progressive JPEG component sampling");
  if (!resource.width || !resource.height || resource.width * resource.height * 4 > 512 * 1024 * 1024) throw new Error("Image pixels exceed the browser working limit");
  const options: ImageBitmapOptions = { imageOrientation: "none", resizeQuality: "high",
    ...(width && height ? { resizeWidth: width, resizeHeight: height } : {}) };
  if (resource.bytes.type !== "image/tiff") return createImageBitmap(resource.bytes, options);
  const { rgba, width: iw, height: ih } = await decodeTiff(new Uint8Array(await resource.bytes.arrayBuffer()));
  return createImageBitmap(new ImageData(rgba, iw, ih), options);
}
