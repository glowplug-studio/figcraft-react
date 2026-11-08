import { readVectorNetwork, wireVectorNetwork } from "./vector-codec";
import { isBooleanOperation, isLeaf, isLeafKind } from "./document";
import { type Corners, type Radii } from "./corners";
import { Unzip, UnzipInflate, ZipPassThrough, zipSync } from "fflate";
import { Uint8ArrayReader, ZipReader } from "@zip.js/zip.js/lib/zip-core-native.js";
import { isLosslessNumber, LosslessNumber, parse, stringify } from "lossless-json";
import { readConstraints } from "./constraints";
import { layerTransform, withLayerTransform, rectanglePaints, withRectanglePaints, pageColour, withPageColour, type Document, type DocumentNode } from "./document";
import { parseColour } from "./colour-css";
import type { Colour } from "./colour";
import { readSolidPaints } from "./solid-paint";
import { isDefaultStroke, readStroke, wireStroke } from "./stroke";
import { transformBounds, type Affine } from "./affine";

/** A deliberately bounded adapter for native format v1, not full archive parity.
 * Source: original/figcraft/crates/{format/src/lib.rs,doc/src/{lib,node,props}.rs}.
 * Only pages, affine groups, boolean groups, frames, rectangles, ellipses, polygons, stars, lines and vectors with solid paints are editable here.
 * Unsupported data is rejected, never opened and silently discarded on save.
 * Browser limits are intentionally below native's: 16 MiB and 10,000 nodes.
 * zip.js reads ZIP metadata; fflate bounds inflation and computes CRC32.
 */
export const FIGCRAFT_FILE_LIMIT = 16 * 1024 * 1024;
export const MAX_FILE_BYTES = FIGCRAFT_FILE_LIMIT;
export const FIGCRAFT_NODE_LIMIT = 10_000;
export const FIGCRAFT_TREE_DEPTH_LIMIT = 256;
const U64_MAX = 18_446_744_073_709_551_615n;
type ObjectValue = Record<string, unknown>;
export interface DecodedFigcraft { document: Document; nextId: string }

function fail(message: string): never { throw new Error(`Cannot open Figcraft file: ${message}`); }
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
function number(value: unknown, path: string): number {
  const result = isLosslessNumber(value) ? Number(value.value) : value;
  if (typeof result !== "number" || !Number.isFinite(result)) fail(`${path} must be finite`);
  return result;
}
function idString(value: string, path: string): string {
  if (!/^(0|[1-9][0-9]*)$/.test(value) || value.length > 20 || BigInt(value) > U64_MAX) fail(`${path} must be an unsigned 64-bit integer`);
  return value;
}
function id(value: unknown, path: string): string {
  if (!isLosslessNumber(value)) fail(`${path} must be a numeric node ID`);
  return idString(value.value, path);
}
function wireId(value: string): LosslessNumber { return new LosslessNumber(idString(value, "node ID")); }

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
  kind: "design", styles: [], variables: { collections: [], variables: [] },
  imageIndex: [], document_colors: [], comments: [], color_profile: "srgb",
  libraries: { enabled: [], store: null, components: [], styles: [], collections: [], variables: [], detached: [], inserted: [] },
  image_presets: [], annotation_categories: null, dev_snapshots: {}, timer: null,
  vote: null, votes: {}, vote_history: [],
};
const nodeDefaults = {
  visible: true, locked: false, opacity: 1, strokes: [], effects: [],
  stroke: { weight: 1, align: "inside", sides: null, cap_start: "none", cap_end: "none", join: "miter", miter_limit: 4, dashes: [], dash_cap: null, width_profile: null, brush: null },
  corners: { radii: [0, 0, 0, 0], smoothing: 0 }, constraints: { horizontal: "left", vertical: "top" }, layout: null,
  child_layout: { sizing_h: "fixed", sizing_v: "fixed", absolute: false, min_w: null, max_w: null, min_h: null, max_h: null, grid_column: null, grid_row: null, grid_column_span: 0, grid_row_span: 0, grid_align_h: null, grid_align_v: null },
  clip: false, is_mask: false, mask_type: "alpha", grids: [], guides: [], exports: [], interactions: [],
  overflow: "none", scroll_position: "scrolls", styles: { fill: null, stroke: null, effect: null, grid: null, text: null },
  bound: {}, var_modes: {}, bool_op: null, constrain_proportions: false, source: null, exposed: false,
  dev_status: "none", dev_changed: false, dev_note: "", overrides: [], prop_refs: {}, plugin_data: {},
  annotations: [], code_links: [], dev_resources: [], measurements: [], board: null,
};

/** Convert only appearance numbers; node IDs remain lossless tokens elsewhere. */
function appearanceValue(value: unknown): unknown {
  if (isLosslessNumber(value)) return number(value, "appearance number");
  if (Array.isArray(value)) return value.map(appearanceValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, appearanceValue(entry)]));
  return value;
}
function nativeColour(value: unknown, path: string): Colour {
  const result = parseColour(appearanceValue(value));
  if (!result) fail(`${path}: invalid colour`);
  return result;
}
function decodeDocument(raw: unknown): DecodedFigcraft {
  const root = object(raw, "document");
  if (root.version !== undefined && number(root.version, "version") > 1) fail("this file needs a newer Figcraft format reader");
  if (root.version !== undefined && number(root.version, "version") !== 1) fail("unsupported format version");
  if (root.format !== undefined && root.format !== "figcraft") fail("unrecognised format");
  fields(root, ["format", "version", "name", "pages", "nodes", "next_id", "current_page"], documentDefaults, "document");
  const pages = list(root.pages, "pages").map((entry) => id(entry, "page ID"));
  if (!pages.length || new Set(pages).size !== pages.length) fail("pages must be non-empty and unique");
  const source = object(root.nodes, "nodes"), entries = Object.entries(source);
  if (entries.length > FIGCRAFT_NODE_LIMIT) fail(`more than ${FIGCRAFT_NODE_LIMIT} nodes`);
  const nodes: Record<string, DocumentNode> = Object.create(null);
  let maximum = 0n;
  for (const [key, value] of entries) {
    idString(key, "node map key");
    maximum = BigInt(key) > maximum ? BigInt(key) : maximum;
    const n = object(value, `node ${key}`), kind = n.type;
    if (id(n.id, "node ID") !== key) fail(`node ${key} has a mismatched ID`);
    if (kind !== "page" && kind !== "group" && kind !== "booleanOp" && kind !== "frame" && !isLeafKind(kind)) fail(`node type ${String(kind)} is not supported yet`);
    fields(n, ["id", "name", "type", "parent", "children", "transform", "width", "height", "fills", "blend", ...(kind === "page" ? ["background", "flows", "prototype"] : ["bool_op", ...(kind === "booleanOp" ? ["op"] : kind === "ellipse" ? ["start", "sweep", "inner"] : kind === "star" ? ["count", "inner_ratio"] : kind === "polygon" ? ["count"] : kind === "vector" ? ["network"] : []), "stroke", "strokes", "visible", "locked", "opacity", "corners", "constraints", "constrain_proportions", ...(kind === "frame" ? ["clip"] : [])])], nodeDefaults, `node ${key}`);
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
      defaultValue(n.fills ?? [], [], "page fills");
      defaultValue(n.flows ?? [], [], "page flows");
      if (n.prototype !== undefined) {
        const prototype = object(n.prototype, "prototype");
        fields(prototype, ["background"], { device: "None", rotation: "portrait", color: "", custom_size: [1280, 720], customSize: [1280, 720], responsive: false }, "prototype");
        if (prototype.background !== undefined) {
          const background = nativeColour(prototype.background, "prototype background"), expected = nativeColour("#1e1e1e", "prototype default");
          if (Object.keys(expected).some(key => background[key as keyof Colour] !== expected[key as keyof Colour])) fail("prototype background is not supported yet");
        }
      }
      nodes[key] = withPageColour({ id: key, kind, name, parent: null, children: Object.freeze(children), background: "#f5f5f5" }, nativeColour(n.background ?? "#f5f5f5", "page background"));
    } else {
      if (isLeafKind(kind) && children.length) fail("leaf children are not supported");
      if (n.blend !== undefined && n.blend !== "normal" && n.blend !== "passThrough") fail(`${kind} blend is not supported yet`);
      if (n.visible !== undefined && typeof n.visible !== "boolean" || n.locked !== undefined && typeof n.locked !== "boolean") fail("node visibility/lock must be boolean");
      if (n.constrain_proportions !== undefined && typeof n.constrain_proportions !== "boolean") fail("constrain_proportions must be boolean");
      const opacity = Math.fround(number(n.opacity ?? 1, "node opacity"));
      if (!Number.isFinite(opacity)) fail("node opacity is outside the native finite range");
      const paints = (() => {
        try { return readSolidPaints(appearanceValue(n.fills ?? [])); }
        catch (error) { return fail(error instanceof Error ? error.message : "Invalid paints"); }
      })();
      const strokeData = (() => {
        try {
          const stroke = readStroke(appearanceValue(n.stroke)), strokes = readSolidPaints(appearanceValue(n.strokes ?? []));
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
      if (kind === "frame" && n.clip !== undefined && typeof n.clip !== "boolean") fail("frame clip must be boolean");
      if (n.bool_op != null && !isBooleanOperation(n.bool_op)) fail("invalid operand operation");
      const op = kind === "booleanOp" ? (isBooleanOperation(n.op) ? n.op : fail("invalid boolean group operation")) : undefined;
      const layer = { ...(isBooleanOperation(n.bool_op) ? { boolOp: n.bool_op } : {}), id: key, kind, name, ...strokeData, ...(corners ? { corners } : {}), parent: id(n.parent, `${kind} parent`), x: transform[4]!, y: transform[5]!, width, height, fill: "transparent", ...(constraints.horizontal !== "left" || constraints.vertical !== "top" ? { constraints } : {}),
        ...(n.constrain_proportions === true ? { constrainProportions: true } : {}), ...(n.visible === false ? { visible: false } : {}), ...(n.locked === true ? { locked: true } : {}), ...(opacity !== 1 ? { opacity } : {}),
        ...(n.blend !== undefined && n.blend !== (!isLeafKind(kind) ? "passThrough" : "normal") ? { blend: n.blend as "normal" | "passThrough" } : {}) };
      let count = 0;
      if (kind === "polygon" || kind === "star") {
        if (isLosslessNumber(n.count) && (!/^(0|[1-9][0-9]*)$/.test(n.count.value) || n.count.value.length > 10)) fail("point count must be a u32");
        count = number(n.count, "point count");
        if (!Number.isInteger(count) || count < 0 || count > 4294967295) fail("point count must be a u32");
      }
      nodes[key] = !isLeafKind(kind)
        ? Object.freeze({ ...withRectanglePaints(withLayerTransform({ ...layer, ...(kind === "frame" ? { kind: "frame" as const, clip: n.clip === true } : op ? { kind: "booleanOp" as const, op } : { kind: "group" as const }), children: Object.freeze(children), blend: (n.blend ?? "passThrough") as "normal" | "passThrough" }, matrix), paints), fills: paints })
        : withRectanglePaints(withLayerTransform(kind === "ellipse" ? { ...layer, kind, start: number(n.start === undefined ? 0 : n.start, "arc start"), sweep: number(n.sweep === undefined ? 2 * Math.PI : n.sweep, "arc sweep"), inner: number(n.inner === undefined ? 0 : n.inner, "arc inner") } : kind === "polygon" ? { ...layer, kind, count } : kind === "star" ? { ...layer, kind, count, innerRatio: number(n.inner_ratio, "inner ratio") } : kind === "vector" ? { ...layer, kind, network: nativeNetwork(n.network) } : { ...layer, kind }, matrix), paints);
    }
  }
  const referenced = new Set<string>();
  for (const pageId of pages) {
    const page = nodes[pageId];
    if (!page || page.kind !== "page") fail("page list refers to a missing or non-page node");
    if (referenced.has(pageId)) fail("duplicate page root");
    referenced.add(pageId);
    const pending = page.children.map(childId => ({ childId, parentId: pageId, depth: 1 }));
    while (pending.length) {
      const { childId, parentId, depth } = pending.pop()!;
      if (depth > FIGCRAFT_TREE_DEPTH_LIMIT) fail(`layer tree exceeds the maximum depth of ${FIGCRAFT_TREE_DEPTH_LIMIT}`);
      const child = nodes[childId];
      if (!child || child.kind === "page" || child.parent !== parentId || referenced.has(childId)) fail("invalid, repeated or cyclic child relationship");
      referenced.add(childId);
      if (!isLeaf(child)) for (const grandchild of child.children) pending.push({ childId: grandchild, parentId: childId, depth: depth + 1 });
    }
  }
  if (referenced.size !== entries.length) fail("unlisted pages or orphan nodes");
  const currentPage = root.current_page == null ? pages[0]! : id(root.current_page, "current page");
  if (!pages.includes(currentPage)) fail("current page is not listed");
  const declared = BigInt(id(root.next_id, "next_id"));
  const minimum = maximum < U64_MAX ? maximum + 1n : U64_MAX;
  return { document: Object.freeze({ name: text(root.name, "document name"), pages: Object.freeze(pages), currentPage, nodes: Object.freeze(nodes) }), nextId: (declared < minimum ? minimum : declared).toString() };
}

async function archiveJson(bytes: Uint8Array): Promise<Uint8Array> {
  let expectedSize = -1, expectedCompression = -1, expectedCrc = -1, entries = 0;
  // Parse the central directory without inflating any member first.
  // The native-only entry point cannot introduce a WASM decoder or asset fetch.
  const reader = new ZipReader(new Uint8ArrayReader(bytes), { strictness: "strict", useWebWorkers: false });
  try {
    for await (const file of reader.getEntriesGenerator()) {
      if (++entries !== 1 || file.filename !== "document.json" || file.directory) fail("archives with resources, history, branches or other members are not supported yet");
      if (file.encrypted) fail("encrypted ZIP members are not supported yet");
      if (file.uncompressedSize > FIGCRAFT_FILE_LIMIT || file.compressedSize > FIGCRAFT_FILE_LIMIT) fail("archive member exceeds the 16 MiB browser limit");
      if (file.compressionMethod !== 0 && file.compressionMethod !== 8) fail("unsupported ZIP compression");
      if (file.crc32 === undefined) fail("ZIP member has no CRC32 checksum");
      expectedSize = file.uncompressedSize;
      expectedCompression = file.compressionMethod;
      expectedCrc = file.crc32;
    }
  } finally { await reader.close(); }
  if (entries !== 1) fail("archive has no document.json");
  const chunks: Uint8Array[] = [];
  const checksum = new ZipPassThrough("document.json");
  checksum.ondata = () => {};
  let size = 0, found = 0, complete = false;
  const unzip = new Unzip((file) => {
    if (++found !== 1 || file.name !== "document.json") fail("inconsistent ZIP members");
    if (file.compression !== expectedCompression || (file.originalSize !== undefined && file.originalSize !== expectedSize)) fail("inconsistent ZIP metadata");
    file.ondata = (error, chunk, final) => {
      if (error) throw error;
      size += chunk.length;
      if (size > FIGCRAFT_FILE_LIMIT || size > expectedSize) { file.terminate(); fail("decompressed data exceeds its permitted size"); }
      checksum.push(chunk, final);
      chunks.push(chunk);
      complete = final;
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  // Small input chunks also bound one decoder emission when metadata lies.
  for (let offset = 0; offset < bytes.length; offset += 1024) unzip.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
  if (!complete || found !== 1 || size !== expectedSize) fail("truncated or inconsistent ZIP data");
  if ((checksum.crc >>> 0) !== expectedCrc) fail("ZIP CRC32 checksum mismatch");
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export async function decodeFigcraft(bytes: Uint8Array): Promise<DecodedFigcraft> {
  if (!bytes.length || bytes.length > FIGCRAFT_FILE_LIMIT) fail("file must be between 1 byte and 16 MiB");
  try {
    const first = bytes.find((byte) => byte !== 32 && byte !== 9 && byte !== 10 && byte !== 13);
    const json = first === 123 ? bytes : await archiveJson(bytes);
    const source = new TextDecoder("utf-8", { fatal: true }).decode(json);
    return decodeDocument(parse(source, undefined, { onDuplicateKey: ({ key }) => fail(`duplicate JSON key ${key}`) }));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Cannot open Figcraft file:")) throw error;
    fail("invalid JSON or ZIP data");
  }
}

export async function encodeFigcraft(document: Document, nextId?: string): Promise<Uint8Array> {
  const nodes: ObjectValue = Object.create(null);
  let maximum = 0n;
  for (const [key, node] of Object.entries(document.nodes)) {
    const numericId = wireId(key);
    maximum = BigInt(key) > maximum ? BigInt(key) : maximum;
    if (node.id !== key) fail("node map key and ID differ");
    const common = { id: numericId, name: node.name, type: node.kind, ...(node.kind === "booleanOp" ? { op: node.op } : {}), ...(node.kind === "ellipse" ? { start: node.start, sweep: node.sweep, inner: node.inner } : node.kind === "star" ? { count: node.count, inner_ratio: node.innerRatio } : node.kind === "polygon" ? { count: node.count } : node.kind === "vector" ? { network: wireVectorNetwork(node.network) } : {}) };
    if (node.kind === "page") {
      nodes[key] = { ...common, width: 0, height: 0, children: node.children.map(wireId), background: pageColour(node) };
    } else {
      nodes[key] = { ...common, ...(node.boolOp ? { bool_op: node.boolOp } : {}), parent: wireId(node.parent), ...(!isLeaf(node) ? { children: node.children.map(wireId) } : {}), transform: layerTransform(node), width: node.width, height: node.height, ...(node.stroke ? { stroke: wireStroke(node.stroke) } : {}), ...(node.strokes ? { strokes: node.strokes } : {}),
        ...(node.corners ? { corners: node.corners } : {}), ...(node.constraints ? { constraints: node.constraints } : {}), ...(node.constrainProportions ? { constrain_proportions: true } : {}), ...(node.kind === "frame" ? { clip: node.clip } : {}), blend: node.blend ?? (!isLeaf(node) ? "passThrough" : "normal"), visible: node.visible ?? true, locked: node.locked ?? false, opacity: node.opacity ?? 1, fills: rectanglePaints(node) };
    }
  }
  const minimum = maximum < U64_MAX ? maximum + 1n : U64_MAX;
  const supplied = nextId === undefined ? minimum : BigInt(idString(nextId, "next_id"));
  const root = { format: "figcraft", version: 1, imageIndex: [], name: document.name, pages: document.pages.map(wireId), nodes, next_id: wireId((supplied < minimum ? minimum : supplied).toString()), current_page: wireId(document.currentPage), styles: [], variables: { collections: [], variables: [] }, document_colors: [], comments: [] };
  // Validate before serialisation (including finite geometry and graph integrity).
  decodeDocument(root);
  const json = new TextEncoder().encode(stringify(root));
  if (json.length > FIGCRAFT_FILE_LIMIT) fail("document exceeds the 16 MiB browser limit");
  const archive = zipSync({ "document.json": json }, { level: 3 });
  if (archive.length > FIGCRAFT_FILE_LIMIT) fail("archive exceeds the 16 MiB browser limit");
  return archive;
}
