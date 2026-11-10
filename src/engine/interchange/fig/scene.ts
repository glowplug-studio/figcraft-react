import type {RestFolder} from "../rest/companions";
import {figOrigin} from "../rest/components";
import {FigComponents,type FigInstance} from "./components";
import {vectorNetwork} from "./network";
import {FigStyles} from "./styles";
import {FigAssets} from "./assets";
import {guideGrids,layoutFields} from "./layout";
import {textLayer} from "./text";
import {identity, multiply, type Affine} from "../../affine";
import {compareScalarKeys} from "../../text-breaks";
import {importRestDocument} from "../rest/document";
import {ImportWarnings} from "../rest/values";
import {colour,effects,guid,items,matrix,num,obj,paints,rows} from "./fields";
import type {KiwiObject, KiwiValue} from "./kiwi";

function pathString(bytes:Uint8Array) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), parts:string[]=[];
  let offset=0;
  while (offset<bytes.length) {
    const opcode=bytes[offset++];
    const count=[0,2,2,4,6][opcode];
    if (count===undefined || offset+count*4>bytes.length || parts.length>=200000) return;
    let part="ZMLQC"[opcode];
    for (let i=0;i<count;i++,offset+=4) {
      const x=view.getFloat32(offset,true);
      if (!Number.isFinite(x)) return;
      let digits=1;
      while (digits<9 && Math.fround(Number(x.toPrecision(digits)))!==x) digits++;
      part+=" "+Number(x.toPrecision(digits));
    }
    parts.push(part);
  }
  return parts.join(" ");
}
function constraint(value:KiwiValue|undefined, low:string,high:string) {
  if (value==="CENTER" || value==="SCALE") return value;
  if (value==="MAX" || value==="FIXED_MAX") return high;
  return value==="STRETCH" ? low+"_"+high : low;
}
function stroke(n:KiwiObject) {
  const limit=num(n.miterLimit),cap=n.strokeCap;
  return {
    strokeWeight:n.strokeWeight,strokeAlign:n.strokeAlign==="OFFSET" ? undefined : n.strokeAlign,strokeJoin:n.strokeJoin,
    strokeCap:cap==="ARROW_LINES" ? "LINE_ARROW" : cap==="ARROW_EQUILATERAL" ? "TRIANGLE_ARROW" : cap,
    strokeDashes:n.dashPattern,strokeMiterAngle:limit!==undefined && limit>1 ? 2*Math.asin(1/limit)*180/Math.PI : undefined,
    ...(n.borderStrokeWeightsIndependent===true && {individualStrokeWeights:{top:n.borderTopWeight ?? 0,right:n.borderRightWeight ?? 0,bottom:n.borderBottomWeight ?? 0,left:n.borderLeftWeight ?? 0}}),
    strokeWidthProfile:items(n.variableWidthPoints).flatMap(v=>{
      const p=obj(v), position=num(p.position), ascent=num(p.ascent), descent=num(p.descent);
      if (position===undefined || ascent===undefined || descent===undefined) return [];
      const l=Math.max(0,ascent), r=Math.max(0,descent), sum=l+r;
      return [[position,sum,sum ? (r-l)/sum : 0]];
    })
  };
}

export async function figScene(msg:KiwiValue,name:string,checkCurrent:()=>void,limit:number,folder?:RestFolder) {
  const root=obj(msg), records=new Map<string,KiwiObject>(), kids=new Map<string,{id:string;position:string}[]>();
  const changes=items(root.nodeChanges);
  const blobs=items(root.blobs).map(v=>obj(v).bytes);
  for (const value of changes) {
    const n=obj(value), id=guid(n.guid);
    if (!id) continue;
    if (n.phase==="REMOVED") records.delete(id); else records.set(id,n);
  }
  const assets=new FigAssets(records,changes);
  for (const [id,n] of records) {
    const p=obj(n.parentIndex), parent=guid(p.guid);
    if (!parent || n.type==="VARIABLE" || n.type==="VARIABLE_SET") continue;
    const list=kids.get(parent) ?? [];
    list.push({id,position:typeof p.position==="string" ? p.position : ""});kids.set(parent,list);
  }
  for (const list of kids.values()) list.sort((a,b)=>compareScalarKeys(a.position,b.position) || compareScalarKeys(a.id,b.id));
  const sorted=[...records.keys()].sort(compareScalarKeys);
  const doc=sorted.find(k=>records.get(k)!.type==="DOCUMENT");
  const pages=doc ? (kids.get(doc) ?? []).map(c=>c.id) : sorted.filter(k=>records.get(k)!.type==="CANVAS");
  const warnings=new ImportWarnings(), warn=(s:string)=>warnings.add(s);
  const components=new FigComponents(records,warn);
  const styles=new FigStyles(assets,warn);
  const paintBudget={remaining:200000};
  const paths=new Map<number,string|undefined>();
  function geometry(values:KiwiValue|undefined) {
    return items(values).flatMap(v=>{
      const p=obj(v), index=num(p.commandsBlob), blob=index===undefined ? undefined : blobs[index];
      if (index===undefined || !(blob instanceof Uint8Array)) return [];
      if (!paths.has(index)) paths.set(index,pathString(blob));
      const path=paths.get(index);
      if (path===undefined) warn("damaged vector geometry was skipped");
      return !path ? [] : [{path,windingRule:p.windingRule==="ODD" ? "EVENODD" : "NONZERO"}];
    });
  }
  let count=0,lastYield=performance.now();
  type Traversal=Generator<void,Record<string,unknown>|undefined>;
  async function run(work:Traversal) {
    let step=work.next();
    while (!step.done) {
      if (performance.now()-lastYield>=8) {
        await new Promise<void>(resolve=>setTimeout(resolve,0));
        checkCurrent();lastYield=performance.now();
      }
      step=work.next();
    }
    return step.value;
  }
  function* layer(id:string,space:Affine,depth:number,parent?:KiwiObject,instance?:FigInstance):Traversal {
    if (depth>256) {warn("layers nested deeper than 256 levels were skipped");return;}
    if (count>=limit) {warn("the file has more than "+limit+" layers; the rest were skipped");return;}
    const {node:n,sizeOverride}=components.override(records.get(id)!,id,instance);
    const restId=instance ? "I"+instance.root+";"+(instance.path ? instance.path+";" : "")+id : id;
    const type=n.type==="ROUNDED_RECTANGLE" ? "RECTANGLE" : n.type==="SYMBOL" ? "COMPONENT" :
      n.type==="FRAME" && n.isStateGroup ? "COMPONENT_SET" : n.type==="FRAME" && n.resizeToFit ? "GROUP" : n.type;
    const t=multiply(space,matrix(n.transform) ?? identity);
    const group=type==="GROUP" || type==="BOOLEAN_OPERATION";
    if (++count%64===0) yield;
    const linked=styles.resolve(n,type);
    const out:Record<string,unknown>={
      styles:linked.refs,
      ...layoutFields(n,parent,warn),layoutGrids:guideGrids(linked.grids),
      exportSettings:items(n.exportSettings).map(v=>{const e=obj(v), c=obj(e.constraint);return {format:e.imageType ?? "PNG",suffix:e.suffix ?? "",constraint:{type:c.type==="CONTENT_WIDTH" ? "WIDTH" : c.type==="CONTENT_HEIGHT" ? "HEIGHT" : "SCALE",value:num(c.value) ?? 1}};}),
      ...(instance && {[figOrigin]:{id,sizeOverride}}),id:restId,type,name:n.name,visible:n.visible,locked:n.locked,isMask:n.mask,maskType:n.maskType==="OUTLINE" ? "VECTOR" : n.maskType,
      size:n.size,opacity:n.opacity,blendMode:n.blendMode==="UNSET" ? undefined : n.blendMode,relativeTransform:rows(t),
      fills:paints(linked.fill,warn),strokes:paints(linked.stroke,warn),effects:effects(linked.effects),...stroke(n),
      cornerRadius:n.cornerRadius,cornerSmoothing:n.cornerSmoothing,arcData:n.arcData,
      constraints:{horizontal:constraint(n.horizontalConstraint,"LEFT","RIGHT"),vertical:constraint(n.verticalConstraint,"TOP","BOTTOM")},
      rectangleCornerRadii:n.rectangleCornerRadiiIndependent ? [n.rectangleTopLeftCornerRadius ?? 0,n.rectangleTopRightCornerRadius ?? 0,
        n.rectangleBottomRightCornerRadius ?? 0,n.rectangleBottomLeftCornerRadius ?? 0] : undefined,
      clipsContent:n.frameMaskDisabled!==true,booleanOperation:n.booleanOperation==="XOR" ? "EXCLUDE" : n.booleanOperation,
      pointCount:n.count,innerRadius:n.starInnerScale
    };
    if (type==="TEXT") Object.assign(out,textLayer(n,warn,linked.text));
    assets.bindings(out,n,warn);
    if (type==="COMPONENT" || type==="COMPONENT_SET") components.definition(out,n,restId);
    const {swap,slot}=components.references(out,n,instance);
    if (type==="VECTOR" || type==="STAR" || type==="REGULAR_POLYGON") {
      const fill=geometry(n.fillGeometry), stroke=geometry(n.strokeGeometry);
      if (fill.length) out.fillGeometry=fill;
      if (stroke.length) out.strokeGeometry=stroke;
      if (type==="VECTOR" && !vectorNetwork(n,out,blobs,warn,paintBudget) && !fill.length && !stroke.length) warn("vectors without geometry are empty");
    }
    const children:unknown[]=[];
    const nested=type==="INSTANCE" ? components.instance(out,n,id,restId,swap,instance) : instance;
    const childSource=type==="INSTANCE" ? nested?.main : slot ?? id;
    for (const child of childSource ? kids.get(childSource) ?? [] : []) {
      const mapped=yield* layer(child.id,group ? t : identity,depth+1,n,nested);
      if (mapped) children.push(mapped);
    }
    if (children.length) out.children=children;
    return out;
  }
  const canvases:unknown[]=[];
  for (const id of pages) {
    const n=records.get(id)!;
    if (n.type!=="CANVAS") {warn("document children other than pages were skipped");continue;}
    if (n.internalOnly) continue;
    const children:unknown[]=[];
    for (const c of kids.get(id) ?? []) {
      const mapped=await run(layer(c.id,identity,0));
      if (mapped) children.push(mapped);
    }
    const page={id,type:"CANVAS",name:n.name,backgroundColor:n.backgroundColor && colour(n.backgroundColor),children};
    assets.bindings(page,n,warn);canvases.push(page);
  }
  if (!canvases.length) warn("the file has no pages");
  checkCurrent();
  const styleDefinitions=await styles.definitions(id=>run(layer(id,identity,0)));
  const imported=await importRestDocument({name,components:components.components,componentSets:components.sets,styles:styles.metadata,styleDefinitions,meta:assets.definitions(),document:{type:"DOCUMENT",children:canvases}},checkCurrent,undefined,undefined,folder,limit);
  if (!imported) throw new Error("Cannot read the Fig document");
  const notes=warnings.finish();
  for (const note of imported.issues ?? []) {
    if (note.includes("geometry=paths")) continue;
    const adapted=note.replaceAll("the variables JSON","the file").replaceAll("the file JSON","the file");
    if (!notes.includes(adapted.replace(/ \(×\d+\)$/u,""))) notes.push(adapted);
  }
  return {...imported,issues:notes};
}
