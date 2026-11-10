import { identity, inverse, multiply, type Affine } from "../affine";
import type { CurveElement } from "../curve-flatten";
import { layerTransform } from "../document";
import { drawGradient } from "../gradient-renderer";
import { subtreeIds } from "../hierarchy";
import { imageTransform } from "../image-placement";
import { patternCell } from "../pattern";
import type { Paint } from "../solid-paint";
import { bake,cubics } from "../vector-drawable/geometry";
import { pathBounds } from "../vector-path";
import { pdfPath } from "./graphics";
import { placeImage } from "./images";
import { number,nums,PdfSurface } from "./objects";
import type { PdfScene } from "./scene";

export async function imagePaint(scene:PdfScene,s:PdfSurface,p:Exclude<Paint,{type:"solid"}>,path:readonly CurveElement[],
  rule:CanvasFillRule,world:Affine,w:number,h:number,mask:boolean) {
  const cmyk=scene.cmyk && !mask, even=rule==="evenodd", tile=new PdfSurface();
  let width:number,height:number,placement:Affine;
  const clip=()=>s.ops.push(pdfPath(bake(path,world)),even ? "W* n" : "W n");
  const rasterPattern=p.type==="pattern" && scene.doc.nodes[p.source] &&
    subtreeIds(scene.doc,p.source).some(id=>scene.doc.nodes[id].effects?.some(e=>e.visible));
  if (p.type==="gradient" || p.type==="pattern" && rasterPattern) {
    const box=pathBounds(cubics(path)); if (!box || box.width<=0 || box.height<=0) return;
    const zoom=Math.sqrt(Math.abs(world[0]*world[3]-world[1]*world[2])) || 1;
    const k=Math.min(4096/Math.max(box.width,box.height),2*zoom);
    const canvas=document.createElement("canvas");
    try {
      canvas.width=Math.max(1,Math.ceil(box.width*k)); canvas.height=Math.max(1,Math.ceil(box.height*k));
      const ctx=canvas.getContext("2d")!;
      ctx.setTransform(k,0,0,k,-box.x*k,-box.y*k);
      if (p.type==="gradient") drawGradient(ctx,p,w,h);
      else {
        const {renderPatternPaint}=await import("../canvas");
        await renderPatternPaint(ctx,scene.doc,p,w,h,scene.depth,scene.tiling);
      }
      const img=await scene.images.pixels(canvas,cmyk);
      if (img) {
        s.ops.push("q");clip();scene.graphics.state(s,p.opacity,p.blend);
        placeImage(s,img,multiply(world,[1/k,0,0,1/k,box.x,box.y]));s.ops.push("Q");
      }
    } finally {canvas.width=canvas.height=0;}
    return;
  }
  if (p.type==="image") {
    const resource=scene.doc.images?.[p.image]; if (!resource) return;
    const img=await scene.images.placed(resource,p,cmyk); if (!img) return;
    width=img.width;height=img.height;
    placement=multiply(world,imageTransform(p,width,height,w,h));
    if (p.scale_mode!=="tile") {
      s.ops.push("q");clip();scene.graphics.state(s,p.opacity,p.blend);placeImage(s,img,placement);s.ops.push("Q");return;
    }
    placeImage(tile,img,identity);
  } else {
    const source=scene.doc.nodes[p.source];
    if (!source || source.kind==="page" || scene.tiling>=2 || scene.depth>=256) return;
    const cell=patternCell(p,source.width,source.height,w,h);
    if (!cell) return;
    [width,height]=cell.size;placement=multiply(world,[1,0,0,1,...cell.origin]);
    scene.tiling++;
    try {
      for (const [x,y] of cell.tiles) await scene.node(tile,source.id,multiply([cell.scale,0,0,cell.scale,x,y],inverse(layerTransform(source))),scene.depth+1,mask);
    } finally {scene.tiling--;}
  }
  if (s===scene.surface) placement=multiply([1,0,0,-1,0,scene.page.sheet.height],placement);
  const pattern=tile.stream(scene.graphics.file,"/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 "+nums([width,height])+
    "] /XStep "+number(width)+" /YStep "+number(height)+" /Matrix ["+nums(placement)+"] /Resources "+tile.resources());
  s.ops.push("q");scene.graphics.state(s,p.opacity,p.blend);
  s.ops.push("/Pattern cs "+s.use("Pattern",pattern)+" scn",pdfPath(bake(path,world)),even ? "f*" : "f","Q");
}
