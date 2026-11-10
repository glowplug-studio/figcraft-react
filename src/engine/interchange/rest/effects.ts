import { paintBlend } from "./paint";
import { clamp, clipped, finite, list, maximumSize, numeric, object, restColour, string, type ImportWarnings } from "./values";

function point(input:unknown,fallback:readonly [number,number],limit:number) {
  const {x,y}=object(input);
  return finite(x) && finite(y) ? [clamp(x,-limit,limit),clamp(y,-limit,limit)] : fallback;
}
export function restEffects(input:unknown,warnings:ImportWarnings) {
  const effects:Record<string,unknown>[]=[];
  for (const entry of list(input)) {
    const e=object(entry),type=string(e.type),visible=e.visible!==false;
    const num=(key:string,fallback:number,min:number,max:number)=>clamp(numeric(e[key]) ?? fallback,min,max);
    const radius=num("radius",0,0,maximumSize), blend=paintBlend(e.blendMode);
    switch (type) {
      case "DROP_SHADOW": case "INNER_SHADOW":
        effects.push({type:type==="DROP_SHADOW" ? "dropShadow" : "innerShadow",visible,color:restColour(e.color) ?? {r:0,g:0,b:0,a:.25},
          offset:point(e.offset,[0,0],maximumSize),radius,spread:num("spread",0,-maximumSize,maximumSize),blend,showBehind:e.showShadowBehindNode===true});break;
      case "LAYER_BLUR": case "BACKGROUND_BLUR":
        effects.push({type:type==="LAYER_BLUR" ? "layerBlur" : "backgroundBlur",visible,blurType:e.blurType==="PROGRESSIVE" ? "progressive" : "uniform",
          radius:Math.min(radius,10000),startRadius:num("startRadius",0,0,10000),start:point(e.startOffset,[.5,0],1000),end:point(e.endOffset,[.5,1],1000)});break;
      case "NOISE": case "TEXTURE": {
        const vector=object(e.noiseSizeVector);
        const hasAxes=finite(vector.x) && finite(vector.y);
        const grain={size:hasAxes ? clamp(vector.x as number,0,maximumSize) : num("noiseSize",.5,0,maximumSize),
          ...(hasAxes && vector.x!==vector.y && {sizeY:clamp(vector.y as number,0,maximumSize)})};
        if (type==="TEXTURE") effects.push({type:"texture",visible,...grain,radius:num("radius",4,0,maximumSize),clipToShape:e.clipToShape===true});
        else effects.push({type:"noise",visible,...grain,mode:e.noiseType==="DUOTONE" ? "duo" : e.noiseType==="MULTITONE" ? "multi" : "mono",
          density:num("density",.5,0,1),color:restColour(e.color) ?? {r:0,g:0,b:0,a:.25},secondary:restColour(e.secondaryColor) ?? {r:1,g:1,b:1,a:.25},opacity:num("opacity",.25,0,1),blend});
        break;
      }
      case "GLASS":
        effects.push({type:"glass",visible,lightAngle:num("lightAngle",-45,-3600,3600),lightIntensity:num("lightIntensity",.8,0,1),
          refraction:num("refraction",.8,0,1),depth:num("depth",20,1,1000),dispersion:num("dispersion",.5,0,1),frost:num("radius",4,0,100),splay:num("splay",0,0,1)});break;
      default: if (type) warnings.add(clipped(type)+" effects are not supported and were skipped");
    }
  }
  return effects;
}
