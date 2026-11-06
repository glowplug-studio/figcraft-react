import type { Corners } from "./corners";
import type { Affine } from "./affine";
import { type Colour, fromRgba8, toRgba8, toCssHex } from "./colour";
import { parseCssColour } from "./colour-css";
import { isLegacyPaint, paintColour, solidPaint, type SolidPaint } from "./solid-paint";
/** Deliberate Document/Node subset; native serialisation belongs to the file adapter. */
export type NodeId = string;
export interface PageNode {
  readonly id: NodeId;
  readonly kind: "page";
  readonly name: string;
  readonly parent: null;
  readonly children: readonly NodeId[];
  readonly background: string;
  readonly backgroundColor?: Colour;
}
export interface Constraints {
  readonly horizontal: "left" | "right" | "leftRight" | "center" | "scale";
  readonly vertical: "top" | "bottom" | "topBottom" | "center" | "scale";
}
export const defaultConstraints: Constraints = Object.freeze({ horizontal: "left", vertical: "top" });
export interface LayerProperties {
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
  readonly fills?: readonly SolidPaint[];
  readonly visible?: boolean;
  readonly locked?: boolean;
  readonly opacity?: number;
  readonly blend?: "normal" | "passThrough";
  readonly constraints?: Constraints;
  readonly constrainProportions?: boolean;
  readonly corners?: Corners;
}
export interface RectangleNode extends LayerProperties { readonly kind: "rectangle" }
export interface EllipseNode extends LayerProperties { readonly kind: "ellipse"; readonly start: number; readonly sweep: number; readonly inner: number }
export interface GroupNode extends LayerProperties {
  readonly kind: "group";
  readonly children: readonly NodeId[];
}
export interface FrameNode extends LayerProperties {
  readonly kind: "frame";
  readonly children: readonly NodeId[];
  readonly clip: boolean;
}
export type LayerNode = RectangleNode | EllipseNode | GroupNode | FrameNode;
export type DocumentNode = PageNode | LayerNode;
export const isLeafKind = (kind: unknown): kind is "rectangle" | "ellipse" => kind === "rectangle" || kind === "ellipse";
export const isLeaf = (node: DocumentNode): node is RectangleNode | EllipseNode => isLeafKind(node.kind);
export interface Document {
  readonly name: string;
  readonly pages: readonly NodeId[];
  readonly currentPage: NodeId;
  readonly nodes: Readonly<Record<NodeId, DocumentNode>>;
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

const legacyPaintCache = new Map<string, readonly SolidPaint[]>();
export function rectanglePaints(node: LayerNode): readonly SolidPaint[] {
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
export function withRectanglePaints<T extends LayerNode>(node: T, paints: readonly SolidPaint[]): T {
  const { fills: previous, ...rest } = node;
  const simple = paints.length === 0 || paints.length === 1 && isLegacyPaint(paints[0]);
  const fill = paints.length ? toCssHex(paintColour(paints[0])).toLowerCase() : "transparent";
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
