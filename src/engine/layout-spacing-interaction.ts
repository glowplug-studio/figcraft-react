import { containsPoint } from "./canvas-selection";
import type { Document } from "./document";
import type { EditorEngine } from "./editor";
import type { Point } from "./geometry";
import { layoutZones, type LayoutZone } from "./layout-zones";
import type { Viewport } from "./viewport";

const pink = "#f2488c";
const sides = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"] as const;

export class LayoutSpacingInteraction {
  #pointer?: Point;
  #drag?: {id: string; zone: LayoutZone; origin: Point; padding: number[]};
  #cache?: {doc: Document; view: Viewport; id: string; zones: ReturnType<typeof layoutZones>};
  constructor(private engine: EditorEngine) {}
  get active() { return Boolean(this.#drag); }
  #zones() {
    const {tool, editable, paintPicker, crop} = this.engine.getSnapshot();
    if (tool !== "move" || !editable || paintPicker || crop || this.engine.currentTextEdit() || this.engine.getVectorEdit() ||
        (this.engine.interacting && !this.#drag)) return;
    const doc = this.engine.getRenderDocument(), selection = this.engine.getRenderSelection();
    const frame = selection.length === 1 ? doc.nodes[selection[0]] : undefined;
    if (frame?.kind !== "frame" || !frame.layout) { this.#cache = undefined; return; }
    const view = this.engine.getView();
    if (!this.#cache || this.#cache.id !== frame.id || this.#cache.doc !== doc || this.#cache.view !== view)
      this.#cache = {doc, view, id:frame.id, zones:layoutZones(doc,frame,view)};
    return this.#cache.zones;
  }
  #zone(at: Point) {
    const zones = this.#zones();
    return zones?.bands.find(z=>containsPoint(z.rect,at)) ?? zones?.gaps.find(z=>containsPoint(z.rect,at));
  }
  hover(at?: Point) {
    this.#pointer = at;
    const zone = at && this.#zone(at);
    return zone ? zone.vertical ? "ns-resize" : "ew-resize" : undefined;
  }
  down(at: Point): boolean {
    const zone = this.#zone(at);
    const {document,selection} = this.engine.getSnapshot(), frame = document.nodes[selection[0]];
    if (!zone || frame?.kind !== "frame" || !frame.layout) return false;
    this.engine.beginInteraction();
    this.#drag = {id:frame.id, zone, origin:at, padding:[...frame.layout.padding]};
    this.#pointer = at;
    return true;
  }
  move(at: Point, paired: boolean) {
    const drag = this.#drag;
    if (!drag) return;
    if (!this.engine.interacting) { this.#drag = undefined; return; }
    this.#pointer = at;
    const {zone} = drag, key = zone.key;
    let delta = zone.vertical ? at.y-drag.origin.y : at.x-drag.origin.x;
    if (key === "paddingRight" || key === "paddingBottom") delta = -delta;
    const value = Math.max(0,Math.round(zone.value+delta/this.engine.getView().zoom));
    if (key === "gap" || key === "crossGap") {
      const frame = this.engine.getSnapshot().document.nodes[drag.id];
      if (frame.kind !== "frame" || !frame.layout) return;
      const props: Record<string,unknown> = {[key]: value};
      if (key === "gap" && frame.layout.mode !== "grid" && frame.layout.mainAlign.startsWith("space")) props.mainAlign = "min";
      if (key === "crossGap" && frame.layout.contentAlign === "spaceBetween") props.contentAlign = "auto";
      this.engine.previewProperties(drag.id,props);
    } else {
      const index = sides.indexOf(key);
      drag.padding[index] = value;
      if (paired) drag.padding[(index+2)%4] = value;
      this.engine.previewProperties(drag.id,{padding:[...drag.padding]});
    }
  }
  up() { if (this.#drag) this.engine.commitInteraction(); this.#drag = undefined; }
  cancel() { if (this.#drag) this.engine.cancelInteraction(); this.#drag = undefined; }
  draw(ctx: CanvasRenderingContext2D) {
    const zones = this.#zones();
    if (!zones) return;
    ctx.save(); ctx.strokeStyle = pink; ctx.lineWidth = 1; ctx.globalAlpha = .6;
    ctx.setLineDash([3,3]); ctx.beginPath();
    for (const [a,b] of zones.tracks) { ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); }
    ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    const drawBand = (zone: LayoutZone, isGap: boolean) => {
      if (zone.key !== this.#drag?.zone.key && (!this.#pointer || !containsPoint(zone.rect,this.#pointer))) return;
      const {x,y,width,height} = zone.rect, cx = x+width/2, cy = y+height/2;
      ctx.fillStyle = pink; ctx.globalAlpha = isGap ? .3 : .25; ctx.fillRect(x,y,width,height); ctx.globalAlpha = 1;
      if (isGap) { ctx.beginPath(); ctx.moveTo(cx-3,cy); ctx.lineTo(cx+3,cy); ctx.stroke(); }
      const text = String(Math.round(zone.value*100)/100);
      ctx.font = "600 10px sans-serif"; const w = ctx.measureText(text).width+8;
      ctx.beginPath(); ctx.roundRect(cx-w/2,cy-8,w,16,3); ctx.fill();
      ctx.fillStyle = "#ffffff"; ctx.textBaseline = "middle"; ctx.textAlign = "center"; ctx.fillText(text,cx,cy);
    };
    for (const zone of zones.bands) drawBand(zone,false);
    for (const zone of zones.gaps) drawBand(zone,true);
    ctx.restore();
  }
}
