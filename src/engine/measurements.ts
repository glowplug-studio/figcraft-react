import { isLeaf } from "./document";
import type { Document, NodeId } from "./document";
import type { Point, Rectangle } from "./geometry";
import { boundsOf, pageToScreen, type Viewport } from "./viewport";
import { distanceLabel, type Guide } from "./snapping";

/** Native distance::neighbours: nearest facing siblings, then containing parent edges. */
export function neighbourGuides(document: Document, moving: readonly NodeId[]): Guide[] {
  const a = boundsOf(document, moving); if (!a) return [];
  const parentId = document.nodes[moving[0]]?.parent ?? document.currentPage, parent = document.nodes[parentId];
  if (!parent || isLeaf(parent)) return [];
  const boxes = parent.children.filter(id => { const n = document.nodes[id]; return !moving.includes(id) && n && n.kind !== "page" && n.visible !== false; })
    .slice(0, 512).map(id => boundsOf(document, [id])).filter((b): b is Rectangle => Boolean(b));
  const frame = parentId === document.currentPage ? undefined : boundsOf(document, [parentId]);
  const containing = frame && frame.x <= a.x + 1e-6 && frame.y <= a.y + 1e-6 && frame.x + frame.width >= a.x + a.width - 1e-6 && frame.y + frame.height >= a.y + a.height - 1e-6;
  const mid = (lo: number, hi: number, b0: number, b1: number): number | undefined => Math.max(lo, b0) <= Math.min(hi, b1) ? (Math.max(lo, b0) + Math.min(hi, b1)) / 2 : undefined;
  const out: Guide[] = [];
  for (let side = 0; side < 4; side++) {
    let best: { edge: number; mid: number; distance: number } | undefined;
    for (const b of boxes) {
      const edge = side === 0 ? b.x + b.width : side === 1 ? b.x : side === 2 ? b.y + b.height : b.y;
      const middle = side < 2 ? mid(a.y, a.y + a.height, b.y, b.y + b.height) : mid(a.x, a.x + a.width, b.x, b.x + b.width);
      const distance = side === 0 ? a.x - edge : side === 1 ? edge - a.x - a.width : side === 2 ? a.y - edge : edge - a.y - a.height;
      if (middle !== undefined && distance >= -1e-6 && (!best || distance < best.distance)) best = { edge, mid: middle, distance };
    }
    if (!best && containing && frame) best = { edge: side === 0 ? frame.x : side === 1 ? frame.x + frame.width : side === 2 ? frame.y : frame.y + frame.height, mid: side < 2 ? a.y + a.height / 2 : a.x + a.width / 2, distance: 0 };
    if (!best) continue;
    const { edge, mid: m } = best;
    const g = side === 0 ? { x0: edge, y0: m, x1: a.x, y1: m } : side === 1 ? { x0: a.x + a.width, y0: m, x1: edge, y1: m } : side === 2 ? { x0: m, y0: edge, x1: m, y1: a.y } : { x0: m, y0: a.y + a.height, x1: m, y1: edge };
    const length = Math.hypot(g.x1 - g.x0, g.y1 - g.y0);
    if (length > 1e-6 && Number.isFinite(length)) out.push({ ...g, label: distanceLabel(length) });
  }
  return out;
}
export function placeGuideLabels(lines: readonly { a: Point; b: Point; width: number; height: number }[], avoid: readonly Rectangle[] = []): Rectangle[] {
  const placed = [...avoid];
  for (const { a, b, width, height } of lines) {
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dx = b.x - a.x, dy = b.y - a.y, horizontal = Math.abs(dx) >= Math.abs(dy);
    const along = horizontal ? width : height, across = horizontal ? height : width, room = (Math.hypot(dx, dy) - along) / 2 - 4;
    const centres: Point[] = [];
    if (room >= 0) {
      centres.push(middle);
      for (let n = 1; n * (along + 4) <= room && centres.length < 32; n++) for (const sign of [1, -1]) centres.push({ x: middle.x + (horizontal ? sign * n * (along + 4) : 0), y: middle.y + (horizontal ? 0 : sign * n * (along + 4)) });
    }
    for (let n = 0; n < 32; n++) for (const sign of [1, -1]) {
      const off = sign * (across / 2 + 4 + n * (across + 4)); centres.push({ x: middle.x + (horizontal ? 0 : off), y: middle.y + (horizontal ? off : 0) });
    }
    const free = (r: Rectangle) => !placed.some(p => p.x - 2 <= r.x + r.width && p.x + p.width + 2 >= r.x && p.y - 2 <= r.y + r.height && p.y + p.height + 2 >= r.y);
    const box = centres.map(p => ({ x: p.x - width / 2, y: p.y - height / 2, width, height })).find(free)
      ?? { x: middle.x - width / 2, y: placed.reduce((y, p) => Math.max(y, p.y + p.height), middle.y) + 4, width, height };
    placed.push(box);
  }
  return placed.slice(avoid.length);
}
export function drawGuides(context: CanvasRenderingContext2D, guides: readonly Guide[], view: Viewport): void {
  context.save(); context.strokeStyle = context.fillStyle = "#f24822"; context.lineWidth = 1; context.font = "600 10px sans-serif";
  const labels: { a: Point; b: Point; width: number; height: number; text: string }[] = [];
  for (const g of guides) {
    const a = pageToScreen(view, { x: g.x0, y: g.y0 }), b = pageToScreen(view, { x: g.x1, y: g.y1 });
    context.setLineDash(g.dashed ? [3, 2] : []); context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
    if (g.label !== undefined) labels.push({ a, b, width: context.measureText(g.label).width + 8, height: 14, text: g.label });
  }
  context.setLineDash([]);
  const boxes = placeGuideLabels(labels);
  labels.forEach((label, i) => { const box = boxes[i]; context.fillStyle = "#f24822"; context.beginPath(); context.roundRect(box.x, box.y, box.width, box.height, 3); context.fill(); context.fillStyle = "white"; context.textBaseline = "top"; context.fillText(label.text, box.x + 4, box.y + 2); });
  context.restore();
}
