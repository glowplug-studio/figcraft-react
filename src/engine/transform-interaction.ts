import { canvasAccent } from "./canvas-colours";
import type { EditorEngine } from "./editor";
import { lockedIn } from "./canvas-selection";
import type { Point } from "./geometry";
import { pixelRound } from "./geometry";
import { transformPoint } from "./affine";
import { selectionFrame } from "./rotation";
import { anchorPoint, frameCorners, handleAt, handleCursor, type ScaleAnchor } from "./transform-handles";
import { resizeStart, type ResizeStart } from "./transform-preview";
import { PointSnapCache, distanceLabel, type Guide } from "./snapping";
import { drawGuides } from "./measurements";
import { pageToScreen } from "./viewport";
import type { MoveModifiers } from "./move-interaction";

type Gesture = { start: Point; resize: ResizeStart; targets: PointSnapCache; scale?: ScaleAnchor; moved: boolean; pivot: Point; angle: number };
/** Native transform handles; all frame-frequency state stays in this controller. */
export class TransformInteraction {
  #gesture?: Gesture;
  #guides: Guide[] = [];
  #hint?: { factor: number; pivot: Point };
  constructor(private engine: EditorEngine, private onError: (message: string) => void) {}
  get active(): boolean { return this.#gesture !== undefined; }
  get scaleHint(): Readonly<{ factor: number; pivot: Point }> | undefined { return this.#hint; }
  #frame() {
    const s = this.engine.getSnapshot();
    if (!s.editable || s.tool === "rectangle" || s.selection.some(id => lockedIn(s.document, id))) return;
    return selectionFrame(s.document, s.selection);
  }
  hover(point: Point): string | undefined {
    try { const frame = this.#frame(); if (!frame) return; const corners = frameCorners(frame), handle = handleAt(corners, point, this.engine.getView().zoom); return handle && handleCursor(corners, handle); }
    catch { return; }
  }
  down(point: Point): boolean {
    try {
      const frame = this.#frame(); if (!frame) return false;
      const handle = handleAt(frameCorners(frame), point, this.engine.getView().zoom); if (!handle) return false;
      const s = this.engine.getSnapshot(), resize = resizeStart(s.document, s.selection, handle); if (!resize) return false;
      const origin = this.engine.getRotationOrigin(), pivot = origin.moved && origin.point ? origin.point : transformPoint(frame.matrix, { x: frame.width / 2, y: frame.height / 2 });
      this.engine.beginInteraction();
      this.#gesture = { start: point, resize, targets: new PointSnapCache(resize.ids), scale: s.tool === "scale" ? s.scaleAnchor : undefined, moved: false, pivot, angle: Math.atan2(point.y - pivot.y, point.x - pivot.x) };
      return true;
    } catch (error) { this.#fail(error); return false; }
  }
  move(point: Point, modifiers: MoveModifiers): void {
    const g = this.#gesture; if (!g) return;
    if (!this.engine.interacting) { this.#clear(); return; }
    try {
      if (g.resize.handle.kind === "rotate") {
        let angle = (Math.atan2(point.y - g.pivot.y, point.x - g.pivot.x) - g.angle) * 180 / Math.PI;
        if (modifiers.shiftKey) angle = pixelRound(angle / 15) * 15;
        this.engine.previewRotate(g.resize.ids, -angle, g.pivot); return;
      }
      if (!g.moved && Math.hypot(point.x - g.start.x, point.y - g.start.y) * this.engine.getView().zoom < 3) return;
      this.#guides = [];
      if (!modifiers.ctrlKey && !modifiers.metaKey) {
        // Native resize gathers against the current preview: refitted parent bounds may change.
        const snapped = g.targets.get(this.engine.getRenderDocument()).snapPoint(point, 5 / this.engine.getView().zoom); point = snapped.point; this.#guides = snapped.guides;
      }
      const matrix = g.resize.frame.matrix;
      if (!g.scale && Math.abs(matrix[1]) < 1e-7 && Math.abs(matrix[2]) < 1e-7) point = { x: pixelRound(point.x), y: pixelRound(point.y) };
      this.#hint = this.engine.previewResize(g.resize, point, modifiers.shiftKey, modifiers.altKey, modifiers.ctrlKey || modifiers.metaKey, g.scale);
      g.moved = true;
    } catch (error) { this.#fail(error); }
  }
  up(): void {
    if (!this.#gesture) return;
    this.#clear();
    try { this.engine.commitInteraction(); } catch (error) { this.#fail(error); }
  }
  #clear(): void { this.#gesture = undefined; this.#guides = []; this.#hint = undefined; }
  cancel(): void { if (this.#gesture) { this.#clear(); this.engine.cancelInteraction(); } }
  #fail(error: unknown): void { this.#clear(); this.engine.cancelInteraction(); this.onError(error instanceof Error ? error.message : "Could not transform selection"); }
  draw(context: CanvasRenderingContext2D): void {
    const s = this.engine.getSnapshot(); if (s.tool === "rectangle") return;
    const doc = this.engine.getRenderDocument(), ids = this.engine.getRenderSelection(), frame = selectionFrame(doc, ids); if (!frame) return;
    const view = this.engine.getView(), corners = frameCorners(frame).map(p => pageToScreen(view, p));
    const locked = ids.some(id => lockedIn(doc, id)), longest = Math.max(Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y), Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y));
    drawGuides(context, this.#guides, view);
    context.save(); context.strokeStyle = canvasAccent(doc); context.fillStyle = "white"; context.lineWidth = 1;
    if (ids.length > 1) { context.beginPath(); corners.forEach((p, i) => i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y)); context.closePath(); context.stroke(); }
    if (!locked && longest >= 16 && s.editable) for (const p of corners) { context.beginPath(); context.roundRect(p.x - 4, p.y - 4, 8, 8, 1); context.fill(); context.stroke(); }
    const label = `${distanceLabel(frame.width)} × ${distanceLabel(frame.height)}${this.#hint ? ` · ${distanceLabel(this.#hint.factor)}x` : ""}`;
    context.font = "600 11px sans-serif"; const width = context.measureText(label).width + 8, height = 18;
    const x = corners.reduce((v, p) => v + p.x, 0) / 4 - width / 2, y = Math.max(...corners.map(p => p.y)) + 9;
    context.fillStyle = "#00875f"; context.beginPath(); context.roundRect(x, y, width, height, 3); context.fill(); context.fillStyle = "white"; context.textBaseline = "top"; context.fillText(label, x + 4, y + 2);
    if (s.tool === "scale") {
      const p = pageToScreen(view, this.#hint?.pivot ?? transformPoint(frame.matrix, anchorPoint(s.scaleAnchor, frame.width, frame.height)));
      context.fillStyle = "white"; context.lineWidth = 1.5; context.beginPath(); context.arc(p.x, p.y, 4, 0, Math.PI * 2); context.fill(); context.stroke(); context.fillStyle = canvasAccent(doc); context.beginPath(); context.arc(p.x, p.y, 1.5, 0, Math.PI * 2); context.fill();
    }
    context.restore();
  }
}
