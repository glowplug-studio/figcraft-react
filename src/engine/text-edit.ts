import { inverse, multiply, type Affine } from "./affine";
import { pageColour, rectanglePaints, rectangleTransform, withLayerTransform, type Document, type TextNode } from "./document";
import { ancestors, HierarchyDraft, worldTransform } from "./hierarchy";
import { pixelRound, type Point } from "./geometry";
import { paintColour } from "./solid-paint";
import { newTextData, normaliseTextLines } from "./text-data";
import { autoSizeText } from "./text-node-layout";
import { replaceTextRange, textLayerName } from "./text-ranges";

export type TextTarget = {id: string} | {parent: string; start: Point; end?: Point};

/** Nearest visible solid above half alpha, otherwise the page, as in canvas::tools::handles. */
export function readableTextFill(document: Document, parent: string) {
  for (const id of [parent, ...ancestors(document, parent)]) {
    const node = document.nodes[id];
    const top = node.kind === "page" ? undefined : [...rectanglePaints(node)].reverse().find(paint => paint.visible);
    const c = node.kind === "page" ? pageColour(node) : top?.type === "solid" ? paintColour(top) : undefined;
    if (!c || node.kind !== "page" && c.a < .5) continue;
    const linear = (v: number) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
    const luminance = .2126 * linear(c.r) + .7152 * linear(c.g) + .0722 * linear(c.b) + .05;
    return 1.05 / luminance > luminance / .05 ? "#ffffff" : "#000000";
  }
  return "#000000";
}

export function createCanvasText(document: Document, id: string, target: Exclude<TextTarget,{id:string}>): TextNode {
  const {start, end, parent} = target;
  const x = pixelRound(end ? Math.min(start.x, end.x) : start.x);
  const y = pixelRound(end ? Math.min(start.y, end.y) : start.y - 7);
  const placement: Affine = [1,0,0,1,x,y];
  let node = autoSizeText(Object.freeze({kind:"text",id,parent,name:"",x:0,y:0,width:1,height:14,
    fill:readableTextFill(document, parent),text:newTextData()}));
  if (end) node = Object.freeze({...node,width:Math.max(1,pixelRound(Math.abs(end.x-start.x))),
    height:Math.max(node.height,pixelRound(Math.abs(end.y-start.y))),text:Object.freeze({...node.text,autoResize:"none"})});
  return withLayerTransform(node, multiply(inverse(worldTransform(document,parent)),placement));
}

/** Replace only the selected scalars so surrounding style runs and paragraph lists survive. */
export function editTextRange(node: TextNode, start: number, end: number, insertion: string) {
  const value = normaliseTextLines(insertion).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g,"");
  if (insertion && !value || !value && start === end) return node;
  const text = replaceTextRange(node.text,start,end,value);
  const previous = textLayerName(node.text.characters);
  const derived = node.name === previous || !previous && node.name === "Text";
  const fitted = autoSizeText(Object.freeze({...node,text,name:derived ? textLayerName(text.characters) : node.name}));
  return text.alignH === "right" && text.autoResize === "widthAndHeight" && fitted.width !== node.width
    ? withLayerTransform(fitted, multiply(rectangleTransform(node),[1,0,0,1,node.width-fitted.width,0])) : fitted;
}

export function publishTextNode(document: Document, node: TextNode) {
  const draft = new HierarchyDraft(document);
  if (document.nodes[node.id]) draft.set(node);
  else draft.insert(node,node.parent);
  draft.normaliseGroups();
  return draft.finish();
}

/** Native double-click groups words by script, and keeps spaces and punctuation on one line. */
export function textWordRange(value: string, index: number): [number,number] {
  const chars = Array.from(value), groups = new Uint8Array(chars.length);
  for (let i=0;i<chars.length;i++) {
    const c=chars[i];
    if (i && /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\u3099-\u309a\ufe20-\ufe2f]/u.test(c)) groups[i]=groups[i-1];
    else if (/[\u3005-\u3007\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{3ffff}]/u.test(c)) groups[i]=2;
    else if (/[\u3041-\u309f]/u.test(c)) groups[i]=3;
    else if (/[\u30a0-\u30ff\u31f0-\u31ff\uff66-\uff9f]/u.test(c)) groups[i]=4;
    else if (/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u.test(c)) groups[i]=5;
    else if (/[\p{Alphabetic}\p{Number}_]/u.test(c)) groups[i]=1;
  }
  let a=Math.min(chars.length,Math.max(0,index));
  if (a && !groups[a] && groups[a-1]) a--;
  let b=a;
  const group=(i:number)=>groups[i] || (/\p{White_Space}/u.test(chars[i] ?? "") ? 10 : 11);
  const k=group(a);
  if (a < chars.length && chars[a] !== "\n") {
    while (a>0 && chars[a-1] !== "\n" && group(a-1)===k) a--;
    while (b<chars.length && chars[b] !== "\n" && group(b)===k) b++;
  }
  return [a,b];
}
