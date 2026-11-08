import { BMP } from "image-size/types/bmp";
import { GIF } from "image-size/types/gif";
import { embeddedIcc } from "./icc-container";
import { iccDescription, pngProfileName } from "./image-profile";
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
  readonly icc?: {readonly bytes:Blob; readonly grey:boolean};
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
export async function imageHash(bytes:Blob | Uint8Array<ArrayBuffer>):Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes instanceof Blob ? await bytes.arrayBuffer() : bytes));
  return Array.from(hash,byte=>byte.toString(16).padStart(2,"0")).join("");
}

/** Native archives keep encoded members even when dimensions cannot be read. */
export function imageResource(data:Uint8Array<ArrayBuffer>, original?: Blob):ImageResource {
  if (!original && data.length > MAX_IMAGE_BYTES) throw new Error("Image data exceeds the native 256 MiB member limit");
  const encoded = (type: string) => original ? original.slice(0, original.size, type) : new Blob([data], {type});
  if (data[0] === 255 && data[1] === 216) {
    const jpeg = jpegHeader(data);
    if (jpeg?.width && jpeg.height) return Object.freeze({
      width: jpeg.width, height: jpeg.height, bytes: encoded("image/jpeg"),
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
  return Object.freeze({width,height,bytes:encoded(mime),...(profileName === undefined ? {} : {profileName})});
}

/** Only compressed colour metadata and transform validation require asynchronous work. */
export async function readImageResource(bytes:Uint8Array<ArrayBuffer>, resource = imageResource(bytes)):Promise<ImageResource> {
  if (!resource.width || !resource.height) return resource;
  const embedded=await embeddedIcc(bytes,resource.bytes.type);
  if (!embedded) return resource;
  const description=iccDescription(embedded.profile);
  if (!description) return resource;
  const {openIccTransform}=await import("./icc-transform");
  const transform=await openIccTransform(embedded.profile,description.grey);
  if (!transform) return resource;
  transform.close();
  const icc=description.grey && !embedded.grey ? undefined :
    Object.freeze({bytes:new Blob([embedded.profile]),grey:description.grey});
  return Object.freeze({...resource,profileName:description.name,icc});
}

/** PNG colour metadata precedes IDAT; the pixels and trailing chunks need no heap copy. */
function pngMetadataComplete(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 8; at + 8 <= bytes.length;) {
    const tag = view.getUint32(at + 4);
    if (tag === 0x49444154 || tag === 0x49454e44) return true;
    at += 12 + view.getUint32(at);
  }
  return false;
}

/** Unknown image members survive native round trips without bringing their payload into JS memory. */
export async function archivedImage(blob: Blob) {
  const header = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  const first = imageResource(header, blob);
  const png = header[0] === 137 && header[1] === 80 && header[2] === 78 && header[3] === 71;
  const hasLongMetadata = png || header[0] === 255 && header[1] === 216
    || header[0] === 82 && header[1] === 73 && header[2] === 70 && header[3] === 70
    || header[0] === 73 && header[1] === 73 || header[0] === 77 && header[1] === 77;
  if (!hasLongMetadata) return {resource: first};
  let resource = first;
  try {
    const prefix = png ? new Uint8Array(await blob.slice(0, 65536).arrayBuffer()) : undefined;
    const bytes = prefix && (prefix.length === blob.size || pngMetadataComplete(prefix)) ? prefix : new Uint8Array(await blob.arrayBuffer());
    resource = imageResource(bytes, blob);
    return {resource: await readImageResource(bytes, resource)};
  } catch {
    return {resource, profileUnavailable: true};
  }
}
