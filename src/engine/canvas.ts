import { pageOf, pageColour, rectanglePaints, rectangleTransform, type Document, type RectangleNode, type LayerNode } from "./document";
import { renderColour } from "./colour";
import { EditorEngine } from "./editor";
import { drawnRectangle, type Point, type Rectangle } from "./geometry";
import { multiply, transformBounds, type Affine } from "./affine";
import { hitRectangle } from "./selection";
import { worldTransform } from "./hierarchy";

const compositeSurfaces = new WeakMap<CanvasRenderingContext2D, HTMLCanvasElement>();
// Immutable document snapshots invalidate these derived bounds after any edit.
const groupBounds = new WeakMap<Document, Map<string, { matrix: readonly number[]; bounds: Rectangle | undefined }>>();
const opacity = (value: number) => Math.max(0, Math.min(1, value));

function paintRectangle(context: CanvasRenderingContext2D, node: RectangleNode, alpha = 1): void {
  context.save();
  if (node.transform) context.transform(...node.transform);
  else context.translate(node.x, node.y);
  for (const paint of rectanglePaints(node)) {
    if (!paint.visible || paint.opacity <= 0) continue;
    context.globalAlpha = opacity(paint.opacity) * alpha;
    context.fillStyle = renderColour(paint.color);
    context.fillRect(0, 0, node.width, node.height);
  }
  context.restore();
}

/** Node opacity affects the finished stack, including antialiased edges, once. */
function paintComposite(context: CanvasRenderingContext2D, node: LayerNode, draw: (target: CanvasRenderingContext2D) => void, painted?: Rectangle): void {
  const matrix = context.getTransform();
  const bounds = painted ?? transformBounds(multiply([matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f], rectangleTransform(node)), node.width, node.height);
  const left = Math.max(0, Math.floor(bounds.x)), top = Math.max(0, Math.floor(bounds.y));
  const width = Math.min(context.canvas.width, Math.ceil(bounds.x + bounds.width)) - left;
  const height = Math.min(context.canvas.height, Math.ceil(bounds.y + bounds.height)) - top;
  if (width <= 0 || height <= 0) return;
  let surface = compositeSurfaces.get(context);
  if (!surface) {
    surface = context.canvas.ownerDocument.createElement("canvas");
    compositeSurfaces.set(context, surface);
  }
  if (surface.width < width) surface.width = width;
  if (surface.height < height) surface.height = height;
  const scratch = surface.getContext("2d");
  if (!scratch) throw new Error("Canvas compositing is unavailable");
  scratch.resetTransform(); scratch.clearRect(0, 0, width, height);
  scratch.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e - left, matrix.f - top);
  draw(scratch);
  context.save(); context.resetTransform(); context.globalAlpha = opacity(node.opacity ?? 1);
  context.drawImage(surface, 0, 0, width, height, left, top, width, height); context.restore();
}

function paintedGroupBounds(context: CanvasRenderingContext2D, document: Document, node: LayerNode): Rectangle | undefined {
  const m = context.getTransform();
  const coefficients = [m.a, m.b, m.c, m.d, m.e, m.f];
  let cachedDocument = groupBounds.get(document);
  if (!cachedDocument) { cachedDocument = new Map(); groupBounds.set(document, cachedDocument); }
  const cached = cachedDocument.get(node.id);
  if (cached && coefficients.every((value, index) => value === cached.matrix[index])) return cached.bounds;
  const pending: { node: LayerNode; parent: Affine; depth: number }[] = [{ node, parent: [m.a, m.b, m.c, m.d, m.e, m.f], depth: 0 }];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  while (pending.length) {
    const item = pending.pop()!, current = item.node;
    if (current.visible === false || (current.opacity ?? 1) <= 0 || item.depth > 256) continue;
    const matrix = multiply(item.parent, rectangleTransform(current));
    if (current.kind === "group") {
      for (const id of current.children) {
        const child = document.nodes[id];
        if (child && child.kind !== "page") pending.push({ node: child, parent: matrix, depth: item.depth + 1 });
      }
    } else {
      const bounds = transformBounds(matrix, current.width, current.height);
      x0 = Math.min(x0, bounds.x); y0 = Math.min(y0, bounds.y);
      x1 = Math.max(x1, bounds.x + bounds.width); y1 = Math.max(y1, bounds.y + bounds.height);
    }
  }
  const bounds = x0 === Infinity ? undefined : { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  cachedDocument.set(node.id, { matrix: coefficients, bounds });
  return bounds;
}

function drawLayer(context: CanvasRenderingContext2D, document: Document, node: LayerNode, depth = 0): void {
  if (node.visible === false || (node.opacity ?? 1) <= 0 || depth > 256) return;
  if (node.kind === "group") {
    const draw = (target: CanvasRenderingContext2D) => {
      target.save(); target.transform(...rectangleTransform(node));
      for (const id of node.children) {
        const child = document.nodes[id];
        if (child && child.kind !== "page") drawLayer(target, document, child, depth + 1);
      }
      target.restore();
    };
    if (opacity(node.opacity ?? 1) < 1) {
      const bounds = paintedGroupBounds(context, document, node);
      if (bounds) paintComposite(context, node, draw, bounds);
    } else draw(context);
  } else if (node.fills || node.opacity !== undefined && node.opacity !== 1) {
    if (rectanglePaints(node).length > 1 && opacity(node.opacity ?? 1) < 1) paintComposite(context, node, target => paintRectangle(target, node));
    else paintRectangle(context, node, opacity(node.opacity ?? 1));
  } else {
    context.fillStyle = node.fill;
    if (node.transform) {
      context.save(); context.transform(...node.transform); context.fillRect(0, 0, node.width, node.height); context.restore();
    } else context.fillRect(node.x, node.y, node.width, node.height);
  }
}

/** Only this module paints editable geometry; React never renders canvas layers. */
export function renderDocument(context: CanvasRenderingContext2D, document: Document, width: number, height: number, selection: readonly string[] = [], preview?: Rectangle): void {
  const page = pageOf(document);
  context.clearRect(0, 0, width, height);
  context.fillStyle = page.backgroundColor ? renderColour(pageColour(page)) : page.background;
  context.fillRect(0, 0, width, height);
  for (const id of page.children) {
    const node = document.nodes[id];
    if (!node || node.kind === "page") continue;
    if (node.kind === "rectangle") {
      const bounds = node.transform ? transformBounds(node.transform, node.width, node.height) : node;
      if (bounds.x > width || bounds.y > height || bounds.x + bounds.width < 0 || bounds.y + bounds.height < 0) continue;
    }
    drawLayer(context, document, node);
  }
  context.strokeStyle = "#0d99ff";
  context.lineWidth = 1;
  for (const id of selection) {
    const node = document.nodes[id];
    if (node && node.kind !== "page") {
      if (node.transform || node.parent !== document.currentPage) {
        // Map the outline points so stroke width remains in screen pixels under scale/skew.
        const [a, b, c, d, e, f] = worldTransform(document, id);
        context.beginPath(); context.moveTo(e, f);
        context.lineTo(a * node.width + e, b * node.width + f);
        context.lineTo(a * node.width + c * node.height + e, b * node.width + d * node.height + f);
        context.lineTo(c * node.height + e, d * node.height + f);
        context.closePath(); context.stroke();
      } else context.strokeRect(node.x, node.y, node.width, node.height);
    }
  }
  if (preview) {
    context.fillStyle = "#d9d9d9";
    context.fillRect(preview.x, preview.y, preview.width, preview.height);
    context.strokeRect(preview.x, preview.y, preview.width, preview.height);
  }
}

/** Owns transient gesture state and a demand-driven render loop, outside React. */
export class CanvasController {
  #frame = 0;
  #disposed = false;
  #start: Point | null = null;
  #last: Point | null = null;
  #preview?: Rectangle;
  #pointer: number | null = null;
  #observer: ResizeObserver;
  #unsubscribe: () => void;
  #abort = new AbortController();
  #width = 0;
  #height = 0;
  #dpr = 1;
  constructor(private canvas: HTMLCanvasElement, private engine: EditorEngine, private onError: (message: string) => void) {
    const options = { signal: this.#abort.signal };
    canvas.addEventListener("pointerdown", this.#down, options);
    canvas.addEventListener("pointermove", this.#move, options);
    canvas.addEventListener("pointerup", this.#up, options);
    canvas.addEventListener("pointercancel", this.#cancelEvent, options);
    canvas.addEventListener("lostpointercapture", this.#cancelEvent, options);
    canvas.addEventListener("keydown", this.#key, options);
    window.addEventListener("blur", this.#cancelEvent, options);
    window.addEventListener("resize", this.#resize, options);
    this.#observer = new ResizeObserver(this.#resize);
    this.#observer.observe(canvas);
    this.#unsubscribe = engine.subscribe(() => {
      if (engine.getSnapshot().tool !== "rectangle" || !engine.getSnapshot().editable) this.cancel();
      this.invalidate();
    });
    this.#resize();
  }
  #point(event: PointerEvent): Point {
    const bounds = this.canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }
  #down = (event: PointerEvent): void => {
    if (event.button !== 0 || this.#pointer !== null || !this.engine.getSnapshot().editable) return;
    this.canvas.focus();
    if (this.engine.getSnapshot().tool !== "rectangle") {
      const snapshot = this.engine.getSnapshot();
      const hit = hitRectangle(snapshot.document, this.#point(event), event.metaKey || event.ctrlKey, snapshot.selection);
      const ids = event.shiftKey ? hit === undefined ? snapshot.selection : snapshot.selection.includes(hit) ? snapshot.selection.filter(id => id !== hit) : [...snapshot.selection, hit] : hit === undefined ? [] : [hit];
      try { this.engine.execute("select.set", { ids }); }
      catch (error) { this.onError(error instanceof Error ? error.message : "Could not select layer"); }
      return;
    }
    event.preventDefault();
    this.#pointer = event.pointerId;
    this.#start = this.#point(event);
    this.#last = this.#start;
    this.canvas.setPointerCapture(event.pointerId);
  };
  #move = (event: PointerEvent): void => {
    if (event.pointerId !== this.#pointer || !this.#start) return;
    const started = performance.now();
    this.#last = this.#point(event);
    this.#preview = drawnRectangle(this.#start, this.#last, event.shiftKey, event.altKey);
    this.invalidate();
    performance.measure("figcraft:pointer", { start: started, end: performance.now() });
  };
  #up = (event: PointerEvent): void => {
    if (event.pointerId !== this.#pointer || !this.#start) return;
    const start = this.#start;
    const end = this.#point(event);
    const tiny = Math.hypot(end.x - start.x, end.y - start.y) < 3;
    const rectangle = tiny || !this.#preview
      ? drawnRectangle(start, { x: start.x + 100, y: start.y + 100 })
      : drawnRectangle(start, end, event.shiftKey, event.altKey);
    this.cancel();
    try {
      this.engine.execute("shape.rectangle", rectangle);
      this.engine.execute("tool.move");
    } catch (error) { this.onError(error instanceof Error ? error.message : "Could not create rectangle"); }
  };
  #cancelEvent = (): void => this.cancel();
  #key = (event: KeyboardEvent): void => {
    if (event.key === "Escape") { event.preventDefault(); this.cancel(); }
  };
  cancel(): void {
    const pointer = this.#pointer;
    this.#pointer = null;
    this.#start = this.#last = null;
    this.#preview = undefined;
    if (pointer !== null && this.canvas.hasPointerCapture(pointer)) this.canvas.releasePointerCapture(pointer);
    this.invalidate();
  }
  #resize = (): void => {
    const bounds = this.canvas.getBoundingClientRect();
    this.#width = bounds.width;
    this.#height = bounds.height;
    this.#dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(bounds.width * this.#dpr));
    const height = Math.max(1, Math.round(bounds.height * this.#dpr));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.invalidate();
  };
  invalidate(): void {
    if (this.#disposed || this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      const context = this.canvas.getContext("2d");
      if (!context) { this.onError("Canvas 2D is unavailable in this browser"); return; }
      const started = performance.now();
      context.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
      const snapshot = this.engine.getSnapshot();
      renderDocument(context, snapshot.document, this.#width, this.#height, snapshot.selection, this.#preview);
      performance.measure("figcraft:render", { start: started, end: performance.now() });
      // Keep diagnostics bounded during long editing sessions.
      if (performance.getEntriesByName("figcraft:render").length > 600) performance.clearMeasures("figcraft:render");
      if (performance.getEntriesByName("figcraft:pointer").length > 1200) performance.clearMeasures("figcraft:pointer");
    });
  }
  dispose(): void {
    this.#disposed = true;
    this.cancel();
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#observer.disconnect();
    this.#unsubscribe();
    this.#abort.abort();
  }
}
