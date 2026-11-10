import type { Colour } from "../colour";
import { toRgba8 } from "../colour";
import type { CurveElement } from "../curve-flatten";
import type { Rectangle } from "../geometry";
import type { ColourStop } from "../gradient";
import { svgNumber, xmlText } from "../svg-format";

export type DrawablePath = readonly CurveElement[];
export interface GroupTransform { x:number; y:number; sx:number; sy:number; rotation:number }
export interface DrawableGradient {
  type:"linear" | "radial" | "sweep";
  stops:readonly ColourStop[];
  line?:readonly [number,number,number,number];
}
export interface DrawableStroke { color:Colour; width:number; cap:string; join:string; miter:number }
interface NamedItem { name?:string; box:Rectangle }
export interface PathItem extends NamedItem {
  data:DrawablePath; fill?:Colour | DrawableGradient; stroke?:DrawableStroke; even?:boolean;
}
export interface GroupItem extends NamedItem {
  children:DrawableItem[]; clip?:DrawablePath; transform?:GroupTransform;
}
export type DrawableItem = PathItem | GroupItem;

const number = (n:number) => svgNumber(Number.isFinite(n) ? Math.max(-3.4028234663852886e38, Math.min(3.4028234663852886e38,n)) : 0);
function pathData(commands:DrawablePath) {
  return commands.map(command=>{
    const pairs:string[]=[];
    for (let i=1;i<command.length;i+=2) pairs.push(number(command[i] as number)+","+number(command[i+1] as number));
    return command[0]+pairs.join(" ");
  }).join(" ");
}
function colour(c:Colour) {
  const [r,g,b,a]=toRgba8(c);
  return "#"+(a===255 ? [r,g,b] : [a,r,g,b]).map(n=>n.toString(16).padStart(2,"0")).join("").toUpperCase();
}
type Attributes = Record<string,string>;
export function drawableXml(width:number,height:number,items:DrawableItem[]) {
  const lines=['<?xml version="1.0" encoding="utf-8"?>'];
  const indent=(n:number)=>"  ".repeat(n);
  function open(depth:number,tag:string,attributes:Attributes,leaf=false) {
    const pairs=Object.entries(attributes), pad=indent(depth);
    const attrs=pairs.map(([key,value])=>(pairs.length===1 ? " " : "\n"+pad+"    ")+key+'="'+value+'"').join("");
    lines.push(pad+"<"+tag+attrs+(leaf ? " />" : ">"));
  }
  function close(depth:number,tag:string) { lines.push(indent(depth)+"</"+tag+">"); }
  function emit(item:DrawableItem,depth:number) {
    const attrs:Attributes={};
    if (item.name!==undefined) attrs["android:name"]=xmlText(item.name).replaceAll("'","&apos;")
      .replaceAll("\t","&#9;").replaceAll("\n","&#10;").replaceAll("\r","&#13;");
    if ("children" in item) {
      const t=item.transform;
      if (t) for (const [key,val,defaultValue] of [["rotation",t.rotation,0],["scaleX",t.sx,1],["scaleY",t.sy,1],
        ["translateX",t.x,0],["translateY",t.y,0]] as const) {
        if (number(val)!==String(defaultValue)) attrs["android:"+key]=number(val);
      }
      const empty=!item.clip && !item.children.length;
      open(depth,"group",attrs,empty);
      if (empty) return;
      if (item.clip) open(depth+1,"clip-path",{"android:pathData":pathData(item.clip)},true);
      for (const child of item.children) emit(child,depth+1);
      close(depth,"group");
      return;
    }
    attrs["android:pathData"]=pathData(item.data);
    const fill=item.fill;
    if (fill && "r" in fill) attrs["android:fillColor"]=colour(fill);
    const s=item.stroke;
    if (s) {
      attrs["android:strokeColor"]=colour(s.color);
      attrs["android:strokeWidth"]=number(s.width);
      if (s.cap!=="butt") attrs["android:strokeLineCap"]=s.cap;
      if (s.join!=="miter") attrs["android:strokeLineJoin"]=s.join;
      else if (number(s.miter)!=="4") attrs["android:strokeMiterLimit"]=number(s.miter);
    }
    if (item.even && fill) attrs["android:fillType"]="evenOdd";
    const gradient=fill && "stops" in fill ? fill : undefined;
    open(depth,"path",attrs,!gradient);
    if (!gradient) return;
    open(depth+1,"aapt:attr",{name:"android:fillColor"});
    const properties:Attributes={"android:type":gradient.type};
    if (gradient.line) {
      const keys=["startX","startY","endX","endY"];
      gradient.line.forEach((v,i)=>{properties["android:"+keys[i]]=number(v);});
    } else {
      properties["android:centerX"]="0"; properties["android:centerY"]="0";
      if (gradient.type==="radial") properties["android:gradientRadius"]="1";
    }
    open(depth+2,"gradient",properties);
    for (const stop of gradient.stops) open(depth+3,"item",{"android:offset":number(stop.position),"android:color":colour(stop.color)},true);
    close(depth+2,"gradient"); close(depth+1,"aapt:attr"); close(depth,"path");
  }
  function hasGradient(item:DrawableItem):boolean {
    return "children" in item ? item.children.some(hasGradient) : !!item.fill && "stops" in item.fill;
  }
  const attrs:Attributes={"xmlns:android":"http://schemas.android.com/apk/res/android"};
  if (items.some(hasGradient)) attrs["xmlns:aapt"]="http://schemas.android.com/aapt";
  attrs["android:width"]=number(width)+"dp"; attrs["android:height"]=number(height)+"dp";
  attrs["android:viewportWidth"]=number(width); attrs["android:viewportHeight"]=number(height);
  open(0,"vector",attrs);
  if (!items.length) open(1,"path",{"android:pathData":"M0,0"},true);
  for (const item of items) emit(item,1);
  close(0,"vector");
  return lines.join("\n")+"\n";
}
