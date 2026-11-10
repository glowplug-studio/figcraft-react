import {isFrameLike,rectanglePaints,type LayerNode,type PageNode} from "../../document";
import {rootId} from "./archive";
import {object} from "../rest/values";
import {penpotType,sourceValue,type Fields,type Warn} from "./write-geometry";
import type {PenpotExportIds} from "./write-pages";

interface Visit {
  node:LayerNode;
  id:string;
  type:NonNullable<ReturnType<typeof penpotType>>;
  parent:string;
  frame:string;
  inheritedFill:boolean;
  children:string[];
}

/** The native writer handles a layer's warnings and resources after its children. */
export function* layerVisits(ids:PenpotExportIds,page:PageNode) {
  const stack:{visit:Visit;finished:boolean}[]=[];
  function push(children:readonly string[],parent:string,frame:string,inheritedFill:boolean) {
    for (let i=children.length-1;i>=0;i--) {
      const node=ids.doc.nodes[children[i]],id=ids.layers.get(children[i]);
      if (!node || node.kind==="page" || !id) continue;
      const type=penpotType(node);
      if (type) stack.push({visit:{node,id,type,parent,frame,inheritedFill,children:ids.children(node)},finished:false});
    }
  }
  push(page.children,rootId,rootId,Boolean(page.fills?.length));
  while (stack.length) {
    const entry=stack.pop()!,v=entry.visit;
    if (entry.finished) {yield v;continue;}
    entry.finished=true;
    stack.push(entry);
    const inherited=!isFrameLike(v.node) && (v.inheritedFill || rectanglePaints(v.node).length>0);
    push(v.children,v.id,v.type==="frame" ? v.id : v.frame,inherited);
  }
}

export function layerFields(ids:PenpotExportIds,v:Visit,pageId:string,fields:Fields,warn:Warn) {
  const {node:n,type}=v;
  Object.assign(fields,{parentId:v.parent,frameId:v.frame,pageId});
  if (["group","frame","bool","svg-raw"].includes(type)) fields.shapes=v.children.map(id=>ids.layers.get(id)!);
  if (type==="bool" && n.kind==="booleanOp") fields.boolType=n.op==="subtract" ? "difference" : n.op==="intersect" ? "intersection" : n.op;
  if (type==="frame") {
    fields.showContent=!(isFrameLike(n) && n.clip);
    fields.hideFillOnExport=false;
    if (n.kind==="componentSet") fields.isVariantContainer=true;
  }
  if (type==="svg-raw") fields.content=sourceValue(n,"content");
  if (type==="group" && n.kind==="group" && ids.doc.nodes[n.children[0]]?.isMask) fields.maskedGroup=true;
  const parent=ids.doc.nodes[n.parent];
  if (n.isMask && !(parent?.kind==="group" && parent.children[0]===n.id))
    warn("Mask '"+n.name+"' is not the bottom layer of a group; Penpot has no equivalent, so it was exported as a plain layer");
  for (const key of ["pluginData","svgViewbox","svgDefs","layoutItemZIndex","exports","hideInViewer"]) {
    const value=sourceValue(n,key);
    if (value!==undefined) fields[key]=value;
  }
  const source=sourceValue(n,"svgAttrs");
  const attrs=source && typeof source==="object" && !Array.isArray(source) ? object(source) : undefined;
  if (["rect","circle","path","bool"].includes(type)) {
    const filled=rectanglePaints(n).length>0;
    if (!attrs && (filled || !v.inheritedFill)) return;
    const output={...attrs};
    if (output.style && typeof output.style==="object" && !Array.isArray(output.style)) {
      const style={...object(output.style)};
      delete style.fill;
      output.style=style;
    }
    if (!filled) output.fill="none";
    else delete output.fill;
    fields.svgAttrs=output;
  } else if (attrs) fields.svgAttrs=attrs;
}
