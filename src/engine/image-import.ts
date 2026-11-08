import type { Document, NodeId } from "./document";
import { rectanglePaints, withRectanglePaints } from "./document";
import { HierarchyDraft } from "./hierarchy";
import { imageHash, imageResource, type ImageResource } from "./image-resource";
import { imagePixelDensity, placedImageSize } from "./image-placement";
import { parseNodeId, parseNumber } from "./parameters";
import { readPaint } from "./solid-paint";
import { MAX_FILE_BYTES } from "./file-format";

export const rasterFilename = /\.(?:png|jpe?g|webp|gif|bmp|tiff?)$/i;

export function fileData(data: unknown): Uint8Array<ArrayBuffer> {
  if (typeof data !== "string") throw new Error("A base64 file is required");
  const start = data.indexOf(",") + 1;
  const encoded = data.slice(start).trim();
  if (encoded.length > Math.ceil(MAX_FILE_BYTES / 3) * 4) throw new Error("File exceeds the browser import limit");
  const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  if (bytes.length > MAX_FILE_BYTES) throw new Error("File exceeds the browser import limit");
  return bytes;
}

/** Pixel validation is required only when introducing new data. Native archives retain damaged images. */
export async function prepareImage(bytes: Uint8Array<ArrayBuffer>, existing?: Readonly<Record<string, ImageResource>>) {
  let resource = imageResource(bytes);
  if (!resource.width || !resource.height) throw new Error("Unsupported image: its dimensions could not be read");
  if (resource.width * resource.height * 4 > 512 * 1024 * 1024) throw new Error("This image can't be read: it is too large");
  try {
    const bitmap = await createImageBitmap(resource.bytes, { imageOrientation: "none" });
    try {
      if (!bitmap.width || !bitmap.height) throw new Error("No image pixels");
    } finally { bitmap.close(); }
  } catch {
    throw new Error("This image can't be read: the encoded pixels are damaged or unsupported by the browser");
  }
  const hash = await imageHash(resource.bytes);
  const previous = existing?.[hash];
  // Native archives allow legacy member names, including a digest that does not match the contents.
  if (previous && previous.bytes.size === bytes.length && await imageHash(previous.bytes) === hash) resource = previous;
  return { resource, hash, density: imagePixelDensity(bytes) };
}

export function placeImage(before: { document: Document; selection: readonly NodeId[] }, nextId: bigint,
  image: Awaited<ReturnType<typeof prepareImage>>, p: Record<string, unknown>) {
  const { resource, hash, density } = image;
  const mode = typeof p.mode === "string" ? p.mode.toLowerCase() : "fill";
  const paint = readPaint({ type: "image", image: hash, scale_mode: ["fit", "crop", "tile"].includes(mode) ? mode : "fill" });
  const target = p.target == null ? undefined : parseNodeId(p.target);
  const extraBytes = Object.entries(before.document.images ?? {}).reduce((total, [key, stored]) => key === hash ? total : total + stored.bytes.size, resource.bytes.size);
  if (extraBytes > MAX_FILE_BYTES) throw new Error("Image resources exceed the 16 MiB browser archive limit");
  const images = before.document.images?.[hash] === resource ? before.document.images : Object.freeze({ ...before.document.images, [hash]: resource });
  const document = Object.freeze({ ...before.document, images });
  if (target !== undefined) {
    const node = document.nodes[target];
    if (!node || node.kind === "page" || node.kind === "group") throw new Error("Image target must be a layer that can have a fill");
    const painted = withRectanglePaints(node, [...rectanglePaints(node), paint]);
    const nodes = Object.freeze({ ...document.nodes, [target]: painted });
    return { document: Object.freeze({ ...document, nodes }), selection: before.selection, nextId,
      result: { id: target, image: hash, width: node.width, height: node.height, imageProfile: null } };
  }
  const size = placedImageSize(resource.width, resource.height, density,
    p.width == null ? undefined : parseNumber(p.width, "width"), p.height == null ? undefined : parseNumber(p.height, "height"));
  if (size.width < 0 || size.height < 0) throw new Error("Negative image dimensions are not supported");
  const draft = new HierarchyDraft(document);
  const allocated = draft.allocateId(nextId);
  const parent = p.parent == null ? document.currentPage : parseNodeId(p.parent);
  if (!parent) throw new Error("Image placement needs a valid parent");
  const node = withRectanglePaints({ kind: "rectangle" as const, id: allocated.id, name: typeof p.name === "string" ? p.name : "Image",
    parent, x: parseNumber(p.x ?? 0, "x"), y: parseNumber(p.y ?? 0, "y"), ...size, fill: "transparent" }, [paint]);
  draft.insert(node, parent);
  draft.normaliseGroups();
  return { document: draft.finish(), nextId: allocated.nextId, selection: Object.freeze([allocated.id]),
    result: { id: allocated.id, image: hash, ...size, imageProfile: null } };
}
