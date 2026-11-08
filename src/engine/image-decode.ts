import type { ImageResource } from "./image-resource";
import { decodeTiff } from "./tiff-image";

/** Placement and painting must accept the same pixels, including TIFF on Chromium. */
export async function decodeImageBitmap(resource: ImageResource, width?: number, height?: number): Promise<ImageBitmap> {
  const options: ImageBitmapOptions = { imageOrientation: "none", resizeQuality: "high",
    ...(width && height ? { resizeWidth: width, resizeHeight: height } : {}) };
  if (resource.bytes.type !== "image/tiff") return createImageBitmap(resource.bytes, options);
  const { rgba, width: iw, height: ih } = await decodeTiff(new Uint8Array(await resource.bytes.arrayBuffer()));
  return createImageBitmap(new ImageData(rgba, iw, ih), options);
}
