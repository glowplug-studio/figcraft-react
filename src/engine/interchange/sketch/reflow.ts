import { multiply } from "../../affine";
import { isFrameLike, rectangleTransform, withLayerTransform, type Document, type DocumentNode, type InstanceNode, type TextNode } from "../../document";
import { HierarchyDraft } from "../../hierarchy";
import { reflowFrame } from "../../layout-reflow";
import { autoSizeText, prepareText } from "../../text-node-layout";

/** A saved Sketch instance uses its master's text bounds, even when an override changed its string. */
export async function reflowSketchInstances(document:Document, checkCurrent:()=>void):Promise<Document> {
  const changed:TextNode[]=[], resized:InstanceNode[]=[];
  for (const n of Object.values(document.nodes)) {
    if (n.kind==="text" && n.source) {
      const main=document.nodes[n.source];
      if (main?.kind==="text" && n.text.characters!==main.text.characters) changed.push(n);
    } else if (n.kind==="instance" && n.layout) {
      const main=document.nodes[n.component];
      if (main?.kind==="component" && (Math.abs(main.width-n.width)>1e-6 || Math.abs(main.height-n.height)>1e-6)) resized.push(n);
    }
  }
  if (!changed.length && !resized.length) return document;
  await prepareText(); checkCurrent();
  const draft=new HierarchyDraft(document);
  const depth=(n:DocumentNode)=>{let level=0;while(n.parent!==null) {n=document.nodes[n.parent];level++;} return level;};
  resized.sort((a,b)=>depth(b)-depth(a));
  for (const n of resized) reflowFrame(draft,draft.nodes[n.id] as InstanceNode);
  for (const before of changed) {
    const n=draft.nodes[before.id] as TextNode;
    await prepareText(n.text.characters);checkCurrent();
    const fit=autoSizeText(n),delta=n.width-fit.width;
    const shift=n.text.autoResize!=="widthAndHeight" ? 0 : n.text.alignH==="center" ? delta/2 : n.text.alignH==="right" ? delta : 0;
    const fitted={...n,width:fit.width,height:fit.height};
    draft.set(shift ? withLayerTransform(fitted,multiply(rectangleTransform(n),[1,0,0,1,shift,0])) : fitted);
    let parent=draft.nodes[n.parent];
    while (parent.kind!=="page") {
      if (isFrameLike(parent) && parent.layout) reflowFrame(draft,parent);
      parent=draft.nodes[parent.parent];
    }
  }
  return Object.freeze({...document,nodes:Object.freeze(draft.nodes)});
}
