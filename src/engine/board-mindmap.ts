import { inverse, multiply, transformPoint, type Affine } from "./affine";
import type { Document, DocumentNode, NodeId } from "./document";
import { HierarchyDraft, ancestors, pageForNode, worldTransform } from "./hierarchy";
import type { BoardItem, Connector, End } from "./board-data";
import { boundsOf } from "./viewport";

/** Source: upstream doc/src/board_mindmap.rs and engine/src/boards/board/mindmap.rs (#2226): mind map layout, nodes and branches. */
export const mindGapX = 88, mindGapY = 48, mindMaxNodes = 2000, mindMaxDepth = 64;
export const mindRootSize = 24, mindNodeSize = 16, mindLineHeight = 150, mindRootTracking = -1.9, mindNodeTracking = -1.1, mindMinW = 8;
export const mindRootText = "Topic", mindStarters = Object.freeze(["Idea 1", "Idea 2", "Idea 3"]), mindMaxStarters = 20, mindMaxText = 500, mindMaxCoord = 1e9;
interface Rect { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }
/** Native `MindBox`: a node as the layout sees it (its parent's index; left of the root, read on the root's children). */
export interface MindBox { readonly id: NodeId; readonly rect: Rect; readonly parent?: number; readonly left: boolean }
const finite = (r: Rect) => [r.x0, r.y0, r.x1, r.y1].every(Number.isFinite);
const cmpId = (a: NodeId, b: NodeId) => { const x = BigInt(a), y = BigInt(b); return x < y ? -1 : x > y ? 1 : 0; };

/** Native `mind_layout`: where every node but the root goes (its top-left on the page). */
export function mindLayout(nodes: readonly MindBox[]): [NodeId, { x: number; y: number }][] {
  const n = nodes.length, root = nodes[0];
  if (!root || root.parent !== undefined || n > mindMaxNodes || !nodes.every(b => finite(b.rect))) return [];
  const left = Array(n).fill(false), depth = Array(n).fill(0), valid = Array(n).fill(false);
  valid[0] = true;
  const kids: [number[], number[]][] = Array.from({ length: n }, () => [[], []]);
  for (let i = 1; i < n; i++) {
    const p = nodes[i].parent;
    if (p === undefined || p >= i || !valid[p]) continue;
    const d = depth[p] + 1;
    if (d > mindMaxDepth) continue;
    const side = p === 0 ? nodes[i].left : left[p];
    valid[i] = true; left[i] = side; depth[i] = d;
    kids[p][side ? 1 : 0].push(i);
  }
  const mid = (i: number) => (nodes[i].rect.y0 + nodes[i].rect.y1) / 2;
  for (const k of kids) for (const list of k) list.sort((a, b) => mid(a) - mid(b) || cmpId(nodes[a].id, nodes[b].id));
  const height = (i: number) => nodes[i].rect.y1 - nodes[i].rect.y0, width = (i: number) => nodes[i].rect.x1 - nodes[i].rect.x0;
  const span = Array(n).fill(0);
  const stack = (list: readonly number[]) => list.reduce((t, c) => t + span[c], 0) + mindGapY * Math.max(list.length - 1, 0);
  for (let i = n - 1; i >= 1; i--) span[i] = Math.max(height(i), stack(kids[i][left[i] ? 1 : 0]));
  const column = Array(n).fill(0), centre = Array(n).fill(0), ok = Array(n).fill(false), out: [NodeId, { x: number; y: number }][] = [];
  centre[0] = (root.rect.y0 + root.rect.y1) / 2; ok[0] = true;
  for (let i = 0; i < n; i++) {
    if (!ok[i]) continue;
    for (const side of [false, true]) {
      const list = kids[i][side ? 1 : 0];
      if (!list.length) continue;
      const x = i === 0 ? (side ? root.rect.x0 - mindGapX : root.rect.x1 + mindGapX) : column[i];
      const widest = list.reduce((m, c) => Math.max(m, width(c)), 0);
      let top = centre[i] - stack(list) / 2;
      for (const c of list) {
        const s = span[c], m = top + s / 2, at = { x: side ? x - width(c) : x, y: m - height(c) / 2 };
        top += s + mindGapY;
        if (!Number.isFinite(at.x) || !Number.isFinite(at.y) || !Number.isFinite(m)) continue;
        centre[c] = m; column[c] = side ? x - widest - mindGapX : x + widest + mindGapX; ok[c] = true;
        out.push([nodes[c].id, at]);
      }
    }
  }
  return out;
}

type Layer = DocumentNode & { board?: BoardItem; x: number; y: number; transform?: Affine };
interface Branch { readonly line: NodeId; readonly parent: NodeId; readonly child: NodeId; readonly left: boolean }
const box = (doc: Document, id: NodeId): Rect | undefined => { const b = boundsOf(doc, [id]); return b && { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height }; };
/** Native `branches`: the branches joining two different layers of their own page, by id. */
export function branchesOf(doc: Document): Branch[] {
  const out: Branch[] = [];
  for (const n of Object.values(doc.nodes) as Layer[]) {
    const b = n.board;
    if (b?.type !== "connector" || !b.branch || !("node" in b.from) || !("node" in b.to)) continue;
    const a = b.from.node, c = b.to.node, page = pageForNode(doc, n.id);
    if (a === c || !doc.nodes[a] || !doc.nodes[c] || pageForNode(doc, a) !== page || pageForNode(doc, c) !== page) continue;
    out.push({ line: n.id, parent: a, child: c, left: b.from.side === "left" });
  }
  return out.sort((x, y) => cmpId(x.line, y.line));
}
/** Native `arriving`: the branch arriving at `node` (the lowest connector id). */
export const arriving = (bs: readonly Branch[], node: NodeId) => bs.find(b => b.child === node);
/** Native `map_children`: a node's children on one side, by their middles then id. */
export function mapChildren(doc: Document, bs: readonly Branch[], node: NodeId, left: boolean): NodeId[] {
  return bs.filter(b => b.parent === node && b.left === left && arriving(bs, b.child)?.line === b.line)
    .flatMap(b => { const r = box(doc, b.child); return r ? [[(r.y0 + r.y1) / 2, b.child] as const] : []; })
    .sort((a, b) => a[0] - b[0] || cmpId(a[1], b[1])).map(p => p[1]);
}
/** Native `map_side`: whether `node` is on the left of its map. */
export function mapSide(bs: readonly Branch[], node: NodeId): boolean {
  let at = node, left = false;
  for (let i = 0; i < mindMaxDepth; i++) { const b = arriving(bs, at); if (!b) break; at = b.parent; left = b.left; }
  return left;
}
/** Move layer `id` by `d` on the page (native `shift`). */
function shift(draft: HierarchyDraft, id: NodeId, d: { x: number; y: number }) {
  const doc = draft.document, n = doc.nodes[id] as Layer;
  const parent = n.parent != null && doc.nodes[n.parent]?.kind !== "page" ? worldTransform(doc, n.parent) : [1, 0, 0, 1, 0, 0] as Affine;
  const local = transformPoint(multiply(inverse(parent), multiply([1, 0, 0, 1, d.x, d.y], parent)), { x: n.x, y: n.y });
  if (Number.isFinite(local.x) && Number.isFinite(local.y)) draft.set({ ...n, x: local.x, y: local.y } as DocumentNode);
}

/** Native `settle_mind_maps`: branches that no longer join two layers of their page go, and the maps an edit touched are laid out again
 * from their first nodes (a map in place is not written to). */
export function settleMindMaps(doc: Document, before: Document): Document {
  if (doc.kind !== "board" || doc.nodes === before.nodes) return doc;
  if (!Object.values(doc.nodes).some(n => { const b = (n as Layer).board; return b?.type === "connector" && b.branch; })) return doc;
  const touched = new Set<NodeId>();
  for (const id of Object.keys(doc.nodes)) if (doc.nodes[id] !== before.nodes[id]) touched.add(id);
  for (const id of Object.keys(before.nodes)) if (!doc.nodes[id]) touched.add(id);
  if (!touched.size) return doc;
  const draft = new HierarchyDraft(doc);
  // Native `prune_branches`.
  const stirred = new Set<NodeId>();
  const endsOf = (c: Connector) => [c.from, c.to].flatMap((e: End) => "node" in e ? [e.node] : []);
  for (const id of touched) { const b = (before.nodes[id] as Layer | undefined)?.board; if (b?.type === "connector" && b.branch) endsOf(b).forEach(e => stirred.add(e)); }
  for (const n of Object.values(doc.nodes) as Layer[]) {
    const b = n.board;
    if (b?.type !== "connector" || !b.branch) continue;
    const page = pageForNode(doc, n.id), joins = (e: End) => "node" in e && !!doc.nodes[e.node] && page !== undefined && pageForNode(doc, e.node) === page;
    if (!(joins(b.from) && joins(b.to) && endsOf(b)[0] !== endsOf(b)[1])) { endsOf(b).forEach(e => stirred.add(e)); draft.remove(n.id); }
  }
  const now = draft.document, bs = branchesOf(now);
  if (!bs.length) return draft.finish();
  const hit = (id: NodeId) => touched.has(id) || ancestors(now, id).some(a => touched.has(a));
  const arrived = new Set<NodeId>(), kids = new Map<NodeId, Branch[]>();
  for (const b of bs) if (!arrived.has(b.child)) { arrived.add(b.child); kids.set(b.parent, [...(kids.get(b.parent) ?? []), b]); }
  const roots = [...kids.keys()].filter(p => !arrived.has(p)).sort(cmpId);
  for (const root of roots) {
    const first = box(draft.document, root);
    if (!first) continue;
    const boxes: MindBox[] = [{ id: root, rect: first, left: false }], lines: NodeId[] = [], seen = new Set([root]), depths = [0];
    let tooBig = false;
    for (let at = 0; at < boxes.length && !tooBig; at++) {
      if (depths[at] >= mindMaxDepth) continue;
      for (const k of kids.get(boxes[at].id) ?? []) {
        if (seen.has(k.child)) continue;
        seen.add(k.child);
        if (boxes.length >= mindMaxNodes) { tooBig = true; break; }
        const r = box(draft.document, k.child);
        if (!r) { tooBig = true; break; }
        boxes.push({ id: k.child, rect: r, parent: at, left: k.left }); depths.push(depths[at] + 1); lines.push(k.line);
      }
    }
    if (tooBig || boxes.some(b => !finite(b.rect))) continue;
    const ids = new Set(boxes.map(b => b.id));
    if (boxes.some(b => ancestors(draft.document, b.id).some(a => ids.has(a)))) continue;
    const stale = boxes.some(b => stirred.has(b.id) || hit(b.id)) || lines.some(hit);
    if (!stale) continue;
    const rects = new Map(boxes.map(b => [b.id, b.rect]));
    for (const [id, to] of mindLayout(boxes)) {
      const was = rects.get(id)!, d = { x: to.x - was.x0, y: to.y - was.y0 };
      if (Number.isFinite(d.x) && Number.isFinite(d.y) && Math.hypot(d.x, d.y) > 1e-6) shift(draft, id, d);
    }
  }
  return draft.finish();
}
