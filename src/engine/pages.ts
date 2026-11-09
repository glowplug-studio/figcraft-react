import { remapPatternSources } from "./pattern-sources";
import { isLeaf } from "./document";
import { withPageColour, type Document, type DocumentNode, type LayerNode, type NodeId, type PageNode } from "./document";
import { parseColour } from "./colour-css";
import { parseNodeId as parseId, parseString as stringValue, parseIndex } from "./parameters";

/** Source: upstream engine/cmd/page.rs; viewport and history belong to the caller. */
export const pageSpecs = Object.freeze({
  "page.add": { label: "Add page", undo: true },
  "page.select": { label: "Go to page", undo: false },
  "page.rename": { label: "Rename page", undo: true },
  "page.delete": { label: "Delete page", undo: true },
  "page.duplicate": { label: "Duplicate page", undo: true },
  "page.move": { label: "Move page", undo: true },
  "page.list": { label: "List pages", undo: false },
  "page.setBackground": { label: "Page background", undo: true },
});
export interface PageListing {
  readonly id: NodeId;
  readonly name: string;
  readonly current: boolean;
  readonly children: number;
  readonly divider: boolean;
}
export interface PageExecution {
  readonly document: Document;
  readonly selection: readonly NodeId[];
  readonly nextId: bigint;
  readonly result: Record<string, unknown>;
}
const U64_MAX = 18446744073709551615n;
const allowed: Readonly<Record<string, readonly string[]>> = {
  "page.add": ["name"], "page.select": ["id", "index"], "page.rename": ["id", "name"],
  "page.delete": ["id"], "page.duplicate": ["id"], "page.move": ["id", "index"], "page.list": [],
  "page.setBackground": ["id", "color"],
};
function page(document: Document, id: NodeId): PageNode {
  const node = document.nodes[id];
  if (!document.pages.includes(id) || !node || node.kind !== "page") throw new Error(`${id} is not a page`);
  return node;
}
export function isDivider(document: Document, id: NodeId): boolean {
  const node = document.nodes[id];
  return node?.kind === "page" && node.children.length === 0 && node.name.startsWith("-");
}
export function listPages(document: Document): readonly PageListing[] {
  return Object.freeze(document.pages.map(id => {
    const node = page(document, id);
    return Object.freeze({ id, name: node.name, current: document.currentPage === id, children: node.children.length, divider: isDivider(document, id) });
  }));
}
function cleanSelection(document: Document, selection: readonly NodeId[]): readonly NodeId[] {
  const seen = new Set<NodeId>();
  const cleaned = selection.filter(id => {
    const node = document.nodes[id];
    if (!node || node.kind === "page" || seen.has(id)) return false;
    const ancestry = new Set<NodeId>([id]);
    let parent = node.parent;
    while (parent !== document.currentPage) {
      if (ancestry.has(parent)) return false;
      ancestry.add(parent);
      const ancestor = document.nodes[parent];
      if (!ancestor || isLeaf(ancestor) || ancestor.kind === "page") return false;
      parent = ancestor.parent;
    }
    seen.add(id);
    return true;
  });
  return cleaned.length === selection.length ? selection : Object.freeze(cleaned);
}
/** Validate a complete supported subtree before any deletion or allocation. */
function pageSubtree(document: Document, source: PageNode): readonly LayerNode[] {
  const seen = new Set<NodeId>();
  const ordered: LayerNode[] = [];
  const pending = [...source.children].reverse().map(id => ({ id, parent: source.id }));
  while (pending.length) {
    const { id, parent } = pending.pop()!;
    const child = document.nodes[id];
    if (!child || child.kind === "page" || child.parent !== parent || seen.has(id)) {
      throw new Error("Page has unsupported or invalid child content");
    }
    seen.add(id);
    ordered.push(child);
    if (!isLeaf(child)) {
      if (!Array.isArray(child.children)) throw new Error("Page has unsupported or invalid child content");
      for (let index = child.children.length - 1; index >= 0; index--) pending.push({ id: child.children[index]!, parent: id });
    } else if ("children" in child && (child as RectangleNodeWithChildren).children?.length) {
      throw new Error("Page has unsupported or invalid child content");
    }
  }
  return ordered;
}
type RectangleNodeWithChildren = { readonly children?: readonly NodeId[] };
export function executePage(command: string, document: Document, selection: readonly NodeId[], nextId: bigint, params: Record<string, unknown>): PageExecution {
  const keys = Object.hasOwn(allowed, command) ? allowed[command]! : undefined;
  if (!keys) throw new Error(`Unsupported page command: ${command}`);
  for (const key of Object.keys(params)) if (!keys.includes(key)) throw new Error(`Unsupported ${command} parameter: ${key}`);
  if (command === "page.list") return { document, selection, nextId, result: { pages: listPages(document) } };
  let updated = document;
  let selected = selection;
  let allocator = nextId;
  let result: Record<string, unknown> = { ok: true };
  // Allocations are local until the entire command has succeeded.
  const allocated = new Set<NodeId>();
  const allocate = (): NodeId => {
    if (allocator < 0n || allocator > U64_MAX) throw new Error("Document identifiers are exhausted");
    while (Object.hasOwn(document.nodes, String(allocator)) || allocated.has(String(allocator))) {
      if (allocator === U64_MAX) throw new Error("Document identifiers are exhausted");
      allocator++;
    }
    const id = String(allocator);
    allocated.add(id);
    if (allocator < U64_MAX) allocator++;
    return id;
  };
  const replacePage = (node: PageNode): void => {
    updated = Object.freeze({ ...document, nodes: Object.freeze({ ...document.nodes, [node.id]: Object.freeze(node) }) });
  };
  if (command === "page.add") {
    const current = page(document, document.currentPage);
    const id = allocate();
    const node: PageNode = Object.freeze({ id, kind: "page", name: stringValue(params.name) ?? `Page ${document.pages.length + 1}`, parent: null, children: Object.freeze([]), background: current.background, ...(current.backgroundColor ? { backgroundColor: current.backgroundColor } : {}) });
    updated = Object.freeze({ ...document, pages: Object.freeze([...document.pages, id]), nodes: Object.freeze({ ...document.nodes, [id]: node }) });
    const divider = isDivider(updated, id);
    if (!divider) { updated = Object.freeze({ ...updated, currentPage: id }); selected = Object.freeze([]); }
    result = divider ? { id, divider: true } : { id };
  } else if (command === "page.select") {
    let id = parseId(params.id);
    if (id === undefined) {
      const index = parseIndex(params.index);
      id = document.pages[index];
      if (id === undefined) throw new Error("no such page");
    }
    page(document, id);
    if (isDivider(document, id)) throw new Error("a divider isn't a page to open");
    if (id !== document.currentPage) updated = Object.freeze({ ...document, currentPage: id });
    selected = Object.freeze([]);
  } else {
    // Upstream optional id() treats an unparseable id like an omitted one.
    const id = parseId(params.id) ?? document.currentPage;
    const moveIndex = command === "page.move" ? parseIndex(params.index) : undefined;
    const source = page(document, id);
    if (command === "page.setBackground") {
      const value = parseColour(params.color);
      if (!value) throw new Error("color must be a colour");
      replacePage(withPageColour(source, value));
    } else if (command === "page.rename") {
      const name = stringValue(params.name);
      if (name === undefined) throw new Error("name must be a string");
      if (name !== source.name) replacePage({ ...source, name });
    } else if (command === "page.delete") {
      const children = pageSubtree(document, source);
      const nodes = { ...document.nodes };
      delete nodes[id];
      for (const child of children) delete nodes[child.id];
      updated = Object.freeze({ ...document, pages: Object.freeze(document.pages.filter(candidate => candidate !== id)), nodes: Object.freeze(nodes) });
    } else if (command === "page.duplicate") {
      const children = pageSubtree(document, source);
      const copyId = allocate();
      const nodes: Record<NodeId, DocumentNode> = { ...document.nodes };
      const ids = new Map<NodeId, NodeId>([[source.id, copyId]]);
      for (const child of children) ids.set(child.id, allocate());
      for (const child of children) {
        const id = ids.get(child.id)!;
        const parent = ids.get(child.parent)!;
        const copy = !isLeaf(child)
          ? Object.freeze({ ...child, id, parent, children: Object.freeze(child.children.map(candidate => ids.get(candidate)!)) })
          : Object.freeze({ ...child, id, parent });
        nodes[id] = remapPatternSources(copy, target => target === source.id ? undefined : ids.get(target));
      }
      const copied = source.children.map(child => ids.get(child)!);
      nodes[copyId] = Object.freeze({ ...source, id: copyId, name: `Copy of ${source.name}`, children: Object.freeze(copied) });
      const pages = [...document.pages];
      pages.splice(pages.indexOf(id) + 1, 0, copyId);
      updated = Object.freeze({ ...document, currentPage: copyId, pages: Object.freeze(pages), nodes: Object.freeze(nodes) });
      result = { id: copyId };
    } else if (moveIndex !== undefined) {
      const index = Math.min(document.pages.length - 1, moveIndex);
      if (document.pages.indexOf(id) !== index) {
        const pages = document.pages.filter(candidate => candidate !== id);
        pages.splice(index, 0, id);
        updated = Object.freeze({ ...document, pages: Object.freeze(pages) });
      }
    }
    if (command === "page.rename" || command === "page.delete") {
      const first = updated.pages.find(candidate => !isDivider(updated, candidate));
      if (first === undefined) throw new Error("a file needs a page that isn't a divider");
      if (!updated.pages.includes(updated.currentPage) || isDivider(updated, updated.currentPage)) {
        updated = Object.freeze({ ...updated, currentPage: first });
        selected = Object.freeze([]);
      }
    }
  }
  return { document: updated, selection: cleanSelection(updated, selected), nextId: allocator, result };
}
