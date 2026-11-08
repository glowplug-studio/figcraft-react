import { canvasAccent } from "./canvas-colours";
import { tracePath } from "./corners";
import type { EditorEngine } from "./editor";
import type { Point } from "./geometry";
import { hitRectangle } from "./selection";
import { availableBuilderArrangement, builderRegionAt, type BuilderArrangement, type BuilderRegion } from "./shape-builder";
import { pageToScreen } from "./viewport";

type Modifiers = Pick<MouseEvent, "altKey" | "shiftKey" | "ctrlKey" | "metaKey">;
const paths = new WeakMap<BuilderRegion, Path2D>();

export class ShapeBuilderInteraction {
  #gesture?: { picked: Set<number>; start: Point; last: Point; remove: boolean };
  #hover = -1;
  #remove = false;
  constructor(private engine: EditorEngine) {}
  get active() { return this.#gesture !== undefined; }
  #arrangement(): BuilderArrangement | undefined {
    const { document, selection, tool } = this.engine.getSnapshot();
    if (tool !== "shapeBuilder") return;
    return availableBuilderArrangement(document, selection);
  }
  down(point: Point, event: Modifiers) {
    if (this.engine.getSnapshot().tool !== "shapeBuilder") return false;
    this.move(point, event.altKey);
    this.#gesture = { start: point, last: point, picked: new Set(this.#hover >= 0 ? [this.#hover] : []), remove: this.#remove };
    return true;
  }
  move(point: Point, alt: boolean) {
    const arrangement = this.#arrangement(), gesture = this.#gesture;
    if (!gesture) {
      this.#hover = arrangement ? builderRegionAt(arrangement, point) : -1;
      this.#remove = alt !== (this.engine.getSnapshot().builderMode === "remove");
    } else if (arrangement) {
      const start = gesture.last, dx = point.x - start.x, dy = point.y - start.y;
      const steps = Math.min(500, Math.max(1, Math.ceil(Math.hypot(dx,dy) * this.engine.getView().zoom / 3)));
      for (let k = 1; k <= steps; k++) {
        const i = builderRegionAt(arrangement, { x: start.x + dx*k/steps, y: start.y + dy*k/steps });
        if (i >= 0) gesture.picked.add(i);
      }
      gesture.last = point;
    }
  }
  up(point: Point, event: Modifiers) {
    const gesture = this.#gesture;
    if (!gesture) return;
    this.cancel();
    if (gesture.picked.size) {
      this.engine.execute(gesture.remove ? "shapeBuilder.remove" : "shapeBuilder.merge", { regions:[...gesture.picked] });
    } else if (Math.hypot(point.x-gesture.start.x, point.y-gesture.start.y) * this.engine.getView().zoom < 3) {
      const { document, selection } = this.engine.getSnapshot();
      const id = hitRectangle(document, point, event.ctrlKey || event.metaKey, selection, 2/this.engine.getView().zoom);
      if (id) this.engine.execute(event.shiftKey ? selection.includes(id) ? "select.remove" : "select.add" : "select.set", { id });
    }
  }
  cancel() { this.#gesture = undefined; this.#hover = -1; }

  draw(context: CanvasRenderingContext2D) {
    const a = this.#arrangement();
    if (!a) return;
    const view = this.engine.getView(), accent = canvasAccent(this.engine.getSnapshot().document);
    const selected = this.#gesture?.picked ?? new Set([this.#hover]);
    context.save();
    const screen = context.getTransform(), origin = pageToScreen(view, {x:0,y:0});
    context.translate(origin.x, origin.y);
    context.scale(view.zoom, view.zoom);
    context.lineJoin = "round";
    const edges = (path: Path2D, active: boolean) => {
      context.strokeStyle = active ? "rgba(255,255,255,.78)" : "rgba(255,255,255,.59)";
      context.lineWidth = (active ? 4 : 2.5) / view.zoom;
      context.stroke(path);
      context.strokeStyle = active && this.#remove ? "#f24822" : accent;
      context.lineWidth = (active ? 2 : 1) / view.zoom;
      context.stroke(path);
    };
    for (const [index, region] of a.regions.entries()) {
      const box = region.bounds, top = pageToScreen(view, box);
      const x0 = Math.max(0,top.x), y0 = Math.max(0,top.y);
      const x1 = Math.min(view.vw, top.x + box.width * view.zoom), y1 = Math.min(view.vh, top.y + box.height * view.zoom);
      if (x1 <= x0 || y1 <= y0) continue;
      let path = paths.get(region);
      if (!path) { path = new Path2D(); tracePath(path, region.path); paths.set(region, path); }
      const active = selected.has(index);
      if (active) {
        context.save(); context.clip(path, "evenodd"); context.setTransform(screen);
        const hatch = new Path2D(), gap = 6 * Math.SQRT2;
        for (let sum = Math.floor((x0+y0)/gap)*gap; sum <= x1+y1; sum += gap) {
          hatch.moveTo(sum-y0,y0); hatch.lineTo(sum-y1,y1);
        }
        context.lineWidth = 3; context.strokeStyle = "rgba(255,255,255,.78)"; context.stroke(hatch);
        context.lineWidth = 1.25; context.strokeStyle = this.#remove ? "#f24822" : accent; context.stroke(hatch);
        context.restore();
      }
      edges(path, active);
    }
    context.restore();
  }
}
