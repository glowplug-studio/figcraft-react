import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { isFrameLike, type DocumentNode } from "../../document";
import { wireId } from "../../native-values";
import {isLosslessNumber} from "lossless-json";
import { readInteractions,wireInteractions,type PrototypeInteraction } from "../../prototype-data";
import { nativeFloat } from "../../text-breaks";
import { children, entries, object, string, type JsonObject } from "../rest/values";
import { PenpotNumbers } from "./json";
import { keepSource, clipped } from "./values";

type Warn = (message:string) => void;
const triggers: Record<string,string> = {click:"onClick","mouse-press":"onPress","mouse-over":"onHover","mouse-enter":"mouseEnter","mouse-leave":"mouseLeave","after-delay":"afterDelay"};
const overlays: Record<string,string> = {manual:"manual",center:"center","top-left":"topLeft","top-right":"topRight","top-center":"topCenter",
  "bottom-left":"bottomLeft","bottom-right":"bottomRight","bottom-center":"bottomCenter"};
const easings: Record<string,string> = {ease:"easeInOut","ease-in":"easeIn","ease-out":"easeOut","ease-in-out":"easeInOut"};

export function keepInteractions(raw: JsonObject, meta: Record<string,string>, numbers: PenpotNumbers, warn: Warn) {
  if (!children(raw.interactions).length) return;
  keepSource(meta,"penpot.interactions",raw.interactions,numbers,65536);
  if (!meta["penpot.interactions"]) warn("A Penpot layer's interaction source is too large to keep; its prototype links were skipped");
}

/** The fingerprint hashes the typed Rust struct (field order, f32 colour, f64 offsets). */
function interactionJson(value: unknown, key = ""): string {
  if (isLosslessNumber(value)) return value.value;
  if (Array.isArray(value)) return "["+value.map(v=>interactionJson(v,key)).join(",")+"]";
  if (value && typeof value==="object") return "{"+Object.entries(value).map(([k,v])=>JSON.stringify(k)+":"+interactionJson(v,k)).join(",")+"}";
  if (typeof value==="number" && ["r","g","b","a"].includes(key)) {
    for (let precision=1;precision<=9;precision++) {
      const short=Number(value.toPrecision(precision));
      if (Math.fround(short)===Math.fround(value)) return nativeFloat(short);
    }
  }
  if (typeof value==="number" && ["offset","x1","y1","x2","y2","mass","stiffness","damping"].includes(key)) return nativeFloat(value);
  return JSON.stringify(value);
}

export function interactionFingerprint(list:readonly PrototypeInteraction[]) {
  const wire=wireInteractions(list).map(({trigger,actions,transition,duration_ms,easing,delay_ms})=>
    ({trigger,actions,transition,duration_ms,easing,...(delay_ms && {delay_ms})}));
  return bytesToHex(sha256(new TextEncoder().encode(interactionJson(wire)))).slice(0,32);
}

export function resolvePrototypes(nodes: Record<string,DocumentNode>, pages: string[], warn: Warn) {
  const ids=new Map<string,string>();
  for (const n of Object.values(nodes)) {
    const id=n.sourceMetadata?.["penpot.id"];
    if (id) ids.set(id,n.id);
  }
  let mapped=0,missing=0;
  for (const n of Object.values(nodes)) {
    const meta=n.sourceMetadata;
    if (!meta) continue;
    const native=[];
    if (meta["penpot.interactions"]) {
      const notes:string[]=[];
      const numbers=new PenpotNumbers();
      const links=children(numbers.read(meta["penpot.interactions"]));
      for (const raw of links.slice(0,64)) {
        const v=object(raw), event=string(v.eventType) ?? "unknown", ty=string(v.actionType) ?? "unknown";
        const type=Object.hasOwn(triggers,event) ? triggers[event] : undefined;
        if (!type) {notes.push("Penpot interaction with event type '"+event+"' has no FigCraft equivalent and was skipped");continue;}
        const rawDelay=numbers.integer(v,"delay");
        const delay=rawDelay!==undefined && rawDelay>=0n && rawDelay<=0xffffffffffffffffn ? Math.min(600000,Number(rawDelay)) : 600;
        const trigger=type==="afterDelay" ? {type,ms:delay} : {type};
        const overlay=ty==="open-overlay", needsDest=overlay || ty==="navigate";
        const dest=ids.get(string(v.destination) ?? "");
        let action;
        if (ty==="navigate") action={type:"navigate",dest:Number(dest),...(v.preserveScroll===true && {preserve_scroll:true})};
        if (overlay && Object.hasOwn(overlays,String(v.overlayPosType))) {
          const position=overlays[String(v.overlayPosType)], p=object(v.overlayPosition);
          const coord=(v:unknown)=>typeof v==="number" ? Math.max(-1e5,Math.min(1e5,v)) : 0;
          action={type:"openOverlay",dest:Number(dest),position,close_on_outside:v.closeClickOutside===true,
            background:v.backgroundOverlay===true ? {r:0,g:0,b:0,a:0.2} : null,
            ...(position==="manual" && Object.hasOwn(v,"overlayPosition") && {offset:[coord(p.x),coord(p.y)]})};
        }
        if (ty==="prev-screen" || ty==="close-overlay") action={type:ty==="prev-screen" ? "back" : "closeOverlay"};
        const url=string(v.url)?.trim();
        if (ty==="open-url" && url && new TextEncoder().encode(url).length<=2048) action={type:"openUrl",url};
        if (!action) {notes.push("Penpot interaction with action type '"+ty+"' has no FigCraft equivalent and was skipped");continue;}
        if (needsDest && typeof v.destination!=="string") {notes.push("A Penpot interaction names no destination; it was skipped");continue;}
        if (needsDest && !dest) {missing++;continue;}
        if (needsDest) mapped++;
        const a=object(v.animation), direction=a.direction==="up" ? "top" : a.direction==="down" ? "bottom" : a.direction==="right" ? "right" : "left";
        const transition=a.animationType==="slide" ? {type:!overlay && a.way==="out" ? "slideOut" : "slideIn",direction} :
          a.animationType==="push" && !overlay ? {type:"push",direction} : {type:a.animationType==="dissolve" ? "dissolve" : "instant"};
        const duration=typeof a.duration==="number" && a.duration>=0 ? Math.min(600000,Math.trunc(a.duration)) : 0;
        native.push({trigger,actions:[action],transition,duration_ms:duration,easing:easings[String(a.easing)] ?? "linear"});
      }
      notes.forEach(warn);
    }
    if (meta["penpot.source.interactions"]!==undefined || native.length) {
      const connections=readInteractions(native.map(i=>({...i, actions:i.actions.map(a=>"dest" in a ? {...a,dest:wireId(String(a.dest))} : a)})));
      const metadata=meta["penpot.source.interactions"]===undefined ? meta : {...meta,
        "penpot.fp.interactions":interactionFingerprint(connections)};
      nodes[n.id]=Object.freeze({...n,sourceMetadata:metadata,...(connections.length && {interactions:connections})});
    }
  }
  if (mapped) warn("Imported "+mapped+" Penpot prototype connection(s) as working FigCraft interactions");
  if (missing) warn(missing+" Penpot prototype destination(s) named no layer in the file; those connections were skipped");
  for (const page of pages) {
    const n=nodes[page];
    if (n.kind!=="page" || !n.sourceMetadata?.["penpot.flows"]) continue;
    const flows=[];
    for (const [,value] of entries(JSON.parse(n.sourceMetadata["penpot.flows"])).slice(0,8)) {
      const v=object(value), ref=string(v.startingFrame);
      if (ref===undefined) continue;
      const id=ids.get(ref);
      if (!id) {warn("A Penpot flow names a starting frame that is not in the file; it was skipped");continue;}
      let top=nodes[id];
      while (top.parent && nodes[top.parent]?.kind!=="page") top=nodes[top.parent];
      const name=string(v.name);
      flows.push({name:name?.trim() ? clipped(name,256) : "Flow",start:isFrameLike(top) ? top.id : id,description:""});
    }
    if (flows.length) nodes[page]=Object.freeze({...n,flows});
  }
}
