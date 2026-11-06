/** Deliberate Document/Node subset; this is not a .figcraft file codec. */
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
