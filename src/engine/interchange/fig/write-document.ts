import {identity} from "../../affine";
import {defaultConstraints,isFrameLike,isLeaf,layerBlend,layerTransform,pageColour,rectanglePaints,type Document,type LayerNode} from "../../document";
import {zeroCorners} from "../../corners";
import {outlinedStroke} from "./outlined-stroke";
import {writeInstance} from "./export-instance";
import {FigComponentProperties} from "./export-component";
import {FigAssetWriter} from "./export-assets";
import {FigBlobs,shapeGeometry} from "./export-geometry";
import {FigPaintWriter,wireBlend,wireEffect,wireMatrix,wireStroke} from "./export-paint";
import {figGuid as guid,figPosition as position,FigLayoutWriter} from "./export-layout";
import {writeVector} from "./export-vector";
import {wireText} from "./export-text";
import {encodeFigCanvas} from "./encode-canvas";
import type {KiwiObject} from "./kiwi";
import {writeFigArchive} from "./write-archive";

const rootFields={visible:true,opacity:1,transform:wireMatrix(identity),strokeWeight:0,strokeAlign:"CENTER",strokeJoin:"BEVEL"};
const constraint={top:"MIN",bottom:"MAX",left:"MIN",right:"MAX",leftRight:"STRETCH",topBottom:"STRETCH",center:"CENTER",scale:"SCALE"} as const;
const kinds={rectangle:"ROUNDED_RECTANGLE",frame:"FRAME",group:"FRAME",booleanOp:"BOOLEAN_OPERATION",polygon:"REGULAR_POLYGON",
  star:"STAR",line:"LINE",ellipse:"ELLIPSE",vector:"VECTOR",text:"TEXT",component:"SYMBOL",componentSet:"FRAME",instance:"INSTANCE"} as const;

async function writeLayer(node:LayerNode,paints:FigPaintWriter,blobs:FigBlobs):Promise<KiwiObject> {
  const c=node.constraints ?? defaultConstraints,out:KiwiObject={name:node.name,type:kinds[node.kind],visible:node.visible!==false,
    locked:node.locked===true,opacity:node.opacity ?? 1,blendMode:wireBlend(layerBlend(node)),size:{x:node.width,y:node.height},transform:wireMatrix(layerTransform(node)),
    fillPaints:await paints.list(node.kind==="text" && node.text.style.fills ? node.text.style.fills : rectanglePaints(node)),strokePaints:await paints.list(node.strokes ?? []),
    ...wireStroke(node,paints.warn),horizontalConstraint:constraint[c.horizontal],verticalConstraint:constraint[c.vertical]};
  if (node.kind==="text") Object.assign(out,await wireText(node.text,rectanglePaints(node),paints));
  if (node.isMask) {out.mask=true;out.maskType=node.maskType==="vector" ? "OUTLINE" : node.maskType==="luminance" ? "LUMINANCE" : "ALPHA";}
  if (node.effects?.length) out.effects=node.effects.map(e=>wireEffect(e,paints.warn));
  if (node.kind==="componentSet") out.isStateGroup=true;
  if ((node.kind==="component" || node.kind==="componentSet") && node.description) out.symbolDescription=node.description;
  if (node.kind==="group") out.resizeToFit=true;
  if (node.kind==="ellipse") {
    const tau=2*Math.PI,angle=Math.atan2(Math.sin(node.start),Math.cos(node.start));
    const start=Math.abs(node.start)<tau ? node.start : ((angle<0 ? angle+tau : angle)%tau);
    out.arcData={startingAngle:start,endingAngle:start+node.sweep,innerRadius:node.inner};
  }
  if (node.kind==="star" || node.kind==="polygon") out.count=node.count;
  if (node.kind==="star") out.starInnerScale=node.innerRatio;
  if (node.kind==="booleanOp") out.booleanOperation=node.op==="exclude" ? "XOR" : node.op.toUpperCase();
  if (isFrameLike(node)) out.frameMaskDisabled=!node.clip;
  const box=node.kind==="rectangle" || isFrameLike(node);
  if (box || node.kind==="star" || node.kind==="polygon" || node.kind==="vector") {
    const corners=node.corners ?? zeroCorners,[tl,tr,br,bl]=corners.radii;
    out.cornerRadius=tl;
    if (box && (tl>0 || corners.radii.some(r=>r!==tl))) {
      Object.assign(out,{rectangleTopLeftCornerRadius:tl,rectangleTopRightCornerRadius:tr,rectangleBottomRightCornerRadius:br,rectangleBottomLeftCornerRadius:bl});
      if (corners.radii.some(r=>r!==tl)) out.rectangleCornerRadiiIndependent=true;
    }
    if (corners.smoothing>0) out.cornerSmoothing=corners.smoothing;
  }
  if (node.kind==="vector") writeVector(out,node,blobs);
  shapeGeometry(out,node,blobs);
  return out;
}
export async function writeFigDocument(doc:Document,checkCurrent:()=>void,thumbnail?:Blob) {
  const warnings=new Set<string>(),warn=(s:string)=>{warnings.add(s);};
  const paints=new FigPaintWriter(doc,warn),blobs=new FigBlobs(warn),documentGuid=guid(0,0);
  const changes:KiwiObject[]=[{guid:documentGuid,phase:"CREATED",type:"DOCUMENT",name:doc.name,...rootFields,
    documentColorProfile:doc.colourProfile==="displayP3" ? "DISPLAY_P3" : "SRGB"}];
  let aux=0;
  const layout=new FigLayoutWriter(doc,()=>++aux,warn);
  const stack=doc.pages.map((id,index)=>({id,index,depth:0,parent:documentGuid})).reverse();
  const ids=new Map<string,number>(),order=[];
  while (stack.length) {
    const item=stack.pop()!,node=doc.nodes[item.id];
    if (!node || ids.has(item.id)) continue;
    if (ids.size>=200000) {warn("the document has more layers than a .fig file is read with; the rest were left out");break;}
    const local=ids.size+1;
    ids.set(item.id,local);order.push(item);
    const mirrored=node.kind==="instance" && doc.nodes[node.component]?.kind==="component";
    if (!isLeaf(node) && !mirrored) for (let i=node.children.length-1;i>=0;i--)
      stack.push({id:node.children[i],index:i,depth:item.depth+1,parent:guid(local)});
  }
  const properties=new FigComponentProperties(doc,ids,()=>++aux,warn);
  const assets=new FigAssetWriter(doc,ids.size+1,paints,()=>++aux);
  const sharedLayer=async(node:LayerNode)=>{
    const outline=outlinedStroke(doc,node);
    if (outline) {
      node=outline.vector;
      warn("strokes wider on one side of their path were written as filled outlines (the stroke itself is kept for FigCraft)");
    }
    const layer=await writeLayer(node,paints,blobs);
    if (outline) layer.pluginData=[{pluginID:"figcraft",key:"stroke",value:outline.value}];
    layout.apply(layer,node,doc.nodes[node.parent]);
    assets.links(layer,node);
    properties.references(layer,node);
    if (node.kind==="booleanOp" && node.children.some(id=>{const c=doc.nodes[id];return c && c.kind!=="page" && c.boolOp;}))
      warn("boolean groups whose layers combine in different ways use the group's operation");
    if (node.kind==="text" && !node.styles?.text && (node.text.style.styleId!==undefined || node.text.runs.some(r=>r.style.styleId!==undefined)))
      warn("text styles applied to part of a text were written as their values");
    if (node.thumbnailFlag!==undefined) warn("plugin data was left out");
    return layer;
  };
  const nestedLayer=async(node:LayerNode)=>{
    const {type,isStateGroup,symbolDescription,...fields}=await sharedLayer(node);
    return fields;
  };
  let lastYield=performance.now();
  for (const {id,index,depth,parent} of order) {
    const node=doc.nodes[id];
    if (depth>256) {warn("layers nested deeper than 256 levels were left out");continue;}
    const base={guid:guid(ids.get(id)!),phase:"CREATED",parentIndex:{guid:parent,position:position(index)}};
    let layer:KiwiObject;
    if (node.kind==="page") {
      if (node.prototypeBackground) warn("prototype device settings were left out");
      const background=pageColour(node);
      layer={type:"CANVAS",name:node.name,...rootFields,backgroundColor:{...background},backgroundEnabled:true,backgroundOpacity:background.a};
    } else {
      layer=await sharedLayer(node);
      if (node.kind==="instance") {
        await writeInstance(doc,node,layer,ids,nestedLayer,(slot,id)=>assets.styleList(slot,id),warn);
        properties.assignments(layer,node);
      } else properties.definitions(layer,node);
    }
    if (node.kind==="page") assets.links(layer,node);
    changes.push({...base,...layer});
    if (changes.length%64===0 && performance.now()-lastYield>8) {
      await new Promise<void>(resolve=>setTimeout(resolve,0));checkCurrent();lastYield=performance.now();
    }
  }
  checkCurrent();
  await assets.append(changes,rootFields);
  const canvas=await encodeFigCanvas({type:"NODE_CHANGES",sessionID:0,nodeChanges:changes,blobs:blobs.blobs},
    blobs.blobs.map(b=>b.bytes.buffer as ArrayBuffer),checkCurrent);
  const page=doc.nodes[doc.pages[0]],background=page?.kind==="page" ? pageColour(page) : {r:1,g:1,b:1,a:1};
  const blob=await writeFigArchive(canvas,doc.name,background,paints.files,thumbnail);
  checkCurrent();
  return {blob,warnings:[...warnings],format:"fig" as const};
}
