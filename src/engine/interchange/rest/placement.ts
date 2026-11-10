import { identity, inverse, multiply, transformBounds, type Affine } from "../../affine";
import type { Rectangle } from "../../geometry";
import { clamp, finite, maximumCoordinate, maximumSize, numeric, object, type ImportWarnings, type JsonObject } from "./values";

export interface ImportSpace { readonly world:Affine; readonly frame:Affine }
export const pageSpace:ImportSpace={world:identity,frame:identity};

export function restTransform(input:unknown):Affine|undefined {
  if (!Array.isArray(input) || !Array.isArray(input[0]) || !Array.isArray(input[1])) return;
  const [[a,c,e],[b,d,f]]=input;
  if (![a,b,c,d,e,f].every(finite) || Math.max(Math.abs(a),Math.abs(b),Math.abs(c),Math.abs(d))>maximumSize ||
    Math.max(Math.abs(e),Math.abs(f))>maximumCoordinate) return;
  return [a,b,c,d,e,f];
}
function box(input:unknown):Rectangle|undefined {
  const {x,y,width,height}=object(input);
  if (finite(x) && finite(y) && finite(width) && finite(height)) return {x:clamp(x,-maximumCoordinate,maximumCoordinate),
    y:clamp(y,-maximumCoordinate,maximumCoordinate),width:clamp(width,0,maximumSize),height:clamp(height,0,maximumSize)};
}
function sizeFromBounds(bounds:Rectangle,rotation:number) {
  const {width,height}=bounds, c=Math.abs(Math.cos(rotation)), s=Math.abs(Math.sin(rotation));
  if (s<1e-9) return {width,height};
  const det=c*c-s*s;
  if (Math.abs(det)>.05) {
    const w=(width*c-height*s)/det, h=(height*c-width*s)/det;
    if (w>=0 && h>=0) return {width:w,height:h};
  }
  return {width:width/(c+s),height:height/(s+c)};
}
function boundsError(xf:Affine,w:number,h:number,expected:Rectangle) {
  const b=transformBounds(xf,w,h);
  return Math.abs(b.x-expected.x)+Math.abs(b.y-expected.y)+Math.abs((b.x+b.width)-(expected.x+expected.width))+
    Math.abs((b.y+b.height)-(expected.y+expected.height));
}
export function placement(node:JsonObject,space:ImportSpace,absolute:boolean,warnings:ImportWarnings) {
  const bounds=box(node.absoluteBoundingBox), rotation=clamp(numeric(node.rotation) ?? 0,-1000,1000);
  const size=object(node.size);
  const {width,height}=finite(size.x) && finite(size.y) ? {width:clamp(size.x,0,maximumSize),height:clamp(size.y,0,maximumSize)} :
    bounds ? sizeFromBounds(bounds,rotation) : {width:0,height:0};
  const relative=restTransform(node.relativeTransform);
  let world:Affine;
  if (bounds && (absolute || !relative)) {
    const c=Math.cos(rotation),s=Math.sin(rotation);
    world=multiply([c,-s,s,c,bounds.x+bounds.width/2,bounds.y+bounds.height/2],[1,0,0,1,-width/2,-height/2]);
  } else if (relative) {
    world=multiply(space.frame,relative);
    if (bounds) {
      const alternative=multiply(space.world,relative);
      if (boundsError(alternative,width,height,bounds)<boundsError(world,width,height,bounds)) world=alternative;
    }
  } else {
    warnings.add("layers without a position were placed at their parent's origin");
    world=space.world;
  }
  const [a,b,c,d,e,f]=space.world;
  const transform:Affine=Math.abs(a*d-b*c)>1e-12 ? multiply(inverse(space.world),world) : [1,0,0,1,world[4]-e,world[5]-f];
  return {world,transform,width,height};
}
