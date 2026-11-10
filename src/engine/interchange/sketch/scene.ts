import { identity, multiply, type Affine } from "../../affine";
import { imageHash, readImageResource, type ImageResource } from "../../image-resource";
import { importRestDocument } from "../rest/document";
import { ImportImages } from "../rest/paint";
import { children, clipped, object, string, type JsonObject } from "../rest/values";
import { sketchFontNote, sketchTooOld, type SketchArchive } from "./archive";
import { frameSize, sketchBase, sketchColour, sketchCorners, sketchLocal, type SketchNode } from "./geometry";
import { sketchExtras, sketchStack } from "./layout";
import { sketchFade, sketchMask, sketchMaskGroups } from "./masks";
import { sketchCutCorners, sketchShape } from "./path";
import { prepareImportFonts } from "../../text-node-layout";
import { sketchFontMetrics } from "./font-metrics";
import { reflowSketchInstances } from "./reflow";
import { sketchShapeGroup } from "./shape-group";
import { SketchSymbols } from "./symbols";
import { sketchTint } from "./tint";
import { SketchShared } from "./shared";
import { bitmapFilters, sketchStyle } from "./style";
import { sketchBaselineShift, sketchText, type SketchTextContext } from "./text";

const basicTypes = new Map(Object.entries({artboard:"FRAME",frame:"FRAME",graphic:"GROUP",rectangle:"RECTANGLE",oval:"ELLIPSE",
  bitmap:"RECTANGLE",slice:"SLICE",shapePath:"VECTOR",star:"VECTOR",triangle:"VECTOR",polygon:"VECTOR",text:"TEXT",hotspot:"FRAME",MSImmutableHotspotLayer:"FRAME"}));
function layerType(layer:JsonObject) {
  if (layer._class==="group") return [1,2].includes(Number(layer.groupBehavior)) || layer.clippingBehavior===1 ? "FRAME" : "GROUP";
  if ((layer._class==="oval" || layer._class==="rectangle") && layer.edited===true) return "VECTOR";
  return basicTypes.get(String(layer._class));
}

export async function sketchScene(archive:SketchArchive, name:string, maxNodes:number, checkCurrent:()=>void, font?:SketchTextContext["font"], workLimit?:number) {
  const shared=new SketchShared(archive.document), notes:string[]=[], seen=new Set<string>();
  function warn(s:string) {
    if (seen.has(s) || seen.size>200) return;
    seen.add(s); notes.push(seen.size>200 ? "more notes were left out" : s);
  }
  let fonts:Awaited<ReturnType<typeof prepareImportFonts>>|undefined;
  const cx:SketchTextContext={swatches:shared.swatches,warn,font};
  async function prepareFonts() {
    fonts=await prepareImportFonts();
    checkCurrent();
    if (!cx.font) {
      const names=fonts.postscriptNames();
      cx.font=name=>names.get(name.toLowerCase());
    }
  }
  if (shared.text.size) await prepareFonts();
  const symbols=new SketchSymbols(archive,shared,cx,workLimit);
  const definitions=shared.definitions(cx);
  let count=0, lastYield=performance.now();
  function appearance(layer:JsonObject,node:SketchNode,w:number,h:number) {
    if (layer._class!=="artboard") {
      if (layer.style!==undefined) sketchStyle(cx,object(layer.style),w,h,node);
      shared.link(layer,node);
    }
    sketchExtras(layer,node,h,warn);
  }
  async function siblings(source: JsonObject, world: Affine, w:number, h:number, depth:number, root:boolean) {
    const built=[];
    for (const raw of children(source.layers)) {
      const child=object(raw), node=await build(child,world,depth+1,root);
      if (node) built.push({node,breaks:child.shouldBreakMaskChain===true || child.hasClippingMask===true});
    }
    return sketchMaskGroups(built,world,w,h,root);
  }
  async function build(input:JsonObject,parent:Affine,depth:number,root:boolean,operandFill?:boolean,operandBorder=false):Promise<SketchNode|undefined> {
    if (performance.now()-lastYield>12) {
      await new Promise<void>(resolve=>setTimeout(resolve,0)); checkCurrent(); lastYield=performance.now();
    }
    if (depth>200) {warn("layers nested deeper than 200 levels were skipped");return;}
    if (Object.hasOwn(object(input.attributedString),"archivedAttributedString")) throw new Error(sketchTooOld);
    const layer=sketchCutCorners(input), kind=string(layer._class);
    if (!kind) return;
    const type=layerType(layer);
    if (!type && !["shapeGroup","symbolMaster","symbolInstance"].includes(kind)) {
      warn("Sketch "+clipped(kind)+" layers are not supported yet and were skipped"); return;
    }
    if (count>=maxNodes) {warn("the file has more than "+maxNodes+" layers; the rest were skipped");return;}
    count++;
    if (kind==="symbolMaster") return symbols.component(layer,parent,depth,root,siblings);
    if (kind==="symbolInstance") return symbols.instance(layer,parent,depth,root,siblings);
    if (kind==="shapeGroup") return sketchShapeGroup({layer:build,appearance,warn},layer,parent,depth,root);
    const {w,h}=frameSize(layer);
    let world=multiply(parent,sketchLocal(layer,w,h));
    if (type==="TEXT") world=multiply(world,[1,0,0,1,0,sketchBaselineShift(layer)]);
    const node=sketchBase(layer,type!,parent,world,w,h,root);
    if (type==="TEXT") {
      if (!fonts) await prepareFonts();
      sketchText(cx,layer,node);
    }
    if (type==="VECTOR") {
      const shape=sketchShape(layer,warn,operandFill,operandBorder);
      if (!shape) return;
      Object.assign(node,shape);
    }
    sketchMask(layer,node);
    if (kind==="artboard" || kind==="frame") {
      node.clipsContent=kind==="artboard" || layer.clipsContent!==false;
      const colour=layer.hasBackgroundColor===true && sketchColour(layer.backgroundColor);
      if (colour || kind==="artboard") node.fills=[{type:"SOLID",color:colour || {r:1,g:1,b:1,a:1}}];
    } else if (kind==="group" && type==="FRAME") node.clipsContent=layer.clippingBehavior!==2;
    let bitmap:SketchNode | undefined;
    if (kind==="bitmap") {
      const ref=string(object(layer.image)._ref);
      if (ref===undefined) warn("images stored inside the JSON were skipped");
      else bitmap={type:"IMAGE",scaleMode:"STRETCH",imageRef:ref,imageTransform:[[1,0,0],[0,1,0]],filters:bitmapFilters(cx,layer)};
    }
    appearance(layer,node,w,h);
    if (bitmap) {
      node.fills=[bitmap,...children(node.fills)];
      if (node.styles) {const refs={...object(node.styles)};delete refs.fill;node.styles=refs;}
    }
    sketchCorners(node,layer);
    if (kind==="hotspot" || kind==="MSImmutableHotspotLayer") {node.clipsContent=false;delete node.fills;}
    if (type==="FRAME" || type==="GROUP") {
      const tint=kind==="group" ? sketchTint(layer,layer.groupBehavior!==1 && symbols.tints) : undefined;
      const source=symbols.tinted(layer,tint);
      if (source!==layer && layer.groupBehavior!==1) delete node.fills;
      const kids=await siblings(source,world,w,h,depth,false);
      node.children=kids;
      sketchStack(layer,node,kids);
    }
    return sketchFade(cx,layer,node,world,w,h);
  }
  const canvases:SketchNode[]=[];
  for (const {id,page} of archive.pages) {
    const starts=children(page.layers).map(object).filter(l=>l.isFlowHome===true && typeof l.do_objectID==="string")
      .map(l=>({nodeId:l.do_objectID,name:string(l.name) ?? "Flow"}));
    canvases.push({type:"CANVAS",id,name:string(page.name) ?? "Page",children:await siblings(page,identity,0,0,0,true),flowStartingPoints:starts});
  }
  const library=await symbols.library(siblings);
  if (library) canvases.push(library);
  const root={name,document:{type:"DOCUMENT",id:"0:0",children:canvases},styleDefinitions:definitions,...shared.variables()};
  const found=new Map<string,{key:string;resource:ImageResource}>(), imageRefs=new Set<string>();
  const collectPaints=(paints:unknown)=>{
    for (const value of children(paints)) {
      const p=object(value);
      if (p.type==="IMAGE" && typeof p.imageRef==="string") imageRefs.add(p.imageRef);
    }
  };
  function collectNode(node:JsonObject) {
    collectPaints(node.fills);collectPaints(node.strokes);collectPaints(object(node.style).fills);
    for (const override of Object.values(object(node.styleOverrideTable))) collectPaints(object(override).fills);
    for (const child of children(node.children)) collectNode(object(child));
  }
  for (const def of definitions) collectNode(object(def.node));
  for (const canvas of canvases) collectNode(canvas);
  for (const ref of imageRefs) {
    const bytes=await archive.image(ref);
    if (!bytes) continue;
    const resource=await readImageResource(bytes);
    if (resource.width && resource.height) {
      const key=await imageHash(bytes);
      found.set(ref,{key,resource:{...resource,digest:key}});
    }
    checkCurrent();
  }
  const decoded=await importRestDocument(root,checkCurrent,new ImportImages(found),undefined,undefined,maxNodes);
  if (!decoded) throw new Error("Sketch import did not produce a document");
  const embedded=sketchFontNote(archive.document);
  const fitted=fonts ? await sketchFontMetrics(decoded.document,fonts,checkCurrent) : decoded.document;
  const document=await reflowSketchInstances(fitted,checkCurrent);
  return {...decoded,document:archive.document.colorSpace===2 ? {...document,colourProfile:"displayP3" as const} : document,
    issues:[...archive.warnings,...notes,...(embedded ? [embedded] : []),...(decoded.issues ?? [])]};
}
