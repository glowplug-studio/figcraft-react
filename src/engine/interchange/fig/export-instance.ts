import {sameComponentValue} from "../../component-groups";
import {isLeaf,type Document,type InstanceNode,type LayerNode} from "../../document";
import {ancestors} from "../../hierarchy";
import {figGuid} from "./export-layout";
import {obj,items} from "./fields";
import {scaledRecord} from "./instance-geometry";
import type {KiwiObject,KiwiValue} from "./kiwi";

const ownFields=new Set(["guid","phase","parentIndex","type","transform","fillGeometry","strokeGeometry","parameterConsumptionMap","componentPropRefs"]);
const geometry=new Set(["size","transform","fillGeometry","strokeGeometry","vectorData"]);
const clears:KiwiObject={
  variableConsumptionMap:{entries:[]},variableModeBySetMap:{entries:[]},gridColumnsSizing:{entries:[]},gridRowsSizing:{entries:[]},
  mask:false,rectangleCornerRadiiIndependent:false,borderStrokeWeightsIndependent:false,effects:[],dashPattern:[],layoutGrids:[],exportSettings:[],
  prototypeInteractions:[],fillGeometry:[],variableWidthPoints:[],cornerSmoothing:0,stackChildPrimaryGrow:0,stackMode:"NONE",stackChildAlignSelf:"AUTO",
  stackPositioning:"AUTO",minSize:{value:{x:0,y:0}},maxSize:{value:{x:Infinity,y:Infinity}},gridColumnSpan:0,gridRowSpan:0,maxLines:0,
  scrollDirection:"NONE",scrollBehavior:"SCROLLS",parameterConsumptionMap:{entries:[]},textTruncation:"DISABLED",hyperlink:{url:""}
};
for (const f of ["styleIdForFill","styleIdForStrokeFill","styleIdForEffect","styleIdForGrid","styleIdForText"]) clears[f]={guid:figGuid(0xffffffff,0xffffffff)};
function difference(mine:KiwiObject,theirs:KiwiObject) {
  const diff:KiwiObject={};
  for (const [key,value] of Object.entries(mine)) if (value!==undefined && !sameComponentValue(value,theirs[key])) diff[key]=value;
  for (const key of Object.keys(theirs)) if (mine[key]===undefined && clears[key]!==undefined) diff[key]=clears[key];
  return diff;
}
function aligned(a:KiwiValue|undefined,b:KiwiValue|undefined,factor:number,slack=0):boolean {
  if (a===b) return true;
  if (typeof a==="number" && typeof b==="number") return Math.abs(a-b*factor)<=slack+.001*Math.max(1,Math.abs(a));
  if (Array.isArray(a) && Array.isArray(b)) return a.length===b.length && a.every((v,i)=>aligned(v,b[i],factor,slack));
  if (!a || !b || typeof a!=="object" || typeof b!=="object" || Array.isArray(a) || Array.isArray(b)) return false;
  if (a instanceof Uint8Array || b instanceof Uint8Array) return sameComponentValue(a,b);
  const keys=Object.keys(a);
  return keys.length===Object.keys(b).length && keys.every(k=>Object.hasOwn(b,k) && aligned(a[k],b[k],factor,slack));
}
function sameBoundPaints(key:string,a:KiwiValue,b:KiwiValue|undefined) {
  if ((key!=="fillPaints" && key!=="strokePaints") || !Array.isArray(b)) return false;
  const unbound=(list:KiwiValue)=>items(list).map(v=>{
    const p=obj(v);
    if (p.colorVar===undefined) return v;
    const {color,...rest}=p;return rest;
  });
  return sameComponentValue(unbound(a),unbound(b));
}
function grew(changed:KiwiObject,base:KiwiObject,k:number) {
  return (base.strokeWeight===0 || aligned(changed.strokeWeight,base.strokeWeight,k)) &&
    changed.size!==undefined && aligned(changed.size,base.size,k,1) &&
    (changed.transform===undefined || aligned(changed.transform,base.transform,k,1));
}
function equalLengths(mine:KiwiObject,theirs:KiwiObject,k:number) {
  const scaled=scaledRecord(theirs,k),result:KiwiObject={};
  for (const [key,value] of Object.entries(mine)) if (sameComponentValue(value,theirs[key]) && !sameComponentValue(value,scaled[key])) result[key]=value;
  return result;
}
function pathIn(doc:Document,id:string|undefined,main:string,depth=0):string[]|undefined {
  if (!id || depth>32) return;
  const up=ancestors(doc,id),end=up.indexOf(main);
  if (end<0) return;
  for (let i=end-1;i>=0;i--) {
    const slot=doc.nodes[up[i]];
    if (slot.kind==="instance") {
      const inner=pathIn(doc,doc.nodes[id].source,slot.component,depth+1);
      return inner && [slot.id,...inner];
    }
  }
  return [id];
}
function layerPath(doc:Document,n:LayerNode,instance:InstanceNode,depth=0):string[]|undefined {
  const direct=pathIn(doc,n.source,instance.component);
  if (direct || depth>32) return direct;
  for (const id of ancestors(doc,n.id)) {
    if (id===instance.id) break;
    const slot=doc.nodes[id];
    if (slot.kind==="instance") {
      const outer=layerPath(doc,slot,instance,depth+1),inner=pathIn(doc,n.source,slot.component);
      return outer && inner && outer.concat(inner);
    }
  }
}
type Row={path:KiwiObject;node:LayerNode;mine:KiwiObject;base:KiwiObject;diff:KiwiObject;swap?:KiwiObject};

export async function writeInstance(doc:Document,n:InstanceNode,out:KiwiObject,ids:Map<string,number>,
  layer:(n:LayerNode)=>Promise<KiwiObject>,styleList:(slot:"effect"|"grid",id:string)=>KiwiValue|undefined,warn:(s:string)=>void) {
  const main=doc.nodes[n.component],id=ids.get(n.component);
  if (!id || main?.kind!=="component") {out.type="FRAME";warn("instances of components that aren't in the file were written as frames");return;}
  const symbol=figGuid(id),parent=doc.nodes[main.parent];
  const inherited=(fields:KiwiObject)=>Object.fromEntries(Object.entries(fields).filter(([k])=>!ownFields.has(k)));
  const mine=inherited(out),base=inherited(await layer(main));
  if (parent.kind==="componentSet" && n.name===parent.name) delete mine.name;
  const changed=difference(mine,base);
  const stack=[...n.children].reverse(),rows:Row[]=[];
  let visited=0;
  while (stack.length && visited++<200000) {
    const child=doc.nodes[stack.pop()!];
    if (!child || child.kind==="page") continue;
    if (!isLeaf(child)) for (let i=child.children.length-1;i>=0;i--) stack.push(child.children[i]);
    const source=child.source && doc.nodes[child.source],path=layerPath(doc,child,n);
    if (!source || source.kind==="page" || !path || path.some(id=>!ids.has(id))) {
      warn("instance layers that don't come from their main component were left out");continue;
    }
    const mine=await layer(child),base=await layer(source),diff=difference(mine,base);
    const swap=child.kind==="instance" && (source.kind!=="instance" || source.component!==child.component) ? ids.get(child.component) : undefined;
    rows.push({path:{guids:path.map(id=>figGuid(ids.get(id)!))},node:child,mine,base,diff,swap:swap===undefined ? undefined : figGuid(swap)});
  }
  const k=n.width/main.width;
  const scaled=k>=.001 && k<=1000 && Math.abs(k-1)>1e-6 && Math.abs(n.height/main.height-k)<=1e-6*Math.max(1,k)
    && grew(changed,base,k) && rows.every(r=>grew(r.diff,r.base,k));
  const follows=(key:string,v:KiwiValue,base:KiwiObject)=>geometry.has(key) || sameBoundPaints(key,v,base[key]) || scaled && aligned(v,base[key],k);
  const overrides:KiwiObject[]=[],derived:KiwiObject[]=[];
  const root:KiwiObject=scaled ? equalLengths(mine,base,k) : {};
  for (const [key,value] of Object.entries(changed)) if (value!==undefined && (key==="size" || !follows(key,value,base))) root[key]=value;
  if (Object.keys(root).length) overrides.push({guidPath:{guids:[symbol]},...root});
  for (const row of rows) {
    const overridesHere:KiwiObject=scaled ? equalLengths(row.mine,row.base,k) : {},derivedHere:KiwiObject={};
    for (const [key,value] of Object.entries(row.diff)) {
      if (value===undefined) continue;
      if (follows(key,value,row.base)) {
        derivedHere[key]=value;
        if (key==="size" && (row.node.kind==="instance" || row.node.overrides?.includes("size"))) overridesHere[key]=value;
      } else overridesHere[key]=value;
    }
    const links:KiwiObject={};
    for (const [slot,link,field] of [["effect","styleIdForEffect","effects"],["grid","styleIdForGrid","layoutGrids"]] as const) {
      const ref=row.node.styles?.[slot],payload=ref && styleList(slot,ref);
      if (!payload || !overridesHere[link]) continue;
      delete overridesHere[field];delete derivedHere[field];
      const current=row.mine[field] ?? [];
      if (!sameComponentValue(current,payload)) {links[link]=overridesHere[link];delete overridesHere[link];overridesHere[field]=current;}
    }
    if (Object.keys(links).length) overrides.push({guidPath:row.path,...links});
    if (row.swap) overridesHere.overriddenSymbolID=row.swap;
    if (Object.keys(overridesHere).length) overrides.push({guidPath:row.path,...overridesHere});
    if (Object.keys(derivedHere).length) derived.push({guidPath:row.path,...derivedHere});
  }
  out.symbolData={symbolID:symbol,symbolOverrides:overrides,uniformScaleFactor:scaled ? k : 1};
  if (derived.length) out.derivedSymbolData=derived;
}
