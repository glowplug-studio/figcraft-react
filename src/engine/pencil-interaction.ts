import type { EditorEngine } from "./editor";
import type { Point } from "./geometry";
import { dropParent } from "./canvas-selection";
import { worldTransform } from "./hierarchy";
import { pencilPressureProfile, shouldSamplePencil } from "./pencil-samples";
import { pencilPath } from "./pencil-path";
import { wireBrush } from "./brush";
import { pageToScreen } from "./viewport";

/** Samples and the unsmoothed preview stay outside document history and React reconciliation. */
export class PencilInteraction {
  #gesture?: { points: Point[]; pressure: (number | undefined)[] };
  constructor(private engine: EditorEngine) {}
  get active(): boolean { return this.#gesture !== undefined; }
  down(point: Point, pressure?: number): boolean {
    if (!this.engine.getSnapshot().editable || this.engine.getSnapshot().tool !== "pencil") return false;
    shouldSamplePencil(undefined, point, this.engine.getView().zoom);
    this.engine.beginInteraction(); this.#gesture = { points: [{ ...point }], pressure: [pressure] }; return true;
  }
  move(point: Point, pressure?: number): void {
    const gesture = this.#gesture; if (!gesture) return;
    try {
      if (!this.engine.interacting) { this.cancel(); return; }
      if (shouldSamplePencil(gesture.points.at(-1), point, this.engine.getView().zoom)) { gesture.points.push({ ...point }); gesture.pressure.push(pressure); }
      this.engine.invalidateCanvas();
    } catch (error) { this.cancel(); throw error; }
  }
  up(point: Point, pressure?: number): void {
    if (!this.#gesture) return;
    try {
      this.move(point, pressure); const gesture = this.#gesture; this.#gesture = undefined; this.engine.cancelInteraction();
      if (!gesture || gesture.points.length < 2) return;
      const document = this.engine.getSnapshot().document, parent = dropParent(document, gesture.points[0], []) ?? document.currentPage;
      const path = pencilPath(gesture.points, worldTransform(document, parent)); if (!path) return;
      const profile = pencilPressureProfile(gesture.points, gesture.pressure), brush = this.engine.getPencilBrush();
      this.engine.execute("node.create", { type: "vector", path, closed: false, parent, name: "Vector", props: {
        fills: [], strokes: ["#000000"], strokeWeight: 2, strokeCap: "round", strokeJoin: "round", strokeAlign: "center",
        ...(profile ? { widthProfile: profile } : {}), ...(brush ? { brush: wireBrush(brush) } : {}),
      } });
    } catch (error) { this.cancel(); throw error; }
    finally { this.engine.invalidateCanvas(); }
  }
  cancel(): void {
    if (!this.#gesture) return;
    this.#gesture = undefined; this.engine.cancelInteraction(); this.engine.invalidateCanvas();
  }
  draw(context: CanvasRenderingContext2D): void {
    const points = this.#gesture?.points; if (!points || points.length < 2) return;
    const view = this.engine.getView(); context.save(); context.strokeStyle = "#000000"; context.lineWidth = Math.max(2 * view.zoom, 1); context.lineCap = "round"; context.lineJoin = "round";
    context.beginPath(); points.forEach((point, i) => { const p = pageToScreen(view, point); if (i) context.lineTo(p.x, p.y); else context.moveTo(p.x, p.y); }); context.stroke(); context.restore();
  }
}
