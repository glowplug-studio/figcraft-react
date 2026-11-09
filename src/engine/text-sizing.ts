import type { Document, TextNode } from "./document";
import { fitEditedText } from "./text-node-layout";
import type { HierarchyDraft } from "./hierarchy";
import type { TextData } from "./text-data";
import { scaleTextPathData } from "./text-path-data";
import type { TextStyle } from "./text-style";

/** Explicit width/height changes release the corresponding hug and preserve truncation. */
export function fixTextSize(node:TextNode, width:boolean, height:boolean, resizeCommand=false):TextNode {
  const old=node.text.autoResize;
  const truncates=old==="truncate" || (old==="height" || old==="widthAndHeight") && node.text.maxLines>0;
  let autoResize=old;
  if (height) autoResize=truncates ? "truncate" : "none";
  else if ((resizeCommand && old!=="truncate") || (width && old==="widthAndHeight")) autoResize="height";
  const horizontal=width ? "fixed" : node.textSizing?.horizontal ?? "fixed";
  const vertical=height ? "fixed" : node.textSizing?.vertical ?? "fixed";
  const {textSizing:_prior,...rest}=node;
  return Object.freeze({...rest,text:Object.freeze({...node.text,autoResize}),
    ...(horizontal !== "fixed" || vertical !== "fixed" ? {textSizing:Object.freeze({horizontal,vertical})} : {})});
}

/** Refit after the anchor and provisional boxes have been transformed, before fitting groups. */
export function refitResizedText(draft:HierarchyDraft, before:Document) {
  for (const id of draft.changedIds) {
    const node=draft.nodes[id], original=before.nodes[id];
    if (node?.kind==="text" && original?.kind==="text" &&
        (node.text!==original.text || node.width!==original.width || node.height!==original.height))
      draft.set(fitEditedText(node,original));
  }
}

export function scaleTextData(t:TextData,k:number):TextData {
  const scaled=(value:number)=>{
    const result=value*k;
    if (!Number.isFinite(result)) throw new Error("Scaled text values must be finite");
    return result;
  };
  const measure=<T extends TextStyle["lineHeight"]>(v:T):T => v.unit==="pixels" ? {...v,value:scaled(v.value)} : v;
  function style(s:TextStyle) {
    const look=s.decorationLook;
    return Object.freeze({...s,fontSize:scaled(s.fontSize),lineHeight:measure(s.lineHeight),letterSpacing:measure(s.letterSpacing),
      ...(look && {decorationLook:Object.freeze({...look,thickness:measure(look.thickness),offset:measure(look.offset)})})});
  }
  return Object.freeze({...t,style:style(t.style),runs:Object.freeze(t.runs.map(r=>Object.freeze({...r,style:style(r.style)}))),
    paragraphSpacing:scaled(t.paragraphSpacing),paragraphIndent:scaled(t.paragraphIndent),listSpacing:scaled(t.listSpacing),
    ...(t.path && {path:Object.freeze({...t.path,d:scaleTextPathData(t.path.d,k,k)})})});
}
