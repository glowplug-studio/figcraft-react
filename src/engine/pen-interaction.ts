import type { NodeId } from "./document";
import type { EditorEngine } from "./editor";
import type { Point } from "./geometry";
import { dropParent } from "./canvas-selection";
import type { MoveModifiers } from "./move-interaction";
import { penAt45 } from "./vector-pen";
import { penPathAction, penPathHandles, selectedVectorEnd, type PenAnchor } from "./pen-path";
import { PenSnapCache } from "./vector-point-snap";
import type { Guide } from "./snapping";
import { hitRectangle } from "./selection";
import { isLeaf } from "./document";

/** A new path owns one transaction across all clicks. Existing networks use VectorInteraction. */
export class PenInteraction {
  #path?: { points: PenAnchor[]; parent: NodeId; id?: NodeId; closed: boolean; join?: number };
  #anchor?: Point;
  #rubber?: readonly [Point, Point];
  #guides: Guide[] = [];
  #targets = new PenSnapCache();
  constructor(private engine: EditorEngine) {}
  get open(): boolean { return this.#path !== undefined; }
  get active(): boolean { return this.#anchor !== undefined; }
  get overlay() {
    const points = this.#path?.points ?? [], last = points.at(-1);
    return { points: points.map(p => p.at), handles: penPathHandles(points), rubber: this.#rubber, guides: this.#guides,
      rubberHandle: last && Math.hypot(last.outgoing.x, last.outgoing.y) > 0 ? { x: last.at.x + last.outgoing.x, y: last.at.y + last.outgoing.y } : undefined };
  }
  #snap(point: Point, modifiers: MoveModifiers): Point {
    const view = this.engine.getView(), objects = view.snapObjects !== false && !modifiers.ctrlKey && !modifiers.metaKey, pixel = view.snapPixel !== false;
    if (!objects && !pixel) return point;
    const path = this.#path, targets = this.#targets.targets(this.engine.getRenderDocument(), path?.id, path?.id ? [] : path?.points.map(p => p.at));
    const snap = targets.snap([point], point, view.zoom, objects, pixel); this.#guides = snap.guides;
    return { x: point.x + snap.correction.x, y: point.y + snap.correction.y };
  }
  down(point: Point, modifiers: MoveModifiers): boolean {
    try { return this.#down(point, modifiers); } catch (error) { this.cancel(); throw error; }
  }
  #down(point: Point, modifiers: MoveModifiers): boolean {
    const snapshot = this.engine.getSnapshot(); if (!snapshot.editable || snapshot.tool !== "pen") return false;
    if (![point.x, point.y].every(Number.isFinite)) throw new Error("Pen points must remain finite");
    this.#guides = []; this.#rubber = undefined;
    if (!this.#path) {
      const end = selectedVectorEnd(snapshot.document, snapshot.selection, point, 8 / this.engine.getView().zoom);
      if (end) { this.#edit(end.id, "pen", end.vertex); return true; }
    }
    const at = modifiers.shiftKey ? point : this.#snap(point, modifiers);
    const path = this.#path ??= { points: [], parent: dropParent(snapshot.document, at, []) ?? snapshot.document.currentPage, closed: false };
    const action = penPathAction(path.points, at, this.engine.getView().zoom, modifiers.shiftKey);
    if (action.kind === "ignore") return true;
    if (action.kind === "close" || action.kind === "join") {
      if (action.kind === "close") path.closed = true; else path.join = action.index;
      this.#update(); this.finish(); return true;
    }
    path.points.push({ at: action.point, incoming: { x: 0, y: 0 }, outgoing: { x: 0, y: 0 } }); this.#anchor = action.point;
    this.#update(); return true;
  }
  #update(): void {
    const path = this.#path; if (!path) return;
    if (path.points.length >= 2) {
      if (path.id === undefined) this.engine.beginInteraction();
      path.id = this.engine.previewPenPath(path.points, path.parent, path.closed, path.join);
    } else this.engine.invalidateCanvas();
  }
  move(point: Point): void {
    try { this.#move(point); } catch (error) { this.cancel(); throw error; }
  }
  #move(point: Point): void {
    const path = this.#path, at = this.#anchor; if (!path || !at) return;
    if (![point.x, point.y].every(Number.isFinite)) throw new Error("Pen handles must remain finite");
    const delta = Math.hypot(point.x - at.x, point.y - at.y) * this.engine.getView().zoom < 3 ? { x: 0, y: 0 } : { x: point.x - at.x, y: point.y - at.y };
    path.points[path.points.length - 1] = { at, outgoing: delta, incoming: { x: -delta.x, y: -delta.y } }; this.#update();
  }
  up(): void { this.#anchor = undefined; }
  hover(point: Point | undefined, modifiers: MoveModifiers): string {
    this.#guides = []; this.#rubber = undefined;
    if (!point) return "crosshair";
    const at = modifiers.shiftKey ? point : this.#snap(point, modifiers), path = this.#path, last = path?.points.at(-1);
    if (last) this.#rubber = [last.at, modifiers.shiftKey ? penAt45(last.at, at) : at];
    if (path) return ["close", "join"].includes(penPathAction(path.points, at, this.engine.getView().zoom, false).kind) ? "alias" : "crosshair";
    const snapshot = this.engine.getSnapshot();
    return selectedVectorEnd(snapshot.document, snapshot.selection, at, 8 / this.engine.getView().zoom) ? "alias" : "crosshair";
  }
  #edit(id: NodeId, tool: "move" | "pen", anchor?: number): void {
    this.engine.execute("tool.move"); this.engine.execute("vector.edit.begin", { id }); this.engine.execute("vector.edit.tool", { tool });
    this.engine.updateVectorSelection(s => ({ ...s, anchor, vertices: anchor === undefined ? [] : [anchor] }));
  }
  finish(tool?: "move" | "pen"): void {
    const id = this.#path?.id; this.#clear();
    if (id !== undefined) { this.engine.commitInteraction(); if (tool && this.engine.getSnapshot().document.nodes[id]) this.#edit(id, tool); }
    this.engine.invalidateCanvas();
  }
  doubleClick(point: Point): boolean {
    if (this.engine.getSnapshot().tool !== "pen") return false;
    if (this.#path?.id !== undefined) { this.finish("move"); return true; }
    this.finish(); const snapshot = this.engine.getSnapshot(), id = hitRectangle(snapshot.document, point, true, [], 6 / this.engine.getView().zoom);
    if (id && isLeaf(snapshot.document.nodes[id])) this.#edit(id, "move"); return true;
  }
  #clear(): void { this.#path = undefined; this.#anchor = undefined; this.#rubber = undefined; this.#guides = []; this.#targets.clear(); }
  cancel(): void { const hadPath = this.open; this.#clear(); if (hadPath) this.engine.cancelInteraction(); this.engine.invalidateCanvas(); }
}
