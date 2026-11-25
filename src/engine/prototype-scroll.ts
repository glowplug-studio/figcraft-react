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

/** Native scroll.rs constants: how quickly a fling after a drag slows down (1/s; it travels its speed / decay). */
export const decayDrag = 2.5;
/** How quickly the wheel's coast slows down (1/s). */
export const decayWheel = 8;
/** Stiffness of the spring that pulls an overscroll back (1/s, critically damped). */
const spring = 16;
/** A fling inside its range stops below this speed (units/s). */
const flingStop = 6;
/** The wheel coasts on when it was faster than this as it stopped (screen points/s). */
export const coastMin = 40;
/** How far a drag past the end can stretch the content at most (screen points). */
export const rubberPoints = 240;

/** Native `fling_axis`: one axis of a fling after `dt` seconds from offset `x` at speed `v` in a range `0..r`. Inside the range it slows
 * down exponentially; past an end it stops there or, with `bounce`, a critically damped spring pulls it back. Solved exactly over short
 * sub-steps, so the motion does not depend on the frame rate. The new offset and speed, and whether it has come to rest. */
export function flingAxis(x: number, v: number, r: number, dt: number, decay: number, bounce: boolean): [number, number, boolean] {
  if (!(Number.isFinite(x) && Number.isFinite(v) && Number.isFinite(r) && Number.isFinite(dt) && decay > 0) || r <= 0)
    return [Number.isFinite(r) && Number.isFinite(x) ? Math.min(Math.max(x, 0), Math.max(r, 0)) : 0, 0, true];
  const step = Math.min(Math.max(dt, 0), 1);
  const steps = Math.min(Math.max(Math.ceil(step * 240), 1), 64), h = step / steps;
  v = Math.min(Math.max(v, -1e6), 1e6);
  const inside = (p: number) => p >= 0 && p <= r;
  for (let i = 0; i < steps; i++) {
    if (inside(x)) {
      const e = Math.exp(-decay * h);
      x += v * (1 - e) / decay;
      v *= e;
      if (!bounce && !inside(x)) { x = Math.min(Math.max(x, 0), r); v = 0; }
    } else {
      const end = Math.min(Math.max(x, 0), r), d = x - end, e = Math.exp(-spring * h), c = v + spring * d;
      x = end + (d + c * h) * e;
      v = (v - spring * c * h) * e;
    }
  }
  if (!Number.isFinite(x) || !Number.isFinite(v)) return [0, 0, true];
  const end = Math.min(Math.max(x, 0), r);
  if (x === end && Math.abs(v) < flingStop) return [x, 0, true];
  if (x !== end && Math.abs(x - end) < 0.5 && Math.abs(v) < flingStop * 4) return [end, 0, true];
  return [x, v, false];
}

/** Native `rubber_band`: where a drag to offset `x` shows in a range `0..r`: past an end it stretches less the further it goes, never
 * more than `limit` past. */
export function rubberBand(x: number, r: number, limit: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(r) || r <= 0 || !Number.isFinite(limit) || limit <= 0)
    return Number.isFinite(x) && Number.isFinite(r) ? Math.min(Math.max(x, 0), Math.max(r, 0)) : 0;
  const band = (over: number) => limit * (1 - 1 / (over * 0.55 / limit + 1));
  return x < 0 ? -band(-x) : x > r ? r + band(x - r) : x;
}

/** What scrolls: a frame by its id, or the whole view panning (native `Scroller::View`). */
export type Scroller = NodeId | "view";
/** Native `units_per_point`: screen points to the scroller's units (page units for frames, points for the view). */
export const unitsPerPoint = (t: Scroller, scale: number) => t === "view" ? 1 : 1 / Math.max(scale, 1e-6);
