import { sameComponentValue } from "./component-groups";
import { zeroCorners } from "./corners";
import { isFrameLike, type DocumentNode } from "./document";
import { frameTuning } from "./layout-properties";
import { remapBindings } from "./list-variable-bindings";
import { defaultStroke } from "./stroke";
import { textWeight } from "./text-style";

/** Values compared before an explicit layer edit, including indirectly resized or constrained fields. */
function boundField(node:DocumentNode,key:string):unknown {
  if (node.kind==="page") return;
  const layout=isFrameLike(node) ? node.layout : undefined, pad=layout?.padding;
  const radii=(node.corners ?? zeroCorners).radii, stroke=node.stroke ?? defaultStroke;
  switch (key) {
    case "width": case "w": return node.width;
    case "height": case "h": return node.height;
    case "minWidth": case "maxWidth": case "minHeight": case "maxHeight": return node.childLayout?.[key];
    case "opacity": return node.opacity ?? 1;
    case "visible": return node.visible ?? true;
    case "gap": case "columnGap": return layout?.gap;
    case "crossGap": case "rowGap": return layout?.crossGap;
    case "padding": return pad;
    case "paddingTop": return pad?.[0];
    case "paddingRight": return pad?.[1];
    case "paddingBottom": return pad?.[2];
    case "paddingLeft": return pad?.[3];
    case "paddingHorizontal": return [pad?.[1],pad?.[3]];
    case "paddingVertical": return [pad?.[0],pad?.[2]];
    case "cornerRadius": return radii;
    case "topLeftRadius": return radii[0];
    case "topRightRadius": return radii[1];
    case "bottomRightRadius": return radii[2];
    case "bottomLeftRadius": return radii[3];
    case "strokeWeight": return [stroke.weight,stroke.sides];
    case "strokeTopWeight": case "strokeRightWeight": case "strokeBottomWeight": case "strokeLeftWeight": return stroke.sides;
    case "arcStart": return node.kind==="ellipse" ? node.start : undefined;
    case "arcSweep": return node.kind==="ellipse" ? node.sweep : undefined;
    case "arcInner": return node.kind==="ellipse" ? node.inner : undefined;
    case "characters": case "paragraphSpacing": case "paragraphIndent": return node.kind==="text" ? node.text[key] : undefined;
    case "fontWeight": case "fontFamily": case "fontStyle": case "fontSize": case "lineHeight": case "letterSpacing":
      return node.kind==="text" ? [node.text.style,...node.text.runs.map(r=>r.style)].map(s=>key==="fontWeight" ? textWeight(s) : s[key]) : undefined;
  }
}

export function detachEditedFields(old:DocumentNode,next:DocumentNode) {
  if (next===old || !old.boundVariables || !next.boundVariables) return next;
  const removedLayout=isFrameLike(old) && old.layout && isFrameLike(next) && !next.layout;
  return remapBindings(next,key=>{
    if (old.boundVariables![key]!==next.boundVariables![key]) return key;
    if (removedLayout && frameTuning.has(key)) return;
    return sameComponentValue(boundField(old,key),boundField(next,key)) ? key : undefined;
  });
}
