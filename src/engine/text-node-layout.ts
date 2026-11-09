/// <reference path="./text-font-assets.d.ts" />
import type { Document, TextNode } from "./document";
import type { TextData } from "./text-data";
import { FontLibrary } from "./font-library";
import { readFontFaces } from "./font-source";
import { layoutTextFlow } from "./text-flow";
import { preparedWordStarts, prepareWordSegmenter, wordSegmenterReady } from "./text-word-starts";
import { textInkBounds, textToPath } from "./text-decorations";
import { mapVectorPath } from "./corners";

let fonts: FontLibrary | undefined;
let loading: Promise<void> | undefined;

async function loadCatalogue() {
  const { readBundledFonts } = await import("#figcraft-font-assets");
  const library = new FontLibrary();
  for (const bytes of await readBundledFonts()) {
    for (const face of await readFontFaces(bytes)) library.add(face);
  }
  fonts = library;
}

/** Prepare the shared, immutable bundled catalogue outside the synchronous edit and paint paths. */
export async function prepareText(characters = "") {
  loading ??= loadCatalogue().catch(error => { loading = undefined; throw error; });
  await Promise.all([loading, prepareWordSegmenter(characters)]);
}

function measure(text: TextData, box: { width?: number; height?: number }) {
  if (!fonts) throw new Error("Call prepareText or executeAsync before creating a text layer");
  return layoutTextFlow(text, fonts, box, preparedWordStarts(text.characters));
}

export function autoSizeText(node: TextNode): TextNode {
  const { text } = node;
  if (text.path || text.autoResize === "none" || text.autoResize === "truncate") return node;
  const fixedWidth = text.autoResize === "height";
  const layout = measure(text, fixedWidth ? {width: node.width} : {});
  return Object.freeze({...node, width: fixedWidth ? node.width : Math.max(1, Math.ceil(layout.width)), height: Math.max(1, layout.height)});
}

function layoutNode(node: TextNode) {
  const text = node.text;
  const layout = measure(text, text.path ? {} : {width: node.width, height: node.height});
  const fixed = !text.path && (text.autoResize === "none" || text.autoResize === "truncate");
  const gap = fixed ? node.height - layout.height : 0;
  const dy = text.alignV === "bottom" ? gap : text.alignV === "middle" ? gap / 2 : 0;
  const ink = textInkBounds(layout);
  return {layout, dy, ink: ink && {...ink, y: ink.y + dy}};
}

const layouts = new WeakMap<TextNode, ReturnType<typeof layoutNode>>();
export function textNodeLayout(node: TextNode) {
  let result = layouts.get(node);
  if (!result) { result = layoutNode(node); layouts.set(node, result); }
  return result;
}
const paths = new WeakMap<TextNode, ReturnType<typeof textToPath>>();
export function textNodePath(node: TextNode) {
  let path = paths.get(node);
  if (!path) {
    const {layout, dy} = textNodeLayout(node);
    const local = textToPath(layout);
    path = dy ? mapVectorPath(local, p => ({x: p.x, y: p.y + dy})) : local;
    paths.set(node, path);
  }
  return path;
}

const preparedDocuments = new WeakSet<Document>();
export function documentTextReady(document: Document) {
  if (preparedDocuments.has(document)) return true;
  for (const id in document.nodes) {
    const node = document.nodes[id];
    if (node.kind === "text" && (!fonts || !wordSegmenterReady(node.text.characters))) return false;
  }
  preparedDocuments.add(document);
  return true;
}

export async function prepareDocumentText(document: Document) {
  for (const id in document.nodes) {
    const node = document.nodes[id];
    if (node.kind === "text" && (!fonts || !wordSegmenterReady(node.text.characters))) await prepareText(node.text.characters);
  }
  preparedDocuments.add(document);
}
