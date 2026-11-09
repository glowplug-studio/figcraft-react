import type { Document, NodeId } from "./document";
import { rectanglePaints, withRectanglePaints } from "./document";
import { pixelRound } from "./geometry";
import { HierarchyDraft } from "./hierarchy";
import { selectedRegionFills, writeFill } from "./fill-commands";
import type { VectorEditState } from "./vector-edit";
import { editImagePaints } from "./image-commands";
import { decodeImageBitmap } from "./image-decode";
import { MAX_IMAGE_BYTES, imageHash, imageResource, readImageResource, type ImageResource } from "./image-resource";
import { imagePixelDensity, placedImageSize } from "./image-placement";
import { parseNodeId, parseNumber, parseString } from "./parameters";
import { readPaint } from "./solid-paint";
import { MAX_UNPACKED_BYTES } from "./file-format";

export const rasterFilename = /\.(?:png|jpe?g|webp|gif|bmp|tiff?)$/i;

/** Native file.import places a raster's top left at the supplied coordinates or view centre. */
export function rasterImportParams(params: Record<string,unknown>, centre: {cx:number; cy:number}) {
  const {x,y,variables} = params, name = parseString(params.name) ?? "import.png";
  if (variables != null) {
    const json = typeof variables === "string" ? JSON.parse(variables) : variables;
    const object = (v:unknown): v is Record<string,unknown> => !!v && typeof v === "object" && !Array.isArray(v);
    if (!object(json) || ![json.meta,json].some(v=>object(v) && object(v.variableCollections))) {
      throw new Error("variables requires the local variables JSON");
    }
  }
  if (/\.(?:svg|figcraft|json|fig|jam|sketch|penpot)$/i.test(name)) throw new Error("This design-file import requires its format adapter");
  const base = name.split(/[\\/]/).pop() || "Untitled", dot = base.lastIndexOf(".");
  const coordinate = (value: unknown, fallback: number) => {
    try { return parseNumber(value); } catch { return fallback; }
  };
  return {name:dot > 0 ? base.slice(0,dot) : base, x:coordinate(x,centre.cx), y:coordinate(y,centre.cy)};
}

export function centrePastedImage(image: Awaited<ReturnType<typeof prepareImage>>, centre: {cx:number; cy:number}) {
  const {width,height} = placedImageSize(image.resource.width,image.resource.height,image.density);
  return {x:pixelRound(centre.cx-width/2), y:pixelRound(centre.cy-height/2)};
}

export function fileData(data: unknown, limit = MAX_IMAGE_BYTES): Uint8Array<ArrayBuffer> {
  if (typeof data !== "string") throw new Error("A base64 file is required");
  const start = data.indexOf(",") + 1;
  const encoded = data.slice(start).replace(/[ \t\r\n\f]/g, "");
  const padding = encoded.indexOf("=");
  if (padding >= 0 && padding < encoded.length - 2) throw new Error("Invalid base64 padding");
  const length = Math.floor((padding < 0 ? encoded.length : padding) * 3 / 4);
  if (length > limit) throw new Error("File exceeds the browser import limit");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (let i = 0; i < encoded.length; i += 65536) {
    const chunk = atob(encoded.slice(i, i + 65536));
    for (let j = 0; j < chunk.length; j++) bytes[offset++] = chunk.charCodeAt(j);
  }
  return bytes;
}

/** Pixel validation is required only when introducing new data. Native archives retain damaged images. */
export async function prepareImage(bytes: Uint8Array<ArrayBuffer>, existing?: Readonly<Record<string, ImageResource>>, maxPixels = 512 * 1024 * 1024 / 4, original?: Blob) {
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error("Image exceeds the 256 MiB external input limit");
  let resource = await readImageResource(bytes, imageResource(bytes, original));
  if (!resource.width || !resource.height) throw new Error("Unsupported image: its dimensions could not be read");
  if (resource.width * resource.height > maxPixels) throw new Error("This image can't be read: it is too large");
  try {
    const bitmap = await decodeImageBitmap(resource);
    try {
      if (!bitmap.width || !bitmap.height) throw new Error("No image pixels");
    } finally { bitmap.close(); }
  } catch {
    throw new Error("This image can't be read: the encoded pixels are damaged or unsupported by the browser");
  }
  const hash = await imageHash(bytes);
  const previous = existing?.[hash];
  // Native archives allow legacy member names, including a digest that does not match the contents.
  if (previous && previous.bytes.size === bytes.length && (previous.digest ?? await imageHash(previous.bytes)) === hash) resource = previous;
  if (!resource.digest) resource = Object.freeze({...resource, digest: hash});
  return { resource, hash, density: imagePixelDensity(bytes) };
}

export function withImageResource(document: Document, {hash, resource}: {hash: string; resource: ImageResource}) {
  if (document.images && Object.hasOwn(document.images,hash) && document.images[hash] === resource) return document;
  if (document.images && !Object.hasOwn(document.images,hash) && Object.keys(document.images).length >= 20_000) throw new Error("Too many images for a native archive");
  const extraBytes = Object.entries(document.images ?? {}).reduce((total, [key, stored]) => key === hash ? total : total + stored.bytes.size, resource.bytes.size);
  if (extraBytes > MAX_UNPACKED_BYTES) throw new Error("Image resources exceed the 2 GiB browser unpacked limit");
  return Object.freeze({ ...document, images: Object.freeze({ ...document.images, [hash]: resource }) });
}

export function replaceImage(before: { document: Document; selection: readonly NodeId[] }, nextId: bigint,
  image: Awaited<ReturnType<typeof prepareImage>>, p: Record<string, unknown>, regionState?: VectorEditState) {
  const node = before.document.nodes[before.selection[0]];
  if (regionState && before.selection.length === 1 && node && node.kind !== "page" && p.target === "fill") {
    const list = selectedRegionFills(node, regionState);
    if (list !== undefined) {
      const previous = list?.[Number(p.index)];
      if (!previous) throw new Error("The selected regions have no shared paint at this index");
      const {opacity, visible, colorAlpha, blend} = previous;
      const paint = readPaint({type:"image", image:image.hash, opacity, visible, colorAlpha, blend});
      const document = writeFill("fill.set", before.document, before.selection, {...p, paint}, regionState);
      return {document:withImageResource(document,image), nextId, selection:before.selection,
        result:{image:image.hash, width:image.resource.width, height:image.resource.height, changed:1}};
    }
  }
  const edit = editImagePaints(before.document, before.selection, p, image.hash);
  return { document: withImageResource(edit.document, image), nextId, selection: before.selection,
    result: { ...edit.result, image: image.hash, width: image.resource.width, height: image.resource.height } };
}

export function placeImage(before: { document: Document; selection: readonly NodeId[] }, nextId: bigint,
  image: Awaited<ReturnType<typeof prepareImage>>, p: Record<string, unknown>) {
  const { resource, hash, density } = image;
  const mode = typeof p.mode === "string" ? p.mode.toLowerCase() : "fill";
  const paint = readPaint({ type: "image", image: hash, scale_mode: ["fit", "crop", "tile"].includes(mode) ? mode : "fill" });
  const target = p.target == null ? undefined : parseNodeId(p.target);
  const document = withImageResource(before.document, image);
  if (target !== undefined) {
    const node = document.nodes[target];
    if (!node || node.kind === "page" || node.kind === "group") throw new Error("Image target must be a layer that can have a fill");
    const painted = withRectanglePaints(node, [...rectanglePaints(node), paint]);
    const nodes = Object.freeze({ ...document.nodes, [target]: painted });
    return { document: Object.freeze({ ...document, nodes }), selection: before.selection, nextId,
      result: { id: target, image: hash, width: node.width, height: node.height, imageProfile: resource.profileName ?? null } };
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
    result: { id: allocated.id, image: hash, ...size, imageProfile: resource.profileName ?? null } };
}
