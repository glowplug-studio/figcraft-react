import { compareScalarKeys } from "../../text-breaks";
import { children, numeric, object, string, type JsonObject } from "../rest/values";
import { sketchPinMask, type SketchNode } from "./geometry";
import type { SketchShared } from "./shared";
import { isRecord, setSketchTint, sketchWeight, tintSketchLayers } from "./tint";

export function sketchOverrides(layer:JsonObject) {
  const overrides=new Map<string,unknown>();
  for (const raw of children(layer.overrideValues).slice(0,100000)) {
    const o=object(raw);
    if (typeof o.overrideName==="string" && Object.hasOwn(o,"value")) overrides.set(o.overrideName,o.value);
  }
  return overrides;
}
export function applySketchOverrides(layers:readonly unknown[], overrides:Map<string,unknown>,shared:SketchShared,masters:ReadonlyMap<string,JsonObject>, budget:number) {
  if (!overrides.size) return budget;
  const nested=new Map<string,Array<[string,unknown]>>();
  for (const key of [...overrides.keys()].sort(compareScalarKeys)) {
    const pos=key.indexOf("/");
    if (pos<0) continue;
    const id=key.slice(0,pos), rows=nested.get(id) ?? [];
    rows.push([key.slice(pos+1),overrides.get(key)]); nested.set(id,rows);
  }
  function apply(items:readonly unknown[],depth:number) {
    if (depth>64) return;
    for (const l of items) {
      if (!isRecord(l) || typeof l.do_objectID!=="string") continue;
      const id=l.do_objectID,get=(s:string)=>overrides.get(id+"_"+s);
      const visible=get("isVisible"),colour=get("fillColor"),img=get("image"),attrs=l.attributedString;
      const visibleOverride=()=>{if (visible!==undefined) l.isVisible=visible!==false && visible!=="0" && visible!==0;};
      if (l._class==="symbolInstance") {
        const target=get("symbolID");
        if (target!==undefined) {
          if (!string(target)) l.isVisible=false;
          else if (masters.has(String(target))) l.symbolID=target;
        }
        for (const [name,value] of nested.get(id) ?? []) {
          const cost=8+sketchWeight(value);
          if (cost>budget) break;
          budget-=cost;
          if (!Array.isArray(l.overrideValues)) l.overrideValues=[];
          (l.overrideValues as unknown[]).push({_class:"overrideValue",overrideName:name,value:structuredClone(value)});
        }
        visibleOverride();
        if (isRecord(colour)) setSketchTint(l,colour);
        continue;
      }
      visibleOverride();
      if (l._class==="text") {
        const value=get("stringValue");
        if (typeof value==="string" && isRecord(attrs)) {
          const first=children(attrs.attributes)[0];
          attrs.string=value;attrs.attributes=isRecord(first) ? [{...first,location:0,length:value.length}] : [];
        }
        const t=get("textColor");
        if (isRecord(t)) tintSketchLayers([l],t);
      } else if (l._class==="bitmap") {
        if (isRecord(img) && Object.hasOwn(img,"_ref")) l.image=img;
      } else if (isRecord(colour)) {
        const first=children(object(l.style).fills)[0];
        if (isRecord(first)) Object.assign(first,{fillType:0,color:colour});
      }
      for (const [key,styles] of [["layerStyle",shared.layer],["textStyle",shared.text]] as const) {
        const sid=string(get(key)), style=sid===undefined ? undefined : styles.get(sid);
        if (!style?.record) continue;
        l.style={...structuredClone(style.value),sharedObjectID:sid};
        const enc=object(style.value.textStyle).encodedAttributes;
        if (key==="textStyle" && enc!==undefined) for (const run of children(object(attrs).attributes)) if (isRecord(run)) run.attributes=structuredClone(enc);
      }
      if (l._class!=="bitmap" && isRecord(img) && Object.hasOwn(img,"_ref")) {
        const fills=children(object(l.style).fills);
        for (let i=fills.length-1;i>=0;i--) {
          const p=fills[i]; if (isRecord(p) && p.fillType===4 && p.isEnabled!==false) {p.image=img;break;}
        }
      }
      apply(children(l.layers),depth+1);
    }
  }
  apply(layers,0);return budget;
}

function resizeAxis(pos:number,size:number,old:number,next:number,start:boolean,fixed:boolean,end:boolean) {
  if (old<=1e-9 || !Number.isFinite(next)) return [pos,size];
  const scale=next/old, delta=next-old,far=old-pos-size;
  const share=(part:number,other:number)=>part+other>1e-9 ? delta*part/(part+other) : delta;
  let p=pos,s=size;
  if (start && !fixed && !end) s+=share(size,far);
  else if (!start && !fixed && end) {s+=share(size,pos);p=next-far-s;}
  else if (!start && fixed && !end) p=(pos+size/2)*scale-size/2;
  else if (start && !fixed && end) s+=delta;
  else if (!start && fixed && end) p=next-far-size;
  else if (!(start && fixed && !end)) {p*=scale;s*=scale;}
  return [Number.isFinite(p) ? p : pos,Number.isFinite(s) ? Math.max(0,s) : size];
}
export function resizeSketchLayers(layers:readonly unknown[],ow:number,oh:number,w:number,h:number,legacy:boolean,depth=0) {
  if (depth>64) return;
  for (const l of layers) {
    if (!isRecord(l) || !isRecord(l.frame)) continue;
    const f=l.frame,mask=legacy ? 63 : sketchPinMask(l);
    const width=Math.max(0,numeric(f.width) ?? 0),height=Math.max(0,numeric(f.height) ?? 0);
    const [x,nw]=resizeAxis(numeric(f.x) ?? 0,width,ow,w,!(mask&4),!(mask&2),!(mask&1));
    const [y,nh]=resizeAxis(numeric(f.y) ?? 0,height,oh,h,!(mask&32),!(mask&16),!(mask&8));
    Object.assign(f,{x,y,width:nw,height:nh});
    resizeSketchLayers(children(l.layers),width,height,nw,nh,legacy || l.groupBehavior===2,depth+1);
  }
}
export function prefixSketchIds(node:SketchNode,prefix:string,depth=0) {
  if (depth>256) return;
  if (typeof node.id==="string") node.id=prefix+";"+node.id;
  for (const n of children(node.children)) if (isRecord(n)) prefixSketchIds(n,prefix,depth+1);
}
