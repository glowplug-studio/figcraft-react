import { toRgba8 } from "../../colour";
import { isFrameLike, rectanglePaints, type DocumentNode, type LayerNode } from "../../document";
import { paintColour } from "../../solid-paint";
import { compareScalarKeys } from "../../text-breaks";
import { resolveVariable, type Variables } from "../../variables";
import { entries } from "../rest/values";
import { clipped } from "./values";

const numberKeys = ["columnGap","rowGap","p1","p2","p3","p4","r1","r2","r3","r4","strokeWidth","fontSize","letterSpacing"];
function numberField(n:LayerNode,key:string,value:number) {
  const same=(v:number|undefined)=>v!==undefined && Math.abs(v-value)<.0001;
  const layout=isFrameLike(n) ? n.layout : undefined;
  const text=n.kind==="text" ? n.text.style : undefined;
  if (key==="width" || key==="height") return same(n[key]) ? key : undefined;
  if (key==="rowGap" || key==="columnGap") {
    const field=(key==="rowGap")===(layout?.mode==="vertical") ? "gap" : "crossGap";
    if (same(layout?.[field])) return field;
  }
  const i=Number(key[1])-1;
  if (/^p[1-4]$/.test(key) && same(layout?.padding[i])) return ["paddingTop","paddingRight","paddingBottom","paddingLeft"][i];
  if (/^r[1-4]$/.test(key) && same(n.corners?.radii[i] ?? 0)) return ["topLeftRadius","topRightRadius","bottomRightRadius","bottomLeftRadius"][i];
  if (key==="strokeWidth" && n.strokes?.length && same(n.stroke?.weight ?? 1)) return "strokeWeight";
  if (key==="fontSize" && same(text?.fontSize)) return key;
  if (key==="letterSpacing" && text?.letterSpacing.unit==="pixels" && same(text.letterSpacing.value)) return key;
}

export function bindTokens(data:Variables,modes:Record<string,string>,nodes:Record<string,DocumentNode>,warn:(message:string)=>void) {
  const index=new Map<string,string[]>();
  for (const v of data.variables) {
    const match=/^penpot:tokens:files\/([^:]+):(.+)$/.exec(v.id);
    if (!match) continue;
    const short=v.id.startsWith(v.collection+":") ? v.id.slice(v.collection.length+1) : match[2];
    for (const name of [short,v.name]) {
      const key=match[1]+":"+name;
      const ids=index.get(key);
      if (ids) ids.push(v.id); else index.set(key,[v.id]);
    }
  }
  if (!index.size) return;
  let linked=0,rejected=0;
  const affected=new Set<string>();
  for (const n of Object.values(nodes)) {
    const meta=n.sourceMetadata,file=meta?.["penpot.fileId"],raw=meta?.["penpot.source.appliedTokens"];
    if (!file || !raw || n.kind==="page") continue;
    const tokens=JSON.parse(raw);
    if (!tokens || typeof tokens!=="object" || Array.isArray(tokens)) {rejected++;affected.add(n.name);continue;}
    const bindings:Record<string,string>=Object.create(null),unlinked:Record<string,string>=Object.create(null);
    for (const [key,t] of entries(tokens)) {
      const name=typeof t==="string" ? t.startsWith("{") && t.endsWith("}") ? t.slice(1,-1) : t : undefined;
      const ids=index.get(file+":"+name),id=ids?.[0];
      let reason:string|undefined,field:string|undefined;
      if (name===undefined) reason="not a token reference";
      else if (!name || new TextEncoder().encode(name).length>256) reason="invalid token name";
      else if (!id) reason="token not imported";
      else if (ids.length!==1) reason="ambiguous token name";
      else {
        const token=resolveVariable(data,id,modes);
        if (!token) reason="token does not resolve";
        else if (key==="fill" || key==="strokeColor") {
          const paints=key==="fill" ? rectanglePaints(n) : n.strokes;
          const p=paints?.length===1 ? paints[0] : undefined;
          if (p?.type==="solid" && token.type==="color" && toRgba8(paintColour(p)).join()===toRgba8(token.value).join())
            field=key==="fill" ? "fills/0/color" : "strokes/0/color";
          else reason="layer color differs from the token";
        } else if (token.type==="number") {
          field=numberField(n,key,token.value);
          if (!field && numberKeys.includes(key)) reason="layer value differs from the token";
        } else if (key==="fontFamily" && token.type==="string" && n.kind==="text" && n.text.style.fontFamily===token.value) field=key;
      }
      if (field && id) {bindings[field]=id;linked++;}
      else {unlinked[key]=reason ?? "property has no FigCraft binding";rejected++;affected.add(n.name);}
    }
    nodes[n.id]=Object.freeze({...n,...(Object.keys(bindings).length && {boundVariables:Object.freeze(bindings)}),
      ...(Object.keys(unlinked).length && {sourceMetadata:{...meta,"penpot.unlinkedTokens":JSON.stringify(unlinked)}})});
  }
  if (linked) warn("Linked "+linked+" Penpot token reference(s) to native FigCraft properties (colors, sizes, gaps, padding, radii, stroke widths, font sizes and families)");
  if (rejected) {
    const names=[...affected].sort(compareScalarKeys).slice(0,4).map(s=>clipped(s,60));
    warn(rejected+" Penpot token reference(s) could not be safely linked (unsupported, ambiguous or different resolved value); original references retained on layers"+(names.length?" including "+names.join(", "):""));
  }
}
