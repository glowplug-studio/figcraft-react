import {identity,transformBounds,type Affine} from "../../affine";
import {axisFactors} from "../../constraints";
import {items,matrix,num,obj} from "./fields";
import type {KiwiObject,KiwiValue} from "./kiwi";

function lengths(value:KiwiObject,keys:readonly string[],factor:number):KiwiObject {
  const result={...value};
  for (const key of keys) {
    const n=num(value[key]);
    if (n!==undefined) result[key]=n*factor;
  }
  return result;
}
const coordinates=["x","y"];
const dimensions=["fontSize","listSpacing","paragraphSpacing","paragraphIndent","cornerRadius","strokeWeight",
  "rectangleTopLeftCornerRadius","rectangleTopRightCornerRadius","rectangleBottomLeftCornerRadius","rectangleBottomRightCornerRadius",
  "borderLeftWeight","borderTopWeight","borderRightWeight","borderBottomWeight","stackSpacing","stackCounterSpacing",
  "stackHorizontalPadding","stackVerticalPadding","stackPaddingRight","stackPaddingBottom","gridColumnGap","gridRowGap"];

/** Scale lengths in the coordinate space of the record that supplied them. */
export function scaledRecord(record:KiwiObject,factor:number):KiwiObject {
  if (factor===1) return record;
  const scaled=lengths(record,dimensions,factor);
  if (record.size) scaled.size=lengths(obj(record.size),coordinates,factor);
  if (record.transform) scaled.transform=lengths(obj(record.transform),["m02","m12"],factor);
  for (const key of ["lineHeight","letterSpacing"]) {
    const units=obj(record[key]);
    if (units.units==="PIXELS") scaled[key]=lengths(units,["value"],factor);
  }
  for (const key of ["minSize","maxSize"]) {
    const limit=obj(record[key]);
    if (limit.value) scaled[key]={...limit,value:lengths(obj(limit.value),coordinates,factor)};
  }
  if (record.dashPattern) scaled.dashPattern=items(record.dashPattern).map(v=>(num(v) ?? 0)*factor);
  if (record.effects) scaled.effects=items(record.effects).map(value=>{
    const effect=lengths(obj(value),["radius","spread","startRadius"],factor);
    for (const key of ["offset","noiseSize"]) if (effect[key]) effect[key]=lengths(obj(effect[key]),coordinates,factor);
    return effect;
  });
  if (record.layoutGrids) scaled.layoutGrids=items(record.layoutGrids).map(v=>lengths(obj(v),["sectionSize","gutterSize","offset"],factor));
  const data=obj(record.textData);
  if (data.styleOverrideTable) scaled.textData={...data,styleOverrideTable:items(data.styleOverrideTable).map(v=>scaledRecord(obj(v),factor))};
  return scaled;
}
function dimensionsOf(value:KiwiValue|undefined) {
  const s=obj(value),x=num(s.x),y=num(s.y);
  return x===undefined || y===undefined ? undefined : {x,y};
}
export function instanceFit(before:KiwiValue|undefined,after:KiwiValue|undefined,group:boolean,scaledMain=false) {
  const from=dimensionsOf(before),to=dimensionsOf(after);
  if (!from || !to) return;
  const close=(a:number,b:number)=>Math.abs(a-b)<=(scaledMain ? 1e-4*Math.max(1,Math.abs(a),Math.abs(b)) : 1e-9);
  if (!close(from.x,to.x) || !close(from.y,to.y)) return {from,to,group};
}
type Fit=NonNullable<ReturnType<typeof instanceFit>>;
function axis(mode:KiwiValue|undefined,start:number,span:number,old:number,next:number,group:boolean) {
  const delta=next-old,ratio=old>1e-9 ? next/old : 1;
  if (group) return {position:(start+span/2)*ratio,ratio};
  if (mode==="SCALE" && old>1e-9) {
    const lo=start*next/old,hi=(start+span)*next/old;
    return {position:lo,ratio:span>1e-9 ? Math.max(0,(hi-lo)/span) : 1};
  }
  if (mode==="STRETCH") return {position:start,ratio:span>1e-9 ? Math.max(0,((start+span+next-old)-start)/span) : 1};
  return {position:start+(mode==="CENTER" ? delta/2 : mode==="MAX" || mode==="FIXED_MAX" ? delta : 0),ratio:1};
}
export function fitInstanceChild(base:KiwiObject,node:KiwiObject,fit:Fit,hasSize:boolean,hasTransform:boolean):KiwiObject {
  const size=dimensionsOf(base.size);
  if (!size) return node;
  const t=matrix(base.transform) ?? identity,box=transformBounds(t,size.x,size.y);
  const horizontal=axis(node.horizontalConstraint,box.x,box.width,fit.from.x,fit.to.x,fit.group);
  const vertical=axis(node.verticalConstraint,box.y,box.height,fit.from.y,fit.to.y,fit.group);
  const [kx,ky]=axisFactors(t,horizontal.ratio,vertical.ratio);
  const width=size.x*kx,height=size.y*ky,linear:Affine=[t[0],t[1],t[2],t[3],0,0];
  const fitted=transformBounds(linear,width,height);
  const x=horizontal.position-(fitted.x+(fit.group ? fitted.width/2 : 0));
  const y=vertical.position-(fitted.y+(fit.group ? fitted.height/2 : 0));
  return {...node,...(!hasSize && {size:{x:width,y:height}}),
    ...(!hasTransform && {transform:{m00:t[0],m01:t[2],m02:x,m10:t[1],m11:t[3],m12:y}})};
}
