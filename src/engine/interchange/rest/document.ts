import {restoreOutlinedStroke} from "./outlined-stroke";
import { unfoldRestAlpha } from "./paint-bindings";
import { refreshBoundStyles } from "../../style-application";
import { refreshLayerBindings } from "../../layer-variable-bindings";
import { ImportStyles } from "./styles";
import { SiblingImages,type RestFolder } from "./companions";
import { ImportComponents } from "./components";
import { ImportVariables } from "./bindings";
import { childLayout, layoutGrids, restLayout } from "./layout";
import { isFrameLikeKind, isGroupLike, isLeaf, newDocument, type Document, type DocumentNode, type PageNode } from "../../document";
import { readNode, type DecodedFigcraft } from "../../file-format";
import { HierarchyDraft } from "../../hierarchy";
import { wireId } from "../../native-values";
import { pageSpace, placement, type ImportSpace } from "./placement";
import { ImportImages } from "./paint";
import { textFields } from "./text";
import { vectorFields } from "./vector";
import { restProperties } from "./properties";
import { ImportWarnings, children, clamp, clipped, entries, numeric, object, restColour, string, type JsonObject } from "./values";

const simpleKinds=new Map([["RECTANGLE","rectangle"],["FRAME","frame"],["GROUP","group"],["LINE","line"],["COMPONENT","component"],["COMPONENT_SET","componentSet"]]);
function shape(n:JsonObject,warnings:ImportWarnings,images:ImportImages):Record<string,unknown>|undefined {
  const ty=string(n.type);
  if (!ty) {warnings.add("layers without a type were skipped");return;}
  const kind=simpleKinds.get(ty);
  if (kind) return {type:kind};
  switch (ty) {
    case "ELLIPSE": {
      const arc=object(n.arcData),tau=2*Math.PI, start=clamp(numeric(arc.startingAngle) ?? 0,-1e15,1e15);
      const end=numeric(arc.endingAngle), stop=end===undefined ? start+tau : clamp(end,-1e15,1e15);
      const delta=stop-start, precision=(Math.abs(start)+Math.abs(stop)+tau)*2**-23;
      const sweep=end===undefined ? tau : precision<=.001 && Math.abs(delta)>=tau-precision ? Math.sign(delta)*tau : clamp(delta,-tau,tau);
      const angle=Math.atan2(Math.sin(start),Math.cos(start)), reduced=angle<0 ? angle+tau : angle;
      return {type:"ellipse",start:Math.abs(start)<tau ? start : reduced<tau ? reduced : 0,sweep,inner:clamp(numeric(arc.innerRadius) ?? 0,0,1)};
    }
    case "STAR": case "REGULAR_POLYGON": {
      const supplied=numeric(n.pointCount), star=ty==="STAR";
      const count=supplied!==undefined && supplied>=3 ? Math.min(Math.trunc(supplied),1000) : undefined;
      if (count===undefined && (children(n.fillGeometry).length || children(n.strokeGeometry).length)) return {type:"vector"};
      if (count===undefined) warnings.add("stars and polygons without point counts or geometry use the default point count");
      return {type:star ? "star" : "polygon", count:count ?? (star ? 5 : 3),...(star && {inner_ratio:clamp(numeric(n.innerRadius) ?? .382,.01,1)})};
    }
    case "BOOLEAN_OPERATION": return {type:"booleanOp",op:["SUBTRACT","INTERSECT","EXCLUDE"].includes(string(n.booleanOperation) ?? "") ? String(n.booleanOperation).toLowerCase() : "union"};
    case "INSTANCE": case "SLOT": return {type:"frame"};
    case "VECTOR": return {type:"vector"};
    case "TEXT": return {type:"text",...textFields(n,images,warnings)};
    case "SECTION": case "SLICE": throw new Error("REST "+ty+" layer import is not supported yet");
    default: warnings.add(clipped(ty)+" layers are not supported and were skipped");return;
  }
}
interface LayerList {
  readonly parent:string;
  readonly items:readonly unknown[];
  index:number;
  readonly space:ImportSpace;
  readonly absolute:boolean;
  readonly depth:number;
  readonly parentMode?:string;
}
function entryRoots(source:JsonObject) {
  return object(source.document).type==="DOCUMENT" ? [source] :
    entries(source.nodes).map(([,v])=>object(v)).filter(v=>typeof object(v.document).type==="string");
}
const title=(s:string)=>s[0].toUpperCase()+s.slice(1);

export async function importRestDocument(input:unknown,checkCurrent:()=>void=()=>{},images=new ImportImages(),companion?:unknown,folder?:RestFolder,figLayerLimit?:number,libraryContexts:readonly unknown[]=[]):Promise<DecodedFigcraft|undefined> {
  const source=object(input), roots=entryRoots(source);
  if (!roots.length) return;
  const warnings=new ImportWarnings(), name=string(source.name);
  const initial=newDocument(name?.trim() ? clipped(name) : "Imported file");
  const variables=new ImportVariables(source,companion,warnings);
  const layerLimit=figLayerLimit===undefined ? 200000 : figLayerLimit+libraryContexts.length;
  const siblings=folder && new SiblingImages(folder.image);
  if (siblings) {
    images=new ImportImages(siblings.found,figLayerLimit!==undefined ? warnings : undefined);
    for (const def of children(source.styleDefinitions).slice(0,256)) await siblings.prepare(object(object(def).node),checkCurrent);
  }
  const styles=new ImportStyles(roots,source,images,variables,warnings);
  const base=new HierarchyDraft(initial), pages:string[]=[], childLists=new Map<string,string[]>(), fit:string[]=[];
  let next=2, count=0, visited=0, lastYield=performance.now(), loose:string|undefined;
  const components=new Map<string,string>(), sets=new Map<string,string>();
  const importedIds=new Map<string,string>();
  const componentImport=new ImportComponents(base,importedIds,warnings);
  for (const e of roots) {
    for (const [field,map] of [["components",components],["componentSets",sets]] as const) {
      for (const [id,v] of entries(e[field])) if (!map.has(id)) map.set(id,clipped(string(object(v).description) ?? ""));
    }
  }

  function addPage(n:JsonObject,fallback:string) {
    const id=String(next++);
    base.nodes[id]=readNode(id,{type:"page",id:wireId(id),name:clipped(string(n.name) ?? fallback),width:0,height:0,
      var_modes:variables.modes(n),background:restColour(n.backgroundColor) ?? "#f5f5f5"});
    pages.push(id);
    childLists.set(id,[]);
    return id;
  }
  async function build(items:readonly unknown[],parent:string,absolute:boolean) {
    const stack:LayerList[]=[{items,parent,index:0,space:pageSpace,absolute,depth:0}];
    while (stack.length) {
      const cursor=stack[stack.length-1];
      if (cursor.index===cursor.items.length) {
        if (isGroupLike(base.nodes[cursor.parent])) fit.push(cursor.parent);
        stack.pop();continue;
      }
      if (++visited%128===0 && performance.now()-lastYield>12) {
        await new Promise<void>(resolve=>setTimeout(resolve,0));checkCurrent();lastYield=performance.now();
      }
      if (cursor.depth>256 || count>=layerLimit) {
        warnings.add(cursor.depth>256 ? "layers nested deeper than 256 levels were skipped" : "the file has more than "+layerLimit+" layers; the rest were skipped",cursor.items.length-cursor.index);
        cursor.index=cursor.items.length;continue;
      }
      const n=object(cursor.items[cursor.index++]);
      if (siblings) await siblings.prepare(n,checkCurrent);
      const kind=shape(n,warnings,images);
      if (!kind) continue;
      const id=String(next++), type=String(kind.type), restId=string(n.id);
      const label=type==="componentSet" ? "Component set" : title(String(kind.op ?? type));
      const {world,transform,width,height}=placement(n,cursor.space,cursor.absolute,warnings);
      const description=(type==="component" ? components : sets).get(restId ?? "") ?? "";
      const props=restProperties(n,type,images,warnings);
      componentImport.register(id,n);
      const layout=isFrameLikeKind(type) ? restLayout(n) : undefined;
      const grids=isFrameLikeKind(type) ? layoutGrids(n.layoutGrids) : [];
      const bindings=variables.fields(n,type,!!layout,props,grids);
      const node=readNode(id,{...kind,...props,...bindings,grids,...(layout && {layout}),child_layout:childLayout(n,layout?.mode,cursor.parentMode),...(type==="vector" && vectorFields(n,props,warnings,images)),...(type==="componentSet" || type==="component" ? {description} : {}),
        id:wireId(id),parent:wireId(cursor.parent),name:clipped(string(n.name) ?? label),transform,width,height});
      const styled=styles.link(node,n);
      base.nodes[id]=n.outlinedStroke===undefined ? styled : restoreOutlinedStroke(styled,n.outlinedStroke);
      count++;
      childLists.get(cursor.parent)!.push(id);
      if (restId && !importedIds.has(restId)) importedIds.set(restId,id);
      const kids=children(n.children);
      if (!kids.length) continue;
      if (isLeaf(node)) {warnings.add("children of "+clipped(String(n.type))+" layers were skipped");continue;}
      childLists.set(id,[]);
      stack.push({parent:id,items:kids,index:0,space:{world,frame:isGroupLike(node) ? cursor.space.frame : world},absolute:false,depth:cursor.depth+1,parentMode:layout?.mode});
    }
  }
  for (const entry of roots) {
    const root=object(entry.document);
    if (root.type==="DOCUMENT") {
      for (const child of children(root.children)) {
        const n=object(child);
        if (n.type==="CANVAS") await build(children(n.children),addPage(n,"Page"),false);
        else warnings.add("document children other than pages were skipped");
      }
    } else if (root.type==="CANVAS") await build(children(root.children),addPage(root,"Page"),false);
    else {
      loose??=addPage({},"Imported layers");
      await build([root],loose,true);
    }
  }
  let storeRoot:string|undefined;
  if (libraryContexts.length) {
    storeRoot=String(next++);
    base.nodes[storeRoot]={...initial.nodes["1"] as PageNode,id:storeRoot,name:"Library components"};
    childLists.set(storeRoot,[]);
    await build(libraryContexts,storeRoot,false);
  }
  for (const [id,children] of childLists) base.nodes[id]=Object.freeze({...base.nodes[id],children:Object.freeze(children)}) as DocumentNode;
  for (const id of fit) base.fitToChildren(id);
  if (pages.length) delete base.nodes["1"];
  else {
    pages.push("1");
    base.nodes["1"]=readNode("1",{id:wireId("1"),width:0,height:0,type:"page",name:(initial.nodes["1"] as PageNode).name});
  }
  styles.takeBindings(base);
  styles.settleText(base);
  componentImport.finish();
  images.finish(warnings);
  const shared=styles.finish();
  const document:Document=Object.freeze({...initial,pages:Object.freeze(pages),currentPage:pages[0],nodes:Object.freeze(base.nodes),
    ...(storeRoot && {libraryStore:{root:storeRoot,components:[],inserted:[],detached:[]}}),
    ...(shared.length && {styles:shared}),
    ...((variables.values.collections.length || variables.values.variables.length) && {variables:variables.values}),
    ...(Object.keys(images.resources).length && {images:Object.freeze(images.resources)})});
  checkCurrent();
  return {document:refreshLayerBindings(refreshBoundStyles(unfoldRestAlpha(document)),undefined,true),nextId:String(next),issues:warnings.finish()};
}
