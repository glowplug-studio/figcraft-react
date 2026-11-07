import { canvasAccent } from "./canvas-colours";
import type { Document } from "./document";
import { drawGuides } from "./measurements";
import type { PenInteraction } from "./pen-interaction";
import { pageToScreen, type Viewport } from "./viewport";

export function drawPen(context: CanvasRenderingContext2D, document: Document, view: Viewport, overlay: PenInteraction["overlay"]): void {
  const accent = canvasAccent(document), screen = (p: { x: number; y: number }) => pageToScreen(view, p);
  context.save(); context.strokeStyle = accent; context.lineWidth = 1; context.fillStyle = "white";
  for (const [from, to] of overlay.handles) {
    const a = screen(from), b = screen(to); context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
    context.beginPath(); context.arc(b.x, b.y, 3.5, 0, Math.PI * 2); context.fill(); context.stroke();
  }
  for (const point of overlay.points) { const p = screen(point); context.beginPath(); context.arc(p.x, p.y, 3.5, 0, Math.PI * 2); context.fill(); context.stroke(); }
  if (overlay.rubber) {
    const [a, b] = overlay.rubber.map(screen); context.beginPath(); context.moveTo(a.x, a.y);
    if (overlay.rubberHandle) { const h = screen(overlay.rubberHandle); context.bezierCurveTo(h.x, h.y, b.x, b.y, b.x, b.y); }
    else context.lineTo(b.x, b.y);
    context.stroke();
  }
  context.restore(); drawGuides(context, overlay.guides, view);
}
