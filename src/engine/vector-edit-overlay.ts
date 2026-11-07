import { canvasAccent } from "./canvas-colours";
import type { Document } from "./document";
import { vectorEditOverlay, type VectorEditState } from "./vector-edit";
import type { VectorInteraction } from "./vector-interaction";
import { pageToScreen, type Viewport } from "./viewport";
import { drawGuides } from "./measurements";

/** Native edit overlays: inactive layers below the active layer, with screen-sized controls. */
export function drawVectorEdit(context: CanvasRenderingContext2D, document: Document, state: VectorEditState, view: Viewport, interaction: VectorInteraction["overlay"]): void {
  const accent = canvasAccent(document), screen = (p: readonly number[]) => pageToScreen(view, { x: p[0], y: p[1] });
  context.save(); context.strokeStyle = accent;
  if (interaction.box) {
    const points = interaction.box.map(p => pageToScreen(view, p)); context.lineWidth = 1;
    context.beginPath(); context.moveTo(points[0].x, points[0].y);
    for (const p of points.slice(1)) context.lineTo(p.x, p.y);
    context.closePath(); context.stroke();
  }
  for (const part of [...state.others.map(p => ({ ...state, ...p, handles: [], regions: [], regionVertices: [] })), state]) {
    const overlay = vectorEditOverlay(document, part); if (!overlay) continue;
    const hover = interaction.hover?.id === part.id ? interaction.hover.hit : undefined;
    const selectedSegments = new Set(overlay.selectedSegments), selectedVertices = new Set(overlay.selectedVertices);
    overlay.segments.forEach((c, i) => {
      const [a, b, d, e] = c.map(screen); context.lineWidth = selectedSegments.has(i) ? 3 : hover?.kind === "segment" && hover.seg === i ? 2.5 : 1.5;
      context.beginPath(); context.moveTo(a.x, a.y); context.bezierCurveTo(b.x, b.y, d.x, d.y, e.x, e.y); context.stroke();
    });
    context.lineWidth = 1;
    for (const h of overlay.handles) {
      const v = screen(h.vertex), p = screen(h.handle), on = overlay.selectedHandles.some(x => x[0] === h.seg && x[1] === h.start);
      const radius = hover?.kind === "handle" && hover.seg === h.seg && hover.start === h.start ? 4.5 : 3.5;
      context.beginPath(); context.moveTo(v.x, v.y); context.lineTo(p.x, p.y); context.stroke();
      context.fillStyle = on ? accent : "white"; context.beginPath(); context.arc(p.x, p.y, radius, 0, Math.PI * 2); context.fill(); context.stroke();
    }
    overlay.vertices.forEach((v, i) => {
      const p = screen(v), size = hover?.kind === "vertex" && hover.index === i ? 9 : 7;
      context.fillStyle = selectedVertices.has(i) ? accent : "white";
      context.beginPath(); context.roundRect(p.x - size / 2, p.y - size / 2, size, size, 5); context.fill(); context.stroke();
    });
  }
  if (interaction.add) {
    const { point, on } = interaction.add, p = pageToScreen(view, point);
    context.fillStyle = on ? accent : "#ffffffbe"; context.strokeStyle = on ? "white" : accent; context.lineWidth = 1.2;
    context.beginPath(); context.arc(p.x, p.y, on ? 5.5 : 3.5, 0, Math.PI * 2); context.fill(); context.stroke();
  }
  if (interaction.rubber) {
    const [from, to] = interaction.rubber.map(p => pageToScreen(view, p));
    context.strokeStyle = accent; context.lineWidth = 1; context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y); context.stroke();
  }
  if (interaction.marquee) {
    const r = interaction.marquee, p = pageToScreen(view, r); context.fillStyle = `${accent}1a`; context.strokeStyle = accent; context.lineWidth = 1;
    context.fillRect(p.x, p.y, r.width * view.zoom, r.height * view.zoom); context.strokeRect(p.x, p.y, r.width * view.zoom, r.height * view.zoom);
  }
  context.restore();
  drawGuides(context, interaction.guides, view);
}
