import { inverse, multiply, type Affine } from "./affine";
import { colour, type Colour } from "./colour";
import { layerTransform, rectanglePaints, withLayerTransform, withRectanglePaints, type Document, type DocumentNode, type NodeId } from "./document";
import { subtreeIds, worldTransform } from "./hierarchy";
import type { PrototypeTransition } from "./prototype-data";
import type { Paint } from "./solid-paint";

/** Source: upstream ui-egui/src/present/transition.rs: smart-animate matching and tweening, and where frames are drawn during a transition. */
const f32 = Math.fround;
type Layer = DocumentNode & { width: number; height: number; opacity?: number; corners?: { radii: readonly number[]; smoothing: number }; strokes?: readonly Paint[] };

/** Native `name_path`: layer names from below `root` down to `id`, joined (the smart-animate matching key). */
export function namePath(doc: Document, root: NodeId, id: NodeId): string | undefined {
  const parts: string[] = [];
  let cur: NodeId | null | undefined = id;
  for (let i = 0; i < 1024 && cur != null; i++) {
    if (cur === root) return parts.reverse().join("\u001f");
    const n: DocumentNode | undefined = doc.nodes[cur];
    if (!n) return undefined;
    parts.push(n.name);
    cur = n.parent;
  }
  return undefined;
}
/** Native `match_layers`: pairs with the same name path below the two roots; repeated paths pair up in layer order. */
export function matchLayers(from: Document, fromRoot: NodeId, to: Document, toRoot: NodeId): [NodeId, NodeId][] {
  const pool = new Map<string, NodeId[]>();
  for (const id of subtreeIds(from, fromRoot).slice(1)) { const p = namePath(from, fromRoot, id); if (p !== undefined) pool.set(p, [...(pool.get(p) ?? []), id]); }
  const out: [NodeId, NodeId][] = [];
  for (const id of subtreeIds(to, toRoot).slice(1)) {
    const p = namePath(to, toRoot, id), q = p !== undefined ? pool.get(p) : undefined;
    if (q?.length) out.push([q.shift()!, id]);
  }
  return out;
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Native `decompose`: centre, rotation and scale of a box `(w, h)` placed by `m`. */
function decompose(m: Affine, [w, h]: readonly [number, number]): [number, number, number, number, number] | undefined {
  const [a, b, c, d, e, f] = m, sx = Math.hypot(a, b);
  if (!Number.isFinite(sx) || sx < 1e-9) return undefined;
  const sy = (a * d - b * c) / sx;
  return [a * w / 2 + c * h / 2 + e, b * w / 2 + d * h / 2 + f, Math.atan2(b, a), sx, sy];
}
/** Native `lerp_transform`: two placements of a box interpolated by centre, rotation (the shortest way round) and scale. */
export function lerpTransform(a: Affine, sa: readonly [number, number], b: Affine, sb: readonly [number, number], size: readonly [number, number], t: number): Affine {
  const x = decompose(a, sa), y = decompose(b, sb);
  if (!x || !y || (x[4] < 0) !== (y[4] < 0)) return t < 0.5 ? a : b;
  let da = y[2] - x[2];
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  const cx = lerp(x[0], y[0], t), cy = lerp(x[1], y[1], t), ang = x[2] + da * t, sx = lerp(x[3], y[3], t), sy = lerp(x[4], y[4], t);
  const cos = Math.cos(ang), sin = Math.sin(ang);
  const r: Affine = [cos * sx, sin * sx, -sin * sy, cos * sy, 0, 0];
  return multiply(multiply([1, 0, 0, 1, cx, cy], r), [1, 0, 0, 1, -size[0] / 2, -size[1] / 2]);
}
/** Native `Color::lerp`. */
function lerpColour(a: Colour, b: Colour, raw: number): Colour {
  const t = Math.min(Math.max(raw, 0), 1);
  return colour(f32(a.r + (b.r - a.r) * t), f32(a.g + (b.g - a.g) * t), f32(a.b + (b.b - a.b) * t), f32(a.a + (b.a - a.a) * t));
}
/** Native `lerp_paints`: solid paints tween their colour and opacity, pair by pair. */
function lerpPaints(from: readonly Paint[], to: readonly Paint[], t: number): Paint[] {
  return to.map((p, i) => {
    const f = from[i];
    if (!f || f.type !== "solid" || p.type !== "solid") return p;
    const k = Math.min(Math.max(t, 0), 1);
    return { ...p, color: lerpColour(f.color, p.color, t), opacity: f32(lerp(f.opacity, p.opacity, k)) };
  });
}
const paintsOf = (n: DocumentNode) => n.kind === "page" ? [] : rectanglePaints(n as never);
const withPaints = (n: DocumentNode, paints: readonly Paint[]) => n.kind === "page" ? n : withRectanglePaints(n as never, paints) as DocumentNode;

/** Native `smart_interpolate`: the destination as it looks at eased progress `t`: matched layers tween place, size, rotation, opacity,
 * corner radii and solid colours; layers only in the destination fade in; layers only in the source are copied in and fade out. */
export function smartInterpolate(from: Document, fromRoot: NodeId, to: Document, toRoot: NodeId, raw: number): Document {
  if (!Number.isFinite(raw) || raw === 1) return to;
  const t = Math.max(raw, -1), fade = Math.min(Math.max(t, 0), 1);
  const pairs = matchLayers(from, fromRoot, to, toRoot);
  const srcOf = new Map(pairs.map(([f, d]) => [d, f])), dstOf = new Map(pairs);
  const fwInv = inverse(worldTransform(from, fromRoot)), twInv = inverse(worldTransform(to, toRoot));
  const nodes: Record<NodeId, DocumentNode> = { ...to.nodes };
  if (from.nodes[fromRoot] && nodes[toRoot]) nodes[toRoot] = withPaints(nodes[toRoot], lerpPaints(paintsOf(from.nodes[fromRoot]), paintsOf(nodes[toRoot]), t));
  const interp = new Map<NodeId, Affine>([[toRoot, [1, 0, 0, 1, 0, 0]]]);
  const faded = new Set<NodeId>();
  for (const id of subtreeIds(to, toRoot).slice(1)) {
    const n = to.nodes[id] as Layer, parent = n.parent ?? toRoot, pInterp = interp.get(parent) ?? [1, 0, 0, 1, 0, 0];
    const s = srcOf.get(id), sn = s !== undefined ? from.nodes[s] as Layer | undefined : undefined;
    if (s !== undefined && sn) {
      const relS = multiply(fwInv, worldTransform(from, s)), relD = multiply(twInv, worldTransform(to, id));
      const w = Math.max(lerp(sn.width, n.width, t), 0), h = Math.max(lerp(sn.height, n.height, t), 0);
      const xf = lerpTransform(relS, [sn.width, sn.height], relD, [n.width, n.height], [w, h], t);
      interp.set(id, xf);
      let m = withLayerTransform({ ...n, width: w, height: h } as never, multiply(inverse(pInterp), xf)) as Layer;
      m = { ...m, opacity: f32(lerp(sn.opacity ?? 1, n.opacity ?? 1, fade)) };
      if (n.corners || sn.corners) {
        const a = sn.corners?.radii ?? [0, 0, 0, 0], b = n.corners?.radii ?? [0, 0, 0, 0];
        m = { ...m, corners: { radii: b.map((r, i) => Math.max(lerp(a[i], r, t), 0)), smoothing: n.corners?.smoothing ?? 0 } } as Layer;
      }
      m = withPaints(m, lerpPaints(paintsOf(sn), paintsOf(m), t)) as Layer;
      if (n.strokes) m = { ...m, strokes: lerpPaints(sn.strokes ?? [], n.strokes, t) } as Layer;
      nodes[id] = Object.freeze(m);
    } else {
      interp.set(id, multiply(pInterp, layerTransform(n as never)));
      if (!faded.has(parent)) nodes[id] = Object.freeze({ ...n, opacity: f32((n.opacity ?? 1) * fade) });
      faded.add(id);
    }
  }
  // Layers only in the source: the top-most ones copied in, fading out.
  let spare = [...Object.keys(to.nodes), ...Object.keys(from.nodes)].reduce((m, k) => { try { const v = BigInt(k); return v > m ? v : m; } catch { return m; } }, 0n) + 1n;
  const tops = subtreeIds(from, fromRoot).slice(1).filter(id => !dstOf.has(id) && (from.nodes[id].parent === fromRoot || dstOf.has(from.nodes[id].parent!)));
  for (const id of tops) {
    const n = from.nodes[id] as Layer, pf = n.parent ?? fromRoot;
    const matched = dstOf.get(pf), matchedNode = matched !== undefined ? nodes[matched] : undefined;
    const container = !!matchedNode && "children" in matchedNode;
    const [parent, local] = container && pf !== fromRoot ? [matched!, layerTransform(n as never)] : [toRoot, multiply(fwInv, worldTransform(from, id))];
    const ids = new Map<NodeId, NodeId>();
    for (const c of subtreeIds(from, id)) ids.set(c, String(spare++));
    for (const c of subtreeIds(from, id)) {
      const cn = from.nodes[c];
      const copy = { ...cn, id: ids.get(c)!, parent: c === id ? parent : ids.get(cn.parent!)!, ...("children" in cn ? { children: Object.freeze((cn.children as readonly NodeId[]).map(k => ids.get(k)!)) } : {}) } as DocumentNode;
      nodes[ids.get(c)!] = Object.freeze(c === id ? { ...(withLayerTransform(copy as never, local) as DocumentNode), opacity: f32(((cn as Layer).opacity ?? 1) * (1 - fade)) } as DocumentNode : copy);
    }
    // Inserted at the source layer's place in its parent's list.
    const p = nodes[parent] as DocumentNode & { children: readonly NodeId[] };
    const index = Math.min((from.nodes[pf] as { children: readonly NodeId[] }).children.indexOf(id), p.children.length);
    const kids = [...p.children]; kids.splice(index < 0 ? kids.length : index, 0, ids.get(id)!);
    nodes[parent] = Object.freeze({ ...p, children: Object.freeze(kids) });
  }
  return Object.freeze({ ...to, nodes: Object.freeze(nodes) });
}

/** Native `FramePlacement`: where the outgoing and incoming frames are drawn, offsets as fractions of their size. */
export interface FramePlacement { readonly fromOff: readonly [number, number]; readonly fromAlpha: number; readonly toOff: readonly [number, number]; readonly toAlpha: number; readonly fromOnTop: boolean }
const directions = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] } as const;
/** Native `transition_frames`: "Move in, left" brings the new frame in from the right edge, moving left. */
export function transitionFrames(tr: PrototypeTransition, t: number): FramePlacement {
  const base = { fromOff: [0, 0] as const, fromAlpha: 1, toOff: [0, 0] as const, toAlpha: 1, fromOnTop: false };
  const mul = (d: readonly [number, number], k: number) => [d[0] * k, d[1] * k] as const;
  switch (tr.type) {
    case "instant": return { ...base, fromAlpha: 0 };
    case "dissolve": case "smartAnimate": return { ...base, toAlpha: Math.min(Math.max(t, 0), 1) };
    case "moveIn": return { ...base, toOff: mul(directions[tr.direction], -(1 - t)) };
    case "moveOut": return { ...base, fromOff: mul(directions[tr.direction], t), fromOnTop: true };
    case "push": return { ...base, fromOff: mul(directions[tr.direction], t), toOff: mul(directions[tr.direction], -(1 - t)) };
    case "slideIn": return { ...base, fromOff: mul(directions[tr.direction], 0.3 * t), toOff: mul(directions[tr.direction], -(1 - t)) };
    case "slideOut": return { ...base, fromOff: mul(directions[tr.direction], t), toOff: mul(directions[tr.direction], -0.3 * (1 - t)), fromOnTop: true };
  }
}
