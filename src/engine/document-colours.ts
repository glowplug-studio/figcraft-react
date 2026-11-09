import {toCssHex,type Colour} from "./colour";
import {rectanglePaints,type Document} from "./document";
import {parseNodeId,parseNumber} from "./parameters";
import {paintColour} from "./solid-paint";

interface PageColour { readonly colour:Colour; readonly hex:string; count:number }
const cache=new WeakMap<Document,{page:string;colours:readonly PageColour[]}>();

/** Native cmd/styles.rs counts visible solid paints beneath the requested root, including hidden layers. */
export function pageColours(document:Document,page=document.currentPage):readonly PageColour[] {
  const prior=cache.get(document);
  if (prior?.page===page) return prior.colours;
  const counts=new Map<string,PageColour>(),stack=[page];
  for (let visited=0;stack.length && visited<200_000;visited++) {
    const node=document.nodes[stack.pop()!];
    if (!node) continue;
    if ("children" in node) for (const child of node.children) stack.push(child);
    const fills=node.kind==="page" ? node.fills ?? [] : rectanglePaints(node);
    for (const list of [fills,node.strokes ?? []]) for (const paint of list) {
      if (paint.type!=="solid" || !paint.visible) continue;
      const colour=paintColour(paint),hex=toCssHex(colour).padEnd(9,"F");
      const existing=counts.get(hex);
      if (existing) existing.count++;
      else counts.set(hex,{colour,hex,count:1});
    }
  }
  const colours=[...counts.values()].sort((a,b)=>b.count-a.count || (a.hex<b.hex ? -1 : a.hex>b.hex ? 1 : 0));
  cache.set(document,{page,colours});
  return colours;
}

export function documentColours(document:Document,p:Record<string,unknown>) {
  for (const key of Object.keys(p)) if (key!=="page" && key!=="limit") throw Error("Unknown paint.documentColors parameter "+key);
  let limit=21;
  try {limit=Math.trunc(Math.max(1,Math.min(500,parseNumber(p.limit))));} catch { /* Native uses 21 when there is no numeric limit. */ }
  return {colors:pageColours(document,parseNodeId(p.page)).slice(0,limit).map(({hex,count})=>({color:hex.slice(1,7),count}))};
}
