import type { BlendMode } from "./blend";
import { compositeSurface } from "./blend-composite";

interface Under {
  parent: CanvasRenderingContext2D;
  left: number;
  top: number;
  opacity: number;
  blend: BlendMode;
  mask?: HTMLCanvasElement;
}
const below = new WeakMap<CanvasRenderingContext2D,Under>();

/** Valid only while painting the isolated surface. The returned cleanup also
 * runs when a suspended image generator is cancelled. */
export function backdropParent(surface: CanvasRenderingContext2D, parent: CanvasRenderingContext2D,
  left: number, top: number, opacity: number, blend: BlendMode, mask?: HTMLCanvasElement) {
  below.set(surface,{parent,left,top,opacity,blend,mask});
  return () => { below.delete(surface); };
}

/** Combine the rectangular portion of each ancestor at its eventual opacity,
 * blend and mask coverage. Off-surface pixels read as transparent. */
export function readBackdrop(target: CanvasRenderingContext2D, source: CanvasRenderingContext2D, x: number, y: number) {
  const layers: { source: HTMLCanvasElement; x: number; y: number; under?: Under }[]=[];
  let current=source;
  for(let depth=0;depth<=256;depth++) {
    const under=below.get(current);
    layers.push({source:current.canvas,x,y,under});
    if (!under) break;
    x+=under.left; y+=under.top; current=under.parent;
  }
  const base=layers.pop()!;
  target.drawImage(base.source,-base.x,-base.y);
  if (!layers.length) return;
  const work=target.canvas.ownerDocument.createElement("canvas");
  const {width,height}=target.canvas;
  try {
    work.width=width; work.height=height;
    const part=work.getContext("2d")!;
    while(layers.length) {
      const layer=layers.pop()!, {under}=layer;
      part.clearRect(0,0,width,height);
      part.drawImage(layer.source,-layer.x,-layer.y);
      if (under?.mask) {
        part.globalCompositeOperation="destination-in";
        part.drawImage(under.mask,-layer.x,-layer.y);
        part.globalCompositeOperation="source-over";
      }
      compositeSurface(target,part,0,0,width,height,under?.blend ?? "normal",under?.opacity ?? 1);
    }
  } finally {work.width=work.height=0;}
}
