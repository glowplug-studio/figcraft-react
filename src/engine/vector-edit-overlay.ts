import { transformPoint } from "./affine";
import { flattenContours } from "./corners";
import type { Point } from "./geometry";
import { worldTransform } from "./hierarchy";
import { canvasAccent } from "./canvas-colours";
import type { Document } from "./document";
import { vectorEditOverlay, type VectorEditState } from "./vector-edit";
import type { VectorInteraction } from "./vector-interaction";
import { pageToScreen, type Viewport } from "./viewport";
import { mapVectorPath, regionHatch } from "./vector-region-selection";
import { widthHandles } from "./vector-width";
import { drawGuides } from "./measurements";

/** Native screen-space hatch, clipped to the even-odd interior of all loops. */
function drawPaintTarget(context: CanvasRenderingContext2D, contours: readonly (readonly Point[])[], accent: string): void {
  const outline = new Path2D(), stripes = new Path2D();
  let low = Infinity, high = -Infinity;
  const edges: { x: number; y: number; endX: number; endY: number }[] = [];
  const rotate = (p: Point) => ({ x: (p.x + p.y) * Math.SQRT1_2, y: (p.y - p.x) * Math.SQRT1_2 });
  for (const contour of contours) {
    if (!contour.length) continue;
    outline.moveTo(contour[0].x, contour[0].y);
    let previous = rotate(contour[contour.length - 1]);
    for (const point of contour) {
      outline.lineTo(point.x, point.y);
      const end = rotate(point);
      low = Math.min(low, end.y); high = Math.max(high, end.y);
      edges.push({ ...previous, endX: end.x, endY: end.y });
      previous = end;
    }
    outline.closePath();
  }
  const lines = Math.ceil((high - low) / 6);
  if (lines <= 4000) for (let i = 0; i < lines; i++) {
    const y = (Math.ceil(low / 6) + i) * 6;
    const crossings = edges.filter(e => (e.y <= y && y < e.endY) || (e.endY <= y && y < e.y))
      .map(e => e.x + (y - e.y) * (e.endX - e.x) / (e.endY - e.y)).sort((a, b) => a - b);
    for (let j = 1; j < crossings.length; j += 2) {
      const a = crossings[j - 1], b = crossings[j];
      stripes.moveTo((a - y) * Math.SQRT1_2, (a + y) * Math.SQRT1_2);
      stripes.lineTo((b - y) * Math.SQRT1_2, (b + y) * Math.SQRT1_2);
    }
  }
  context.save();
  for (const [path, halo, width] of [[stripes, 3, 1.25], [outline, 4, 2]] as const) {
    context.strokeStyle = "#ffffffc8"; context.lineWidth = halo; context.stroke(path);
    context.strokeStyle = accent; context.lineWidth = width; context.stroke(path);
  }
  context.restore();
}

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
    if (part.id === state.id && (state.regions.length || interaction.regionHover !== undefined)) {
      const origin = pageToScreen(view, { x: 0, y: 0 });
      const regions = interaction.regionHover === undefined ? state.regions : [...state.regions, interaction.regionHover];
      const lines = regionHatch(document, state.id, regions, [view.zoom, 0, 0, view.zoom, origin.x, origin.y], { x: 0, y: 0, width: view.vw, height: view.vh });
      context.beginPath(); context.lineWidth = 1.4;
      for (const [a, b] of lines) { context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); }
      context.stroke();
    }
    if (state.tool === "paint" && interaction.paintHover?.id === part.id && state.id === part.id) {
      const world = worldTransform(document, part.id);
      const screenPath = mapVectorPath(interaction.paintHover.face.path, p => pageToScreen(view, transformPoint(world, p)));
      drawPaintTarget(context, flattenContours(screenPath, .25), accent);
    }
    const hover = interaction.hover?.id === part.id ? interaction.hover.hit : undefined;
    const selectedSegments = new Set(overlay.selectedSegments), selectedVertices = new Set(overlay.selectedVertices);
    overlay.segments.forEach((c, i) => {
      const [a, b, d, e] = c.map(screen); context.lineWidth = selectedSegments.has(i) ? 3 : hover?.kind === "segment" && hover.seg === i ? 2.5 : 1.5;
      context.beginPath(); context.moveTo(a.x, a.y); context.bezierCurveTo(b.x, b.y, d.x, d.y, e.x, e.y); context.stroke();
    });
    if (state.tool === "width") continue;
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
  if (state.tool === "width") {
    const hover = interaction.widthHover;
    const handles = widthHandles(document, state.id, view.zoom);
    if (hover?.kind === "path") handles.push(...widthHandles(document, state.id, view.zoom, hover.t));
    for (const handle of handles) {
      const centre = screen(handle.at), [right, left] = handle.sides.map(screen);
      const colour = handle.index < 0 ? accent + "80" : accent;
      context.beginPath(); context.moveTo(right.x, right.y); context.lineTo(left.x, left.y);
      context.strokeStyle = "#ffffffa0"; context.lineWidth = 3; context.stroke();
      context.strokeStyle = colour; context.lineWidth = 1; context.stroke();
      const circle = (point: typeof centre, radius: number, selected: boolean) => {
        context.fillStyle = selected ? accent : "white";
        context.beginPath(); context.arc(point.x, point.y, radius, 0, Math.PI * 2); context.fill(); context.stroke();
      };
      const side = hover?.kind === "handle" && hover.index === handle.index ? hover.side : undefined;
      circle(right, side === "right" ? 4.5 : 3.5, false);
      circle(left, side === "left" ? 4.5 : 3.5, false);
      circle(centre, hover?.kind === "point" && hover.index === handle.index ? 5 : 4, state.widthPoint === handle.index);
    }
  }
  if (interaction.add) {
    const { point, on } = interaction.add, p = pageToScreen(view, point);
    context.fillStyle = on ? accent : "#ffffffbe"; context.strokeStyle = on ? "white" : accent; context.lineWidth = 1.2;
    context.beginPath(); context.arc(p.x, p.y, on ? 5.5 : 3.5, 0, Math.PI * 2); context.fill(); context.stroke();
  }
  if (interaction.rubber) {
    const [from, to] = interaction.rubber.map(p => pageToScreen(view, p));
    context.strokeStyle = accent; context.lineWidth = 1; context.setLineDash([4, 3]); context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y); context.stroke(); context.setLineDash([]);
  }
  if (interaction.marquee) {
    const r = interaction.marquee, p = pageToScreen(view, r); context.fillStyle = `${accent}1a`; context.strokeStyle = accent; context.lineWidth = 1;
    context.fillRect(p.x, p.y, r.width * view.zoom, r.height * view.zoom); context.strokeRect(p.x, p.y, r.width * view.zoom, r.height * view.zoom);
  }
  context.restore();
  drawGuides(context, interaction.guides, view);
}
