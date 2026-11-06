import type { Affine } from "./affine";
/** Deliberate Document/Node subset; native serialisation belongs to the file adapter. */
export type NodeId = string;
export interface PageNode {
  readonly id: NodeId;
  readonly kind: "page";
  readonly name: string;
  readonly parent: null;
  readonly children: readonly NodeId[];
  readonly background: string;
}
export interface RectangleNode {
  readonly id: NodeId;
  readonly kind: "rectangle";
  readonly name: string;
  readonly parent: NodeId;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fill: string;
  /** Native coefficients; omitted for legacy translated rectangles. x/y retain translation aliases. */
  readonly transform?: Affine;
}
export type DocumentNode = PageNode | RectangleNode;
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

export function rectangleTransform(node: RectangleNode): Affine {
  return node.transform ?? [1, 0, 0, 1, node.x, node.y];
}

/** Single canonical update path for native coefficients and legacy translation aliases. */
export function withRectangleTransform(node: RectangleNode, matrix: Affine): RectangleNode {
  if (matrix.length !== 6 || matrix.some(value => !Number.isFinite(value))) throw new Error("Transform must contain six finite coefficients");
  const { transform: previous, ...rest } = node;
  const translated = matrix[0] === 1 && matrix[1] === 0 && matrix[2] === 0 && matrix[3] === 1;
  return Object.freeze({ ...rest, x: matrix[4], y: matrix[5], ...(translated ? {} : { transform: Object.freeze([...matrix]) as Affine }) });
}
