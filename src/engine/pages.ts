import type { Document, DocumentNode, NodeId, PageNode } from "./document";

/** Source: upstream engine/cmd/page.rs; viewport and history belong to the caller. */
export const pageSpecs = Object.freeze({
  "page.add": { label: "Add page", undo: true },
  "page.select": { label: "Go to page", undo: false },
  "page.rename": { label: "Rename page", undo: true },
  "page.delete": { label: "Delete page", undo: true },
  "page.duplicate": { label: "Duplicate page", undo: true },
  "page.move": { label: "Move page", undo: true },
  "page.list": { label: "List pages", undo: false },
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
};
function parseId(value: unknown): NodeId | undefined {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? String(value) : undefined;
  if (typeof value !== "string") return undefined;
  const suffix = value.trim().split(":").at(-1)!;
  if (!/^\d+$/.test(suffix)) return undefined;
  const id = BigInt(suffix);
  return id <= U64_MAX ? String(id) : undefined;
}
function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}
function numeric(value: unknown): number {
  let number: number;
  if (typeof value === "number") number = value;
  else if (typeof value === "boolean") number = value ? 1 : 0;
  else if (typeof value === "string") {
    // The upstream numeric parser trims px/% suffixes and accepts decimal/exponent notation.
    const text = value.trim().replace(/(?:px)+$/, "").replace(/%+$/, "").trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) throw new Error("index must be a number");
    number = Number(text);
  } else throw new Error("index must be a number");
  if (!Number.isFinite(number)) throw new Error("index must be a finite number");
  return number;
}
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
    if (!node || node.kind !== "rectangle" || node.parent !== document.currentPage || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return cleaned.length === selection.length ? selection : Object.freeze(cleaned);
}
/** Restrict copying/removal to supported children; never silently flatten future node kinds. */
function rectangleChildren(document: Document, source: PageNode): readonly DocumentNode[] {
  const seen = new Set<NodeId>();
  return source.children.map(id => {
    const child = document.nodes[id];
    if (!child || child.kind !== "rectangle" || child.parent !== source.id || seen.has(id)) throw new Error("Page has unsupported or invalid child content");
    seen.add(id);
    return child;
  });
}
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
    const node: PageNode = Object.freeze({ id, kind: "page", name: stringValue(params.name) ?? `Page ${document.pages.length + 1}`, parent: null, children: Object.freeze([]), background: current.background });
    updated = Object.freeze({ ...document, pages: Object.freeze([...document.pages, id]), nodes: Object.freeze({ ...document.nodes, [id]: node }) });
    const divider = isDivider(updated, id);
    if (!divider) { updated = Object.freeze({ ...updated, currentPage: id }); selected = Object.freeze([]); }
    result = divider ? { id, divider: true } : { id };
  } else if (command === "page.select") {
    let id = parseId(params.id);
    if (id === undefined) {
      const index = numeric(params.index);
      if (!Number.isInteger(index) || index < 0 || index >= 1e9) throw new Error("index out of range");
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
    const source = page(document, id);
    if (command === "page.rename") {
      const name = stringValue(params.name);
      if (name === undefined) throw new Error("name must be a string");
      if (name !== source.name) replacePage({ ...source, name });
    } else if (command === "page.delete") {
      const children = rectangleChildren(document, source);
      const nodes = { ...document.nodes };
      delete nodes[id];
      for (const child of children) delete nodes[child.id];
      updated = Object.freeze({ ...document, pages: Object.freeze(document.pages.filter(candidate => candidate !== id)), nodes: Object.freeze(nodes) });
    } else if (command === "page.duplicate") {
      const children = rectangleChildren(document, source);
      const copyId = allocate();
      const nodes: Record<NodeId, DocumentNode> = { ...document.nodes };
      const copied = children.map(child => {
        const childId = allocate();
        if (child.kind !== "rectangle") throw new Error("Unsupported page child kind");
        nodes[childId] = Object.freeze({ ...child, id: childId, parent: copyId });
        return childId;
      });
      nodes[copyId] = Object.freeze({ ...source, id: copyId, name: `Copy of ${source.name}`, children: Object.freeze(copied) });
      const pages = [...document.pages];
      pages.splice(pages.indexOf(id) + 1, 0, copyId);
      updated = Object.freeze({ ...document, currentPage: copyId, pages: Object.freeze(pages), nodes: Object.freeze(nodes) });
      result = { id: copyId };
    } else if (command === "page.move") {
      const index = Math.min(document.pages.length - 1, Math.trunc(Math.max(0, numeric(params.index))));
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
