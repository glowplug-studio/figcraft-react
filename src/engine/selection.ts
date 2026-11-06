import { identity, inverse, multiply, transformPoint, type Affine } from "./affine";
import { layerTransform, pageOf, type Document, type NodeId } from "./document";
import { pageForNode } from "./hierarchy";
import type { Point } from "./geometry";
import { parseNodeId } from "./parameters";

/** Upstream cmd/edit.rs selection commands; selection does not enter document history. */
export const selectionSpecs = Object.freeze({
  "select.set": { label: "Select", undo: false },
  "select.add": { label: "Add to selection", undo: false },
  "select.remove": { label: "Remove from selection", undo: false },
  "select.all": { label: "Select all", undo: false },
  "select.none": { label: "Select none", undo: false },
  "select.inverse": { label: "Select inverse", undo: false },
  "select.children": { label: "Select children", undo: false },
  "select.parent": { label: "Select parent", undo: false },
});

export interface SelectionExecution {
  readonly document: Document;
  readonly selection: readonly NodeId[];
  readonly result: Record<string, unknown>;
}

function parsedTargets(params: Record<string, unknown>): NodeId[] {
  return Array.isArray(params.ids)
    ? params.ids.map(parseNodeId).filter((id): id is NodeId => id !== undefined)
    : [parseNodeId(params.id)].filter((id): id is NodeId => id !== undefined);
}

function clean(document: Document, ids: readonly NodeId[]): readonly NodeId[] {
  const seen = new Set<NodeId>();
  return Object.freeze(ids.filter(id => {
    const node = document.nodes[id];
    if (!node || node.kind === "page" || pageForNode(document, id) !== document.currentPage || seen.has(id)) return false;
    seen.add(id);
    return true;
  }));
}

export function executeSelection(command: string, document: Document, selection: readonly NodeId[], params: Record<string, unknown>): SelectionExecution {
  if (!Object.hasOwn(selectionSpecs, command)) throw new Error(`Unsupported selection command: ${command}`);
  const allowed = command === "select.set" || command === "select.add" || command === "select.remove" ? ["id", "ids"] : [];
  for (const key of Object.keys(params)) if (!allowed.includes(key)) throw new Error(`Unsupported ${command} parameter: ${key}`);

  let current = document;
  let ids: readonly NodeId[];
  const first = document.nodes[selection[0]];
  const siblingParent = first?.kind !== "page" && first?.parent ? document.nodes[first.parent] : undefined;
  const siblings = siblingParent && siblingParent.kind !== "rectangle" ? siblingParent.children : pageOf(document).children;
  if (command === "select.none") {
    ids = [];
  } else if (command === "select.all" || command === "select.inverse") {
    ids = siblings.filter(id => {
      const node = document.nodes[id];
      return node && node.kind !== "page" && node.visible !== false && node.locked !== true
        && (command !== "select.inverse" || !selection.includes(id));
    });
  } else if (command === "select.children") {
    const children = selection.flatMap(id => {
      const node = document.nodes[id];
      return node && node.kind !== "page" && node.kind !== "rectangle" ? node.children : [];
    });
    ids = children.length ? children : selection;
  } else if (command === "select.parent") {
    const parents = selection.map(id => document.nodes[id]?.parent).filter((id): id is NodeId => id !== undefined && id !== null && document.nodes[id]?.kind !== "page");
    ids = parents.length ? [...new Set(parents)] : selection;
  } else {
    const targets = parsedTargets(params);
    if (command === "select.set") {
      // Validate every parsed ID before changing the current page or selection.
      for (const id of targets) if (!Object.hasOwn(document.nodes, id)) throw new Error(`No node ${id}`);
      const first = targets[0];
      const targetPage = first === undefined ? undefined : pageForNode(document, first);
      if (targetPage !== undefined && targetPage !== document.currentPage) {
        if (!document.pages.includes(targetPage)) throw new Error(`${first} isn't on a page`);
        current = Object.freeze({ ...document, currentPage: targetPage });
      }
      ids = targets;
    } else if (command === "select.add") {
      ids = [...selection];
      for (const id of targets) if (!ids.includes(id)) ids = [...ids, id];
    } else {
      ids = selection.filter(id => !targets.includes(id));
    }
  }
  const cleaned = clean(current, ids);
  return { document: current, selection: cleaned, result: command === "select.none" ? { ok: true } : { selection: cleaned } };
}

/** Match native level_target for supported containers, using the current selection as context. */
function targetForLeaf(document: Document, leaf: NodeId, selection: readonly NodeId[]): NodeId {
  const chain: NodeId[] = [];
  let id: NodeId | null = leaf;
  while (id !== null && document.nodes[id]?.kind !== "page") {
    chain.push(id);
    id = document.nodes[id]?.parent ?? null;
  }
  chain.reverse();
  let target = 0;
  for (const selected of selection) {
    const parent = document.nodes[selected]?.parent;
    if (!parent) continue;
    const at = chain.indexOf(parent);
    if (at >= 0 && at + 1 < chain.length) target = Math.max(target, at + 1);
  }
  if (target === 0 && chain.length > 1 && document.nodes[chain[0]]?.kind === "frame") target = 1;
  return chain[target] ?? leaf;
}

/** Hit frontmost visible layer; container selection follows native level_target. */
export function hitRectangle(document: Document, point: Point, deep = false, selection: readonly NodeId[] = []): NodeId | undefined {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined;
  const page = pageOf(document);
  const hit = (id: NodeId, parent: NodeId, world: Affine, depth: number): NodeId | undefined => {
    const node = document.nodes[id];
    if (depth > 256 || !node || node.kind === "page" || node.parent !== parent || node.visible === false || node.locked === true) return undefined;
    try {
      const transform = world === identity ? layerTransform(node) : multiply(world, layerTransform(node));
      if (node.kind === "group") return hitGroup(node.children, id, transform, depth + 1);
      if (node.kind === "frame") {
        const local = transformPoint(inverse(transform), point);
        const inside = local.x >= 0 && local.x <= node.width && local.y >= 0 && local.y <= node.height;
        if (node.clip && !inside) return undefined;
        return hitGroup(node.children, id, transform, depth + 1) ?? (inside ? id : undefined);
      }
      if (world === identity && !node.transform) {
        return point.x >= node.x && point.x <= node.x + node.width && point.y >= node.y && point.y <= node.y + node.height ? id : undefined;
      }
      const local = transformPoint(inverse(transform), point);
      return local.x >= 0 && local.x <= node.width && local.y >= 0 && local.y <= node.height ? id : undefined;
    } catch {
      return undefined;
    }
  };
  const hitGroup = (children: readonly NodeId[], parent: NodeId, world: Affine, depth: number): NodeId | undefined => {
    for (let index = children.length - 1; index >= 0; index--) {
      const leaf = hit(children[index]!, parent, world, depth);
      if (leaf !== undefined) return leaf;
    }
    return undefined;
  };
  for (let index = page.children.length - 1; index >= 0; index--) {
    const leaf = hit(page.children[index]!, page.id, identity, 0);
    if (leaf !== undefined) return deep ? leaf : targetForLeaf(document, leaf, selection);
  }
  return undefined;
}
