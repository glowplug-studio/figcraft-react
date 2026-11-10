import {stringify} from "lossless-json";
import {paintedStrokePath} from "../../boolean-result";
import {rectanglePaints,type Document,type LayerNode,type VectorNode} from "../../document";
import {wireNode} from "../../file-format";
import {defaultStroke,wireStroke} from "../../stroke";
import {networkFromPath} from "../../vector-network";

export function outlinedStroke(doc:Document,node:LayerNode) {
  const stroke=node.stroke;
  if (!stroke || stroke.brush || stroke.weight<=0 || !stroke.widthProfile?.points.some(p=>Math.abs(p.bias)>1e-6) ||
      !["line","vector","rectangle","ellipse","star","polygon"].includes(node.kind) ||
      !node.strokes?.some(p=>p.visible) || rectanglePaints(node).some(p=>p.visible)) return;
  const path=paintedStrokePath(doc,node);
  if (!path?.length || path.length>50000) return;
  const raw:Record<string,unknown>=wireNode(node.id,node);
  const kind=Object.fromEntries(["type","start","sweep","inner","count","inner_ratio","network"].filter(k=>Object.hasOwn(raw,k)).map(k=>[k,raw[k]]));
  const value=stringify({kind,fills:raw.fills,strokes:raw.strokes,stroke:wireStroke(stroke)});
  if (!value || new TextEncoder().encode(value).length>(1<<20)) return;
  const net=networkFromPath(path);
  const vector:VectorNode={...node,kind:"vector",network:{...net,regions:net.regions.map(r=>({...r,winding:"nonZero"}))},
    fills:node.strokes,strokes:[],stroke:defaultStroke,
    styles:node.styles && {...node.styles,fill:node.styles.stroke,stroke:null},
    boundVariables:node.boundVariables && Object.fromEntries(Object.entries(node.boundVariables).filter(([k])=>k!=="fill" && !k.startsWith("fills/") && !k.startsWith("stroke")))};
  return {vector,value};
}
