/// <reference path="./text-font-assets.d.ts" />
import { LocalFontAccess } from "./local-font-access";
import { fontsChanged, fontGeometryCache } from "./font-generation";
import { multiply } from "./affine";
import { rectangleTransform, withLayerTransform, type Document, type TextNode } from "./document";
import type { TextData } from "./text-data";
import { bytesToHex } from "@noble/hashes/utils.js";
import { parseBoolean, parseString } from "./parameters";
import { FontLibrary } from "./font-library";
import { readFontFaces } from "./font-source";
import { layoutTextFlow } from "./text-flow";
import { preparedWordStarts, prepareWordSegmenter, wordSegmenterReady } from "./text-word-starts";
import { textInkBounds, textToPath } from "./text-decorations";
import { mapVectorPath } from "./corners";

const localFonts=new LocalFontAccess();
export const canAskForLocalFonts=()=>localFonts.canAsk();
export async function askForLocalFonts() {
  if (fonts) await localFonts.ask(fonts);
}

let fonts: FontLibrary | undefined;
let loading: Promise<void> | undefined;

async function loadCatalogue() {
  const { readBundledFonts } = await import("#figcraft-font-assets");
  const library:FontLibrary = new FontLibrary(font=>{void localFonts.load(library,font);});
  for (const bytes of await readBundledFonts()) {
    for (const face of await readFontFaces(bytes)) library.add(face);
  }
  fonts = library;
}

/** Prepare the bundled catalogue outside the synchronous edit and paint paths. */
export async function prepareText(characters = "") {
  loading ??= loadCatalogue().catch(error => { loading = undefined; throw error; });
  await Promise.all([loading, prepareWordSegmenter(characters)]);
}

export const hasFontFamily = (family:string) => fonts?.hasFamily(family) ?? false;
export const localOnlyFont = (family:string) => fonts?.localOnly(family) ?? false;
export const fontFamilies = () => fonts?.families() ?? [];
export const textFace = (family:string,style:string) => fonts?.find(family,style) ?? fonts?.defaultFace();
export const familyStyleWeights = (family:string) => fonts?.styleWeights(family) ?? [];
export const familyStyles = (family: string) => fonts?.styles(family) ?? [];

export function queryFonts(params:Record<string,unknown>) {
  if (!fonts) throw new Error("Prepare the font catalogue with executeAsync first");
  const family=parseString(params.family);
  if (family===undefined) return fonts.families();
  const features=parseBoolean(params.features), axes=parseBoolean(params.axes);
  if (!features && !axes) return fonts.styles(family);
  const face=textFace(family,parseString(params.style) ?? "Regular");
  if (features) return face ? [...face.features] : [];
  if (!face) return null;
  return {
    family:face.family,
    axes:Object.values(face.axes).sort((a,b)=>a.axisIndex-b.axisIndex).map(a=>({
      tag:a.tag,name:a.name,min:a.min,default:a.default,max:a.max,hidden:(a.flags & 1)!==0,
    })),
    instances:face.instances.map(i=>({name:i.name,variations:{...i.coordinates}})),
  };
}

const importedFonts=new Map<string,readonly string[]>();
export async function importFontBytes(bytes:Uint8Array<ArrayBuffer>, checkCurrent:()=>void) {
  const digest=bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)));
  checkCurrent();
  const existing=importedFonts.get(digest);
  if (existing) return existing;
  const faces=await readFontFaces(bytes);
  checkCurrent();
  // Another import may have finished while the shaper was initialising.
  const concurrent=importedFonts.get(digest);
  if (concurrent) return concurrent;
  if (!faces.length) throw new Error("Not a font file");
  const families:string[]=[];
  for (const face of faces) {
    fonts!.add(face);
    if (families.at(-1)!==face.family) families.push(face.family);
  }
  importedFonts.set(digest,Object.freeze(families));
  fontsChanged();
  return families;
}

export const fontStyleWarning = (family:string, style:string) => fonts?.styleWarning(family, style);

function measure(text: TextData, box: { width?: number; height?: number }) {
  if (!fonts) throw new Error("Call prepareText or executeAsync before creating a text layer");
  return layoutTextFlow(text, fonts, box, preparedWordStarts(text.characters));
}

/** The native layout measurer asks separately for natural size and height at a given width. */
export function measureLayoutText(node: TextNode, width?: number) {
  const autoResize = width === undefined ? "widthAndHeight" : node.text.autoResize === "widthAndHeight" ? "height" : node.text.autoResize;
  const layout = measure({...node.text, autoResize}, {width});
  return {width: Math.max(1, Math.ceil(layout.width)), height: Math.max(1, layout.height)};
}

export function autoSizeText(node: TextNode): TextNode {
  const {text, textSizing} = node;
  const h = textSizing?.horizontal ?? "fixed", v = textSizing?.vertical ?? "fixed";
  const autoWidth = text.autoResize === "widthAndHeight";
  const autoHeight = autoWidth || text.autoResize === "height";
  const horizontal = h === "fill" ? h : autoWidth ? "hug" : autoHeight ? h : "fixed";
  const vertical = v === "fill" ? v : autoHeight ? "hug" : "fixed";
  if (horizontal !== h || vertical !== v) {
    const {textSizing: _previous, ...layer} = node;
    node = Object.freeze(horizontal === "fixed" && vertical === "fixed" ? layer :
      {...layer, textSizing: Object.freeze({horizontal, vertical})});
  }
  if (text.path || text.autoResize === "none" || text.autoResize === "truncate") return node;
  const fixedWidth = text.autoResize === "height";
  const layout = measure(text, fixedWidth ? {width: node.width} : {});
  return Object.freeze({...node, width: fixedWidth ? node.width : Math.max(1, Math.ceil(layout.width)), height: Math.max(1, layout.height)});
}

export function fitEditedText(node:TextNode, previous:TextNode) {
  const fitted = autoSizeText(node);
  const right = (n:TextNode) => n.text.autoResize === "widthAndHeight" && n.text.alignH === "right";
  if (right(previous) && right(fitted) && fitted.width !== node.width)
    return withLayerTransform(fitted,multiply(rectangleTransform(node),[1,0,0,1,node.width-fitted.width,0]));
  return fitted;
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

const layouts = fontGeometryCache<TextNode, ReturnType<typeof layoutNode>>();
export function textNodeLayout(node: TextNode) {
  let result = layouts.get(node);
  if (!result) { result = layoutNode(node); layouts.set(node, result); }
  return result;
}
const paths = fontGeometryCache<TextNode, ReturnType<typeof textToPath>>();
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
