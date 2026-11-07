import { inverse, transformPoint } from "./affine";
import { cubicPoint } from "./cubic";
import type { Document, NodeId } from "./document";
import type { EditorEngine } from "./editor";
import type { Point, Rectangle } from "./geometry";
import { HierarchyDraft, worldTransform } from "./hierarchy";
import type { MoveModifiers } from "./move-interaction";
import { validateChangedGeometry } from "./rotation";
import { hitRectangle } from "./selection";
import { strokeBounds } from "./stroke-renderer";
import { activateVector, clearVectorSelection, refitVector, selectedVectorPoints, vectorNetwork, vectorParts, type VectorEditPart, type VectorEditState } from "./vector-edit";
import { vectorLocalOffset } from "./vector-edit-commands";
import { hitEditedVectors, type VectorHit } from "./vector-edit-hit";
import { bendSegment, makeSmooth, mergeVertices, moveVertices, setHandle, smoothVertices, splitSegment, type VectorHandle } from "./vector-edit-ops";
import { networkCubic, networkIncident, type VectorNetwork } from "./vector-network";

type Gesture = { kind: "points"; start: Point; parts: readonly VectorEditPart[]; split?: readonly [number, number]; moved: boolean }
  | { kind: "handle"; seg: number; start: boolean; independent: boolean; group: readonly VectorHandle[] }
  | { kind: "bendSegment"; seg: number; t: number }
  | { kind: "bendVertex"; vertex: number; origin: Point; smooth: boolean; moved: boolean }
  | { kind: "marquee"; start: Point; base: readonly VectorEditPart[]; leave: boolean };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const toggle = (indices: readonly number[], index: number) => indices.includes(index) ? indices.filter(i => i !== index) : [...indices, index];
function editNetworks(document: Document, edits: readonly { id: NodeId; update: (net: VectorNetwork) => VectorNetwork }[]): Document {
  const draft = new HierarchyDraft(document);
  for (const { id, update } of edits) {
    const node = draft.nodes[id]; if (node?.kind !== "vector") throw new Error("Not a vector");
    const network = update(node.network); draft.set(refitVector(network === node.network ? node : { ...node, network }));
  }
  draft.normaliseGroups(); return validateChangedGeometry(draft);
}
function segmentPoint(document: Document, id: NodeId, seg: number, t: number): Point | undefined {
  const net = vectorNetwork(document, id), c = net && networkCubic(net, seg);
  return c && transformPoint(worldTransform(document, id), cubicPoint(c, t));
}

/** Point editing gestures own transient geometry outside React and commit a single history item. */
export class VectorInteraction {
  #gesture?: Gesture;
  #pressed = false;
  #hover?: { id: NodeId; hit: VectorHit };
  #add?: { point: Point; on: boolean };
  #marquee?: Rectangle;
  constructor(private engine: EditorEngine, private onError: (message: string) => void) {}
  get active(): boolean { return this.#pressed; }
  get overlay() { return { hover: this.#hover, add: this.#add, marquee: this.#marquee }; }
  #fail(error: unknown): void { this.cancel(); this.onError(error instanceof Error ? error.message : "Could not edit vector"); }
  hover(point?: Point, modifiers?: MoveModifiers): string | undefined {
    this.#hover = undefined; this.#add = undefined;
    const state = this.engine.getRenderVectorEdit(); if (!state || !point) return undefined;
    const document = this.engine.getRenderDocument(), zoom = this.engine.getView().zoom;
    this.#hover = hitEditedVectors(document, state, point, 6 / zoom);
    const found = this.#hover;
    if (found?.hit.kind === "segment" && state.tool === "move" && !(modifiers?.ctrlKey || modifiers?.metaKey || modifiers?.shiftKey || modifiers?.altKey)) {
      const at = segmentPoint(document, found.id, found.hit.seg, .5); if (at) this.#add = { point: at, on: distance(at, point) * zoom <= 6 };
    }
    return found ? "default" : "crosshair";
  }
  down(point: Point, modifiers: MoveModifiers): boolean {
    let state = this.engine.getVectorEdit(); if (!state || !this.engine.getSnapshot().editable) return false;
    this.#pressed = true; this.#hover = undefined; this.#add = undefined;
    try {
      const document = this.engine.getSnapshot().document, zoom = this.engine.getView().zoom;
      const found = hitEditedVectors(document, state, point, 6 / zoom);
      if (found && found.id !== state.id) { this.engine.updateVectorSelection(s => activateVector(s, found.id)!); state = this.engine.getVectorEdit()!; }
      if (!modifiers.shiftKey && state.regions.length) {
        this.engine.updateVectorSelection(s => ({ ...s, vertices: s.vertices.filter(v => !s.regionVertices.includes(v)), regions: [], regionVertices: [], regionTopology: undefined }));
        state = this.engine.getVectorEdit()!;
      }
      const hit = found?.hit, bend = state.tool === "bend" || modifiers.ctrlKey || modifiers.metaKey;
      if (hit?.kind === "handle") {
        let handles = state.handles;
        const has = handles.some(h => h[0] === hit.seg && h[1] === hit.start);
        if (!bend) {
          handles = modifiers.shiftKey ? has ? handles.filter(h => h[0] !== hit.seg || h[1] !== hit.start) : [...handles, [hit.seg, hit.start] as const] : has ? handles : [[hit.seg, hit.start]];
          this.engine.updateVectorSelection(s => ({ ...s, handles }));
          if (!handles.some(h => h[0] === hit.seg && h[1] === hit.start)) return true;
        }
        this.engine.beginInteraction(); this.#gesture = { kind: "handle", seg: hit.seg, start: hit.start, independent: bend || modifiers.altKey, group: bend ? [] : handles };
      } else if (bend && hit?.kind === "vertex") {
        const net = vectorNetwork(document, state.id)!, v = net.vertices[hit.index];
        const smooth = networkIncident(net, hit.index).some(([seg, start]) => { const h = start ? net.segments[seg].ta : net.segments[seg].tb; return h[0] !== 0 || h[1] !== 0; });
        this.engine.updateVectorSelection(s => ({ ...clearVectorSelection(s), vertices: [hit.index] }));
        this.engine.beginInteraction(); this.#gesture = { kind: "bendVertex", vertex: hit.index, origin: v, smooth, moved: false };
      } else if (bend && hit?.kind === "segment") {
        this.engine.beginInteraction(); this.#gesture = { kind: "bendSegment", seg: hit.seg, t: hit.t };
      } else if (hit?.kind === "vertex") {
        const keep = modifiers.shiftKey || state.vertices.includes(hit.index);
        const vertices = modifiers.shiftKey ? state.regionVertices.includes(hit.index) ? state.vertices : toggle(state.vertices, hit.index) : state.vertices.includes(hit.index) ? state.vertices : [hit.index];
        this.engine.updateVectorSelection(s => ({ ...(keep ? s : clearVectorSelection(s)), vertices, handles: [], segments: modifiers.shiftKey ? s.segments : [], regionVertices: s.regionVertices.filter(i => i !== hit.index) }));
        const current = this.engine.getVectorEdit()!;
        const parts = vectorParts(current).map(p => ({ ...p, vertices: selectedVectorPoints(vectorNetwork(document, p.id)!, p), segments: [] }));
        this.engine.beginInteraction(); this.#gesture = { kind: "points", start: point, parts, moved: false };
      } else if (hit?.kind === "segment") {
        const at = segmentPoint(document, state.id, hit.seg, .5), midpoint = !modifiers.altKey && !modifiers.shiftKey && at && distance(at, point) * zoom <= 6;
        if (midpoint || modifiers.altKey) {
          const t = midpoint ? .5 : hit.t, vertex = vectorNetwork(document, state.id)!.vertices.length;
          this.engine.beginInteraction();
          this.#gesture = { kind: "points", start: point, parts: [{ id: state.id, vertices: [vertex], segments: [] }], split: [hit.seg, t], moved: false };
          this.#previewPoints(this.#gesture, { x: 0, y: 0 });
        } else if (modifiers.shiftKey) this.engine.updateVectorSelection(s => ({ ...s, segments: toggle(s.segments, hit.seg) }));
        else {
          const segment = vectorNetwork(document, state.id)!.segments[hit.seg];
          this.engine.updateVectorSelection(s => ({ ...clearVectorSelection(s), segments: [hit.seg] })); this.engine.beginInteraction();
          this.#gesture = { kind: "points", start: point, parts: [{ id: state.id, vertices: [segment.a, segment.b], segments: [] }], moved: false };
        }
      } else {
        const inside = vectorParts(state).some(p => {
          const node = document.nodes[p.id]; if (node?.kind !== "vector") return false;
          const b = strokeBounds(node, worldTransform(document, p.id)), margin = 24 / zoom;
          return point.x >= b.x - margin && point.x < b.x + b.width + margin && point.y >= b.y - margin && point.y < b.y + b.height + margin;
        });
        const leave = !bend && !inside && !modifiers.shiftKey && Boolean(hitRectangle(document, point, true, [], 12 / zoom));
        const base = vectorParts(state).map(p => ({ ...p, vertices: modifiers.shiftKey ? p.vertices : [], segments: [] }));
        if (!bend && !modifiers.shiftKey) this.engine.updateVectorSelection(clearVectorSelection);
        this.engine.beginInteraction(); this.#gesture = { kind: "marquee", start: point, base, leave };
      }
      return true;
    } catch (error) { this.#fail(error); return true; }
  }
  #previewPoints(g: Extract<Gesture, { kind: "points" }>, delta: Point): void {
    this.engine.previewVectorEdit((document, state) => {
      const next = editNetworks(document, g.parts.map(p => ({ id: p.id, update: (net: VectorNetwork) => {
        if (p.id === state.id && g.split) net = splitSegment(net, g.split[0], g.split[1])!.network;
        return moveVertices(net, p.vertices, vectorLocalOffset(worldTransform(document, p.id), delta));
      } })));
      return { document: next, state: g.split ? { ...clearVectorSelection(state), vertices: g.parts[0].vertices } : state };
    });
  }
  move(point: Point, modifiers: MoveModifiers): void {
    const g = this.#gesture; if (!g) return;
    if (!this.engine.interacting) { this.#gesture = undefined; this.#pressed = false; return; }
    try {
      const zoom = this.engine.getView().zoom;
      if (g.kind === "points") {
        const delta = { x: point.x - g.start.x, y: point.y - g.start.y }; if (Math.hypot(delta.x, delta.y) * zoom < 1) return;
        if (modifiers.shiftKey) { if (Math.abs(delta.x) > Math.abs(delta.y)) delta.y = 0; else delta.x = 0; }
        this.#previewPoints(g, delta); g.moved = true; return;
      }
      this.engine.previewVectorEdit((document, state) => {
        if (g.kind === "marquee") {
          const r = { x: Math.min(point.x, g.start.x), y: Math.min(point.y, g.start.y), width: Math.abs(point.x - g.start.x), height: Math.abs(point.y - g.start.y) };
          this.#marquee = r;
          const parts = g.base.map(p => {
            const w = worldTransform(document, p.id), found = vectorNetwork(document, p.id)!.vertices.flatMap((v, i) => {
              const q = transformPoint(w, v); return q.x >= r.x && q.x < r.x + r.width && q.y >= r.y && q.y < r.y + r.height ? [i] : [];
            });
            const old = vectorParts(state).find(s => s.id === p.id)!;
            return { ...old, vertices: [...new Set([...p.vertices, ...found])] };
          });
          return { document, state: { ...state, vertices: parts[0].vertices, others: parts.slice(1) } };
        }
        const w = worldTransform(document, state.id), local = transformPoint(inverse(w), point);
        if (g.kind === "bendVertex" && !g.moved && distance(point, transformPoint(w, g.origin)) * zoom < 2) return { document, state };
        const next = editNetworks(document, [{ id: state.id, update: net => {
          if (g.kind === "bendSegment") return bendSegment(net, g.seg, g.t, local);
          if (g.kind === "bendVertex") { g.moved = true; return makeSmooth(net, g.vertex, { x: local.x - g.origin.x, y: local.y - g.origin.y }); }
          const seg = net.segments[g.seg], v = net.vertices[g.start ? seg.a : seg.b], from = g.start ? seg.ta : seg.tb;
          const rel = [local.x - v.x, local.y - v.y] as const, independent = g.independent || modifiers.altKey;
          let next = setHandle(net, g.seg, g.start, rel, independent);
          // Bend handles act alone; Move preserves the captured selected handle group.
          for (const [index, start] of g.group) {
            if (index === g.seg && start === g.start) continue;
            const s = net.segments[index], h = start ? s.ta : s.tb;
            next = setHandle(next, index, start, [h[0] + rel[0] - from[0], h[1] + rel[1] - from[1]], independent);
          }
          return next;
        } }]);
        return { document: next, state };
      });
    } catch (error) { this.#fail(error); }
  }
  /** A click outside the edited layers may be replayed by the normal move tool. */
  up(point: Point): Point | undefined {
    const g = this.#gesture; this.#gesture = undefined; this.#pressed = false; this.#marquee = undefined;
    if (!g || !this.engine.interacting) return;
    try {
      if (g.kind === "points" && !g.moved && !g.split) { this.engine.cancelInteraction(); return; }
      if (g.kind === "points" && !g.split && g.parts[0].vertices.length === 1 && g.parts.slice(1).every(p => !p.vertices.length)) this.#mergeDrop(g.parts[0].vertices[0]);
      if (g.kind === "bendVertex" && !g.moved) {
        const state = this.engine.getRenderVectorEdit()!, net = vectorNetwork(this.engine.getRenderDocument(), state.id)!;
        if (!g.smooth && networkIncident(net, g.vertex).length !== 2) { this.engine.cancelInteraction(); return; }
        this.engine.previewVectorEdit((document, state) => ({ document: editNetworks(document, [{ id: state.id, update: net => smoothVertices(net, [g.vertex], !g.smooth) }]), state }));
      }
      if (g.kind === "marquee") {
        if (g.leave && distance(point, g.start) * this.engine.getView().zoom < 3) { this.engine.cancelInteraction(); this.engine.execute("vector.edit.end"); return g.start; }
        const current = this.engine.getRenderVectorEdit()!, document = this.engine.getRenderDocument();
        const other = !current.vertices.length && current.others.find(p => p.vertices.length);
        if (other) this.engine.previewVectorEdit(() => ({ document, state: activateVector(current, other.id)! }));
      }
      this.engine.commitInteraction();
    } catch (error) { this.#fail(error); }
    return undefined;
  }
  #mergeDrop(vertex: number): void {
    const document = this.engine.getRenderDocument(), state = this.engine.getRenderVectorEdit()!, net = vectorNetwork(document, state.id)!;
    const w = worldTransform(document, state.id), p = transformPoint(w, net.vertices[vertex]);
    let keep: number | undefined, nearest = Infinity;
    net.vertices.forEach((v, i) => { const d = distance(p, transformPoint(w, v)); if (i !== vertex && d <= 6 / this.engine.getView().zoom && d < nearest) { keep = i; nearest = d; } });
    if (keep === undefined) return; const merged = mergeVertices(net, keep, vertex); if (!merged.segments.length) return;
    const vertices = [keep > vertex ? keep - 1 : keep];
    this.engine.previewVectorEdit(() => ({ document: editNetworks(document, [{ id: state.id, update: () => merged }]), state: { ...state, vertices, segments: [] } }));
  }
  doubleClick(point: Point): boolean {
    const state = this.engine.getVectorEdit(); if (!state) return false;
    if (state.tool === "move" && !hitEditedVectors(this.engine.getSnapshot().document, state, point, 6 / this.engine.getView().zoom)) this.engine.execute("vector.edit.end");
    return true;
  }
  cancel(): void {
    if (this.#gesture) this.engine.cancelInteraction(); this.#gesture = undefined; this.#pressed = false;
    this.#hover = undefined; this.#add = undefined; this.#marquee = undefined;
  }
}
