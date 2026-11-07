import { canvasAccent } from "./canvas-colours";
import type { EditorEngine } from "./editor";
import { isLeaf, type Document, type NodeId } from "./document";
import { isClosedShape } from "./shape-path";
import type { Point, Rectangle } from "./geometry";
import { ancestorIds, containsPoint, dragParent, enterTarget, lockedIn, marqueeSelection, marqueeWithin, paintsBelow, selectionContains } from "./canvas-selection";
import { hitRectangle, targetForLeaf } from "./selection";
import { rootIds } from "./hierarchy";
import { boundsOf, pageToScreen } from "./viewport";
import { SnapTargets, type Guide } from "./snapping";
import { drawGuides, neighbourGuides } from "./measurements";
import { originBoxPoints } from "./rotation";

export interface MoveModifiers { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }
type Gesture = { kind: "marquee"; document: Document; start: Point; base: readonly NodeId[]; toggle: boolean; within?: NodeId }
  | { kind: "move"; start: Point; ids: readonly NodeId[]; targets: SnapTargets; duplicate: boolean; moved: boolean; deselect?: NodeId; keep?: NodeId; drop?: NodeId };

/** Native move tool's supported free-layout path. Preview state never lives in React. */
export class MoveInteraction {
  #gesture?: Gesture;
  #marquee?: Rectangle;
  #guides: readonly Guide[] = [];
  constructor(private engine: EditorEngine, private onError: (message: string) => void) {}
  get active(): boolean { return this.#gesture !== undefined; }
  get copying(): boolean { return this.#gesture?.kind === "move" && this.#gesture.duplicate; }
  #fail(error: unknown): void { this.cancel(); this.engine.cancelInteraction(); this.onError(error instanceof Error ? error.message : "Could not move selection"); }
  down(point: Point, modifiers: MoveModifiers): boolean {
    const { document, selection, editable, tool } = this.engine.getSnapshot();
    if (!editable || tool !== "move" && tool !== "scale") return false;
    try {
      const deep = modifiers.metaKey || modifiers.ctrlKey;
      const leaf = hitRectangle(document, point, true, [], 2 / this.engine.getView().zoom);
      const node = leaf && document.nodes[leaf];
      const background = node && node.kind === "frame" && node.parent === document.currentPage && node.children.length > 0 && !selection.includes(node.id);
      const clicked = leaf && (deep || !background) ? deep ? leaf : targetForLeaf(document, leaf, selection) : undefined;
      let target = clicked;
      const behind = !target || selection.some(id => id !== target && (ancestorIds(document, id).includes(target!) || selectionContains(document, [id], point) && paintsBelow(document, target!, id)));
      const first = selection.find(id => !lockedIn(document, id));
      if (first && !modifiers.shiftKey && behind && selectionContains(document, selection, point)) target = first;
      if (target) {
        const box = boundsOf(document, selection), inBox = selection.length > 1 && box && containsPoint(box, point) && !modifiers.shiftKey;
        const deselect = modifiers.shiftKey && selection.includes(target) ? target : undefined;
        const keep = clicked && inBox && !deep && (selection.includes(clicked) || selection.some(id => ancestorIds(document, clicked).includes(id))) ? clicked : undefined;
        const next = keep ? selection : modifiers.shiftKey && !deselect ? [...selection, target] : selection.includes(target) ? selection : [target];
        this.engine.execute("select.set", { ids: next });
        const ids = rootIds(document, next).filter(id => !lockedIn(document, id));
        if (!ids.length) {
          if (deselect) this.engine.execute("select.remove", { ids: [deselect] });
          else if (keep) this.engine.execute("select.set", { ids: [keep] });
          return false;
        }
        const targets = new SnapTargets(document, ids);
        if (modifiers.altKey && targets.moving) targets.addBox(targets.moving);
        this.engine.beginInteraction();
        this.#gesture = { kind: "move", start: point, ids, targets, duplicate: modifiers.altKey, moved: false, deselect, keep };
      } else {
        const within = marqueeWithin(document, point);
        if (!modifiers.shiftKey) this.engine.execute("select.none");
        this.engine.beginInteraction();
        this.#gesture = { kind: "marquee", document, start: point, within, toggle: modifiers.shiftKey, base: modifiers.shiftKey ? selection : [] };
      }
      return true;
    } catch (error) { this.#fail(error); return false; }
  }
  move(point: Point, modifiers: MoveModifiers): void {
    const gesture = this.#gesture;
    if (!gesture) return;
    if (!this.engine.interacting) { this.#gesture = undefined; this.#marquee = undefined; this.#guides = []; return; }
    try {
      if (gesture.kind === "marquee") {
        this.#marquee = { x: Math.min(gesture.start.x, point.x), y: Math.min(gesture.start.y, point.y), width: Math.abs(point.x - gesture.start.x), height: Math.abs(point.y - gesture.start.y) };
        this.engine.previewSelection(marqueeSelection(gesture.document, this.#marquee, gesture.within, modifiers.ctrlKey || modifiers.metaKey, gesture.base, gesture.toggle));
        return;
      }
      if (gesture.duplicate !== modifiers.altKey) {
        gesture.duplicate = modifiers.altKey;
        if (gesture.targets.moving) { if (modifiers.altKey) gesture.targets.addBox(gesture.targets.moving); else gesture.targets.removeBox(gesture.targets.moving); }
      }
      let delta = { x: point.x - gesture.start.x, y: point.y - gesture.start.y };
      if (!gesture.moved && Math.hypot(delta.x, delta.y) * this.engine.getView().zoom < 3) return;
      if (modifiers.shiftKey) { if (Math.abs(delta.x) > Math.abs(delta.y)) delta.y = 0; else delta.x = 0; }
      if (this.engine.getView().snapPixel !== false) delta = gesture.targets.roundMove(delta);
      this.#guides = [];
      if (this.engine.getView().snapObjects !== false && !(modifiers.ctrlKey || modifiers.metaKey)) {
        const snapped = gesture.targets.snapMove(delta, 5 / this.engine.getView().zoom);
        delta = { x: delta.x + snapped.correction.x, y: delta.y + snapped.correction.y }; this.#guides = snapped.guides;
      }
      this.engine.previewMove(gesture.ids, delta, gesture.duplicate);
      const document = this.engine.getRenderDocument(), moving = gesture.duplicate ? this.engine.getRenderSelection() : gesture.ids;
      const home = document.nodes[moving[0]]?.parent;
      gesture.drop = home && document.nodes[home]?.kind === "group" ? home : dragParent(document, point, moving);
      if (gesture.duplicate) this.#guides = neighbourGuides(document, moving);
      gesture.moved = true;
    } catch (error) { this.#fail(error); }
  }
  up(point: Point, modifiers: MoveModifiers): void {
    let gesture = this.#gesture;
    if (!gesture) return;
    // Native release refreshes an existing move only when Alt changed since the last event.
    if (gesture.kind === "move" && gesture.moved && gesture.duplicate !== modifiers.altKey) this.move(point, modifiers);
    gesture = this.#gesture;
    this.#gesture = undefined; this.#marquee = undefined; this.#guides = [];
    if (!gesture || !this.engine.interacting) return;
    try {
      if (gesture.kind === "marquee") { this.engine.commitInteraction(); return; }
      if (gesture.moved) this.engine.finishMove(gesture.ids, gesture.drop ?? this.engine.getSnapshot().document.currentPage);
      else {
        this.engine.cancelInteraction();
        if (gesture.deselect) this.engine.execute("select.remove", { ids: [gesture.deselect] });
        else if (gesture.keep && this.engine.getSnapshot().selection.length > 1) this.engine.execute("select.set", { ids: [gesture.keep] });
      }
    } catch (error) { this.#fail(error); }
  }
  doubleClick(point: Point): void {
    this.cancel();
    const { document, selection, tool, editable } = this.engine.getSnapshot();
    if (!editable || tool !== "move" && tool !== "scale") return;
    const leaf = hitRectangle(document, point, true, [], 2 / this.engine.getView().zoom);
    const selected = selection.length === 1 ? document.nodes[selection[0]] : undefined;
    const bounds = selected && isLeaf(selected) && isClosedShape(selected) ? boundsOf(document, selection) : undefined;
    if (selected && bounds && containsPoint(bounds, point) && (!leaf || leaf === selected.id)) {
      this.engine.execute("vector.edit.begin", { id: selected.id }); return;
    }
    if (leaf) {
      const target = enterTarget(document, leaf, selection), node = document.nodes[target];
      if (node && isLeaf(node) && (selection.includes(target) || targetForLeaf(document, leaf, selection) === target)) {
        const allShapes = selection.length && selection.every(id => { const n = document.nodes[id]; return n && isLeaf(n); });
        this.engine.execute("vector.edit.begin", { ids: [target, ...(selection.includes(target) && allShapes ? selection.filter(id => id !== target) : [])] });
      } else this.engine.execute("select.set", { ids: [target] });
    }
  }
  cancel(): void {
    if (this.#gesture) { this.#gesture = undefined; this.engine.cancelInteraction(); }
    this.#marquee = undefined; this.#guides = [];
  }
  draw(context: CanvasRenderingContext2D): void {
    const view = this.engine.getView(), gesture = this.#gesture;
    drawGuides(context, this.#guides, view);
    context.save(); context.strokeStyle = canvasAccent(this.engine.getRenderDocument()); context.lineWidth = 1;
    if (this.#marquee) {
      const b = this.#marquee, p = pageToScreen(view, b); context.fillStyle = `${canvasAccent(this.engine.getRenderDocument())}1a`;
      context.fillRect(p.x, p.y, b.width * view.zoom, b.height * view.zoom); context.strokeRect(p.x, p.y, b.width * view.zoom, b.height * view.zoom);
    }
    if (gesture?.kind === "move" && gesture.moved && gesture.drop && gesture.drop !== this.engine.getSnapshot().document.currentPage) {
      const document = this.engine.getRenderDocument();
      const points = document.nodes[gesture.drop]?.kind === "frame" ? originBoxPoints(document, [gesture.drop]) : undefined;
      if (points) {
        context.beginPath(); points.slice(0, 4).forEach((point, index) => { const p = pageToScreen(view, point); if (index === 0) context.moveTo(p.x, p.y); else context.lineTo(p.x, p.y); }); context.closePath(); context.stroke();
      }
    }
    context.restore();
  }
}
