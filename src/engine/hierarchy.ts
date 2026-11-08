import { isLeaf } from "./document";
import { identity, inverse, multiply, transformBounds, type Affine } from "./affine";
import { layerTransform, withLayerTransform, type Document, type DocumentNode, type LayerNode, type NodeId } from "./document";

function nodeOf(document: Document, id: NodeId): DocumentNode {
  const node = document.nodes[id];
  if (!node) throw new Error(`No node ${id}`);
  return node;
}

function childrenOf(node: DocumentNode): readonly NodeId[] {
  return isLeaf(node) ? [] : node.children;
}

function ancestors(document: Document, id: NodeId): NodeId[] {
  const result: NodeId[] = [], seen = new Set<NodeId>([id]);
  let node = document.nodes[id];
  while (node && node.parent !== null) {
    if (seen.has(node.parent)) throw new Error("Cyclic node hierarchy");
    seen.add(node.parent);
    result.push(node.parent);
    node = nodeOf(document, node.parent);
  }
  return result;
}

/** The full local-to-page affine, including every enclosing group. */
export function worldTransform(document: Document, id: NodeId): Affine {
  let transform: Affine = identity;
  let node = nodeOf(document, id);
  const seen = new Set<NodeId>();
  while (node.kind !== "page") {
    if (seen.has(node.id)) throw new Error("Cyclic node hierarchy");
    seen.add(node.id);
    transform = multiply(layerTransform(node), transform);
    node = nodeOf(document, node.parent);
  }
  return transform;
}

/** Groups have no frame coordinate space of their own. */
export function frameRelative(document: Document, id: NodeId): Affine {
  const node = document.nodes[id];
  if (!node || node.kind === "page") return identity;
  let transform = layerTransform(node);
  let parent = document.nodes[node.parent];
  const seen = new Set<NodeId>();
  let limit = Infinity;
  for (let hops = 0; parent?.kind === "group"; hops++) {
    // Count the whole document only for a malformed cycle, matching the native hop bound.
    if (limit === Infinity && seen.has(parent.id)) limit = Object.keys(document.nodes).length;
    if (hops >= limit) break;
    seen.add(parent.id);
    transform = multiply(layerTransform(parent), transform);
    parent = document.nodes[parent.parent];
  }
  return transform;
}

export function pageForNode(document: Document, id: NodeId): NodeId | undefined {
  const node = document.nodes[id];
  if (!node) return undefined;
  if (node.kind === "page") return document.pages.includes(id) ? id : undefined;
  const chain = ancestors(document, id);
  const page = chain.at(-1);
  return page && document.nodes[page]?.kind === "page" && document.pages.includes(page) ? page : undefined;
}

export function subtreeIds(document: Document, id: NodeId): readonly NodeId[] {
  nodeOf(document, id);
  const result: NodeId[] = [], seen = new Set<NodeId>(), stack = [id];
  while (stack.length) {
    const current = stack.pop()!;
    if (seen.has(current)) throw new Error("Cyclic or repeated node hierarchy");
    seen.add(current);
    const node = nodeOf(document, current);
    result.push(current);
    stack.push(...[...childrenOf(node)].reverse());
  }
  return result;
}

export function rootIds(document: Document, ids: readonly NodeId[]): NodeId[] {
  const selected = new Set(ids), seen = new Set<NodeId>();
  return ids.filter(id => {
    nodeOf(document, id);
    if (seen.has(id)) return false;
    seen.add(id);
    return !ancestors(document, id).some(parent => selected.has(parent));
  });
}

/** Tree pre-order matches bottom-to-top native paint order. */
export function zSorted(document: Document, ids: readonly NodeId[]): NodeId[] {
  const order = new Map<NodeId, number>();
  for (const page of document.pages) for (const id of subtreeIds(document, page)) order.set(id, order.size);
  return [...ids].sort((left, right) => (order.get(left) ?? Number.MAX_SAFE_INTEGER) - (order.get(right) ?? Number.MAX_SAFE_INTEGER));
}

export class HierarchyDraft {
  readonly nodes: Record<NodeId, DocumentNode>;
  readonly originalDocument: Document;
  readonly changedIds = new Set<NodeId>();
  #changed = false;

  constructor(document: Document) {
    this.originalDocument = document;
    this.nodes = { ...document.nodes };
  }

  get document(): Document { return { ...this.originalDocument, nodes: this.nodes }; }

  set(node: DocumentNode): void {
    if (!this.nodes[node.id]) throw new Error(`No node ${node.id}`);
    if (node === this.nodes[node.id]) return;
    this.nodes[node.id] = Object.freeze(node);
    this.#changed = true;
    this.changedIds.add(node.id);
  }

  allocateId(start: bigint): { id: NodeId; nextId: bigint } {
    const maximum = 18446744073709551615n;
    let value = start;
    while (value <= maximum && this.nodes[String(value)]) value++;
    if (value < 0n || value > maximum) throw new Error("Document identifiers are exhausted");
    return { id: String(value), nextId: value === maximum ? maximum : value + 1n };
  }
  insert(node: LayerNode, parent: NodeId, index?: number): void {
    if (this.nodes[node.id]) throw new Error(`Node ${node.id} already exists`);
    const target = nodeOf(this.document, parent);
    if (isLeaf(target)) throw new Error(`${parent} is not a container`);
    if (index !== undefined && (!Number.isSafeInteger(index) || index < 0)) throw new Error("Invalid child index");
    if (!isLeaf(node) && node.children.length) throw new Error("Inserted containers must start empty");
    const children = [...target.children];
    children.splice(Math.min(index ?? children.length, children.length), 0, node.id);
    this.nodes[node.id] = Object.freeze({ ...node, parent });
    this.changedIds.add(node.id);
    this.set(Object.freeze({ ...target, children: Object.freeze(children) }));
  }

  reparent(id: NodeId, parent: NodeId, index?: number): void {
    const document = this.document, node = nodeOf(document, id), destination = nodeOf(document, parent);
    if (node.kind === "page") throw new Error("Pages cannot be reparented");
    if (isLeaf(destination)) throw new Error(`${parent} is not a container`);
    if (id === parent || ancestors(document, parent).includes(id)) throw new Error("Cyclic node hierarchy");
    if (index !== undefined && (!Number.isSafeInteger(index) || index < 0)) throw new Error("Invalid child index");
    const oldParent = nodeOf(document, node.parent);
    if (isLeaf(oldParent)) throw new Error("Invalid parent");
    const oldIndex = oldParent.children.indexOf(id);
    if (oldIndex < 0) throw new Error("Missing parent-child link");
    const world = worldTransform(document, id), local = multiply(inverse(worldTransform(document, parent)), world);
    const oldChildren = oldParent.children.filter(child => child !== id);
    const destinationChildren = parent === oldParent.id ? oldChildren : [...destination.children];
    let at = index ?? destinationChildren.length;
    if (parent === oldParent.id && index !== undefined && oldIndex < at) at--;
    destinationChildren.splice(Math.min(at, destinationChildren.length), 0, id);
    if (parent !== oldParent.id) this.set(Object.freeze({ ...oldParent, children: Object.freeze(oldChildren) }));
    this.set(Object.freeze({ ...destination, children: Object.freeze(destinationChildren) }));
    this.set(Object.freeze({ ...withLayerTransform(node, local), parent }));
  }

  fitToChildren(id: NodeId): void {
    const document = this.document, node = nodeOf(document, id);
    if (node.kind !== "group" || node.children.length === 0) return;
    const world = worldTransform(document, id), toLocal = inverse(world);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const childWorlds = node.children.map(childId => {
      const child = nodeOf(document, childId);
      if (child.kind === "page") throw new Error("Page cannot be a group child");
      const childWorld = worldTransform(document, childId);
      const bounds = transformBounds(multiply(toLocal, childWorld), child.width, child.height);
      x0 = Math.min(x0, bounds.x); y0 = Math.min(y0, bounds.y);
      x1 = Math.max(x1, bounds.x + bounds.width); y1 = Math.max(y1, bounds.y + bounds.height);
      return [childId, childWorld] as const;
    });
    const shift: Affine = [1, 0, 0, 1, x0, y0];
    const newWorld = multiply(world, shift), toNewLocal = inverse(newWorld);
    const newTransform = multiply(layerTransform(node), shift);
    transformBounds(newTransform, x1 - x0, y1 - y0);
    this.set(Object.freeze({ ...withLayerTransform(node, newTransform), width: x1 - x0, height: y1 - y0 }));
    for (const [childId, childWorld] of childWorlds) {
      const child = nodeOf(this.document, childId) as LayerNode;
      this.set(withLayerTransform(child, multiply(toNewLocal, childWorld)));
    }
  }

  fitAncestors(id: NodeId): void {
    for (const parent of ancestors(this.document, id)) {
      if (this.nodes[parent]?.kind !== "group") break;
      this.fitToChildren(parent);
    }
  }

  remove(id: NodeId): void {
    const document = this.document, node = nodeOf(document, id);
    if (node.kind === "page") throw new Error("Use page commands to remove pages");
    const parent = nodeOf(document, node.parent);
    if (isLeaf(parent) || !parent.children.includes(id)) throw new Error("Missing parent-child link");
    const descendants = subtreeIds(document, id);
    this.set(Object.freeze({ ...parent, children: Object.freeze(parent.children.filter(child => child !== id)) }));
    for (const descendant of descendants) delete this.nodes[descendant];
    for (const descendant of descendants) this.changedIds.add(descendant);
    this.#changed = true;
  }

  /** Upstream post-command maintenance: only touched groups and their ancestors refit. */
  normaliseGroups(): void {
    const document = this.document;
    const touched = new Set<NodeId>();
    for (const id of this.changedIds) {
      if (this.nodes[id]) touched.add(id);
      else {
        const oldParent = this.originalDocument.nodes[id]?.parent;
        if (oldParent && this.nodes[oldParent]) touched.add(oldParent);
      }
    }
    const groups = new Set<NodeId>();
    for (const id of touched) {
      if (this.nodes[id]?.kind === "group") groups.add(id);
      for (const parent of ancestors(document, id)) {
        if (this.nodes[parent]?.kind !== "group") break;
        groups.add(parent);
      }
    }
    const deepestFirst = [...groups].sort((left, right) => ancestors(document, right).length - ancestors(document, left).length);
    for (const id of deepestFirst) {
      const node = this.nodes[id];
      if (!node || node.kind !== "group") continue;
      if (node.children.length === 0) this.remove(id);
      else this.fitToChildren(id);
    }
  }

  finish(): Document {
    return this.#changed ? Object.freeze({ ...this.originalDocument, nodes: Object.freeze(this.nodes) }) : this.originalDocument;
  }
}
