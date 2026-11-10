import { identity, multiply, type Affine } from "../../affine";
import { children, numeric, object, string, type JsonObject } from "../rest/values";
import type { SketchArchive } from "./archive";
import { frameSize, sketchBase, sketchColour, sketchCorners, sketchLocal, type SketchNode } from "./geometry";
import { sketchExtras, sketchStack } from "./layout";
import { applySketchOverrides, prefixSketchIds, resizeSketchLayers, sketchOverrides } from "./overrides";
import type { SketchShared } from "./shared";
import { sketchStyle, type SketchStyleContext } from "./style";
import { isRecord, sketchTint, sketchWeight, tintSketchLayers } from "./tint";

type Siblings=(layer:JsonObject, world:Affine, w:number, h:number, depth:number, root:boolean)=>Promise<SketchNode[]>;
export class SketchSymbols {
  readonly masters=new Map<string,JsonObject>();
  readonly #cost=new Map<string,number>();
  readonly #foreign:JsonObject[]=[];
  readonly #libraries:string[]=[];
  readonly #chain:string[]=[];
  readonly #legacy:boolean;
  readonly tints:boolean;
  constructor(archive:SketchArchive,readonly shared:SketchShared,readonly cx:SketchStyleContext,private remaining=15_000_000) {
    this.#legacy=archive.version>0 && archive.version<110;
    this.tints=!archive.version || archive.version>123;
    const add=(layer:JsonObject)=>{
      const sid=string(layer.symbolID);
      if (sid!==undefined && this.masters.size<100000 && !this.masters.has(sid)) this.masters.set(sid,layer);
    };
    const visit=(parent:JsonObject,depth:number)=>{
      if (depth>64) return;
      for (const raw of children(parent.layers)) {
        const child=object(raw);
        if (child._class==="symbolMaster") add(child);else visit(child,depth+1);
      }
    };
    for (const {page} of archive.pages) visit(page,0);
    for (const raw of children(archive.document.foreignSymbols)) {
      const f=object(raw),m=object(f.symbolMaster),sid=string(m.symbolID);
      if (sid===undefined || this.masters.has(sid)) continue;
      const lib=string(f.sourceLibraryName);
      if (lib!==undefined && !this.#libraries.includes(lib)) this.#libraries.push(Array.from(lib).slice(0,64).join(""));
      add(m); this.#foreign.push(m);
    }
  }
  tinted(layer:JsonObject, tint:JsonObject|undefined) {
    if (!tint) return layer;
    const cost=sketchWeight(layer);
    if (cost>this.remaining) {
      this.cx.warn("tints past what the import handles were skipped; those layers keep their own colours");return layer;
    }
    this.remaining-=cost;
    const copy=structuredClone(layer);
    tintSketchLayers(children(copy.layers),tint);
    return copy;
  }
  #frameLook(master:JsonObject,node:SketchNode,w:number,h:number) {
    node.clipsContent=master.clippingBehavior===1;
    if (Object.hasOwn(master,"groupBehavior") && master.style!==undefined) sketchStyle(this.cx,object(master.style),w,h,node);
    sketchCorners(node,master);
  }
  #background(master:JsonObject,node:SketchNode) {
    const c=master.hasBackgroundColor===true && sketchColour(master.backgroundColor);
    if (c) node.fills=[{type:"SOLID",color:c}];
  }
  async #children(sid:string,siblings:Siblings,master:JsonObject,world:Affine,w:number,h:number,depth:number) {
    this.#chain.push(sid);
    try {return await siblings(master,world,w,h,depth,false);} finally {this.#chain.pop();}
  }
  async component(layer:JsonObject,parent:Affine,depth:number,root:boolean,siblings:Siblings) {
    const {w,h}=frameSize(layer),world=multiply(parent,sketchLocal(layer,w,h));
    const node=sketchBase(layer,"COMPONENT",parent,world,w,h,root);
    this.#frameLook(layer,node,w,h); this.#background(layer,node);
    sketchExtras(layer,node,h,this.cx.warn);
    const copy=this.tinted(layer,sketchTint(layer,false));
    const kids=await this.#children(string(layer.symbolID) ?? "",siblings,copy,world,w,h,depth);
    node.children=kids; sketchStack(copy,node,kids);
    return node;
  }
  async instance(layer:JsonObject,parent:Affine,depth:number,root:boolean,siblings:Siblings) {
    const {w,h}=frameSize(layer),world=multiply(parent,sketchLocal(layer,w,h)),sid=string(layer.symbolID) ?? "";
    const master=this.masters.get(sid);
    const budgetWarning="the file's symbols expand to more than the import handles; the instances past that were imported as empty frames";
    const cost=this.#cost.get(sid) ?? (master && sketchWeight(master)) ?? 0;
    if (master) this.#cost.set(sid,cost);
    if (!master || cost>this.remaining) {
      if (master) this.remaining=0;
      this.cx.warn(master ? budgetWarning : "instances of symbols that aren't in the file were imported as empty frames");
      return {...sketchBase(layer,"FRAME",parent,world,w,h,root),children:[]};
    }
    this.remaining-=cost;
    if (this.#chain.includes(sid)) {
      this.cx.warn("symbol "+Array.from(string(master.name) ?? "").slice(0,64).join("")+" contains itself; the inner copy was left out");return;
    }
    const scale=numeric(layer.scale);
    if (scale && Math.abs(scale-1)>1e-9) this.cx.warn("scaled symbol instances were imported at their size, unscaled");
    const node=sketchBase(layer,"INSTANCE",parent,world,w,h,root);
    node.componentId=string(master.do_objectID) ?? sid;
    this.#frameLook(master,node,w,h);
    if (master.includeBackgroundColorInInstance===true && master.includeBackgroundColorInExport===true) this.#background(master,node);
    else delete node.fills;
    if (layer.style!==undefined) {
      const style={...object(layer.style)};delete style.fills;
      sketchStyle(this.cx,style,w,h,node);
    }
    sketchExtras(layer,node,h,this.cx.warn);
    const guides:SketchNode={type:"FRAME"};
    sketchExtras({layout:master.layout,grid:master.grid},guides,h,this.cx.warn);
    if (guides.layoutGrids) node.layoutGrids=guides.layoutGrids;
    const copy:SketchNode=structuredClone(master), overrides=sketchOverrides(layer), layers=children(copy.layers);
    this.remaining=applySketchOverrides(layers,overrides,this.shared,this.masters,this.remaining);
    if (!this.remaining) this.cx.warn(budgetWarning);
    const own=overrides.get(String(layer.do_objectID)+"_fillColor");
    const tint=(typeof layer.do_objectID==="string" && isRecord(own) ? own : undefined) ?? sketchTint(layer,this.tints) ?? sketchTint(copy,false);
    if (tint) tintSketchLayers(layers,tint);
    const {w:mw,h:mh}=frameSize(copy),graphic=copy.groupBehavior===2;
    const stack=!graphic && object(copy.groupLayout)._class==="MSImmutableFlexGroupLayout";
    if (!stack && (Math.abs(mw-w)>1e-9 || Math.abs(mh-h)>1e-9)) resizeSketchLayers(layers,mw,mh,w,h,this.#legacy || graphic);
    const kids=await this.#children(sid,siblings,copy,world,w,h,depth);
    node.children=kids;
    for (const field of ["horizontalSizing","verticalSizing"]) if (Object.hasOwn(layer,field)) copy[field]=layer[field];
    sketchStack(copy,node,kids);
    for (const kid of kids) prefixSketchIds(kid,string(layer.do_objectID) ?? "I");
    return node;
  }
  async library(siblings:Siblings) {
    if (!this.#foreign.length) return;
    let x=0;const kids=[];
    for (const master of this.#foreign) {
      const placed={...master,...(isRecord(master.frame) && {frame:{...master.frame,x,y:0}})};
      x+=frameSize(master).w+100;
      kids.push(await this.component(placed,identity,0,true,siblings));
    }
    this.cx.warn("symbols from the libraries "+this.#libraries.join(", ")+" became local components on the page Library symbols");
    return {type:"CANVAS",id:"library-symbols",name:"Library symbols",children:kids};
  }
}
