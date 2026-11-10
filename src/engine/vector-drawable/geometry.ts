import { identity, multiply, type Affine } from "../affine";
import type { PathCommand } from "../corners";
import type { CurveElement } from "../curve-flatten";
import { rectanglePaints, type TextNode } from "../document";
import type { Rectangle } from "../geometry";
import { decorationPath } from "../text-decorations";
import { textNodeLayout } from "../text-node-layout";
import { textSpans, textStyleKey } from "../text-ranges";
import type { TextStyle } from "../text-style";
import type { Paint } from "../solid-paint";
import type { DrawableItem, DrawablePath } from "./xml";

export function bake(path:DrawablePath,[a,b,c,d,e,f]:Affine):CurveElement[] {
  return path.map(command=>{
    if (command[0]==="Z") return command;
    const out:(string|number)[]=[command[0]];
    for (let i=1;i<command.length;i+=2) {
      const x=Number(command[i]), y=Number(command[i+1]);
      out.push(a*x+c*y+e,b*x+d*y+f);
    }
    return out as unknown as CurveElement;
  });
}
export function cubics(path:DrawablePath):readonly PathCommand[] {
  if (!path.some(c=>c[0]==="Q")) return path as readonly PathCommand[];
  let x=0,y=0,startX=0,startY=0;
  return path.map(c=>{
    if (c[0]==="Z") {x=startX; y=startY; return c;}
    const endX=Number(c[c.length-2]), endY=Number(c[c.length-1]);
    const out:PathCommand=c[0]==="Q" ? ["C",x+(c[1]-x)*2/3,y+(c[2]-y)*2/3,endX+(c[1]-endX)*2/3,endY+(c[2]-endY)*2/3,endX,endY] : c;
    if (c[0]==="M") {startX=endX; startY=endY;}
    x=endX; y=endY; return out;
  });
}
export function textRuns(node:TextNode) {
  const {layout,dy}=textNodeLayout(node), offset:Affine=[1,0,0,1,0,dy];
  const groups=new Map<string,{path:CurveElement[];paints:readonly Paint[]}>();
  function part(style:TextStyle) {
    const key=textStyleKey(style);
    let g=groups.get(key);
    if (!g) {g={path:[],paints:style.fills ?? rectanglePaints(node)}; groups.set(key,g);}
    return g.path;
  }
  for (const span of textSpans(node.text)) part(span.style);
  for (const g of layout.glyphs) {
    const s=g.size/g.face.upem, place=multiply(offset,multiply(g.warp ?? identity,[s,0,0,s,g.x,g.y]));
    const target=part(g.style);
    for (const cmd of bake(g.face.outline(g.id,g.coordinates,true),place)) target.push(cmd);
  }
  for (const d of layout.decorations) {
    const target=part(d.style);
    for (const cmd of bake(decorationPath(d),offset)) target.push(cmd);
  }
  return [...groups.values()].filter(g=>g.path.length);
}
export function itemBounds(items:DrawableItem[]):Rectangle {
  let left=Infinity, top=Infinity, right=-Infinity, bottom=-Infinity;
  for (const {box} of items) {
    left=Math.min(left,box.x); top=Math.min(top,box.y);
    right=Math.max(right,box.x+box.width); bottom=Math.max(bottom,box.y+box.height);
  }
  return {x:left,y:top,width:right-left,height:bottom-top};
}
export function overlaps(items:DrawableItem[]) {
  const leaves:Rectangle[]=[];
  function visit(children:DrawableItem[]):boolean {
    for (const it of children) {
      if ("children" in it && !it.transform) {if (visit(it.children)) return true; continue;}
      const a=it.box;
      if (leaves.length===64 || leaves.some(b=>Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>1e-9 &&
        Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>1e-9)) return true;
      leaves.push(a);
    }
    return false;
  }
  return visit(items);
}
