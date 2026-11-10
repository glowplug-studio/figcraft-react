import { rectanglePaints, withRectanglePaints, type Document } from "../../document";
import { type Paint } from "../../solid-paint";
import { bindingItem } from "../../variable-binding-key";
import { layerModes } from "../../variable-modes";
import { resolveVariable } from "../../variables";

/** REST puts colour alpha into paint opacity. A bound colour supplies that alpha again on load. */
export function unfoldRestAlpha(doc:Document):Document {
  const vars=doc.variables;
  if (!vars?.variables.length) return doc;
  function unfold(paints:readonly Paint[],bindings:Readonly<Record<string,string>>,modes:Readonly<Record<string,string>>,list:string) {
    let next:Paint[]|undefined;
    for (const [field,id] of Object.entries(bindings)) {
      const entry=bindingItem(field);
      if (entry?.list!==list || entry.field!=="color") continue;
      const p=(next ?? paints)[entry.index];
      if (p?.type!=="solid") continue;
      const value=resolveVariable(vars!,id,modes);
      if (value?.type!=="color" || value.value.a<=0 || value.value.a>=1) continue;
      (next??=paints.slice())[entry.index]={...p,opacity:Math.min(1,Math.fround(p.opacity/value.value.a))};
    }
    return next;
  }
  const styles=doc.styles?.map(s=>{
    const paints=s.type==="paint" && s.bound && unfold(s.paints,s.bound,{},"fills");
    return paints ? {...s,paints} : s;
  });
  let nodes:Record<string,Document["nodes"][string]>|undefined;
  for (const node of Object.values(doc.nodes)) {
    if (!node.boundVariables || node.kind==="page") continue;
    const modes=layerModes(doc,node.id),fills=unfold(rectanglePaints(node),node.boundVariables,modes,"fills"),
      strokes=unfold(node.strokes ?? [],node.boundVariables,modes,"strokes");
    if (fills || strokes) (nodes??={...doc.nodes})[node.id]={...(fills ? withRectanglePaints(node,fills) : node),...(strokes && {strokes})};
  }
  return {...doc,...(styles && {styles}),...(nodes && {nodes:Object.freeze(nodes)})};
}
