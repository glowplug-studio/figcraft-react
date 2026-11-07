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
import { hitEditedVectors, hitVector, type VectorHit } from "./vector-edit-hit";
import { bendSegment, makeSmooth, mergeVertices, moveVertices, setHandle, smoothVertices, splitSegment, type VectorHandle } from "./vector-edit-ops";
import { networkCubic, networkIncident, type VectorNetwork } from "./vector-network";
import { handleCursor, resizedBox, type Handle } from "./transform-handles";
import { pixelRound } from "./geometry";
import { hitVectorPointBox, pointBoxCentre, pointBoxCorners, pointBoxOnto, pointRotationMatrix, shownVectorPointBox, transformVectorBox, type PointBox } from "./vector-point-transform";
import { PenSnapCache, VectorPointTargets } from "./vector-point-snap";
import type { Guide } from "./snapping";
import { applyPen, planPen, type PenHandle, type PenPlan } from "./vector-pen";

type PointSnap = { targets: VectorPointTargets; from: readonly Point[]; grab?: Point };
type Gesture = { kind: "points"; start: Point; parts: readonly VectorEditPart[]; split?: readonly [number, number]; moved: boolean; clearOnClick?: boolean; snap?: PointSnap }
  | { kind: "pen"; plan: PenPlan; origin: Point; out?: PenHandle }
  | { kind: "boxScale"; box: PointBox; handle: Handle; targets: VectorPointTargets }
  | { kind: "boxRotate"; box: PointBox; startAngle: number; angle: number }
  | { kind: "handle"; seg: number; start: boolean; independent: boolean; group: readonly VectorHandle[]; targets: VectorPointTargets }
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
function capturePointSnap(document: Document, id: NodeId, parts: readonly VectorEditPart[], start: Point): PointSnap {
  const from: Point[] = [];
  for (const part of parts) {
    const net = vectorNetwork(document, part.id), w = worldTransform(document, part.id);
    for (const i of part.vertices) if (net?.vertices[i]) from.push(transformPoint(w, net.vertices[i]));
  }
  let grab: Point | undefined, nearest = Infinity;
  for (const p of from) { const d = distance(p, start); if (d < nearest) { nearest = d; grab = p; } }
  return { from, grab, targets: new VectorPointTargets(document, id, parts.find(p => p.id === id)?.vertices ?? [], parts.filter(p => p.id !== id)) };
}

/** Point editing gestures own transient geometry outside React and commit a single history item. */
export class VectorInteraction {
  #gesture?: Gesture;
  #pressed = false;
  #hover?: { id: NodeId; hit: VectorHit };
  #add?: { point: Point; on: boolean };
  #marquee?: Rectangle;
  #guides: Guide[] = [];
  #rubber?: readonly [Point, Point];
  #penSnap = new PenSnapCache();
  #penPress?: { point: Point; depth: number };
  constructor(private engine: EditorEngine, private onError: (message: string) => void) {}
  get active(): boolean { return this.#pressed; }
  get overlay() {
    const g = this.#gesture, state = this.engine.getRenderVectorEdit();
    const box = state && shownVectorPointBox(this.engine.getRenderDocument(), state);
    const corners = g?.kind === "boxRotate" ? pointBoxCorners(g.box).map(p => transformPoint(pointRotationMatrix(pointBoxCentre(g.box), -g.angle), p)) : box && pointBoxCorners(box);
    return { hover: this.#hover, add: this.#add, marquee: this.#marquee, box: corners, guides: this.#guides, rubber: this.#rubber };
  }
  #snapPen(point: Point, id: NodeId, modifiers?: MoveModifiers): Point {
    const view = this.engine.getView(), objects = view.snapObjects !== false && !modifiers?.ctrlKey && !modifiers?.metaKey, pixel = view.snapPixel !== false;
    if (!objects && !pixel) return point;
    const snap = this.#penSnap.targets(this.engine.getRenderDocument(), id).snap([point], point, view.zoom, objects, pixel);
    this.#guides = snap.guides; return { x: point.x + snap.correction.x, y: point.y + snap.correction.y };
  }
  #fail(error: unknown): void { this.cancel(); this.onError(error instanceof Error ? error.message : "Could not edit vector"); }
  hover(point?: Point, modifiers?: MoveModifiers): string | undefined {
    this.#hover = undefined; this.#add = undefined; this.#rubber = undefined; this.#guides = [];
    const state = this.engine.getRenderVectorEdit(); if (!state || !point) return undefined;
    const document = this.engine.getRenderDocument(), zoom = this.engine.getView().zoom;
    this.#hover = hitEditedVectors(document, state, point, 6 / zoom);
    const found = this.#hover;
    if (state.tool === "pen") {
      const hit = hitVector(document, state, point, 6 / zoom), to = !hit && !modifiers?.shiftKey ? this.#snapPen(point, state.id, modifiers) : point;
      if (state.anchor !== undefined) {
        const anchor = vectorNetwork(document, state.id)?.vertices[state.anchor];
        if (anchor) this.#rubber = [transformPoint(worldTransform(document, state.id), anchor), to];
      }
      if (hit?.kind === "segment") { const at = segmentPoint(document, state.id, hit.seg, hit.t); if (at) this.#add = { point: at, on: true }; }
      return hit?.kind === "vertex" ? "alias" : hit?.kind === "segment" ? "copy" : "crosshair";
    }
    if (!(modifiers?.ctrlKey || modifiers?.metaKey)) {
      const box = shownVectorPointBox(document, state), hit = box && hitVectorPointBox(box, found?.hit, point, zoom);
      if (box && hit?.kind === "handle") { this.#hover = undefined; return handleCursor(pointBoxCorners(box), hit.handle); }
      if (hit?.kind === "inside" && !modifiers?.shiftKey) return "move";
    }
    if (found?.hit.kind === "segment" && state.tool === "move" && !(modifiers?.ctrlKey || modifiers?.metaKey || modifiers?.shiftKey || modifiers?.altKey)) {
      const at = segmentPoint(document, found.id, found.hit.seg, .5); if (at) this.#add = { point: at, on: distance(at, point) * zoom <= 6 };
    }
    return found ? "default" : "crosshair";
  }
  down(point: Point, modifiers: MoveModifiers): boolean {
    let state = this.engine.getVectorEdit(); if (!state || !this.engine.getSnapshot().editable) return false;
    this.#pressed = true; this.#hover = undefined; this.#add = undefined; this.#guides = []; this.#rubber = undefined;
    try {
      const document = this.engine.getSnapshot().document, zoom = this.engine.getView().zoom;
      const found = hitEditedVectors(document, state, point, 6 / zoom);
      if (found && found.id !== state.id && !(state.tool === "pen" && state.anchor !== undefined)) { this.engine.updateVectorSelection(s => activateVector(s, found.id)!); state = this.engine.getVectorEdit()!; }
      if (!modifiers.shiftKey && state.regions.length) {
        this.engine.updateVectorSelection(s => ({ ...s, vertices: s.vertices.filter(v => !s.regionVertices.includes(v)), regions: [], regionVertices: [], regionTopology: undefined }));
        state = this.engine.getVectorEdit()!;
      }
      const hit = found?.id === state.id ? found.hit : undefined, bend = state.tool === "bend" || state.tool === "move" && (modifiers.ctrlKey || modifiers.metaKey);
      if (state.tool === "pen") {
        const at = !hit && !modifiers.shiftKey ? this.#snapPen(point, state.id, modifiers) : point;
        const decision = planPen(vectorNetwork(document, state.id)!, state.anchor, hit, transformPoint(inverse(worldTransform(document, state.id)), at), modifiers.shiftKey);
        if (decision.kind !== "edit") {
          const anchor = decision.kind === "start" ? decision.vertex : undefined;
          this.engine.updateVectorSelection(s => ({ ...s, anchor, penOut: undefined, ...(anchor !== undefined ? { vertices: [anchor], segments: [] } : {}) })); return true;
        }
        this.#penPress = state.anchor === undefined ? { point, depth: this.engine.getUndoDepth() } : undefined;
        this.engine.beginInteraction();
        const g: Extract<Gesture, { kind: "pen" }> = { kind: "pen", plan: decision.plan, origin: point, out: state.penOut };
        this.#gesture = g; this.#previewPen(g); return true;
      }
      const box = !bend && shownVectorPointBox(document, state), boxHit = box && hitVectorPointBox(box, hit, point, zoom);
      if (box && boxHit && !(boxHit.kind === "inside" && modifiers.shiftKey)) {
        this.engine.beginInteraction();
        if (boxHit.kind === "inside") {
          const parts = [{ id: state.id, vertices: box.points, segments: [] }, ...box.others.map(p => ({ ...p, segments: [] }))];
          this.#gesture = { kind: "points", start: point, parts, moved: false, clearOnClick: true, snap: capturePointSnap(document, state.id, parts, point) };
        }
        else if (boxHit.handle.kind === "rotate") {
          const c = pointBoxCentre(box); this.#gesture = { kind: "boxRotate", box, startAngle: Math.atan2(point.y - c.y, point.x - c.x), angle: 0 };
        } else this.#gesture = { kind: "boxScale", box, handle: boxHit.handle, targets: new VectorPointTargets(document, state.id, box.points, box.others) };
        return true;
      }
      if (hit?.kind === "handle") {
        let handles = state.handles;
        const has = handles.some(h => h[0] === hit.seg && h[1] === hit.start);
        if (!bend) {
          handles = modifiers.shiftKey ? has ? handles.filter(h => h[0] !== hit.seg || h[1] !== hit.start) : [...handles, [hit.seg, hit.start] as const] : has ? handles : [[hit.seg, hit.start]];
          this.engine.updateVectorSelection(s => ({ ...s, handles }));
          if (!handles.some(h => h[0] === hit.seg && h[1] === hit.start)) return true;
        }
        const segment = vectorNetwork(document, state.id)!.segments[hit.seg];
        this.engine.beginInteraction(); this.#gesture = { kind: "handle", seg: hit.seg, start: hit.start, independent: bend || modifiers.altKey, group: bend ? [] : handles, targets: new VectorPointTargets(document, state.id, [hit.start ? segment.a : segment.b]) };
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
        this.engine.beginInteraction(); this.#gesture = { kind: "points", start: point, parts, moved: false, snap: capturePointSnap(document, state.id, parts, point) };
      } else if (hit?.kind === "segment") {
        const at = segmentPoint(document, state.id, hit.seg, .5), midpoint = !modifiers.altKey && !modifiers.shiftKey && at && distance(at, point) * zoom <= 6;
        if (midpoint || modifiers.altKey) {
          const t = midpoint ? .5 : hit.t, vertex = vectorNetwork(document, state.id)!.vertices.length;
          this.engine.beginInteraction();
          this.#gesture = { kind: "points", start: point, parts: [{ id: state.id, vertices: [vertex], segments: [] }], split: [hit.seg, t], moved: false };
          this.#previewPoints(this.#gesture, { x: 0, y: 0 });
          this.#gesture.snap = capturePointSnap(this.engine.getRenderDocument(), state.id, this.#gesture.parts, point);
        } else if (modifiers.shiftKey) this.engine.updateVectorSelection(s => ({ ...s, segments: toggle(s.segments, hit.seg) }));
        else {
          const segment = vectorNetwork(document, state.id)!.segments[hit.seg];
          this.engine.updateVectorSelection(s => ({ ...clearVectorSelection(s), segments: [hit.seg] })); this.engine.beginInteraction();
          const parts = [{ id: state.id, vertices: [segment.a, segment.b], segments: [] }];
          this.#gesture = { kind: "points", start: point, parts, moved: false, snap: capturePointSnap(document, state.id, parts, point) };
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
  #previewPen(g: Extract<Gesture, { kind: "pen" }>, drag?: Point): void {
    this.engine.previewVectorEdit((document, state) => {
      let vertex: number | undefined;
      const next = editNetworks(document, [{ id: state.id, update: net => {
        const result = applyPen(net, g.plan, g.out, drag); vertex = result.vertex; return result.network;
      } }]);
      const open = g.plan.kind === "new";
      return { document: next, state: { ...state, vertices: vertex === undefined ? [] : [vertex], segments: [], anchor: open ? vertex : undefined, penOut: open && drag ? [drag.x, drag.y] : undefined } };
    });
  }
  move(point: Point, modifiers: MoveModifiers): void {
    const g = this.#gesture; if (!g) return;
    if (!this.engine.interacting) { this.#gesture = undefined; this.#pressed = false; this.#guides = []; return; }
    try {
      const view = this.engine.getView(), zoom = view.zoom, objects = view.snapObjects !== false && !modifiers.ctrlKey && !modifiers.metaKey, pixel = view.snapPixel !== false;
      if (g.kind === "pen") {
        if (distance(point, g.origin) * zoom < 2) return;
        const state = this.engine.getVectorEdit()!;
        const delta = vectorLocalOffset(worldTransform(this.engine.getInteractionBase(), state.id), { x: point.x - g.origin.x, y: point.y - g.origin.y });
        this.#previewPen(g, delta); return;
      }
      if (g.kind === "points") {
        const delta = { x: point.x - g.start.x, y: point.y - g.start.y }; if (Math.hypot(delta.x, delta.y) * zoom < 1) return;
        const lock = modifiers.shiftKey ? Math.abs(delta.x) > Math.abs(delta.y) : undefined;
        if (lock === true) delta.y = 0; else if (lock === false) delta.x = 0;
        if (g.snap) {
          const add = (p: Point) => ({ x: p.x + delta.x, y: p.y + delta.y });
          const snapped = g.snap.targets.snap(g.snap.from.map(add), g.snap.grab && add(g.snap.grab), zoom, objects, pixel, lock);
          delta.x += snapped.correction.x; delta.y += snapped.correction.y; this.#guides = snapped.guides;
        }
        this.#previewPoints(g, delta); g.moved = true; return;
      }
      this.engine.previewVectorEdit((document, state) => {
        if (g.kind === "boxScale" || g.kind === "boxRotate") {
          const draft = new HierarchyDraft(document);
          if (g.kind === "boxScale") {
            const snapped = g.targets.snap([point], undefined, zoom, objects, false); this.#guides = snapped.guides;
            const local = transformPoint(inverse(g.box.frame), { x: point.x + snapped.correction.x, y: point.y + snapped.correction.y }), b = resizedBox(g.handle, local, g.box.width, g.box.height, modifiers.shiftKey, modifiers.altKey);
            transformVectorBox(draft, state.id, g.box, pointBoxOnto(g.box, ...b));
          } else {
            const c = pointBoxCentre(g.box); g.angle = (Math.atan2(point.y - c.y, point.x - c.x) - g.startAngle) * 180 / Math.PI;
            if (modifiers.shiftKey) g.angle = pixelRound(g.angle / 15) * 15;
            transformVectorBox(draft, state.id, g.box, pointRotationMatrix(c, -g.angle));
          }
          draft.normaliseGroups(); return { document: validateChangedGeometry(draft), state };
        }
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
        let target = point;
        if (g.kind === "handle") {
          const snapped = g.targets.snap([point], point, zoom, objects, pixel); this.#guides = snapped.guides;
          target = { x: point.x + snapped.correction.x, y: point.y + snapped.correction.y };
        }
        const w = worldTransform(document, state.id), local = transformPoint(inverse(w), target);
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
    const g = this.#gesture; this.#gesture = undefined; this.#pressed = false; this.#marquee = undefined; this.#guides = [];
    if (!g || !this.engine.interacting) return;
    try {
      if (g.kind === "points" && !g.moved && !g.split) {
        this.engine.cancelInteraction();
        if (g.clearOnClick) this.engine.updateVectorSelection(s => ({ ...s, vertices: [], segments: [], others: s.others.map(p => ({ ...p, vertices: [], segments: [] })) }));
        return;
      }
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
    if (state.tool === "pen") {
      const press = this.#penPress; this.#penPress = undefined;
      if (press && distance(press.point, point) * this.engine.getView().zoom < 8) {
        while (this.engine.getUndoDepth() > press.depth) if (!this.engine.execute("edit.undo").undone) break;
      }
      if (!this.engine.getVectorEdit()) this.engine.execute("vector.edit.begin", { id: state.id });
      this.engine.execute("vector.edit.tool", { tool: "move" }); this.#rubber = undefined; return true;
    }
    if (state.tool === "move" && !hitEditedVectors(this.engine.getSnapshot().document, state, point, 6 / this.engine.getView().zoom)) this.engine.execute("vector.edit.end");
    return true;
  }
  cancel(): void {
    if (this.#gesture) this.engine.cancelInteraction(); this.#gesture = undefined; this.#pressed = false;
    this.#hover = undefined; this.#add = undefined; this.#marquee = undefined; this.#guides = []; this.#rubber = undefined;
  }
}
