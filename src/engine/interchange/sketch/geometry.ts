import {inverse,multiply,transformBounds,type Affine} from "../../affine";
import {rows} from "../fig/fields";
import {children,clamp,numeric,object,string,type JsonObject} from "../rest/values";

export type SketchNode=Record<string,unknown>;
const sizeLimit=1e6,coordinateLimit=1e7;
export function sketchColour(value:unknown) {
  const c=object(value),r=numeric(c.red),g=numeric(c.green),b=numeric(c.blue);
  if (r===undefined || g===undefined || b===undefined) return;
  return {r:clamp(r,0,1),g:clamp(g,0,1),b:clamp(b,0,1),a:clamp(numeric(c.alpha) ?? 1,0,1)};
}
export function frameSize(layer:JsonObject) {
  const f=object(layer.frame);
  return {w:clamp(numeric(f.width) ?? 0,0,sizeLimit),h:clamp(numeric(f.height) ?? 0,0,sizeLimit)};
}
export function sketchLocal(layer:JsonObject,w:number,h:number):Affine {
  const frame=object(layer.frame),x=clamp(numeric(frame.x) ?? 0,-coordinateLimit,coordinateLimit),
    y=clamp(numeric(frame.y) ?? 0,-coordinateLimit,coordinateLimit);
  const angle=-((numeric(layer.rotation) ?? 0)%360)*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle);
  const sx=layer.isFlippedHorizontal===true ? -1 : 1,sy=layer.isFlippedVertical===true ? -1 : 1;
  const a=sx*cos,b=sy*sin,c=-sx*sin,d=sy*cos;
  return [a,b,c,d,(a*(-w/2)+c*(-h/2))+(x+w/2),(b*(-w/2)+d*(-h/2))+(y+h/2)];
}
const integer=(v:unknown)=>Number.isInteger(v) ? Number(v) : 0;
export function sketchPinMask(l:JsonObject) {
  if (!Object.hasOwn(l,"horizontalPins") && !Object.hasOwn(l,"horizontalSizing")) return Number.isInteger(l.resizingConstraint) ? Number(l.resizingConstraint) : 63;
  const h=integer(l.horizontalPins),v=integer(l.verticalPins);
  return 63 ^ ((h&1 ? 4 : 0) | (h&4 ? 1 : 0) | ([0,1].includes(integer(l.horizontalSizing)) ? 2 : 0) |
    (v&1 ? 32 : 0) | (v&4 ? 8 : 0) | ([0,1].includes(integer(l.verticalSizing)) ? 16 : 0));
}
function constraints(mask:number) {
  function axis(lo:number,size:number,hi:number,first:string,last:string) {
    if (!(mask&lo)) return mask&hi ? first : mask&size ? first+"_"+last : "SCALE";
    return !(mask&hi) ? last : mask&size ? "SCALE" : "CENTER";
  }
  return {horizontal:axis(4,2,1,"LEFT","RIGHT"),vertical:axis(32,16,8,"TOP","BOTTOM")};
}
export function sketchBase(l:JsonObject,type:string,parent:Affine,world:Affine,w:number,h:number,root:boolean):SketchNode {
  return {type,id:string(l.do_objectID),name:string(l.name) ?? string(l._class) ?? "Layer",visible:l.isVisible!==false,locked:l.isLocked===true,
    size:{x:w,y:h},relativeTransform:rows(multiply(inverse(parent),world)),...(!root && {absoluteBoundingBox:transformBounds(world,w,h)}),
    constraints:constraints(sketchPinMask(l))};
}
export function sketchCorners(node:SketchNode,l:JsonObject) {
  if (l._class==="rectangle" && node.type==="RECTANGLE") {
    const radii=children(l.points).map(p=>clamp(numeric(object(p).cornerRadius) ?? 0,0,sizeLimit)),fixed=numeric(l.fixedRadius) ?? 0;
    if (radii.length===4 && radii.some(r=>r>0)) node.rectangleCornerRadii=radii;
    else if (fixed>0) node.cornerRadius=Math.min(fixed,sizeLimit);
  }
  if (!["RECTANGLE","FRAME","COMPONENT","INSTANCE"].includes(String(node.type))) return;
  const c=object(object(l.style).corners),radii=children(c.radii).filter((v):v is number=>numeric(v)!==undefined).slice(0,4).map(n=>clamp(n,0,sizeLimit));
  if (!radii.length) return;
  if (radii.length===1) {node.cornerRadius=radii[0];delete node.rectangleCornerRadii;}
  else node.rectangleCornerRadii=Array.from({length:4},(_,i)=>radii[i%radii.length]);
  if (c.style===1 && numeric(c.smoothing)!==undefined) node.cornerSmoothing=clamp(Number(c.smoothing),0,1);
}
