import { textCaret, textHit, textVisualStep } from "./text-caret";
import { textWordStep } from "./text-edit";
import { TextGraphemes } from "./text-graphemes";
import type { TextNode } from "./document";
import { textNodeLayout } from "./text-node-layout";

export type DirectedTextSelection={anchor:number;caret:number};
type Modifiers={shift:boolean;word:boolean;line:boolean};
const boundaries=new WeakMap<TextNode,TextGraphemes>();
function graphemes(node:TextNode) {
  let map=boundaries.get(node);
  if (!map) {map=new TextGraphemes(node.text.characters);boundaries.set(node,map);}
  return map;
}
export function textLineBoundary(chars:readonly string[],i:number,right:boolean) {
  if (right) while (i<chars.length && chars[i]!=="\n") i++;
  else while (i>0 && chars[i-1]!=="\n") i--;
  return i;
}

/** Native movement and deletion are in Unicode scalars, including a backwards selection. */
export function textKeyMotion(node:TextNode,selection:DirectedTextSelection,key:string,mods:Modifiers):
  {selection:DirectedTextSelection}|{remove:readonly [number,number]}|undefined {
  key=key.replace(/^Arrow/,"");
  if (!["Backspace","Delete","Left","Right","Up","Down","Home","End","SelectAll"].includes(key)) return;
  const {anchor,caret}=selection, a=Math.min(anchor,caret), b=Math.max(anchor,caret);
  const bounds=graphemes(node), n=bounds.length;
  if (key==="SelectAll") return {selection:{anchor:0,caret:n}};
  const right=key==="Right" || key==="Down" || key==="End" || key==="Delete";
  const lineEdge=(i:number,r:boolean)=>textLineBoundary(Array.from(node.text.characters),i,r);
  const wordEdge=(i:number,r:boolean)=>textWordStep(Array.from(node.text.characters),i,r);
  if (key==="Delete" || key==="Backspace") {
    if (a!==b) return {remove:[a,b]};
    const edge=mods.line ? lineEdge(caret,right) : mods.word ? wordEdge(caret,right) :
      right ? bounds.step(caret,true) : bounds.backspace(caret);
    return {remove:right ? [caret,edge] : [edge,caret]};
  }
  const cur=mods.shift ? caret : right ? b : a;
  let next:number;
  if (key==="Home" || key==="End") next=mods.line ? (right ? n : 0) : lineEdge(cur,right);
  else if (key==="Up" || key==="Down") {
    next=right ? n : 0;
    if (!mods.line) {
      const {layout}=textNodeLayout(node), {x,line}=textCaret(layout,cur);
      const row=layout.lines[line+(right ? 1 : -1)];
      if (row) next=textHit(layout,x,row.top+row.height/2);
    }
  } else if (mods.line) next=lineEdge(cur,right);
  else if (mods.word) next=wordEdge(cur,right);
  else if (!mods.shift && a!==b) next=cur;
  else next=textVisualStep(textNodeLayout(node).layout,cur,right) ?? bounds.step(cur,right);
  return {selection:{anchor:mods.shift ? anchor : next,caret:next}};
}
