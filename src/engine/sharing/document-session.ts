import { highestIdSpace } from "../branch-ids";
import { wireComment } from "../comments";
import { identity } from "../affine";
import { initialPositions, layerFields, nodePropertyOrder, numericOrder, type WireFields } from "../branch-diff";
import { fromRgba8 } from "../colour";
import { sameComponentValue } from "../component-groups";
import { zeroCorners } from "../corners";
import { defaultConstraints, type Document, type DocumentNode } from "../document";
import { wireId } from "../native-values";
import { wireLibraryLinks } from "../published-library";
import { base64Bytes } from "../recovery";
import { wireSharedStyle } from "../shared-styles";
import { solidPaint } from "../solid-paint";
import { defaultStroke, wireStroke } from "../stroke";
import { compareScalarKeys } from "../text-breaks";
import { sessionJson, sessionKind, sessionProperty, sessionStyle } from "./session-json";
import { InitialSnapshotMeasure, type InitialChange, type InitialSession } from "./session-postcard";

const white = [solidPaint(fromRgba8(255, 255, 255))];
const grey = [solidPaint(fromRgba8(217, 217, 217))];
const black = [solidPaint(fromRgba8(0, 0, 0))];
const purple = [solidPaint(fromRgba8(151, 71, 255))];
const emptyStyles = { effect: null, fill: null, grid: null, stroke: null, text: null };
const prototype = { device: "None", rotation: "portrait", background: fromRgba8(30, 30, 30) };
const ordinaryStroke = wireStroke(defaultStroke);
const blankFields = new Map<DocumentNode["kind"], WireFields>();

export function blankNode(k: DocumentNode["kind"]): WireFields {
  const saved = blankFields.get(k);
  if (saved) return saved;
  const fills = ["frame", "component", "section"].includes(k) ? white :
    ["rectangle", "ellipse", "polygon", "star", "vector"].includes(k) ? grey : k === "text" ? black : [];
  const fields = { name: "", visible: true, locked: false, opacity: 1, blend: ["page", "frame", "group", "section", "booleanOp", "component", "componentSet", "instance"].includes(k) ? "passThrough" : "normal",
    transform: identity, width: 0, height: 0, fills, strokes: k === "line" ? black : k === "componentSet" ? purple : [],
    stroke: k === "line" || k === "vector" ? {...ordinaryStroke, align: "center"} :
      k === "componentSet" ? {...ordinaryStroke, dashes: [10, 5]} : ordinaryStroke,
    corners: k === "componentSet" ? { radii: [5, 5, 5, 5], smoothing: 0 } : zeroCorners,
    constraints: defaultConstraints, clip: ["frame", "component", "componentSet", "instance"].includes(k),
    effects: [], guides: [], grids: [], exports: [], interactions: [], styles: emptyStyles,
    varModes: {}, bound: {}, overrides: [], propRefs: {}, pluginData: {}, exposed: false, constrainProportions: false };
  blankFields.set(k, fields);
  return fields;
}

// Paint::eq compares the effective paint. Its stored colour-alpha provenance
// is serialised only when the paint differs from the constructor default.
function matchesBlank(name: string, value: unknown, blank: unknown) {
  if (sameComponentValue(value, blank)) return true;
  if ((name !== "fills" && name !== "strokes") || !Array.isArray(value) || !Array.isArray(blank)
      || value.length !== 1 || blank.length !== 1) return false;
  const { colorAlpha: _source, ...actual } = value[0];
  const { colorAlpha: _default, ...expected } = blank[0];
  return sameComponentValue(actual, expected);
}

export function sessionNodeFields(node: DocumentNode): WireFields {
  const fields = layerFields(node);
  const kind = fields.kind as WireFields;
  if (node.kind === "page") {
    kind.prototype ??= prototype;
    kind.flows ??= [];
  }
  // The native archive reader supplies empty paint lists and inside strokes
  // when omitted. Node::new has distinct drawing-tool defaults for some kinds.
  fields.fills ??= [];
  fields.strokes ??= [];
  fields.stroke ??= ordinaryStroke;
  fields.corners ??= zeroCorners;
  return fields;
}

export function createNode(node: DocumentNode, position: string): Extract<InitialChange, { type: "create" }> {
  const fields = sessionNodeFields(node);
  const kind = fields.kind as WireFields;
  const blank = blankNode(node.kind), props: [string, string][] = [];
  for (const name of nodePropertyOrder) {
    const value = fields[name];
    if (name === "kind" || value === undefined || matchesBlank(name, value, blank[name])) continue;
    props.push([name, sessionProperty(name, value)]);
  }
  return { type: "create", id: node.id, parent: node.parent, position, kind: sessionKind(kind), props };
}

function* putList<T extends {id: string}>(prop: string, entry: string,
  items: readonly T[], render: (item: T) => string): Generator<InitialChange> {
  if (new Set(items.map(item => item.id)).size !== items.length) {
    yield {type: "setDoc", prop, value: "[" + items.map(render).join(",") + "]"};
  } else {
    for (const item of items) yield {type: "put", entry, key: item.id, value: render(item)};
  }
}

function* documentChanges(document: Document): Generator<InitialChange> {
  const pages = new Set(document.pages);
  const extraRoots = Object.keys(document.nodes).filter(id => !document.nodes[id].parent && !pages.has(id)).sort(numericOrder);
  const stack = [...document.pages, ...extraRoots].reverse();
  const positions = initialPositions(document);
  while (stack.length) {
    const id = stack.pop()!, node = document.nodes[id];
    yield createNode(node, positions.get(id)!);
    if ("children" in node) for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
  }
  const set = (prop: string, value: unknown): InitialChange => ({type: "setDoc", prop, value: sessionJson(value)});
  if (document.name) yield set("name", document.name);
  yield set("currentPage", wireId(document.currentPage));
  if (document.documentColours?.length) yield set("documentColors", document.documentColours);
  if (document.colourProfile === "displayP3") yield set("colorProfile", document.colourProfile);
  if (document.imagePresets?.length) yield set("imagePresets", document.imagePresets);
  if (document.libraryLinks?.length || document.libraryRecords || document.libraryStore) {
    const libraries = wireLibraryLinks(document.libraryLinks ?? [], document.libraryRecords, document.libraryStore);
    if (!sameComponentValue(libraries, wireLibraryLinks([]))) yield set("libraries", libraries);
  }
  yield* putList("styles", "style", document.styles ?? [], s => sessionStyle(wireSharedStyle(s)));
  yield* putList("comments", "comment", document.comments ?? [], c => sessionJson(wireComment(c)));
  yield* putList("collections", "collection", document.variables?.collections ?? [], sessionJson);
  yield* putList("variables", "variable", document.variables?.variables ?? [], sessionJson);
}

export const imageValue = (data: string, height: number, width: number) => JSON.stringify({bytes: data, height, width});

export async function initialDocumentState(document: Document, session: bigint): Promise<InitialSession> {
  const changes = [...documentChanges(document)];
  for (const key of Object.keys(document.images ?? {}).sort(compareScalarKeys)) {
    const { bytes, width, height } = document.images![key];
    const data = base64Bytes(new Uint8Array(await bytes.arrayBuffer()));
    changes.push({type: "put", entry: "image", key, value: imageValue(data, height, width)});
  }
  return {session, changes, nextClient: highestIdSpace(document) + 1};
}

/** Returns the exact framed size, or a lower bound once the supplied limit is exceeded. */
export async function measureDocumentSnapshot(document: Document, session: bigint, limit = Infinity) {
  const measure = new InitialSnapshotMeasure();
  const client = highestIdSpace(document) + 1;
  let count = 0, yielded = performance.now();
  // Count the immutable image members first. Their contributions are additive
  // and equal for any content of the same length, including the final padding.
  for (const [key, { bytes, width, height }] of Object.entries(document.images ?? {})) {
    const length = imageValue("", height, width).length + 4 * Math.ceil(bytes.size / 3);
    measure.image(key, length);
  }
  let size = measure.framedBytes(session, client);
  if (size > limit) return size;
  for (const change of documentChanges(document)) {
    measure.add(change);
    if (++count % 64 === 0) {
      size = measure.framedBytes(session, client);
      if (size > limit) return size;
      if (performance.now() - yielded > 12) {
        await new Promise(resolve => setTimeout(resolve, 0));
        yielded = performance.now();
      }
    }
  }
  return measure.framedBytes(session, client);
}
