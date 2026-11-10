import { isDrawTool, type DrawShapeKind } from "./document";
import type { EditorEngine } from "./editor";
import { drawnLine, drawnRectangle, pixelRound, type Point } from "./geometry";
import { frameAt } from "./canvas-selection";
import { SnapTargets, type Guide } from "./snapping";
import { drawGuides } from "./measurements";
import type { MoveModifiers } from "./move-interaction";

/** Shared native shape draw gesture, including parent coordinates and preview IDs. */
export class DrawInteraction {
  #gesture?: { start: Point; parent: string; kind: DrawShapeKind; targets: SnapTargets; moved: boolean };
  #guides: Guide[] = [];
  constructor(private engine: EditorEngine, private onError: (message: string) => void) {}
  get active(): boolean { return Boolean(this.#gesture); }
  down(point: Point): boolean {
    const s = this.engine.getSnapshot(); if (!s.editable || !isDrawTool(s.tool)) return false;
    this.engine.beginInteraction();
    const hit=frameAt(s.document,point,[]);
    const parent=hit && (s.tool!=="section" || s.document.nodes[hit].kind==="section") ? hit : s.document.currentPage;
    this.#gesture = { start: point, parent, kind: s.tool, targets: new SnapTargets(s.document, []), moved: false }; return true;
  }
  move(point: Point, modifiers: MoveModifiers): void {
    const g = this.#gesture; if (!g) return;
    if (!this.engine.interacting) { this.#gesture = undefined; this.#guides = []; return; }
    try {
      const view = this.engine.getView(), pixel = view.snapPixel !== false;
      const start = pixel ? { x: pixelRound(g.start.x), y: pixelRound(g.start.y) } : g.start;
      if (pixel) point = { x: pixelRound(point.x), y: pixelRound(point.y) };
      this.#guides = [];
      if (view.snapObjects !== false && !modifiers.ctrlKey && !modifiers.metaKey) { const snap = g.targets.snapPoint(point, 5 / view.zoom); point = snap.point; this.#guides = snap.guides; }
      const draw = g.kind === "line" || g.kind === "arrow" ? drawnLine : drawnRectangle;
      this.engine.previewDraw(g.kind, draw(start, point, modifiers.shiftKey, modifiers.altKey, false), g.parent); g.moved = true;
    } catch (error) { this.#fail(error); }
  }
  up(point: Point): void {
    const g = this.#gesture; if (!g) return;
    this.#gesture = undefined; this.#guides = [];
    try {
      if (!g.moved || Math.hypot(point.x - g.start.x, point.y - g.start.y) * this.engine.getView().zoom < 3) {
        const line = g.kind === "line" || g.kind === "arrow";
        this.engine.previewDraw(g.kind, (line ? drawnLine : drawnRectangle)(g.start, { x: g.start.x + (g.kind==="section" ? 400 : 100), y: g.start.y + (line ? 0 : g.kind==="section" ? 300 : 100) }, false, false, this.engine.getView().snapPixel !== false), g.parent);
      }
      this.engine.finishDraw(); this.engine.execute("tool.move");
    } catch (error) { this.#fail(error); }
  }
  cancel(): void { if (this.#gesture) { this.#gesture = undefined; this.#guides = []; this.engine.cancelInteraction(); } }
  #fail(error: unknown): void { this.#gesture = undefined; this.#guides = []; this.engine.cancelInteraction(); this.onError(error instanceof Error ? error.message : "Could not draw shape"); }
  draw(context: CanvasRenderingContext2D): void { drawGuides(context, this.#guides, this.engine.getView()); }
}
