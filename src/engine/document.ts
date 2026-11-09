import type { LayerStyles, SharedStyle } from "./shared-styles";
import type { ComponentLinks, ComponentMain, ComponentSet, ComponentInstance } from "./component-properties";
import type { AutoLayout, ChildLayout, LayerSizing } from "./auto-layout";
import { scaleTextPathData } from "./text-path-data";
import type { TextData } from "./text-data";
import type { Effect } from "./effects";
import type { BlendMode } from "./blend";
import type { ImagePreset } from "./image-filters";
import type { ImageResource } from "./image-resource";
import type { Corners } from "./corners";
import type { StrokeProps } from "./stroke";
import { transformNetwork, type VectorNetwork } from "./vector-network";
import type { Affine } from "./affine";
import { type Colour, fromRgba8, toRgba8, toCssHex } from "./colour";
import { parseCssColour } from "./colour-css";
import { isLegacyPaint, paintColour, solidPaint, type Paint } from "./solid-paint";
/** Deliberate Document/Node subset; native serialisation belongs to the file adapter. */
export type NodeId = string;

export const booleanOperations = ["union", "subtract", "intersect", "exclude"] as const;
export type BooleanOperation = typeof booleanOperations[number];
export function isBooleanOperation(value: unknown): value is BooleanOperation {
  return booleanOperations.some(op => op === value);
}
export const maskTypes = ["alpha","vector","luminance"] as const;
export type MaskType = typeof maskTypes[number];
export function isMaskType(value:unknown): value is MaskType {
  return maskTypes.some(type=>type===value);
}
interface MaskProperties {
  readonly isMask?: boolean;
  readonly maskType?: MaskType;
}
export function withMaskProperties<T extends MaskProperties>(node:T, isMask = node.isMask ?? false, maskType = node.maskType ?? "alpha"): T {
  if (isMask === (node.isMask ?? false) && maskType === (node.maskType ?? "alpha")) return node;
  const {isMask: priorMask, maskType: priorType, ...rest} = node;
  return Object.freeze({...rest,...(isMask && {isMask:true}),...(maskType !== "alpha" && {maskType})}) as T;
}
export interface PageNode extends MaskProperties, ComponentLinks, LayerStyles {
  readonly effects?: readonly Effect[];
  readonly id: NodeId;
  readonly kind: "page";
  readonly name: string;
  readonly parent: null;
  readonly children: readonly NodeId[];
  readonly background: string;
  readonly backgroundColor?: Colour;
  readonly prototypeBackground?: Colour;
}
export interface Constraints {
  readonly horizontal: "left" | "right" | "leftRight" | "center" | "scale";
  readonly vertical: "top" | "bottom" | "topBottom" | "center" | "scale";
}
export const defaultConstraints: Constraints = Object.freeze({ horizontal: "left", vertical: "top" });
export interface LayerProperties extends MaskProperties, ComponentLinks, LayerStyles {
  readonly childLayout?: ChildLayout;
  readonly sizing?: LayerSizing;
  readonly effects?: readonly Effect[];
  readonly boolOp?: BooleanOperation;
  readonly id: NodeId;
  readonly name: string;
  readonly parent: NodeId;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fill: string;
  /** Native coefficients; omitted for legacy translated rectangles. x/y retain translation aliases. */
  readonly transform?: Affine;
  readonly fills?: readonly Paint[];
  readonly strokes?: readonly Paint[];
  readonly stroke?: StrokeProps;
  readonly visible?: boolean;
  readonly locked?: boolean;
  readonly opacity?: number;
  readonly blend?: BlendMode;
  readonly constraints?: Constraints;
  readonly constrainProportions?: boolean;
  readonly corners?: Corners;
}
export interface RectangleNode extends LayerProperties { readonly kind: "rectangle" }
export interface LineNode extends LayerProperties { readonly kind: "line" }
export interface EllipseNode extends LayerProperties { readonly kind: "ellipse"; readonly start: number; readonly sweep: number; readonly inner: number }
export interface PolygonNode extends LayerProperties { readonly kind: "polygon"; readonly count: number }
export interface StarNode extends LayerProperties { readonly kind: "star"; readonly count: number; readonly innerRatio: number }
export interface VectorNode extends LayerProperties { readonly kind: "vector"; readonly network: VectorNetwork }
export interface TextNode extends LayerProperties { readonly kind: "text"; readonly text: TextData; readonly textSizing?: LayerSizing; readonly charactersOverridden?: true }
export type LeafNode = RectangleNode | EllipseNode | PolygonNode | StarNode | LineNode | VectorNode | TextNode;
export type DrawShapeKind = Exclude<LeafNode["kind"], "vector" | "text"> | "arrow";
export interface GroupNode extends LayerProperties {
  readonly kind: "group";
  readonly children: readonly NodeId[];
}
interface FrameProperties extends LayerProperties {
  readonly layout?: AutoLayout;
  readonly children: readonly NodeId[];
  readonly clip: boolean;
}
export interface FrameNode extends FrameProperties { readonly kind: "frame" }
export interface ComponentNode extends FrameProperties, ComponentMain {}
export interface ComponentSetNode extends FrameProperties, ComponentSet {}
export interface InstanceNode extends FrameProperties, ComponentInstance {}
export type FrameLikeNode = FrameNode | ComponentNode | ComponentSetNode | InstanceNode;
export function isFrameLikeKind(kind: unknown): kind is FrameLikeNode["kind"] {
  return kind === "frame" || kind === "component" || kind === "componentSet" || kind === "instance";
}
export function isFrameLike(node: DocumentNode | undefined): node is FrameLikeNode {
  return node !== undefined && isFrameLikeKind(node.kind);
}
export interface BooleanNode extends LayerProperties {
  readonly kind: "booleanOp";
  readonly op: BooleanOperation;
  readonly children: readonly NodeId[];
}
export type LayerNode = LeafNode | GroupNode | FrameLikeNode | BooleanNode;
export function commonProperties(node: LayerNode): LayerProperties {
  switch (node.kind) {
    case "component": { const { description, props, propOrder, ...frame } = node; return commonProperties({ ...frame, kind: "frame" }); }
    case "componentSet": { const { description, ...frame } = node; return commonProperties({ ...frame, kind: "frame" }); }
    case "instance": { const { component, props, ...frame } = node; return commonProperties({ ...frame, kind: "frame" }); }
    case "frame": { const { kind: _kind, children: _children, clip: _clip, layout: _layout, ...common } = node; return common; }
    case "group": { const { kind: _kind, children: _children, ...common } = node; return common; }
    case "booleanOp": { const { kind: _kind, children: _children, op: _op, ...common } = node; return common; }
    case "ellipse": { const { kind: _kind, start: _start, sweep: _sweep, inner: _inner, ...common } = node; return common; }
    case "polygon": { const { kind: _kind, count: _count, ...common } = node; return common; }
    case "star": { const { kind: _kind, count: _count, innerRatio: _inner, ...common } = node; return common; }
    case "text": { const { kind: _kind, text: _text, textSizing: _sizing, charactersOverridden: _overridden, ...common } = node; return _sizing ? {...common, sizing: _sizing} : common; }
    case "vector": { const { kind: _kind, network: _network, ...common } = node; return common; }
    default: { const { kind: _kind, ...common } = node; return common; }
  }
}
export type DocumentNode = PageNode | LayerNode;
export function nodeTypeName(node: DocumentNode): string {
  if (node.kind === "booleanOp") return "BOOLEAN_OPERATION";
  if (node.kind === "componentSet") return "COMPONENT_SET";
  return node.kind.toUpperCase();
}
export const isGroupLike = (node: DocumentNode | undefined): node is GroupNode | BooleanNode => node?.kind === "group" || node?.kind === "booleanOp";
export const isLeafKind = (kind: unknown): kind is LeafNode["kind"] => kind === "rectangle" || kind === "ellipse" || kind === "polygon" || kind === "star" || kind === "line" || kind === "vector" || kind === "text";
export const isDrawTool = (kind: unknown): kind is DrawShapeKind => isLeafKind(kind) && kind !== "vector" && kind !== "text" || kind === "arrow";
export const isLeaf = (node: DocumentNode): node is LeafNode => isLeafKind(node.kind);
export const layerBlend = (node: LayerNode): BlendMode => node.blend ?? (isLeaf(node) ? "normal" : "passThrough");
export interface Document {
  readonly styles?: readonly SharedStyle[];
  readonly colourProfile?: import("./colour-spaces").ColourProfile;
  readonly documentColours?: readonly Colour[];
  readonly imagePresets?: readonly ImagePreset[];
  readonly images?: Readonly<Record<string, ImageResource>>;
  readonly name: string;
  readonly pages: readonly NodeId[];
  readonly currentPage: NodeId;
  readonly nodes: Readonly<Record<NodeId, DocumentNode>>;
}
// Current page is navigation state. It is persisted, but does not dirty document content.
export function sameContent(a: Document, b: Document | null): boolean {
  return b !== null && a.name === b.name && a.pages === b.pages && a.styles === b.styles && a.nodes === b.nodes && (a.colourProfile ?? "srgb") === (b.colourProfile ?? "srgb") && a.documentColours === b.documentColours && a.images === b.images && a.imagePresets === b.imagePresets;
}
export function newDocument(name = "Untitled"): Document {
  const page: PageNode = Object.freeze({ id: "1", kind: "page", name: "Page 1", parent: null, children: Object.freeze([]), background: "#f5f5f5" });
  return Object.freeze({ name, pages: Object.freeze([page.id]), currentPage: page.id, nodes: Object.freeze({ [page.id]: page }) });
}
export function pageOf(document: Document): PageNode {
  const page = document.nodes[document.currentPage];
  if (!page || page.kind !== "page") throw new Error("The document has no current page");
  return page;
}

export function rectangleTransform(node: LayerNode): Affine {
  return node.transform ?? [1, 0, 0, 1, node.x, node.y];
}

/** Single canonical update path for native coefficients and legacy translation aliases. */
export function withRectangleTransform<T extends LayerNode>(node: T, matrix: Affine): T {
  if (matrix.length !== 6 || matrix.some(value => !Number.isFinite(value))) throw new Error("Transform must contain six finite coefficients");
  const { transform: previous, ...rest } = node;
  const translated = matrix[0] === 1 && matrix[1] === 0 && matrix[2] === 0 && matrix[3] === 1;
  return Object.freeze({ ...rest, x: matrix[4], y: matrix[5], ...(translated ? {} : { transform: Object.freeze([...matrix]) as Affine }) }) as T;
}
export const layerTransform = rectangleTransform;
export const withLayerTransform = withRectangleTransform;

/** Native layout::set_size changes network coordinates while ordinary resize retains point radii. */
export function withLayerSize<T extends LayerNode>(node: T, width: number, height: number): T;
export function withLayerSize(node: LayerNode, width: number, height: number): LayerNode {
  if (node.kind === "vector" && (Math.abs(width - node.width) >= 1e-9 || Math.abs(height - node.height) >= 1e-9)) {
    const network = transformNetwork(node.network, [node.width > 1e-9 ? width / node.width : 1, 0, 0, node.height > 1e-9 ? height / node.height : 1, 0, 0]);
    return Object.freeze({ ...node, width, height, network });
  }
  if (node.kind === "text" && node.text.path && (Math.abs(width-node.width)>=1e-9 || Math.abs(height-node.height)>=1e-9)) {
    const sx=node.width>1e-9 ? width/node.width : 1, sy=node.height>1e-9 ? height/node.height : 1;
    const path=Object.freeze({...node.text.path,d:scaleTextPathData(node.text.path.d,sx,sy)});
    return Object.freeze({...node,width,height,text:Object.freeze({...node.text,path})});
  }
  return Object.freeze({ ...node, width, height });
}

const legacyPaintCache = new Map<string, readonly Paint[]>();
export function rectanglePaints(node: LayerNode): readonly Paint[] {
  if (node.fills) return node.fills;
  let paints = legacyPaintCache.get(node.fill);
  if (!paints) {
    const value = parseCssColour(node.fill);
    if (!value) throw new Error("Invalid legacy rectangle fill");
    paints = Object.freeze(node.fill === "transparent" ? [] : [solidPaint(value)]);
    if (legacyPaintCache.size >= 256) legacyPaintCache.clear();
    legacyPaintCache.set(node.fill, paints);
  }
  return paints;
}
export function withRectanglePaints<T extends LayerNode>(node: T, paints: readonly Paint[]): T {
  const { fills: previous, ...rest } = node;
  const simple = paints.length === 0 || paints.length === 1 && isLegacyPaint(paints[0]);
  const fill = paints[0]?.type === "solid" ? toCssHex(paintColour(paints[0])).toLowerCase() : "transparent";
  return Object.freeze({ ...rest, fill, ...(simple ? {} : { fills: Object.freeze([...paints]) }) }) as T;
}
export function pageColour(page: PageNode): Colour {
  const value = page.backgroundColor ?? parseCssColour(page.background);
  if (!value) throw new Error("Invalid page background");
  return value;
}
export function withPageColour(page: PageNode, value: Colour): PageNode {
  const { backgroundColor: previous, ...rest } = page;
  const bytes = toRgba8(value), canonical = fromRgba8(...bytes);
  const simple = value.a === 1 && value.r === canonical.r && value.g === canonical.g && value.b === canonical.b;
  return Object.freeze({ ...rest, background: toCssHex(value).toLowerCase(), ...(simple ? {} : { backgroundColor: value }) });
}
