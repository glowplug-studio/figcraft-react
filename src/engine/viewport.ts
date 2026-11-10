import { transformBounds } from "./affine";
import { isFrameLike, pageOf, type Document, type NodeId } from "./document";
import { worldTransform } from "./hierarchy";
import { isDivider } from "./pages";
import { parseBoolean, parseNumber } from "./parameters";
import type { Point, Rectangle } from "./geometry";

export interface Viewport { readonly cx: number; readonly cy: number; readonly zoom: number; readonly vw: number; readonly vh: number; readonly slices?: boolean; readonly layoutGrids?: boolean; readonly snapObjects?: boolean; readonly snapPixel?: boolean; readonly proofSrgb?: boolean }
export const defaultViewport: Viewport = Object.freeze({ cx: 0, cy: 0, zoom: 1, vw: 1200, vh: 800 });
export const minimumZoom = 0.02, maximumZoom = 256;
const steps = [0.02, 0.03, 0.06, 0.13, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256];
export const viewSpecs = Object.freeze({
  "view.proofSrgb": { label: "Soft-proof sRGB", undo: false },
  "view.slices": { label:"Slices", undo:false },
  "view.layoutGrids": { label:"Layout grids", undo:false },
  "view.snapObjects": { label: "Snap to objects", undo: false }, "view.snapPixel": { label: "Snap to pixel grid", undo: false },
  "view.zoomIn": { label: "Zoom in", undo: false }, "view.zoomOut": { label: "Zoom out", undo: false },
  "view.zoom100": { label: "Zoom to 100%", undo: false }, "view.zoom50": { label: "Zoom to 50%", undo: false },
  "view.zoom200": { label: "Zoom to 200%", undo: false }, "view.zoomFit": { label: "Zoom to fit", undo: false },
  "view.zoomSelection": { label: "Zoom to selection", undo: false }, "view.zoomAt": { label: "Zoom tool", undo: false },
  "view.set": { label: "Set view", undo: false }, "view.get": { label: "Get view", undo: false },
  "view.pan": { label: "Pan the view", undo: false }, "view.nextFrame": { label: "Zoom to next frame", undo: false },
  "view.prevFrame": { label: "Zoom to previous frame", undo: false }, "view.nextPage": { label: "Next page", undo: false },
  "view.prevPage": { label: "Previous page", undo: false },
});
export function viewOrigin(view: Viewport): Point { return { x: view.cx - view.vw / (2 * view.zoom), y: view.cy - view.vh / (2 * view.zoom) }; }
export function pageToScreen(view: Viewport, point: Point): Point { const origin = viewOrigin(view); return { x: (point.x - origin.x) * view.zoom, y: (point.y - origin.y) * view.zoom }; }
export function screenToPage(view: Viewport, point: Point): Point { const origin = viewOrigin(view); return { x: origin.x + point.x / view.zoom, y: origin.y + point.y / view.zoom }; }
export function zoomAt(view: Viewport, zoom: number, anchor: Point): Viewport {
  const z = Number.isFinite(zoom) ? Math.max(minimumZoom, Math.min(maximumZoom, zoom)) : view.zoom;
  if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return view;
  return Object.freeze({ ...view, zoom: z, cx: anchor.x + (view.cx - anchor.x) * view.zoom / z, cy: anchor.y + (view.cy - anchor.y) * view.zoom / z });
}
export function scrollView(view: Viewport, dx: number, dy: number, shift = false): Viewport {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return view;
  if (shift && dx === 0) { dx = dy; dy = 0; }
  return Object.freeze({ ...view, cx: view.cx - dx / view.zoom, cy: view.cy - dy / view.zoom });
}
export function fitView(view: Viewport, box: Rectangle, maxZoom = maximumZoom): Viewport {
  const zoom = box.width > 0 || box.height > 0
    ? Math.max(minimumZoom, Math.min(maxZoom, Math.max(50, view.vw - 128) / Math.max(1e-6, box.width), Math.max(50, view.vh - 128) / Math.max(1e-6, box.height))) : view.zoom;
  return Object.freeze({ ...view, zoom, cx: box.x + box.width / 2, cy: box.y + box.height / 2 });
}
export function boundsOf(document: Document, ids: readonly NodeId[]): Rectangle | undefined {
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const id of ids) {
    const node = document.nodes[id];
    if (!node) continue;
    const box = node.kind === "page" ? boundsOf(document, node.children) : transformBounds(worldTransform(document, id), node.width, node.height);
    if (!box) continue;
    x = Math.min(x, box.x); y = Math.min(y, box.y); right = Math.max(right, box.x + box.width); bottom = Math.max(bottom, box.y + box.height);
  }
  return x === Infinity ? undefined : { x, y, width: right - x, height: bottom - y };
}
export function fitPage(view: Viewport, document: Document): Viewport {
  const bounds = boundsOf(document, pageOf(document).children);
  return bounds ? fitView(view, bounds, 1) : Object.freeze({ ...view, zoom: 1, cx: view.vw / 2 - 100, cy: view.vh / 2 - 100 });
}
function optionalNumber(value: unknown): number | undefined { try { return parseNumber(value); } catch { return undefined; } }
function step(zoom: number, up: boolean): number { return up ? steps.find(value => value > zoom * 1.001) ?? maximumZoom : [...steps].reverse().find(value => value < zoom * 0.999) ?? minimumZoom; }

export function executeView(command: string, previous: Viewport, document: Document, selection: readonly NodeId[], params: Record<string, unknown>) {
  if (!Object.hasOwn(viewSpecs, command)) throw new Error(`Unsupported view command: ${command}`);
  const toggle = command === "view.slices" || command === "view.layoutGrids" || command === "view.snapObjects" || command === "view.snapPixel" || command === "view.proofSrgb";
  const allowed = toggle ? ["on"] : command === "view.set" ? ["zoom", "cx", "cy", "vw", "vh"] : command === "view.zoomAt" ? ["x", "y", "out", "width", "height"] : command === "view.pan" ? ["dx", "dy", "big"] : [];
  for (const key of Object.keys(params)) if (!allowed.includes(key)) throw new Error(`Unsupported ${command} parameter: ${key}`);
  let view = previous, current = document, selected = selection, result: Record<string, unknown> = {};
  if (toggle) {
    const key = command === "view.slices" ? "slices" : command === "view.layoutGrids" ? "layoutGrids" : command === "view.snapObjects" ? "snapObjects" : command === "view.snapPixel" ? "snapPixel" : "proofSrgb";
    const on = parseBoolean(params.on) ?? !(view[key] ?? (key !== "proofSrgb"));
    view = Object.freeze({ ...view, [key]: on }); result = { on };
  } else if (command === "view.set") {
    const values = Object.fromEntries(allowed.map(key => [key, optionalNumber(params[key])])) as Partial<Viewport>;
    view = Object.freeze({ ...view, cx: values.cx ?? view.cx, cy: values.cy ?? view.cy, zoom: Math.max(minimumZoom, Math.min(maximumZoom, values.zoom ?? view.zoom)),
      vw: Math.max(10, Math.min(20000, values.vw ?? view.vw)), vh: Math.max(10, Math.min(20000, values.vh ?? view.vh)) });
    result = { ...view };
  } else if (command === "view.get") result = { ...view };
  else if (command === "view.pan") {
    const amount = parseBoolean(params.big) === true ? 200 : 20;
    const dx = Math.max(-100, Math.min(100, optionalNumber(params.dx) ?? 0)) * amount;
    const dy = Math.max(-100, Math.min(100, optionalNumber(params.dy) ?? 0)) * amount;
    view = scrollView(view, -dx, -dy); result = { cx: view.cx, cy: view.cy };
  } else if (command === "view.zoomAt") {
    const x = optionalNumber(params.x), y = optionalNumber(params.y), width = optionalNumber(params.width), height = optionalNumber(params.height);
    if (x === undefined || y === undefined) throw new Error("view.zoomAt requires finite page x and y");
    view = width !== undefined && height !== undefined && width > 0 && height > 0
      ? fitView(view, { x, y, width, height }) : zoomAt(view, step(view.zoom, parseBoolean(params.out) !== true), { x, y });
    result = { zoom: view.zoom, cx: view.cx, cy: view.cy };
  } else if (command === "view.zoomFit" || command === "view.zoomSelection") {
    const box = boundsOf(document, command === "view.zoomFit" ? pageOf(document).children : selection);
    if (box) view = fitView(view, box);
    result = { zoom: view.zoom };
  } else if (command === "view.nextFrame" || command === "view.prevFrame") {
    const frames = pageOf(document).children.filter(id => isFrameLike(document.nodes[id])).map(id => ({ id, box: boundsOf(document, [id])! })).sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
    if (frames.length) {
      let top = selection[0];
      while (top && document.nodes[top]?.parent && document.nodes[top].parent !== document.currentPage) top = document.nodes[top].parent!;
      const index = frames.findIndex(frame => frame.id === top), direction = command === "view.nextFrame" ? 1 : -1;
      const next = frames[index < 0 ? 0 : (index + direction + frames.length) % frames.length];
      selected = Object.freeze([next.id]); view = fitView(view, next.box); result = { frame: next.id };
    } else result = { ok: true };
  } else if (command === "view.nextPage" || command === "view.prevPage") {
    const direction = command === "view.nextPage" ? 1 : -1;
    for (let at = document.pages.indexOf(document.currentPage) + direction; at >= 0 && at < document.pages.length; at += direction) {
      const page = document.nodes[document.pages[at]];
      if (page.kind === "page" && !isDivider(document, page.id)) { current = Object.freeze({ ...document, currentPage: page.id }); break; }
    }
    selected = Object.freeze([]); view = fitPage(view, current); result = { page: current.currentPage };
  } else {
    const zoom = command === "view.zoomIn" || command === "view.zoomOut" ? step(view.zoom, command === "view.zoomIn") : command === "view.zoom50" ? 0.5 : command === "view.zoom200" ? 2 : 1;
    view = zoomAt(view, zoom, { x: view.cx, y: view.cy }); result = { zoom: view.zoom };
  }
  return { view, document: current, selection: selected, result };
}
