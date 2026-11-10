import {sanitiseBrush} from "../../brush";
import {readNode,wireNode} from "../../file-format";
import type {DocumentNode} from "../../document";
import {sanitiseNetwork} from "../../vector-network";
import {sanitiseWidthProfile} from "../../width-profile";
import {children,object} from "./values";

/** Only the four native shape/stroke fields may be restored from an untrusted Fig or REST file. */
export function restoreOutlinedStroke(node:DocumentNode,original:unknown):DocumentNode {
  const o=object(original),kind=object(o.kind);
  if (!["line","vector","rectangle","ellipse","star","polygon"].includes(String(kind.type)) ||
      !Array.isArray(o.fills) || !Array.isArray(o.strokes) || !o.stroke || typeof o.stroke!=="object" || Array.isArray(o.stroke)) return node;
  const net=object(kind.network);
  if (kind.type==="vector" && children(net.vertices).length+children(net.segments).length>200000) return node;
  try {
    const base:Record<string,unknown>=wireNode(node.id,node);
    for (const key of ["start","sweep","inner","count","inner_ratio","network"]) delete base[key];
    const shape=Object.fromEntries(["type","start","sweep","inner","count","inner_ratio","network"].filter(k=>Object.hasOwn(kind,k)).map(k=>[k,kind[k]]));
    const restored=readNode(node.id,{...base,...shape,fills:o.fills.slice(0,64),strokes:o.strokes.slice(0,64),stroke:o.stroke});
    if (restored.kind==="page") return node;
    const s=restored.stroke;
    return Object.freeze({...restored,...(restored.kind==="vector" && {network:sanitiseNetwork(restored.network)}),
      ...(s && {stroke:Object.freeze({...s,weight:Math.min(1e6,Math.max(0,s.weight)),dashes:s.dashes.slice(0,64),
        ...(s.widthProfile && {widthProfile:sanitiseWidthProfile(s.widthProfile)}),...(s.brush && {brush:sanitiseBrush(s.brush)})})})});
  } catch {return node;}
}
