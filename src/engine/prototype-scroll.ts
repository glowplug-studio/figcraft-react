import { inverse, multiply, transformBounds, type Affine } from "./affine";
import { layerTransform, withLayerTransform, type Document, type DocumentNode, type NodeId, type PageNode } from "./document";
import { ancestors, pageForNode, worldTransform } from "./hierarchy";
import { defaultPrototypeDevice, presentedDevice, type PrototypeDevice } from "./prototype-settings";

/** Source: upstream ui-egui/src/present/scroll.rs: what scrolls in a presented prototype and how far. */
export type ScrollOffsets = ReadonlyMap<NodeId, readonly [number, number]>;
type Children = { readonly children?: readonly NodeId[] };
const childrenOf = (n: DocumentNode | undefined): readonly NodeId[] => (n as Children | undefined)?.children ?? [];
const position = (n: DocumentNode | undefined) => (n as { scrollPosition?: string } | undefined)?.scrollPosition;
const translate = (dx: number, dy: number): Affine => [1, 0, 0, 1, dx, dy];
function localBox(n: DocumentNode) {
  const b = transformBounds(layerTransform(n as never), (n as { width: number }).width, (n as { height: number }).height);
  return { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height };
}

/** Native `page_settings`: the device settings of the page `id` is on. */
export function pageDevice(doc: Document, id: NodeId): PrototypeDevice {
  const page = doc.nodes[id] ? pageForNode(doc, id) : undefined;
  return (page !== undefined ? (doc.nodes[page] as PageNode).prototypeDevice : undefined) ?? defaultPrototypeDevice;
}
/** Native `viewport`: the part of top-level `frame` its page's device shows (none without a device). */
export function viewport(doc: Document, frame: NodeId): readonly [number, number] | undefined {
  const d = presentedDevice(pageDevice(doc, frame)), n = doc.nodes[frame] as { width?: number; height?: number } | undefined;
  return d && n?.width !== undefined && n.height !== undefined ? [Math.min(n.width, d.width), Math.min(n.height, d.height)] : undefined;
}
/** Native `scroll_range_in`: how far `frame`'s content scrolls when `view` of it shows (a device's screen), else at its own size. */
export function scrollRangeIn(doc: Document, frame: NodeId, view?: readonly [number, number]): readonly [number, number] {
  const n = doc.nodes[frame] as (DocumentNode & { width: number; height: number; layout?: { padding: readonly number[] } }) | undefined;
  if (!n || n.kind === "page") return [0, 0];
  const overflow = n.overflow ?? "none";
  if (overflow === "none" && !view) return [0, 0];
  let x1 = 0, y1 = 0;
  for (const c of childrenOf(n)) {
    const cn = doc.nodes[c];
    if (!cn || cn.kind === "page" || (cn as { visible?: boolean }).visible === false || position(cn) === "fixed") continue;
    const b = localBox(cn);
    x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
  }
  if (n.layout) { x1 += n.layout.padding[1]; y1 += n.layout.padding[2]; }
  if (overflow !== "horizontal" && overflow !== "both") x1 = 0;
  if (overflow !== "vertical" && overflow !== "both") y1 = 0;
  let vw = n.width, vh = n.height;
  if (view) { x1 = Math.max(x1, n.width); y1 = Math.max(y1, n.height); [vw, vh] = view; }
  const rx = Math.max(x1 - vw, 0), ry = Math.max(y1 - vh, 0);
  return [Number.isFinite(rx) ? rx : 0, Number.isFinite(ry) ? ry : 0];
}
export const scrollRange = (doc: Document, frame: NodeId) => scrollRangeIn(doc, frame);
/** Native `clamp_scroll`: within 0..range on each axis, 0 for non-finite values. */
export function clampScroll([x, y]: readonly [number, number], [rx, ry]: readonly [number, number]): [number, number] {
  const c = (v: number, r: number) => Number.isFinite(v) && Number.isFinite(r) ? Math.min(Math.max(v, 0), Math.max(r, 0)) : 0;
  return [c(x, rx), c(y, ry)];
}
const setNode = (nodes: Record<NodeId, DocumentNode>, id: NodeId, f: (n: DocumentNode) => DocumentNode) => { nodes[id] = Object.freeze(f(nodes[id])); };
const moved = (n: DocumentNode, dx: number, dy: number) => withLayerTransform(n as never, multiply(translate(dx, dy), layerTransform(n as never))) as DocumentNode;
/** Native `fit_viewport`: `frame` sized to the part a screen shows; fixed layers follow their constraints to the screen's edges. */
export function fitViewport(doc: Document, frame: NodeId, [w, h]: readonly [number, number]): Document {
  const n = doc.nodes[frame] as (DocumentNode & { width: number; height: number }) | undefined;
  if (!n) return doc;
  const dw = w - n.width, dh = h - n.height;
  if (!Number.isFinite(dw) || !Number.isFinite(dh) || dw === 0 && dh === 0) return doc;
  const nodes = { ...doc.nodes };
  for (const c of childrenOf(n)) {
    const cn = nodes[c];
    if (!cn || position(cn) !== "fixed") continue;
    const k = (cn as { constraints?: { horizontal: string; vertical: string } }).constraints ?? { horizontal: "left", vertical: "top" };
    const dx = k.horizontal === "right" ? dw : k.horizontal === "center" ? dw / 2 : 0;
    const dy = k.vertical === "bottom" ? dh : k.vertical === "center" ? dh / 2 : 0;
    setNode(nodes, c, x => moved(x, dx, dy));
  }
  setNode(nodes, frame, x => ({ ...x, width: w, height: h }) as DocumentNode);
  return Object.freeze({ ...doc, nodes: Object.freeze(nodes) });
}
/** Native `apply_scroll`: scrolling frames' children shifted by the offsets; fixed ones stay; sticky ones stop at the top or left edge. */
export function applyScroll(doc: Document, scroll: ScrollOffsets): Document {
  const sticky = (pos: number, s: number) => pos >= 0 && pos - s < 0 ? -pos : -s;
  let nodes: Record<NodeId, DocumentNode> | undefined;
  for (const [frame, [sx, sy]] of scroll) {
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx === 0 && sy === 0) continue;
    const n = doc.nodes[frame];
    if (!n) continue;
    for (const c of childrenOf(n)) {
      const cn = doc.nodes[c];
      if (!cn || position(cn) === "fixed") continue;
      let dx = -sx, dy = -sy;
      if (position(cn) === "sticky") { const b = localBox(cn); dx = sticky(b.x0, sx); dy = sticky(b.y0, sy); }
      nodes ??= { ...doc.nodes };
      setNode(nodes, c, x => moved(x, dx, dy));
    }
  }
  return nodes ? Object.freeze({ ...doc, nodes: Object.freeze(nodes) }) : doc;
}
/** Native `raise_fixed`: each frame's fixed children move above the rest, keeping their order. */
export function raiseFixed(doc: Document): Document {
  let nodes: Record<NodeId, DocumentNode> | undefined;
  for (const n of Object.values(doc.nodes)) {
    if (n.kind === "page") continue;
    const kids = childrenOf(n);
    const fixed = kids.filter(c => position(doc.nodes[c]) === "fixed");
    if (!fixed.length) continue;
    const order = [...kids.filter(c => position(doc.nodes[c]) !== "fixed"), ...fixed];
    if (order.every((c, i) => c === kids[i])) continue;
    nodes ??= { ...doc.nodes };
    setNode(nodes, n.id, x => ({ ...x, children: Object.freeze(order) }) as DocumentNode);
  }
  return nodes ? Object.freeze({ ...doc, nodes: Object.freeze(nodes) }) : doc;
}
/** Native `scroll_to_layer`: every scrolling frame around `dest`, innermost first, brings it (then itself) to its top-left. */
export function scrollToLayer(doc: Document, dest: NodeId, offset: readonly [number, number], range: (frame: NodeId) => readonly [number, number],
  scroll: ScrollOffsets): [NodeId, readonly [number, number], readonly [number, number]][] {
  const out: [NodeId, readonly [number, number], readonly [number, number]][] = [];
  let target = dest, off: [number, number] = [Number.isFinite(offset[0]) ? offset[0] : 0, Number.isFinite(offset[1]) ? offset[1] : 0];
  for (const f of doc.nodes[dest] ? ancestors(doc, dest) : []) {
    if (doc.nodes[f]?.kind === "page") break;
    const [rx, ry] = range(f), tn = doc.nodes[target];
    if (!tn) break;
    if (rx <= 0 && ry <= 0) continue;
    const rel = multiply(inverse(worldTransform(doc, f)), worldTransform(doc, target));
    const b = transformBounds(rel, (tn as { width: number }).width, (tn as { height: number }).height);
    const from = scroll.get(f) ?? [0, 0];
    out.push([f, from, clampScroll([rx > 0 ? b.x - off[0] : from[0], ry > 0 ? b.y - off[1] : from[1]], [rx, ry])]);
    target = f; off = [0, 0];
  }
  return out;
}
