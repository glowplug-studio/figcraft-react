import type { EditorEngine } from "./editor";
import { drawnRectangle, type Point } from "./geometry";
import { dropParent } from "./canvas-selection";
import { SnapTargets, type Guide } from "./snapping";
import { drawGuides } from "./measurements";
import type { MoveModifiers } from "./move-interaction";

/** Shared native Rectangle/Ellipse draw gesture, including parent coordinates and preview IDs. */
export class DrawInteraction {
  #gesture?: { start: Point; parent: string; kind: "rectangle" | "ellipse"; targets: SnapTargets; moved: boolean };
  #guides: Guide[] = [];
  constructor(private engine: EditorEngine, private onError: (message: string) => void) {}
  get active(): boolean { return Boolean(this.#gesture); }
  down(point: Point): boolean {
    const s = this.engine.getSnapshot(); if (!s.editable || s.tool !== "rectangle" && s.tool !== "ellipse") return false;
    this.engine.beginInteraction();
    this.#gesture = { start: point, parent: dropParent(s.document, point, []) ?? s.document.currentPage, kind: s.tool, targets: new SnapTargets(s.document, []), moved: false }; return true;
  }
  move(point: Point, modifiers: MoveModifiers): void {
    const g = this.#gesture; if (!g) return;
    if (!this.engine.interacting) { this.#gesture = undefined; this.#guides = []; return; }
    try {
      this.#guides = [];
      if (!modifiers.ctrlKey && !modifiers.metaKey) { const snap = g.targets.snapPoint(point, 5 / this.engine.getView().zoom); point = snap.point; this.#guides = snap.guides; }
      this.engine.previewDraw(g.kind, drawnRectangle(g.start, point, modifiers.shiftKey, modifiers.altKey), g.parent); g.moved = true;
    } catch (error) { this.#fail(error); }
  }
  up(point: Point): void {
    const g = this.#gesture; if (!g) return;
    this.#gesture = undefined; this.#guides = [];
    try {
      if (!g.moved || Math.hypot(point.x - g.start.x, point.y - g.start.y) * this.engine.getView().zoom < 3) this.engine.previewDraw(g.kind, drawnRectangle(g.start, { x: g.start.x + 100, y: g.start.y + 100 }), g.parent);
      this.engine.commitInteraction(); this.engine.execute("tool.move");
    } catch (error) { this.#fail(error); }
  }
  cancel(): void { if (this.#gesture) { this.#gesture = undefined; this.#guides = []; this.engine.cancelInteraction(); } }
  #fail(error: unknown): void { this.#gesture = undefined; this.#guides = []; this.engine.cancelInteraction(); this.onError(error instanceof Error ? error.message : "Could not draw shape"); }
  draw(context: CanvasRenderingContext2D): void { drawGuides(context, this.#guides, this.engine.getView()); }
}
