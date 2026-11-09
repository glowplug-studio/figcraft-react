import { inverse, transformPoint } from "./affine";
import { canvasAccent } from "./canvas-colours";
import type { EditorEngine } from "./editor";
import type { Point } from "./geometry";
import { worldTransform } from "./hierarchy";
import { pageToScreen, screenToPage } from "./viewport";

export class BlurInteraction {
  #drag?: { endpoint: "start" | "end"; index: number; id: string; gesture: NonNullable<ReturnType<EditorEngine["beginEffectPreview"]>> };
  constructor(private engine: EditorEngine) {}
  get active() { return !!this.#drag; }

  private target() {
    const engine = this.engine, ids = engine.getRenderSelection(), open = engine.getSnapshot().openEffects;
    if (!open?.length || ids.length !== 1 || engine.pickedGradient()) return;
    const doc = engine.getRenderDocument(), node = doc.nodes[ids[0]];
    if (!node || node.kind === "page") return;
    const stack = node.effects ?? [];
    const index = stack.findIndex((e,i) => e.visible && (e.type === "layerBlur" || e.type === "backgroundBlur") &&
      e.blurType === "progressive" && open.includes(i));
    const effect = stack[index];
    if (effect?.type !== "layerBlur" && effect?.type !== "backgroundBlur") return;
    const matrix = worldTransform(doc,node.id), view = engine.getView();
    const limit = (v: number) => Math.max(-1000, Math.min(1000, v));
    const screen = ([x,y]: readonly [number, number]) => pageToScreen(view, transformPoint(matrix,
      {x: limit(x) * node.width, y: limit(y) * node.height}));
    return {node, index, effect, matrix, start: screen(effect.start), end: screen(effect.end)};
  }

  private hit(point: Point) {
    const target = this.target();
    if (!target) return;
    for (const endpoint of ["start", "end"] as const) {
      const p = target[endpoint];
      if (Math.hypot(p.x - point.x, p.y - point.y) <= 8) return {target, endpoint};
    }
  }
  cursor(point: Point) { return this.hit(point) ? "grab" : undefined; }
  down(point: Point) {
    const hit = this.hit(point);
    if (!hit) return false;
    const gesture = this.engine.beginEffectPreview(hit.target.index);
    if (!gesture) return false;
    this.#drag = {endpoint: hit.endpoint, id: hit.target.node.id, index: hit.target.index, gesture};
    return true;
  }
  move(point: Point) {
    const drag = this.#drag, target = this.target();
    if (!drag || !target || target.node.id !== drag.id || target.index !== drag.index) return;
    const p = transformPoint(inverse(target.matrix), screenToPage(this.engine.getView(), point));
    drag.gesture.preview({...target.effect, [drag.endpoint]: [p.x / Math.max(1e-9,target.node.width),
      p.y / Math.max(1e-9,target.node.height)]});
  }
  up() { this.#drag?.gesture.commit(); this.#drag = undefined; }
  cancel() { this.#drag?.gesture.cancel(); this.#drag = undefined; }
  draw(ctx: CanvasRenderingContext2D) {
    const target = this.target();
    if (!target) return;
    const accent = canvasAccent(this.engine.getRenderDocument()), {start, end} = target;
    ctx.save(); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.moveTo(start.x,start.y); ctx.lineTo(end.x,end.y);
    ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,.47)"; ctx.lineWidth = 1; ctx.stroke();
    for (const p of [start,end]) {
      ctx.beginPath(); ctx.arc(p.x,p.y,5,0,2*Math.PI);
      ctx.fillStyle = p === start ? "white" : accent; ctx.fill();
      ctx.strokeStyle = p === start ? accent : "white"; ctx.lineWidth = 1.5; ctx.stroke();
    }
    ctx.restore();
  }
}
