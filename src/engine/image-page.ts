import type { Document } from "./document";
import type { CanvasImages, PaintSteps } from "./image-renderer";

/** A suspended page owns its context, including open clips and unfinished opacity groups. */
export class ImagePage {
  #document?: Document;
  #geometry: number[] = [];
  #surface?: HTMLCanvasElement;
  #generation = 0;
  #invalidate?: () => void;
  #pending = false;
  #notification?: number;
  #waiting?: Promise<void>;
  #resume?: () => void;

  draw(target: CanvasRenderingContext2D, document: Document, width: number, height: number,
    origin: {x:number;y:number}, zoom: number, images: CanvasImages,
    paint: (ctx: CanvasRenderingContext2D) => PaintSteps, invalidate: () => void) {
    this.#invalidate = invalidate;
    const matrix = target.getTransform();
    const geometry = [target.canvas.width,target.canvas.height,width,height,origin.x,origin.y,zoom,
      matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f];
    if (document !== this.#document || !this.#geometry.every((n,i) => n === geometry[i])) {
      const generation = ++this.#generation;
      if (this.#notification !== undefined) cancelAnimationFrame(this.#notification);
      this.#notification = undefined;
      if (this.#pending) this.#releaseSurface();
      this.#document = document;
      this.#geometry = geometry;
      const surface = this.#surface ??= target.canvas.ownerDocument.createElement("canvas");
      if (surface.width !== target.canvas.width) surface.width = target.canvas.width;
      if (surface.height !== target.canvas.height) surface.height = target.canvas.height;
      const ctx = surface.getContext("2d")!;
      ctx.setTransform(matrix);
      const steps = paint(ctx);
      let step = steps.next();
      const notify = () => {
        if (this.#notification !== undefined) return;
        this.#notification = requestAnimationFrame(() => {
          this.#notification = undefined;
          if (generation === this.#generation) this.#invalidate?.();
        });
      };
      const advance = () => {
        if (generation !== this.#generation) return;
        if (this.#pending) notify();
        while (!step.done) {
          const wait = images.paint(...step.value);
          if (wait) {
            this.#pending = true;
            this.#resume = advance;
            if (this.#waiting !== wait) {
              this.#waiting = wait;
              void wait.then(() => {
                if (this.#waiting !== wait) return;
                this.#waiting = undefined;
                const resume = this.#resume;
                this.#resume = undefined;
                resume?.();
              });
            }
            return;
          }
          step = steps.next();
        }
        if (this.#pending) {
          this.#pending = false;
          if (this.#notification !== undefined) cancelAnimationFrame(this.#notification);
          this.#notification = undefined;
          this.#invalidate?.();
        }
      };
      advance();
    }
    const surface = this.#surface;
    if (!surface?.width || !surface.height) return;
    target.save();
    target.beginPath(); target.rect(0,0,width,height); target.clip();
    target.resetTransform();
    target.clearRect(0,0,surface.width,surface.height);
    target.drawImage(surface,0,0);
    target.restore();
  }

  #releaseSurface() {
    if (this.#notification !== undefined) cancelAnimationFrame(this.#notification);
    this.#notification = undefined;
    if (this.#surface) this.#surface.width = this.#surface.height = 0;
    this.#surface = undefined;
    this.#resume = undefined;
    this.#pending = false;
  }

  clear() {
    ++this.#generation;
    this.#document = undefined;
    this.#invalidate = undefined;
    this.#releaseSurface();
  }
}
