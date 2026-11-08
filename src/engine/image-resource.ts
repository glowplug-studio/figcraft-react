import { BMP } from "image-size/types/bmp";
import { GIF } from "image-size/types/gif";
import { pngProfileName } from "./image-profile";
import { jpegHeader } from "./jpeg-header";
import { PNG } from "image-size/types/png";
import { tiffDimensions } from "./tiff-directory";
import { WEBP } from "image-size/types/webp";

export const MAX_IMAGE_BYTES = 256 * 1024 * 1024;
export interface ImageResource {
  readonly bytes: Blob;
  readonly width: number;
  readonly height: number;
  readonly unsupportedJpegSampling?: true;
  readonly profileName?: string;
}

const readers = [
  ["image/png",PNG], ["image/webp",WEBP],
  ["image/gif",GIF], ["image/bmp",BMP], ["image/tiff",{
    validate: (bytes: Uint8Array) => bytes.length >= 8 && ((bytes[0] === 73 && bytes[1] === 73 && bytes[3] === 0 && (bytes[2] === 42 || bytes[2] === 43))
      || (bytes[0] === 77 && bytes[1] === 77 && bytes[2] === 0 && (bytes[3] === 42 || bytes[3] === 43))),
    calculate: tiffDimensions,
  }],
] as const;

export function validImageKey(key:string):boolean {
  return key.length >= 1 && key.length <= 128 && !/[^a-zA-Z0-9_-]/.test(key);
}

/** Saving and collaboration use SHA-256 content keys. Some native imports use safe legacy keys. */
export async function imageHash(bytes:Blob):Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256",await bytes.arrayBuffer()));
  return Array.from(hash,byte=>byte.toString(16).padStart(2,"0")).join("");
}

/** Native archives keep encoded members even when dimensions cannot be read. */
export function imageResource(data:Uint8Array<ArrayBuffer>):ImageResource {
  if (data.length > MAX_IMAGE_BYTES) throw new Error("Image data exceeds the native 256 MiB member limit");
  if (data[0] === 255 && data[1] === 216) {
    const jpeg = jpegHeader(data);
    if (jpeg?.width && jpeg.height) return Object.freeze({
      width: jpeg.width, height: jpeg.height, bytes: new Blob([data], {type:"image/jpeg"}),
      ...(jpeg.unsupportedSampling && {unsupportedJpegSampling: true as const}),
    });
  }
  let width=0, height=0, mime="application/octet-stream";
  try {
    const format = readers.find(([,reader])=>reader.validate(data));
    if (format) {
      const [type,reader] = format;
      // The OS/2 core header stores two unsigned 16-bit sizes, unlike the Windows info header.
      const view = new DataView(data.buffer,data.byteOffset,data.byteLength);
      const size = type === "image/bmp" && view.getUint32(14,true) === 12
        ? {width:view.getUint16(18,true),height:view.getUint16(20,true)} : reader.calculate(data);
      if (Number.isSafeInteger(size.width) && size.width>0 && Number.isSafeInteger(size.height) && size.height>0) {
        width=size.width; height=size.height; mime=type;
      }
    }
  } catch { /* The native archive retains unreadable bytes with dimensions 0 × 0. */ }
  const profileName = mime === "image/png" ? pngProfileName(data) : undefined;
  return Object.freeze({width,height,bytes:new Blob([data],{type:mime}),...(profileName === undefined ? {} : {profileName})});
}
