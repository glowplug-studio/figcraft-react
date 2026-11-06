import { canvasAccent } from "./canvas-colours";
import { pageOf, pageColour, rectanglePaints, rectangleTransform, type Document, type LayerNode } from "./document";
import { renderColour } from "./colour";
import { EditorEngine } from "./editor";
import { drawnRectangle, type Point, type Rectangle } from "./geometry";
import { multiply, transformBounds, type Affine } from "./affine";
import { worldTransform } from "./hierarchy";
import { pageToScreen, screenToPage, scrollView, viewOrigin, zoomAt, type Viewport } from "./viewport";
import { SmartHandles } from "./smart-handles";
import { MoveInteraction } from "./move-interaction";
import { TransformInteraction } from "./transform-interaction";

const compositeSurfaces = new WeakMap<CanvasRenderingContext2D, HTMLCanvasElement>();
// Immutable document snapshots invalidate these derived bounds after any edit.
const groupBounds = new WeakMap<Document, Map<string, { matrix: readonly number[]; bounds: Rectangle | undefined }>>();
const opacity = (value: number) => Math.max(0, Math.min(1, value));

function paintRectangle(context: CanvasRenderingContext2D, node: LayerNode, alpha = 1): void {
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
    if (current.kind !== "rectangle") {
      for (const id of current.children) {
        const child = document.nodes[id];
        if (child && child.kind !== "page") pending.push({ node: child, parent: matrix, depth: item.depth + 1 });
      }
    }
    if (current.kind !== "group") {
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
  if (node.kind !== "rectangle") {
    const draw = (target: CanvasRenderingContext2D) => {
      if (node.kind === "frame") paintRectangle(target, node);
      target.save(); target.transform(...rectangleTransform(node));
      if (node.kind === "frame" && node.clip) { target.beginPath(); target.rect(0, 0, node.width, node.height); target.clip(); }
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
export function renderDocument(context: CanvasRenderingContext2D, document: Document, width: number, height: number, selection: readonly string[] = [], preview?: Rectangle, view?: Viewport): void {
  const page = pageOf(document);
  context.clearRect(0, 0, width, height);
  context.fillStyle = page.backgroundColor ? renderColour(pageColour(page)) : page.background;
  context.fillRect(0, 0, width, height);
  context.save();
  const origin = view ? viewOrigin(view) : { x: 0, y: 0 }, zoom = view?.zoom ?? 1;
  context.scale(zoom, zoom); context.translate(-origin.x, -origin.y);
  for (const id of page.children) {
    const node = document.nodes[id];
    if (!node || node.kind === "page") continue;
    if (node.kind === "rectangle") {
      const bounds = node.transform ? transformBounds(node.transform, node.width, node.height) : node;
      if (bounds.x > origin.x + width / zoom || bounds.y > origin.y + height / zoom || bounds.x + bounds.width < origin.x || bounds.y + bounds.height < origin.y) continue;
    }
    drawLayer(context, document, node);
  }
  context.strokeStyle = canvasAccent(document);
  context.lineWidth = 1 / zoom;
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
  context.restore();
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
  #unsubscribeView: () => void;
  #unsubscribeOrigin: () => void;
  #unsubscribeCanvas: () => void;
  #smart: SmartHandles;
  #moving: MoveInteraction;
  #transforming: TransformInteraction;
  #dragOrigin = false;
  #space = false;
  #zoomHeld = false;
  #pan?: { screen: Point; view: Viewport };
  #zoomStart?: Point;
  #zoomArea?: Rectangle;
  #abort = new AbortController();
  #width = 0;
  #height = 0;
  #dpr = 1;
  constructor(private canvas: HTMLCanvasElement, private engine: EditorEngine, private onError: (message: string) => void) {
    this.#smart = new SmartHandles(engine, onError);
    this.#moving = new MoveInteraction(engine, onError);
    this.#transforming = new TransformInteraction(engine, onError);
    const options = { signal: this.#abort.signal };
    canvas.addEventListener("pointerdown", this.#down, options);
    canvas.addEventListener("pointermove", this.#move, options);
    canvas.addEventListener("pointerleave", event => { if (this.#pointer === null) { this.#smart.hover(undefined, event); this.invalidate(); } }, options);
    canvas.addEventListener("pointerup", this.#up, options);
    canvas.addEventListener("dblclick", this.#doubleClick, options);
    canvas.addEventListener("pointercancel", this.#cancelEvent, options);
    canvas.addEventListener("lostpointercapture", this.#cancelEvent, options);
    canvas.addEventListener("keydown", this.#key, options);
    window.addEventListener("keyup", this.#keyUp, options);
    canvas.addEventListener("wheel", this.#wheel, { ...options, passive: false });
    window.addEventListener("blur", this.#blur, options);
    window.addEventListener("resize", this.#resize, options);
    this.#observer = new ResizeObserver(this.#resize);
    this.#observer.observe(canvas);
    this.#unsubscribe = engine.subscribe(() => {
      if (engine.getSnapshot().tool !== "rectangle" || !engine.getSnapshot().editable) this.cancel();
      this.invalidate();
    });
    this.#unsubscribeView = engine.subscribeView(() => this.invalidate());
    this.#unsubscribeOrigin = engine.subscribeOrigin(() => this.invalidate());
    this.#unsubscribeCanvas = engine.subscribeCanvas(() => this.invalidate());
    this.#resize();
  }
  #point(event: { clientX: number; clientY: number }): Point {
    return screenToPage(this.engine.getView(), this.#screenPoint(event));
  }
  #screenPoint(event: { clientX: number; clientY: number }): Point {
    const bounds = this.canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }
  #down = (event: PointerEvent): void => {
    if (this.#pointer !== null || !this.engine.getSnapshot().editable) return;
    if (event.button === 1 || event.button === 0 && (this.#space || this.#zoomHeld)) {
      event.preventDefault(); this.canvas.focus(); this.#pointer = event.pointerId;
      if (event.button === 1 || this.#space) this.#pan = { screen: this.#screenPoint(event), view: this.engine.getView() };
      else this.#zoomStart = this.#screenPoint(event);
      this.canvas.setPointerCapture(event.pointerId); return;
    }
    if (event.button !== 0) return;
    this.canvas.focus();
    if (this.#onOrigin(this.#point(event))) {
      event.preventDefault(); this.#dragOrigin = true; this.#pointer = event.pointerId;
      this.canvas.setPointerCapture(event.pointerId); return;
    }
    if (this.#smart.down(this.#screenPoint(event), event)) {
      event.preventDefault(); this.#pointer = event.pointerId; this.canvas.setPointerCapture(event.pointerId); this.invalidate(); return;
    }
    if (this.#transforming.down(this.#point(event))) {
      event.preventDefault(); this.#pointer = event.pointerId; this.canvas.setPointerCapture(event.pointerId); this.invalidate(); return;
    }
    if (this.engine.getSnapshot().tool !== "rectangle") {
      if (this.#moving.down(this.#point(event), event)) {
        event.preventDefault(); this.#pointer = event.pointerId; this.canvas.setPointerCapture(event.pointerId); this.invalidate();
      }
      return;
    }
    event.preventDefault();
    this.#pointer = event.pointerId;
    this.#start = this.#point(event);
    this.#last = this.#start;
    this.canvas.setPointerCapture(event.pointerId);
  };
  #move = (event: PointerEvent): void => {
    if (this.#pointer === null) {
      this.canvas.style.cursor = this.#onOrigin(this.#point(event)) ? "move" : this.#transforming.hover(this.#point(event)) ?? this.#smart.hover(this.#screenPoint(event), event);
      this.invalidate();
    }
    if (event.pointerId === this.#pointer && this.#transforming.active) {
      const started = performance.now(); this.#transforming.move(this.#point(event), event); this.invalidate();
      performance.measure("figcraft:pointer", { start: started, end: performance.now() }); return;
    }
    if (event.pointerId === this.#pointer && this.#moving.active) {
      const started = performance.now(); this.#moving.move(this.#point(event), event);
      this.canvas.style.cursor = this.#moving.copying ? "copy" : "default"; this.invalidate();
      performance.measure("figcraft:pointer", { start: started, end: performance.now() }); return;
    }
    if (event.pointerId === this.#pointer && this.#smart.active) {
      const started = performance.now();
      this.#smart.move(this.#screenPoint(event), event, this.#width, this.#height); this.invalidate();
      performance.measure("figcraft:pointer", { start: started, end: performance.now() }); return;
    }
    if (event.pointerId === this.#pointer && this.#dragOrigin) {
      const started = performance.now();
      try { this.engine.dragRotationOrigin(this.#point(event), this.engine.getView().zoom); }
      catch (error) { this.onError(error instanceof Error ? error.message : "Could not move rotation origin"); this.cancel(); }
      performance.measure("figcraft:pointer", { start: started, end: performance.now() }); return;
    }
    if (event.pointerId === this.#pointer && this.#pan) {
      const point = this.#screenPoint(event);
      this.engine.updateView(scrollView(this.#pan.view, point.x - this.#pan.screen.x, point.y - this.#pan.screen.y)); return;
    }
    if (event.pointerId === this.#pointer && this.#zoomStart) {
      const point = this.#screenPoint(event), start = this.#zoomStart;
      this.#zoomArea = { x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) };
      this.invalidate(); return;
    }
    if (event.pointerId !== this.#pointer || !this.#start) return;
    const started = performance.now();
    this.#last = this.#point(event);
    this.#preview = drawnRectangle(this.#start, this.#last, event.shiftKey, event.altKey);
    this.invalidate();
    performance.measure("figcraft:pointer", { start: started, end: performance.now() });
  };
  #up = (event: PointerEvent): void => {
    if (event.pointerId === this.#pointer && this.#transforming.active) { this.#transforming.up(); this.cancel(); return; }
    if (event.pointerId === this.#pointer && this.#moving.active) { this.#moving.up(this.#point(event), event); this.cancel(); return; }
    if (event.pointerId === this.#pointer && this.#smart.active) {
      this.#smart.up(this.#screenPoint(event), event, this.#width, this.#height); this.cancel(); return;
    }
    if (event.pointerId === this.#pointer && this.#dragOrigin) { this.cancel(); return; }
    if (event.pointerId === this.#pointer && this.#pan) { this.#move(event); this.cancel(); return; }
    if (event.pointerId === this.#pointer && this.#zoomStart) {
      const start = this.#zoomStart, end = this.#screenPoint(event), view = this.engine.getView();
      const a = screenToPage(view, { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) });
      const width = Math.abs(end.x - start.x), height = Math.abs(end.y - start.y);
      this.cancel();
      try { this.engine.execute("view.zoomAt", width > 4 && height > 4 ? { ...a, width: width / view.zoom, height: height / view.zoom } : { ...screenToPage(view, end), out: event.altKey }); }
      catch (error) { this.onError(error instanceof Error ? error.message : "Could not zoom"); }
      return;
    }
    if (event.pointerId !== this.#pointer || !this.#start) return;
    const start = this.#start;
    const end = this.#point(event);
    const tiny = Math.hypot(end.x - start.x, end.y - start.y) * this.engine.getView().zoom < 3;
    const rectangle = tiny || !this.#preview
      ? drawnRectangle(start, { x: start.x + 100, y: start.y + 100 })
      : drawnRectangle(start, end, event.shiftKey, event.altKey);
    this.cancel();
    try {
      this.engine.execute("shape.rectangle", rectangle);
      this.engine.execute("tool.move");
    } catch (error) { this.onError(error instanceof Error ? error.message : "Could not create rectangle"); }
  };
  #wheel = (event: WheelEvent): void => {
    if (!this.engine.getSnapshot().editable) return;
    event.preventDefault();
    const view = this.engine.getView(), unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? view.vh : 1;
    const dx = event.deltaX * unit, dy = event.deltaY * unit;
    this.engine.updateView(event.ctrlKey || event.metaKey
      ? zoomAt(view, view.zoom * Math.exp(Math.max(-50, Math.min(50, -dy * 0.005))), screenToPage(view, this.#screenPoint(event)))
      : scrollView(view, -dx, -dy, event.shiftKey));
  };
  #onOrigin(point: Point): boolean {
    const origin = this.engine.getRotationOrigin();
    return Boolean(origin.editing && origin.point && Math.hypot(point.x - origin.point.x, point.y - origin.point.y) * this.engine.getView().zoom <= 8);
  }
  #doubleClick = (event: MouseEvent): void => {
    if (!this.engine.getSnapshot().editable) return;
    event.preventDefault();
    try {
      if (this.#onOrigin(this.#point(event))) this.engine.execute("transform.setRotationOrigin", { reset: true });
      else this.#moving.doubleClick(this.#point(event));
    } catch (error) { this.onError(error instanceof Error ? error.message : "Could not enter layer"); }
  };
  #blur = (): void => { this.#space = false; this.#zoomHeld = false; this.cancel(); };
  #cancelEvent = (): void => this.cancel();
  #key = (event: KeyboardEvent): void => {
    if (!event.ctrlKey && !event.metaKey && (event.code === "Space" || event.key.toLowerCase() === "z")) {
      event.preventDefault();
      if (event.code === "Space") this.#space = true; else this.#zoomHeld = true;
    }
    if (event.key === "Escape") { event.preventDefault(); this.cancel(); }
  };
  #keyUp = (event: KeyboardEvent): void => {
    if (event.code === "Space") this.#space = false;
    if (event.key.toLowerCase() === "z") this.#zoomHeld = false;
  };
  cancel(): void {
    this.#transforming.cancel();
    this.#moving.cancel();
    this.#smart.cancel();
    const pointer = this.#pointer;
    this.#pointer = null;
    this.#start = this.#last = null;
    this.#preview = undefined;
    this.#dragOrigin = false;
    this.canvas.style.cursor = "";
    this.#pan = undefined; this.#zoomStart = undefined; this.#zoomArea = undefined;
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
    this.engine.resizeViewport(this.#width, this.#height);
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
      const view = this.engine.getView(), origin = viewOrigin(view);
      renderDocument(context, this.engine.getRenderDocument(), this.#width, this.#height, this.engine.getRenderSelection(), this.#preview, view);
      if (!this.#moving.active && !this.#transforming.active) this.#smart.draw(context);
      if (!this.#moving.active && !this.#smart.active) this.#transforming.draw(context);
      this.#moving.draw(context);
      const rotationOrigin = this.engine.getRotationOrigin();
      if (rotationOrigin.editing && rotationOrigin.point) {
        const point = pageToScreen(view, rotationOrigin.point);
        context.strokeStyle = canvasAccent(this.engine.getRenderDocument()); context.fillStyle = "#ffffff"; context.lineWidth = 1.5;
        context.beginPath(); context.arc(point.x, point.y, 5, 0, Math.PI * 2); context.fill(); context.stroke();
        context.beginPath();
        for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          context.moveTo(point.x + x * 5, point.y + y * 5); context.lineTo(point.x + x * 10, point.y + y * 10);
        }
        context.stroke(); context.fillStyle = canvasAccent(this.engine.getRenderDocument());
        context.beginPath(); context.arc(point.x, point.y, 1.5, 0, Math.PI * 2); context.fill();
      }
      if (this.#zoomArea) {
        context.strokeStyle = canvasAccent(this.engine.getRenderDocument()); context.lineWidth = 1;
        context.strokeRect(this.#zoomArea.x, this.#zoomArea.y, this.#zoomArea.width, this.#zoomArea.height);
      }
      this.canvas.dataset.viewOriginX = String(origin.x); this.canvas.dataset.viewOriginY = String(origin.y); this.canvas.dataset.viewZoom = String(view.zoom);
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
    this.#unsubscribeView();
    this.#unsubscribeOrigin();
    this.#unsubscribeCanvas();
    this.#abort.abort();
  }
}
