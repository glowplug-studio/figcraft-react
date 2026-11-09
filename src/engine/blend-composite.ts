import { canvasBlend, plusDarkerPixels, type BlendMode } from "./blend";

/** The caller owns the bounded scratch surface and may reuse it after compositing. */
export function compositeSurface(ctx:CanvasRenderingContext2D, source:CanvasRenderingContext2D,
  left:number, top:number, width:number, height:number, mode:BlendMode, opacity:number) {
  ctx.save();
  try {
    ctx.resetTransform();
    if (mode === "plusDarker") {
      // Keep the working set small even when the visible layer covers a large display.
      const step=Math.max(1,Math.floor(262144/width));
      for(let y=0;y<height;y+=step) {
        const rows=Math.min(step,height-y), dst=ctx.getImageData(left,top+y,width,rows);
        plusDarkerPixels(dst.data,source.getImageData(0,y,width,rows).data,opacity);
        source.putImageData(dst,0,y);
      }
      // putImageData ignores the active clip. Copy the finished rectangle through that clip.
      ctx.beginPath(); ctx.rect(left,top,width,height); ctx.clip();
      ctx.globalCompositeOperation="copy"; ctx.globalAlpha=1;
    } else {
      ctx.globalCompositeOperation=canvasBlend[mode]; ctx.globalAlpha=opacity;
    }
    ctx.drawImage(source.canvas,0,0,width,height,left,top,width,height);
  } finally {ctx.restore();}
}
