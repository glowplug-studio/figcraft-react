import type { Document, NodeId } from "./document";
import { inverse, transformPoint } from "./affine";
import type { Point, Rectangle } from "./geometry";
import { worldTransform } from "./hierarchy";
import { boundsOf } from "./viewport";
import { selectionFrame } from "./rotation";
import { targetForLeaf } from "./selection";

export const containsPoint = (r: Rectangle, p: Point): boolean => p.x >= r.x && p.y >= r.y && p.x <= r.x + r.width && p.y <= r.y + r.height;
export const containsBox = (a: Rectangle, b: Rectangle): boolean => containsPoint(a, b) && containsPoint(a, { x: b.x + b.width, y: b.y + b.height });
const touches = (a: Rectangle, b: Rectangle): boolean => a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
export function ancestorIds(document: Document, id: NodeId): NodeId[] {
  const ids: NodeId[] = [], seen = new Set<NodeId>([id]);
  let parent = document.nodes[id]?.parent;
  while (parent) {
    if (seen.has(parent)) throw new Error("Cyclic hierarchy");
    ids.push(parent); seen.add(parent); parent = document.nodes[parent]?.parent;
  }
  return ids;
}
export function lockedIn(document: Document, id: NodeId): boolean {
  return [id, ...ancestorIds(document, id)].some(id => { const node = document.nodes[id]; return node && node.kind !== "page" && node.locked === true; });
}
export function paintsBelow(document: Document, below: NodeId, above: NodeId): boolean {
  const a = [...ancestorIds(document, below).reverse(), below], b = [...ancestorIds(document, above).reverse(), above];
  let shared = 0;
  while (shared < a.length && a[shared] === b[shared]) shared++;
  if (shared === a.length) return shared < b.length;
  const parent = document.nodes[a[shared - 1]];
  return Boolean(parent && parent.kind !== "rectangle" && shared < b.length && parent.children.indexOf(a[shared]) < parent.children.indexOf(b[shared]));
}
export function selectionContains(document: Document, ids: readonly NodeId[], point: Point): boolean {
  try {
    const frame = selectionFrame(document, ids);
    return Boolean(frame && frame.width > 0 && frame.height > 0 && containsPoint({ x: 0, y: 0, width: frame.width, height: frame.height }, transformPoint(inverse(frame.matrix), point)));
  } catch { return false; }
}
export function enterTarget(document: Document, leaf: NodeId, selected: readonly NodeId[]): NodeId {
  const chain = [...ancestorIds(document, leaf).reverse(), leaf];
  for (let index = chain.length - 1; index >= 0; index--) if (selected.includes(chain[index]) && chain[index + 1]) return chain[index + 1];
  return targetForLeaf(document, leaf, selected);
}

/** Native deepest free-layout destination, excluding the complete moving branches. */
export function dropParent(document: Document, point: Point, exclude: readonly NodeId[]): NodeId | undefined {
  const omitted = new Set(exclude);
  const visit = (id: NodeId, depth: number): NodeId | undefined => {
    const node = document.nodes[id];
    if (!node || node.kind === "page" || depth > 128 || omitted.has(id) || node.visible === false || node.locked) return;
    if (node.kind === "rectangle") return;
    if (node.kind === "frame") {
      try {
        if (!containsPoint({ x: 0, y: 0, width: node.width, height: node.height }, transformPoint(inverse(worldTransform(document, id)), point))) return;
      } catch { return; }
    }
    for (const child of [...node.children].reverse()) {
      const found = visit(child, depth + 1); if (found) return found;
    }
    return node.kind === "frame" ? id : undefined;
  };
  const page = document.nodes[document.currentPage];
  if (page.kind !== "page") return;
  for (const id of [...page.children].reverse()) { const found = visit(id, 0); if (found) return found; }
  return;
}
export function dragParent(document: Document, point: Point, moving: readonly NodeId[]): NodeId {
  const hit = dropParent(document, point, moving), home = document.nodes[moving[0]]?.parent;
  if (home && document.nodes[home]?.kind === "frame" && (!hit || hit !== home && ancestorIds(document, home).includes(hit))) {
    const bounds = boundsOf(document, [home]);
    if (bounds && containsPoint(bounds, point)) return home;
  }
  return hit ?? document.currentPage;
}
export function marqueeWithin(document: Document, point: Point): NodeId | undefined {
  const frame = dropParent(document, point, []);
  return frame && document.nodes[frame]?.parent === document.currentPage ? frame : undefined;
}
export function marqueeSelection(document: Document, box: Rectangle, within: NodeId | undefined, deep: boolean, base: readonly NodeId[], toggle: boolean): readonly NodeId[] {
  const hits: NodeId[] = [];
  const walk = (parent: NodeId, depth: number): void => {
    const node = document.nodes[parent];
    if (!node || node.kind === "rectangle") return;
    for (const id of node.children) {
      const child = document.nodes[id];
      if (!child || child.kind === "page" || child.visible === false || child.locked) continue;
      const bounds = boundsOf(document, [id]);
      if (!bounds || !touches(box, bounds)) continue;
      if (!deep && !within && child.kind === "frame" && !containsBox(box, bounds)) continue;
      const count = hits.length;
      if (deep && child.kind !== "rectangle" && depth < 256) walk(id, depth + 1);
      if (count === hits.length) hits.push(id);
    }
  };
  walk(deep ? document.currentPage : within ?? document.currentPage, 0);
  const selected = base.filter(id => !(toggle && hits.includes(id)));
  for (const id of hits) if (!base.includes(id) && !selected.includes(id)) selected.push(id);
  return Object.freeze(selected);
}
