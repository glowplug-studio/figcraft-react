import {readImportedRecords,readLibraryLinks,wireLibraryLinks,keepLibraryAssets,libraryImageKeys,readLibraryManifest,wireLibraryManifest,type PublishedLibrary} from "./published-library";
import { emptyVariables, readVariables } from "./variables";
import { readLayerStyles, readSharedStyles, wireSharedStyle } from "./shared-styles";
import { readComponentLinks, wireComponentLinks, readFrameKind, wireFrameKind } from "./component-properties";
import { layerSizing, readAutoLayout, readChildLayout, wireAutoLayout, wireChildLayout } from "./auto-layout";
import { U64_MAX, appearanceValue, fail, id, idString, number, wireId, wirePaints } from "./native-values";
import { readTextData, wireTextData } from "./text-data";
import { readEffects, wireEffect } from "./effects";
import { isBlendMode, type BlendMode } from "./blend";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { readNativeJson } from "./native-json";
import { readVectorNetwork, wireVectorNetwork } from "./vector-codec";
import { isFrameLikeKind, isFrameLike, isMaskType, layerBlend, isBooleanOperation, isLeaf, isLeafKind } from "./document";
import { type Corners, type Radii } from "./corners";
import { readImageFilters } from "./image-filters";
import { archivedImage, validImageKey, type ImageResource } from "./image-resource";
import { BlobReader, BlobWriter, ZipWriter, ERR_INVALID_CRC32, ERR_INVALID_UNCOMPRESSED_SIZE, Reader, ZipReader, type Entry, type FileEntry } from "@zip.js/zip.js/lib/zip-core-native.js";
import { isLosslessNumber, parse, stringify } from "lossless-json";
import { readConstraints } from "./constraints";
import { layerTransform, withLayerTransform, rectanglePaints, withRectanglePaints, pageColour, withPageColour, type Document, type DocumentNode } from "./document";
import { parseColour } from "./colour-css";
import type { Colour } from "./colour";
import { readPaints } from "./solid-paint";
import { isDefaultStroke, readStroke, wireStroke } from "./stroke";
import { transformBounds, type Affine } from "./affine";

/** A deliberately bounded adapter for native format v1, not full archive parity.
 * Source: original/figcraft/crates/{format/src/lib.rs,doc/src/{lib,node,props}.rs}.
 * Unsupported data is rejected, never opened and silently discarded on save.
 * Root fields and node records are parsed separately for large JSON files.
 * zip.js checks metadata, bounds inflation and verifies CRC32 for each member.
 */
export const MAX_DOCUMENT_BYTES = 1024 ** 3;
export const MAX_ARCHIVE_MEMBER = 512 * 1024 * 1024;
export const MAX_UNPACKED_BYTES = 2 * 1024 ** 3; // Native browser target.
const MAX_DIRECTORY_READ = 16 * 1024 * 1024;
export const FIGCRAFT_TREE_DEPTH_LIMIT = 256;
type ObjectValue = Record<string, unknown>;
const IMAGE_COUNT_LIMIT = 20_000;
export interface DecodedFigcraft { document: Document; nextId: string; issues?: readonly string[] }

function nativeEffects(value: unknown) {
  try { return readEffects(appearanceValue(value), "archive"); }
  catch (error) { return fail(error instanceof Error ? error.message : "Invalid effects"); }
}
function nativeNetwork(value: unknown): ReturnType<typeof readVectorNetwork> {
  try { return readVectorNetwork(appearanceValue(value)); }
  catch (error) { return fail(error instanceof Error ? error.message : "Invalid vector network"); }
}
function object(value: unknown, path: string): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value) || isLosslessNumber(value)) fail(`${path} must be an object`);
  return value as ObjectValue;
}
function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  return value;
}
function text(value: unknown, path: string): string {
  if (typeof value !== "string") fail(`${path} must be text`);
  return value;
}
// Serde's defaulted structs accept omitted members. Explicit non-default values
// are refused even when they would not currently affect the canvas appearance.
function defaultValue(value: unknown, expected: unknown, path: string): void {
  if (typeof expected === "number") {
    if (number(value, path) !== expected) fail(`${path} is not supported yet`);
  } else if (Array.isArray(expected)) {
    const actual = list(value, path);
    if (actual.length !== expected.length) fail(`${path} is not supported yet`);
    actual.forEach((item, index) => defaultValue(item, expected[index], `${path}/${index}`));
  } else if (expected && typeof expected === "object") {
    fields(object(value, path), [], expected as ObjectValue, path);
  } else if (value !== expected) fail(`${path} is not supported yet`);
}
function fields(value: ObjectValue, supported: string[], defaults: ObjectValue, path: string): void {
  for (const [key, entry] of Object.entries(value)) {
    if (supported.includes(key)) continue;
    if (!Object.hasOwn(defaults, key)) fail(`${path}/${key} is not supported yet`);
    defaultValue(entry, defaults[key], `${path}/${key}`);
  }
}
const documentDefaults = {
  kind: "design",
  comments: [],
  libraries: { enabled: [], store: null, components: [], styles: [], collections: [], variables: [], detached: [], inserted: [] },
  annotation_categories: null, dev_snapshots: {}, timer: null,
  vote: null, votes: {}, vote_history: [],
};
const nodeDefaults = {
  visible: true, locked: false, opacity: 1, strokes: [], effects: [],
  stroke: { weight: 1, align: "inside", sides: null, cap_start: "none", cap_end: "none", join: "miter", miter_limit: 4, dashes: [], dash_cap: null, width_profile: null, brush: null },
  corners: { radii: [0, 0, 0, 0], smoothing: 0 }, constraints: { horizontal: "left", vertical: "top" }, layout: null,
  child_layout: { sizing_h: "fixed", sizing_v: "fixed", absolute: false, min_w: null, max_w: null, min_h: null, max_h: null, grid_column: null, grid_row: null, grid_column_span: 0, grid_row_span: 0, grid_align_h: null, grid_align_v: null },
  clip: false, is_mask: false, mask_type: "alpha", guides: [], exports: [], interactions: [],
  overflow: "none", scroll_position: "scrolls",
  bound: {}, var_modes: {}, bool_op: null, constrain_proportions: false, source: null, exposed: false,
  dev_status: "none", dev_changed: false, dev_note: "", overrides: [], prop_refs: {}, plugin_data: {},
  annotations: [], code_links: [], dev_resources: [], measurements: [], board: null,
};

function nativeColour(value: unknown, path: string): Colour {
  const result = parseColour(appearanceValue(value));
  if (!result) fail(`${path}: invalid colour`);
  return result;
}
const textFields = [ "characters", "style", "runs", "auto_resize", "align_h", "align_v", "paragraph_spacing",
  "paragraph_indent", "list", "paragraphs", "list_spacing", "hanging_punctuation", "hanging_list",
  "leading_trim", "max_lines", "wrap_style", "features", "path", "saved_breaks"];

function readNode(key: string, value: unknown): DocumentNode {
  idString(key, "node map key");
  const n = object(value, `node ${key}`), kind = n.type;
  if (id(n.id, "node ID") !== key) fail(`node ${key} has a mismatched ID`);
  if (kind !== "page" && kind !== "group" && kind !== "booleanOp" && !isFrameLikeKind(kind) && !isLeafKind(kind)) fail(`node type ${String(kind)} is not supported yet`);
  const componentFields = kind === "component" ? ["description", "props", "prop_order"]
    : kind === "componentSet" ? ["description"] : kind === "instance" ? ["component", "props"] : [];
  fields(n, [...componentFields, "bound", "var_modes", "styles", "grids", "overrides", "source", "prop_refs", "exposed", "id", "name", "type", "parent", "children", "transform", "width", "height", "fills", "blend", "effects", "is_mask", "mask_type", ...(kind === "page" ? ["background", "flows", "prototype", "strokes"] : ["bool_op", "child_layout", ...(kind === "booleanOp" ? ["op"] : kind === "ellipse" ? ["start", "sweep", "inner"] : kind === "star" ? ["count", "inner_ratio"] : kind === "polygon" ? ["count"] : kind === "vector" ? ["network"] : kind === "text" ? textFields : []), "stroke", "strokes", "visible", "locked", "opacity", "corners", "constraints", "constrain_proportions", ...(isFrameLikeKind(kind) ? ["clip", "layout"] : [])])], nodeDefaults, `node ${key}`);
  const modes=n.var_modes===undefined ? [] : Object.entries(object(n.var_modes,"layer variable modes"));
  const variableModes=modes.length ? Object.freeze(Object.fromEntries(modes.map(([k,v])=>[k,text(v,"variable mode ID")]))) : undefined;
  const bindings=Object.entries(n.bound===undefined ? {} : object(n.bound,"layer variable bindings"));
  const boundVariables=bindings.length ? Object.freeze(Object.fromEntries(bindings.map(([k,v])=>[k,text(v,"variable ID")]))) : undefined;
  const links = { ...(boundVariables && {boundVariables}), ...(variableModes && {variableModes}), ...readComponentLinks(n), ...readLayerStyles(n) };
  if (n.is_mask !== undefined && typeof n.is_mask !== "boolean") fail("is_mask must be boolean");
  if (n.mask_type !== undefined && !isMaskType(n.mask_type)) fail("mask_type must be alpha, vector or luminance");
  const effects = n.effects === undefined ? undefined : nativeEffects(n.effects);
  const mask = {...(n.is_mask === true && {isMask:true}),...(n.mask_type && n.mask_type !== "alpha" ? {maskType:n.mask_type} : {})};
  const name = text(n.name, "node name"), width = number(n.width, "width"), height = number(n.height, "height");
  if (width < 0 || height < 0) fail("negative dimensions are not supported yet");
  const transform = list(n.transform ?? [1, 0, 0, 1, 0, 0], "transform").map((entry) => number(entry, "transform"));
  if (transform.length !== 6) fail("transform needs six coefficients");
  const matrix = transform as unknown as Affine;
  transformBounds(matrix, width, height);
  const children = list(n.children ?? [], "children").map((entry) => id(entry, "child ID"));
  if (kind === "page") {
    if (n.parent != null || width !== 0 || height !== 0 || transform.some((entry, index) => entry !== [1, 0, 0, 1, 0, 0][index])) fail("non-default page geometry is not supported yet");
    defaultValue(n.blend ?? "passThrough", "passThrough", "page blend");
    const fills = readPaints(appearanceValue(n.fills ?? []));
    const strokes = readPaints(appearanceValue(n.strokes ?? []));
    defaultValue(n.flows ?? [], [], "page flows");
    let prototypeBackground: Colour | undefined;
    if (n.prototype !== undefined) {
      const prototype = object(n.prototype, "prototype");
      fields(prototype, ["background"], { device: "None", rotation: "portrait", color: "", custom_size: [1280, 720], customSize: [1280, 720], responsive: false }, "prototype");
      if (prototype.background !== undefined) {
        const background = nativeColour(prototype.background, "prototype background"), expected = nativeColour("#1e1e1e", "prototype default");
        if (Object.keys(expected).some(key => background[key as keyof Colour] !== expected[key as keyof Colour])) prototypeBackground = background;
      }
    }
    return withPageColour({ ...links, ...(fills.length && {fills}), ...(strokes.length && {strokes}), ...mask, ...(effects?.length && { effects }), ...(prototypeBackground && {prototypeBackground}), id: key, kind, name, parent: null, children: Object.freeze(children), background: "#f5f5f5" }, nativeColour(n.background ?? "#f5f5f5", "page background"));
  } else {
    if (isLeafKind(kind) && children.length) fail("leaf children are not supported");
    if (n.blend !== undefined && !isBlendMode(n.blend)) fail(`${kind} blend is not supported yet`);
    if (n.visible !== undefined && typeof n.visible !== "boolean" || n.locked !== undefined && typeof n.locked !== "boolean") fail("node visibility/lock must be boolean");
    if (n.constrain_proportions !== undefined && typeof n.constrain_proportions !== "boolean") fail("constrain_proportions must be boolean");
    const opacity = Math.fround(number(n.opacity ?? 1, "node opacity"));
    if (!Number.isFinite(opacity)) fail("node opacity is outside the native finite range");
    const paints = (() => {
      try { return readPaints(appearanceValue(n.fills ?? [])); }
      catch (error) { return fail(error instanceof Error ? error.message : "Invalid paints"); }
    })();
    const strokeData = (() => {
      try {
        const stroke = readStroke(appearanceValue(n.stroke)), strokes = readPaints(appearanceValue(n.strokes ?? []));
        return { ...(isDefaultStroke(stroke) ? {} : { stroke }), ...(strokes.length ? { strokes } : {}) };
      }
      catch (error) { return fail(error instanceof Error ? error.message : "Invalid stroke"); }
    })();
    let corners: Corners | undefined;
    if (n.corners !== undefined) {
      const value = object(n.corners, "corners");
      fields(value, ["radii", "smoothing"], {}, "corners");
      const rawRadii = value.radii === undefined ? [0, 0, 0, 0] : value.radii;
      if (!Array.isArray(rawRadii) || rawRadii.length !== 4) fail("corners.radii must contain four numbers");
      const radii = (rawRadii as unknown[]).map(v => number(v, "radius"));
      const smoothing = number(value.smoothing === undefined ? 0 : value.smoothing, "smoothing");
      if (smoothing !== 0 || radii.some(r => r !== 0)) corners = Object.freeze({ radii: Object.freeze(radii) as unknown as Radii, smoothing });
    }
    const constraints = readConstraints(n.constraints === undefined ? {} : n.constraints);
    if (isFrameLikeKind(kind) && n.clip !== undefined && typeof n.clip !== "boolean") fail("frame clip must be boolean");
    if (n.bool_op != null && !isBooleanOperation(n.bool_op)) fail("invalid operand operation");
    const op = kind === "booleanOp" ? (isBooleanOperation(n.op) ? n.op : fail("invalid boolean group operation")) : undefined;
    const layer = { ...links, ...(n.child_layout !== undefined && readChildLayout(n.child_layout, kind === "text")), ...(isBooleanOperation(n.bool_op) ? { boolOp: n.bool_op } : {}), id: key, kind, name, ...strokeData, ...(corners ? { corners } : {}), parent: id(n.parent, `${kind} parent`), x: transform[4]!, y: transform[5]!, width, height, fill: "transparent", ...(constraints.horizontal !== "left" || constraints.vertical !== "top" ? { constraints } : {}),
      ...mask, ...(effects?.length && { effects }), ...(n.constrain_proportions === true ? { constrainProportions: true } : {}), ...(n.visible === false ? { visible: false } : {}), ...(n.locked === true ? { locked: true } : {}), ...(opacity !== 1 ? { opacity } : {}),
      ...(n.blend !== undefined && n.blend !== (!isLeafKind(kind) ? "passThrough" : "normal") ? { blend: n.blend as BlendMode } : {}) };
    let count = 0;
    if (kind === "polygon" || kind === "star") {
      if (isLosslessNumber(n.count) && (!/^(0|[1-9][0-9]*)$/.test(n.count.value) || n.count.value.length > 10)) fail("point count must be a u32");
      count = number(n.count, "point count");
      if (!Number.isInteger(count) || count < 0 || count > 4294967295) fail("point count must be a u32");
    }
    return !isLeafKind(kind)
      ? Object.freeze({ ...withRectanglePaints(withLayerTransform({ ...layer, ...(isFrameLikeKind(kind) ? { ...readFrameKind(kind, n), clip: n.clip === true, ...(n.layout != null && {layout: readAutoLayout(n.layout)}) } : op ? { kind: "booleanOp" as const, op } : { kind: "group" as const }), children: Object.freeze(children), blend: (n.blend ?? "passThrough") as BlendMode }, matrix), paints), fills: paints })
      : withRectanglePaints(withLayerTransform(kind === "ellipse" ? { ...layer, kind, start: number(n.start === undefined ? 0 : n.start, "arc start"), sweep: number(n.sweep === undefined ? 2 * Math.PI : n.sweep, "arc sweep"), inner: number(n.inner === undefined ? 0 : n.inner, "arc inner") } : kind === "polygon" ? { ...layer, kind, count } : kind === "star" ? { ...layer, kind, count, innerRatio: number(n.inner_ratio, "inner ratio") } : kind === "vector" ? { ...layer, kind, network: nativeNetwork(n.network) } : kind === "text" ? { ...layer, kind, text: readTextData(n), ...(Array.isArray(n.overrides) && n.overrides.includes("characters") && {charactersOverridden: true as const}) } : { ...layer, kind }, matrix), paints);
  }
}

function decodeDocument(raw: unknown, parsedNodes?: Record<string,DocumentNode>): DecodedFigcraft {
  const root = object(raw, "document");
  if (root.version !== undefined && number(root.version, "version") > 1) fail("this file needs a newer Figcraft format reader");
  if (root.version !== undefined && number(root.version, "version") !== 1) fail("unsupported format version");
  if (root.format !== undefined && root.format !== "figcraft") fail("unrecognised format");
  fields(root, ["libraries", "variables", "styles", "format", "version", "name", "pages", "nodes", "next_id", "current_page", "imageIndex", "image_presets", "document_colors", "color_profile"], documentDefaults, "document");
  const libraries=root.libraries===undefined ? {} : object(root.libraries,"libraries");
  fields(libraries,["enabled","variables","collections"],documentDefaults.libraries,"libraries");
  const libraryRecords=readImportedRecords(libraries);
  const libraryLinks=readLibraryLinks(libraries.enabled);
  const profile = root.color_profile === undefined ? "srgb" : root.color_profile;
  if (profile !== "srgb" && profile !== "displayP3") fail("invalid document colour profile");
  const palette = root.document_colors === undefined ? [] : list(root.document_colors, "document colors").map(c => nativeColour(c, "document color"));
  const presets = root.image_presets === undefined ? [] : list(root.image_presets, "image presets").map(entry => {
    const preset = object(entry, "image preset");
    fields(preset, ["name", "filters"], {}, "image preset");
    const name = text(preset.name, "image preset name");
    try {
      return Object.freeze({ name, filters: readImageFilters(appearanceValue(preset.filters)) });
    } catch (error) {
      return fail(error instanceof Error ? error.message : "invalid image filters");
    }
  });
  const variables = root.variables === undefined ? emptyVariables : readVariables(root.variables);
  const styles = root.styles === undefined ? undefined : readSharedStyles(root.styles);
  const pages = list(root.pages, "pages").map((entry) => id(entry, "page ID"));
  if (!pages.length || new Set(pages).size !== pages.length) fail("pages must be non-empty and unique");
  const source = object(root.nodes,"nodes");
  const nodes: Record<string,DocumentNode> = parsedNodes ?? Object.create(null);
  let maximum = 0n, count = 0;
  for (const key of Object.keys(source)) {
    count++;
    if (!parsedNodes) nodes[key] = readNode(key,source[key]);
    const id = BigInt(key);
    if (id > maximum) maximum = id;
  }
  const referenced = new Set<string>();
  for (const pageId of pages) {
    const page = nodes[pageId];
    if (!page || page.kind !== "page") fail("page list refers to a missing or non-page node");
    if (referenced.has(pageId)) fail("duplicate page root");
    referenced.add(pageId);
    // One cursor per ancestor keeps wide pages from allocating a second list of all their children.
    const pending = [{ parent: page.id, children: page.children, index: 0 }];
    while (pending.length) {
      const cursor = pending[pending.length - 1];
      if (cursor.index === cursor.children.length) { pending.pop(); continue; }
      if (pending.length > FIGCRAFT_TREE_DEPTH_LIMIT) fail(`layer tree exceeds the maximum depth of ${FIGCRAFT_TREE_DEPTH_LIMIT}`);
      const childId = cursor.children[cursor.index++], child = nodes[childId];
      if (!child || child.kind === "page" || child.parent !== cursor.parent || referenced.has(childId)) fail("invalid, repeated or cyclic child relationship");
      referenced.add(childId);
      if (!isLeaf(child)) pending.push({parent: childId, children: child.children, index: 0});
    }
  }
  if (referenced.size !== count) fail("unlisted pages or orphan nodes");
  const currentPage = root.current_page == null ? pages[0]! : id(root.current_page, "current page");
  if (!pages.includes(currentPage)) fail("current page is not listed");
  const declared = BigInt(id(root.next_id, "next_id"));
  const minimum = maximum < U64_MAX ? maximum + 1n : U64_MAX;
  return { document: Object.freeze({ ...(libraryRecords && {libraryRecords}), ...(libraryLinks.length && {libraryLinks}), ...(variables !== emptyVariables && {variables}), ...(styles?.length && { styles }), ...(profile === "displayP3" && {colourProfile: "displayP3" as const}), ...(palette.length > 0 && {documentColours: Object.freeze(palette)}), ...(presets.length ? { imagePresets: Object.freeze(presets) } : {}), name: text(root.name, "document name"), pages: Object.freeze(pages), currentPage, nodes: parsedNodes ?? Object.freeze(nodes) }), nextId: (declared < minimum ? minimum : declared).toString() };
}

async function parseDocument(source: Uint8Array | Blob) {
  const size = source instanceof Blob ? source.size : source.byteLength;
  let root: ObjectValue, decoded: DecodedFigcraft;
  if (size <= 1024 * 1024) {
    const bytes = source instanceof Blob ? new Uint8Array(await source.arrayBuffer()) : source;
    const json = new TextDecoder("utf-8", {fatal:true}).decode(bytes);
    root = object(parse(json, undefined, {onDuplicateKey: ({key}) => fail(`duplicate JSON key ${key}`)}), "document");
    decoded = decodeDocument(root);
  } else {
    let offset = 0;
    const stream = source instanceof Blob ? source.stream() : new ReadableStream<Uint8Array<ArrayBuffer>>({
      pull(controller) {
        if (offset === source.length) { controller.close(); return; }
        const end = Math.min(source.length,offset + 65536);
        controller.enqueue(new Uint8Array(source.subarray(offset,end)));
        offset = end;
      },
    });
    root = await readNativeJson(stream, readNode);
    decoded = decodeDocument(root,Object.freeze(object(root.nodes,"nodes")) as Record<string,DocumentNode>);
  }
  const listed = new Set<string>();
  if (Array.isArray(root.imageIndex)) {
    for (const entry of root.imageIndex) if (typeof entry?.hash === "string") listed.add(entry.hash);
  }
  return { decoded, listed };
}

async function readMember(file: FileEntry, source?: Blob, hash?: ReturnType<typeof sha256.create>): Promise<Blob> {
  if (file.encrypted) fail("encrypted ZIP members are not supported yet");
  if (file.compressionMethod !== 0 && file.compressionMethod !== 8) fail("unsupported ZIP compression");
  if (file.crc32 === undefined) fail("ZIP member has no CRC32 checksum");
  try {
    if (source && file.compressionMethod === 0) {
      // Validate the streamed bytes and local header before keeping a slice of the original file.
      await file.getData(new WritableStream<Uint8Array>({write(chunk) { hash?.update(chunk); }}));
      const at = file.localDirectory?.dataOffset;
      if (at === undefined || at < 0 || at + file.uncompressedSize > source.size) fail("invalid stored member offset");
      return source.slice(at, at + file.uncompressedSize);
    }
    if (!hash) return await file.getData(new BlobWriter());
    const writer = new BlobWriter();
    const sink = writer.writable.getWriter();
    try {
      await file.getData(new WritableStream<Uint8Array<ArrayBuffer>>({
        write(chunk) { hash.update(chunk); return sink.write(chunk); },
      }));
      await sink.close();
      return await writer.getData();
    } catch (error) {
      await sink.abort(error);
      throw error;
    } finally { sink.releaseLock(); }
  } catch (error) {
    if (error instanceof Error && error.message === ERR_INVALID_CRC32) fail("ZIP CRC32 checksum mismatch");
    if (error instanceof Error && error.message === ERR_INVALID_UNCOMPRESSED_SIZE) fail("decompressed data exceeds its permitted size or is truncated");
    throw error;
  }
}

/** zip.js streams file payloads but requests the central directory in one read. */
class ArchiveReader extends Reader<Uint8Array | Blob> {
  constructor(private source: Uint8Array | Blob) {
    super(source);
    this.size = source instanceof Blob ? source.size : source.byteLength;
  }

  async readUint8Array(index: number, length: number) {
    if (length > MAX_DIRECTORY_READ) fail("ZIP metadata exceeds the browser directory budget");
    if (this.source instanceof Blob) return new Uint8Array(await this.source.slice(index, index + length).arrayBuffer());
    return this.source.subarray(index, index + length);
  }
}

/** Native wasm32 document_limit, applied before inflation. */
export function documentByteLimit(packed: number, archiveBytes: number) {
  return Math.min(MAX_DOCUMENT_BYTES, Math.max(MAX_ARCHIVE_MEMBER, 16 * Math.min(packed,archiveBytes)));
}

const MANIFEST = "library/manifest.json";
const SNAPSHOT = "library/document.json";
const MAX_MANIFEST = 16 * 1024 ** 2;
async function readPublished(members:ReadonlyMap<string,FileEntry>, own:Readonly<Record<string,ImageResource>>,
  imageMembers:ReadonlyMap<string,FileEntry>, remaining:number, source?:Blob):Promise<PublishedLibrary | undefined> {
  if (!members.has(MANIFEST)) return undefined;
  async function required(name:string,limit:number) {
    const member=members.get(name);
    if (!member) fail("missing "+name);
    if (member.uncompressedSize>Math.min(remaining,limit)) fail(name+" exceeds the library byte budget");
    remaining-=member.uncompressedSize;
    return readMember(member,source);
  }
  const raw=await required(MANIFEST,MAX_MANIFEST);
  const manifest=readLibraryManifest(parse(new TextDecoder("utf-8",{fatal:true}).decode(await raw.arrayBuffer())));
  const {decoded}=await parseDocument(await required(SNAPSHOT,MAX_ARCHIVE_MEMBER));
  const images:Record<string,ImageResource>=Object.create(null);
  let imageBudget=1024 ** 3, count=0;
  for (const key of libraryImageKeys(decoded.document)) {
    if (!validImageKey(key)) continue;
    if (Object.hasOwn(own,key)) { images[key]=own[key]; continue; }
    const member=members.get("library/images/"+key) ?? imageMembers.get(key);
    if (!member || ++count>IMAGE_COUNT_LIMIT || member.uncompressedSize>Math.min(remaining,imageBudget,MAX_ARCHIVE_MEMBER)) continue;
    remaining-=member.uncompressedSize;
    imageBudget-=member.uncompressedSize;
    try {
      const hash=sha256.create(),encoded=await readMember(member,source,hash);
      const {resource}=await archivedImage(encoded);
      images[key]=Object.freeze({...resource,digest:bytesToHex(hash.digest())});
    } catch { /* A damaged image leaves a placeholder in the published snapshot. */ }
  }
  const document=Object.keys(images).length ? Object.freeze({...decoded.document,images:Object.freeze(images)}) : decoded.document;
  return Object.freeze({manifest:keepLibraryAssets(manifest,document),document,nextId:decoded.nextId});
}
const archiveOptions={strictness:"strict",filenameValidation:"tolerant",checkCrc32:true,checkOverlappingEntry:true,useWebWorkers:false} as const;
function addLibraryMember(members:Map<string,FileEntry>,file:Entry) {
  if (file.filename!==MANIFEST && file.filename!==SNAPSHOT && !file.filename.startsWith("library/images/")) return false;
  if (!file.directory) {
    if (members.has(file.filename)) fail("duplicate library member");
    members.set(file.filename,file);
  }
  return true;
}
/** A consumer can use a published snapshot without reading the author's editable drawing or history. */
export async function decodePublishedLibrary(source:Uint8Array | Blob) {
  const reader=new ZipReader(new ArchiveReader(source),archiveOptions);
  try {
    const members=new Map<string,FileEntry>(),images=new Map<string,FileEntry>();
    for await (const file of reader.getEntriesGenerator()) {
      if (addLibraryMember(members,file) || file.directory || !file.filename.startsWith("images/")) continue;
      const key=file.filename.slice(7);
      if (validImageKey(key)) images.set(key,file);
    }
    return await readPublished(members,{},images,MAX_UNPACKED_BYTES,source instanceof Blob ? source : undefined);
  } finally { await reader.close(); }
}

async function readArchive(bytes: Uint8Array | Blob): Promise<DecodedFigcraft> {
  // Keys are validated before reading image members. An unsafe key is a recoverable
  // image issue. No entry name is ever used as a filesystem path.
  const reader = new ZipReader(new ArchiveReader(bytes), archiveOptions);
  try {
    let documentFile: FileEntry | undefined;
    const members = new Map<string, FileEntry>();
    const publicationMembers = new Map<string,FileEntry>();
    const unreadKeys = new Set<string>();
    const issues: string[] = [];
    let issueCount = 0;
    const report = (message: string) => {
      if (++issueCount <= 20) issues.push(message);
    };
    for await (const file of reader.getEntriesGenerator()) {
      if (file.filename === "document.json" && !file.directory && !documentFile) {
        documentFile = file;
      } else if (addLibraryMember(publicationMembers,file) || file.filename==="thumbnail.png" && !file.directory || file.filename==="library/" && file.directory) {
        continue;
      } else if (file.filename === "images/" && file.directory) {
        continue;
      } else if (file.filename.startsWith("images/")) {
        const key = file.filename.slice(7);
        if (!validImageKey(key) || file.directory) {
          unreadKeys.add(key);
          report(`image ${key} couldn't be read (invalid image name): it is left out, and saving this file again drops it`);
        } else {
          if (members.has(key)) fail("duplicate image member");
          members.set(key, file);
        }
      } else fail("archives with history, branches or other members are not supported yet");
    }
    if (!documentFile) fail("archive has no document.json");
    const archiveBytes = bytes instanceof Blob ? bytes.size : bytes.byteLength;
    if (documentFile.uncompressedSize > documentByteLimit(documentFile.compressedSize,archiveBytes)) fail("document exceeds the native browser inflation limit");
    const { decoded, listed } = await parseDocument(await readMember(documentFile));
    const images: Record<string, ImageResource> = Object.create(null);
    let remaining = MAX_UNPACKED_BYTES - documentFile.uncompressedSize;
    let count = 0;
    // Read the document's declared resources before any additional loose images.
    const keys = [...members.keys()].sort((a, b) => Number(listed.has(b)) - Number(listed.has(a)));
    for (const key of keys) {
      const member = members.get(key)!;
      if (++count > IMAGE_COUNT_LIMIT || member.uncompressedSize > remaining) {
        report(`image ${key} exceeds the browser archive budget: it stays in the original file and is left out of the opened drawing`);
        continue;
      }
      if (member.uncompressedSize > MAX_ARCHIVE_MEMBER) {
        report(`image ${key} exceeds the 512 MiB native member limit: it is left out of the opened drawing`);
        continue;
      }
      // Charge failed reads too, so a series of damaged members cannot repeatedly inflate the budget.
      remaining -= member.uncompressedSize;
      const hash = sha256.create();
      let encoded: Blob;
      try {
        encoded = await readMember(member, bytes instanceof Blob ? bytes : undefined, hash);
      } catch (error) {
        const reason = error instanceof Error ? error.message.replace(/^Cannot open Figcraft file: /, "") : "invalid ZIP data";
        report(`image ${key} couldn't be read (${reason}): it is left out, and saving this file again drops it`);
        continue;
      }
      const {resource, profileUnavailable} = await archivedImage(encoded);
      images[key] = Object.freeze({...resource, digest:bytesToHex(hash.digest())});
      if (profileUnavailable) report(`image ${key} opened without colour conversion. Its original bytes are preserved.`);
    }
    for (const key of [...listed].sort()) {
      if (!members.has(key) && !unreadKeys.has(key)) report(`image ${key} is used by the file but its data is missing: it is left out, and saving this file again drops it`);
    }
    let published:PublishedLibrary | undefined;
    try {
      published=await readPublished(publicationMembers,images,members,remaining,bytes instanceof Blob ? bytes : undefined);
    } catch (error) {
      report("the published library was skipped: "+(error instanceof Error ? error.message : "invalid library"));
    }
    if (issueCount > issues.length) issues.push(`${issueCount - issues.length} more images couldn't be loaded`);
    const document = Object.keys(images).length || published ? Object.freeze({ ...decoded.document, ...(published && {published}), ...(Object.keys(images).length && {images:Object.freeze(images)}) }) : decoded.document;
    return { ...decoded, document, ...(issues.length ? { issues: Object.freeze(issues) } : {}) };
  } finally {
    await reader.close();
  }
}

/** A raw native JSON file may start with any number of JSON whitespace bytes. */
async function startsWithJson(source: Uint8Array | Blob) {
  const nonSpace = (byte: number) => byte !== 32 && byte !== 9 && byte !== 10 && byte !== 13;
  if (!(source instanceof Blob)) return source.find(nonSpace) === 123;
  for (let offset = 0; offset < source.size; offset += 65536) {
    const chunk = new Uint8Array(await source.slice(offset, offset + 65536).arrayBuffer());
    const first = chunk.find(nonSpace);
    if (first !== undefined) return first === 123;
  }
  return false;
}

export async function decodeFigcraft(source: Uint8Array | Blob): Promise<DecodedFigcraft> {
  const size = source instanceof Blob ? source.size : source.length;
  if (!size) fail("file is empty");
  try {
    if (await startsWithJson(source)) {
      if (size > MAX_DOCUMENT_BYTES) fail("document exceeds the 1 GiB browser limit");
      return (await parseDocument(source)).decoded;
    }
    return await readArchive(source);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Cannot open Figcraft file:")) throw error;
    fail("invalid JSON or ZIP data");
  }
}

function wireNode(key: string, node: DocumentNode) {
  const numericId = wireId(key);
  if (node.id !== key) fail("node map key and ID differ");
  const common = { ...(node.boundVariables && {bound:node.boundVariables}), ...(node.variableModes && {var_modes:node.variableModes}), ...(node.styles && { styles: node.styles }), ...(node.grids?.length && { grids: node.grids }), ...wireComponentLinks(node), ...(node.effects?.length && { effects: node.effects.map(wireEffect) }), ...(node.isMask && {is_mask:true}), ...(node.maskType && node.maskType !== "alpha" && {mask_type:node.maskType}), id: numericId, name: node.name, type: node.kind, ...(node.kind === "booleanOp" ? { op: node.op } : {}), ...(node.kind === "ellipse" ? { start: node.start, sweep: node.sweep, inner: node.inner } : node.kind === "star" ? { count: node.count, inner_ratio: node.innerRatio } : node.kind === "polygon" ? { count: node.count } : node.kind === "vector" ? { network: wireVectorNetwork(node.network, wirePaints) } : node.kind === "text" ? wireTextData(node.text) : {}) };
  if (node.kind === "page") {
    return { ...common, ...(node.fills?.length && {fills:wirePaints(node.fills)}), ...(node.strokes?.length && {strokes:wirePaints(node.strokes)}), width: 0, height: 0, children: node.children.map(wireId), background: pageColour(node), ...(node.prototypeBackground && { prototype: { device: "None", rotation: "portrait", background: node.prototypeBackground } }) };
  } else {
    return { ...common, child_layout: wireChildLayout(node.childLayout, layerSizing(node)), ...(node.boolOp ? { bool_op: node.boolOp } : {}), parent: wireId(node.parent), ...(!isLeaf(node) ? { children: node.children.map(wireId) } : {}), transform: layerTransform(node), width: node.width, height: node.height, ...(node.stroke ? { stroke: wireStroke(node.stroke) } : {}), ...(node.strokes ? { strokes: wirePaints(node.strokes) } : {}),
      ...(node.corners ? { corners: node.corners } : {}), ...(node.constraints ? { constraints: node.constraints } : {}), ...(node.constrainProportions ? { constrain_proportions: true } : {}), ...(isFrameLike(node) ? { ...wireFrameKind(node), clip: node.clip, ...(node.layout && {layout: wireAutoLayout(node.layout)}) } : {}), blend: layerBlend(node), visible: node.visible ?? true, locked: node.locked ?? false, opacity: node.opacity ?? 1, fills: wirePaints(rectanglePaints(node)) };
  }
}

export async function prepareArchive(document: Document, nextId?: string) {
  const parts: BlobPart[] = [];
  let maximum = 0n, count = 0, batch = "", yielded = performance.now();
  for (const key of Object.keys(document.nodes)) {
    // Engine revisions are immutable. Yield between batches without reading a later revision.
    if (count && count % 64 === 0 && Object.isFrozen(document.nodes) && performance.now()-yielded > 12) {
      await new Promise<void>(resolve => setTimeout(resolve,0));
      yielded = performance.now();
    }
    const wire = wireNode(key, document.nodes[key]);
    readNode(key,wire);
    const id = BigInt(key);
    if (id > maximum) maximum = id;
    batch += (count++ ? "," : "") + JSON.stringify(key) + ":" + stringify(wire);
    if (batch.length >= 262144) { parts.push(new Blob([batch])); batch = ""; }
  }
  if (batch) parts.push(batch);
  const minimum = maximum < U64_MAX ? maximum + 1n : U64_MAX;
  const supplied = nextId === undefined ? minimum : BigInt(idString(nextId, "next_id"));
  const resources: Readonly<Record<string, ImageResource>> = document.images ?? {};
  const keys = Object.keys(resources).sort();
  if (keys.length > IMAGE_COUNT_LIMIT) fail("too many images for a native archive");
  const imageIndex = keys.map(hash => {
    if (!validImageKey(hash)) fail("invalid image resource key");
    const { width, height, bytes } = resources[hash]!;
    if (bytes.size > MAX_ARCHIVE_MEMBER) fail("image exceeds the 512 MiB native member limit");
    return { hash, width, height };
  });
  const root = { format: "figcraft", version: 1, imageIndex, ...((document.libraryLinks?.length || document.libraryRecords) && {libraries:wireLibraryLinks(document.libraryLinks ?? [],document.libraryRecords)}), ...(document.imagePresets?.length ? { image_presets: document.imagePresets } : {}), name: document.name, pages: document.pages.map(wireId), next_id: wireId((supplied < minimum ? minimum : supplied).toString()), current_page: wireId(document.currentPage), styles: document.styles?.map(wireSharedStyle) ?? [], variables: document.variables ?? emptyVariables, document_colors: document.documentColours ?? [], ...(document.colourProfile === "displayP3" && {color_profile: document.colourProfile}), comments: [] };
  // Validate relationships on the supplied domain graph after each individual wire record passed.
  decodeDocument({...root,nodes:document.nodes},document.nodes);
  const header = stringify(root)!;
  const json = new Blob([header.slice(0,-1), ',"nodes":{', ...parts, "}}"], {type:"application/json"});
  if (json.size > MAX_DOCUMENT_BYTES) fail("document exceeds the 1 GiB browser limit");
  if (keys.reduce((total, key) => total + resources[key]!.bytes.size, json.size) > MAX_UNPACKED_BYTES) fail("archive members exceed the 2 GiB browser unpacked limit");
  return {json, keys, resources};
}

export async function encodeFigcraftBlob(document: Document, nextId?: string): Promise<Blob> {
  const {json, keys, resources} = await prepareArchive(document, nextId);
  const writer = new ZipWriter(new BlobWriter("application/octet-stream"), {useWebWorkers: false, extendedTimestamp: false});
  // A very compressible document above the 512 MiB floor could exceed the native 16:1 read budget.
  await writer.add("document.json", new BlobReader(json), {level: json.size > MAX_ARCHIVE_MEMBER ? 0 : 3});
  for (const key of keys) {
    await writer.add(`images/${key}`, new BlobReader(resources[key]!.bytes), {level: 0});
  }
  if (document.published) {
    const published=document.published;
    const snapshot=await prepareArchive(published.document,published.nextId);
    const manifest=new Blob([stringify(wireLibraryManifest(published.manifest))!]);
    if (manifest.size>MAX_MANIFEST || snapshot.json.size>MAX_ARCHIVE_MEMBER) fail("published library exceeds the native member limit");
    const extra=snapshot.keys.filter(key=>!Object.hasOwn(resources,key));
    const imageBytes=extra.reduce((n,key)=>n+snapshot.resources[key].bytes.size,0);
    const total=keys.reduce((n,key)=>n+resources[key].bytes.size,json.size+snapshot.json.size+manifest.size+imageBytes);
    if (total>MAX_UNPACKED_BYTES || imageBytes>1024 ** 3) fail("published library exceeds the archive budget");
    await writer.add(MANIFEST,new BlobReader(manifest),{level:3});
    await writer.add(SNAPSHOT,new BlobReader(snapshot.json),{level:3});
    for (const key of extra) await writer.add("library/images/"+key,new BlobReader(snapshot.resources[key].bytes),{level:0});
  }
  return writer.close();
}

export async function encodeFigcraft(document: Document, nextId?: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await (await encodeFigcraftBlob(document, nextId)).arrayBuffer());
}
