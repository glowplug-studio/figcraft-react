import { pageOf, type Document } from "./document";
import { EditorEngine } from "./editor";
import { drawnRectangle, type Point, type Rectangle } from "./geometry";

/** Only this module paints editable geometry; React never renders canvas layers. */
export function renderDocument(context: CanvasRenderingContext2D, document: Document, width: number, height: number, selection: readonly string[] = [], preview?: Rectangle): void {
  const page = pageOf(document);
  context.fillStyle = page.background;
  context.fillRect(0, 0, width, height);
  for (const id of page.children) {
    const node = document.nodes[id];
    if (!node || node.kind !== "rectangle") continue;
    if (node.x > width || node.y > height || node.x + node.width < 0 || node.y + node.height < 0) continue;
    context.fillStyle = node.fill;
    context.fillRect(node.x, node.y, node.width, node.height);
  }
  context.strokeStyle = "#0d99ff";
  context.lineWidth = 1;
  for (const id of selection) {
    const node = document.nodes[id];
    if (node?.kind === "rectangle") context.strokeRect(node.x, node.y, node.width, node.height);
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
    if (this.engine.getSnapshot().tool !== "rectangle") return;
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
