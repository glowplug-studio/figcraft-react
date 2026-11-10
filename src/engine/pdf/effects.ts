import { identity, multiply } from "../affine";
import type { BlendMode } from "../blend";
import { renderAreaPixels } from "../canvas";
import type { LayerNode } from "../document";
import type { Effect } from "../effects";
import { backdropPixels, effectView, isolatedEffectDocument, type EffectView } from "../export-effect-raster";
import { worldTransform } from "../hierarchy";
import { expand, intersect, worldRenderBounds } from "../render-bounds";
import { ShadowLayer } from "../shadow-renderer";
import { filterMargin } from "../svg-shadows";
import { placeImage, type PdfImage } from "./images";
import type { PdfSurface } from "./objects";
import type { PdfScene } from "./scene";

interface PlacedEffect {image:PdfImage;view:EffectView;blend:BlendMode}

export function drawEffect(scene:PdfScene,s:PdfSurface,e:PlacedEffect,opacity=1) {
  const {box,scale}=e.view;
  s.ops.push("q");
  scene.graphics.state(s,opacity,e.blend);
  placeImage(s,e.image,multiply(scene.origin,[1/scale,0,0,1/scale,box.x,box.y]));
  s.ops.push("Q");
}

export async function pdfEffects(scene:PdfScene,n:LayerNode,mask:boolean) {
  const {doc,page,depth}=scene,keep=expand(page.area,page.sheet.bleed);
  const cmyk=scene.cmyk && !mask;
  const effects=n.effects?.filter(e=>e.visible) ?? [];
  const whole=effects.some(e=>e.type==="layerBlur" || e.type==="noise" || e.type==="texture");
  const shadows=effects.filter((e):e is Extract<Effect,{type:"dropShadow"|"innerShadow"}>=>e.type==="dropShadow" || e.type==="innerShadow");
  const drop:PlacedEffect[]=[],inner:PlacedEffect[]=[];
  const back=!mask && !scene.tiling ? await backdropPixels(doc,n,page.ids,async(canvas,view)=>{
    const image=await scene.images.pixels(canvas,cmyk);
    if (image) return {image,view,blend:"normal" as const};
  },keep) : undefined;
  const result:{whole:boolean; layer?:PlacedEffect;back?:PlacedEffect;drop:PlacedEffect[];inner:PlacedEffect[]}={whole,back,drop,inner};
  if (!whole && !shadows.length) return result;
  const bounds=worldRenderBounds(doc,n.id), world=worldTransform(doc,n.id);
  if (!bounds) return result;
  const sc=Math.sqrt(Math.abs(world[0]*world[3]-world[1]*world[2])) || 1;
  const reach=whole ? filterMargin(n)*sc : shadows.reduce((max,e)=>
    Math.max(max,Math.abs(e.radius)*2+Math.abs(e.spread)*4+Math.abs(e.offset[0])+Math.abs(e.offset[1])),0)*sc+1;
  const view=effectView(intersect(expand(bounds,reach),keep));
  if (!view) return result;
  const canvas=document.createElement("canvas");
  try {
    const isolated=isolatedEffectDocument(doc,n,!whole);
    await renderAreaPixels(canvas,isolated,view.box,view.scale,[n.id],undefined,0,undefined,"srgb",false,depth);
    if (whole) {
      const image=await scene.images.pixels(canvas,cmyk);
      if (image) result.layer={image,view,blend:n.blend ?? "normal"};
      return result;
    }
    const layer=canvas.getContext("2d")!;
    layer.setTransform(...multiply(view.xf,n.parent ? worldTransform(doc,n.parent) : identity));
    const target=document.createElement("canvas");
    target.width=canvas.width;target.height=canvas.height;
    try {
      const ctx=target.getContext("2d")!;
      for (const e of shadows) {
        ctx.clearRect(0,0,target.width,target.height);
        const caster=new ShadowLayer(layer,doc,{...n,opacity:1,effects:[{...e,blend:"normal"}]},view.scale);
        try {
          if (e.type==="dropShadow") caster.drop(ctx,0,0); else caster.inner(ctx);
          const image=await scene.images.pixels(target,cmyk);
          if (image) (e.type==="dropShadow" ? drop : inner).push({image,view,blend:e.type==="dropShadow" ? e.blend : "normal"});
        } finally {caster.dispose();}
      }
    } finally {target.width=target.height=0;}
    return result;
  } finally {canvas.width=canvas.height=0;}
}
