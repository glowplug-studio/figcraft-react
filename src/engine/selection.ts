import { inverse, transformPoint } from "./affine";
import { pageOf, rectangleTransform, type Document, type NodeId } from "./document";
import type { Point } from "./geometry";
import { parseNodeId } from "./parameters";

/** Upstream cmd/edit.rs selection commands; selection does not enter document history. */
export const selectionSpecs = Object.freeze({
  "select.set": { label: "Select", undo: false },
  "select.add": { label: "Add to selection", undo: false },
  "select.remove": { label: "Remove from selection", undo: false },
  "select.all": { label: "Select all", undo: false },
  "select.none": { label: "Select none", undo: false },
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
    if (node?.kind !== "rectangle" || node.parent !== document.currentPage || seen.has(id)) return false;
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
  if (command === "select.none") {
    ids = [];
  } else if (command === "select.all") {
    ids = pageOf(document).children.filter(id => {
      const node = document.nodes[id];
      return node?.kind === "rectangle" && node.visible !== false && node.locked !== true;
    });
  } else {
    const targets = parsedTargets(params);
    if (command === "select.set") {
      // Validate every parsed ID before changing the current page or selection.
      for (const id of targets) if (!Object.hasOwn(document.nodes, id)) throw new Error(`No node ${id}`);
      const first = targets[0];
      const node = first === undefined ? undefined : document.nodes[first];
      const targetPage = node?.kind === "page" ? first : node?.parent;
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

/** Current flat rectangle model: local box hit, frontmost child first. */
export function hitRectangle(document: Document, point: Point): NodeId | undefined {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined;
  const children = pageOf(document).children;
  for (let index = children.length - 1; index >= 0; index--) {
    const id = children[index]!;
    const node = document.nodes[id];
    if (node?.kind !== "rectangle" || node.parent !== document.currentPage || node.visible === false || node.locked === true) continue;
    if (!node.transform) {
      if (point.x >= node.x && point.x <= node.x + node.width && point.y >= node.y && point.y <= node.y + node.height) return id;
      continue;
    }
    try {
      const local = transformPoint(inverse(rectangleTransform(node)), point);
      if (local.x >= 0 && local.x <= node.width && local.y >= 0 && local.y <= node.height) return id;
    } catch {
      // Singular or non-finite transforms cannot produce a meaningful local hit.
    }
  }
  return undefined;
}
