import { rectanglePaints, withRectanglePaints, type LayerNode } from "./document";
import { reconcilePaintBindings } from "./list-variable-bindings";
import { samePaints } from "./solid-paint";
import { restyleRange, scalarCount, textSpans } from "./text-ranges";

export function characterFills(node:LayerNode) {
  const layer=rectanglePaints(node);
  if (node.kind!=="text" || !node.text.style.fills && !node.text.runs.length) return layer;
  const spans=textSpans(node.text);
  const first=spans[0].style.fills ?? layer;
  return spans.every(span=>samePaints(span.style.fills ?? layer,first,false)) ? first : null;
}

/** A layer-level fill edit takes ownership of the colours previously applied to characters. */
export function takeCharacterFills(node:LayerNode):LayerNode {
  if (node.kind!=="text" || !node.text.style.fills && !node.text.runs.some(r=>r.style.fills)) return node;
  const common=characterFills(node),layer=rectanglePaints(node);
  const next=common && !samePaints(layer,common,false)
    ? withRectanglePaints(reconcilePaintBindings(node,"fills",layer,common),common) : node;
  const text=restyleRange(node.text,0,scalarCount(node.text.characters),style=>{
    if (!style.fills) return style;
    const {fills,...rest}=style;
    return Object.freeze(rest);
  });
  return Object.freeze({...next,text});
}
