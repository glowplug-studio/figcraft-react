import type { PageNode } from "../../document";
import type { HierarchyDraft } from "../../hierarchy";
import { easingNames, type PrototypeEasing, type PrototypeFlow, type PrototypeInteraction, type PrototypeTransition, type PrototypeTrigger } from "../../prototype-data";
import type { Variables } from "../../variables";
import { RestPrototypeActions } from "./prototype-actions";
import { children, clamp, clipped, finite, numeric, object, string, type ImportWarnings, type JsonObject } from "./values";

const time=(v:unknown,fallback:number)=>Math.trunc(clamp(numeric(v) ?? fallback,0,60000));
const namedTriggers={ON_CLICK:"onClick",ON_PRESS:"onPress",ON_HOVER:"onHover",ON_DRAG:"onDrag",MOUSE_UP:"mouseUp",MOUSE_DOWN:"mouseDown",MOUSE_ENTER:"mouseEnter",MOUSE_LEAVE:"mouseLeave"} as const;
const buttons="A B X Y LB RB LT RT View Menu LS RS Up Down Left Right Home".split(" ");
const keys:Record<number,string>={8:"Backspace",9:"Tab",13:"Enter",27:"Escape",32:"Space",37:"ArrowLeft",38:"ArrowUp",39:"ArrowRight",40:"ArrowDown",46:"Delete"};
const modifier=(n:number)=>[16,17,18,91,92,93,224].includes(n);
function keyName(code:number|undefined) {
  if (code===undefined || !Number.isFinite(code) || code<0 || code>255) return;
  const n=Math.trunc(code);
  if (n>=48 && n<=57 || n>=65 && n<=90) return String.fromCharCode(n);
  if (n>=112 && n<=123) return "F"+(n-111);
  return keys[n];
}
function trigger(t:JsonObject,w:ImportWarnings):PrototypeTrigger|undefined {
  const type=string(t.type) ?? "";
  if (Object.hasOwn(namedTriggers,type)) return {type:namedTriggers[type as keyof typeof namedTriggers]};
  if (type==="AFTER_TIMEOUT") return {type:"afterDelay",ms:time(t.timeout,0)};
  if (type!=="ON_KEY_DOWN" && type!=="ON_KEY_UP") {w.add("prototype triggers of unknown types were skipped");return;}
  const codes=children(t.keyCodes).filter(finite);
  let key:string;
  if (typeof t.device==="string" && t.device!=="KEYBOARD") {
    const button=codes.length===1 && Number.isInteger(codes[0]) && buttons[codes[0]];
    if (!button) {w.add("gamepad triggers without exactly one known controller button were skipped");return;}
    key="Gamepad "+button;
  } else {
    const name=keyName([...codes].reverse().find(c=>!modifier(c)));
    if (!name) {w.add("key triggers without a supported key were skipped");return;}
    key=[codes.includes(17) && "Ctrl",codes.includes(18) && "Alt",codes.includes(16) && "Shift",
      codes.some(c=>[91,92,93,224].includes(c)) && "Cmd",name].filter(Boolean).join("+");
  }
  if (type==="ON_KEY_UP") w.add("key up triggers import as key presses");
  return {type:"keyPress",key};
}
function easing(type:unknown,raw:JsonObject={}):PrototypeEasing {
  if (type==="EASE_IN_AND_OUT") return "easeInOut";
  if (type==="EASE_IN_AND_OUT_BACK") return "easeInOutBack";
  if (type==="GENTLE_SPRING") return "gentle";
  if (type==="CUSTOM_CUBIC_BEZIER") {
    const {x1,y1,x2,y2}=object(raw.easingFunctionCubicBezier);
    return {customBezier:finite(x1) && finite(y1) && finite(x2) && finite(y2) ?
      {x1:clamp(x1,0,1),y1:clamp(y1,-10,10),x2:clamp(x2,0,1),y2:clamp(y2,-10,10)} : {x1:.42,y1:0,x2:.58,y2:1}};
  }
  if (type==="CUSTOM_SPRING") {
    const {mass,stiffness,damping}=object(raw.easingFunctionSpring);
    return {customSpring:finite(mass) && finite(stiffness) && finite(damping) && mass>0 && stiffness>0 && damping>=0 ?
      {mass:Math.min(mass,1e4),stiffness:Math.min(stiffness,1e6),damping:Math.min(damping,1e6)} : {mass:1,stiffness:100,damping:15}};
  }
  return easingNames.find(n=>n.replace(/[A-Z]/g,c=>"_"+c).toUpperCase()===type) ?? "easeOut";
}
function transition(t:JsonObject,w:ImportWarnings):PrototypeTransition {
  if (t.type==="DISSOLVE") return {type:"dissolve"};
  if (t.type==="SMART_ANIMATE" || t.type==="SCROLL_ANIMATE") return {type:"smartAnimate"};
  const types={MOVE_IN:"moveIn",MOVE_OUT:"moveOut",PUSH:"push",SLIDE_IN:"slideIn",SLIDE_OUT:"slideOut"} as const;
  const type=string(t.type) ?? "";
  if (!Object.hasOwn(types,type)) {w.add("prototype transitions of unknown types play instantly");return {type:"instant"};}
  const dir=t.direction;
  return {type:types[type as keyof typeof types],direction:dir==="RIGHT" ? "right" : dir==="TOP" ? "top" : dir==="BOTTOM" ? "bottom" : "left"};
}
export class ImportPrototypes {
  readonly #flows:{page:string;name:string;source:string}[]=[];
  readonly #layers:{id:string;source:JsonObject}[]=[];
  readonly #overlays=new Map<string,JsonObject>();
  constructor(readonly ids:ReadonlyMap<string,string>,readonly warnings:ImportWarnings) {}
  page(id:string,raw:JsonObject) {
    const flows=children(raw.flowStartingPoints);
    for (const v of flows) {
      const f=object(v);
      if (typeof f.nodeId==="string") this.#flows.push({page:id,name:clipped(string(f.name) ?? "Flow"),source:f.nodeId});
    }
    if (!flows.length && typeof raw.prototypeStartNodeID==="string" && raw.prototypeStartNodeID) this.#flows.push({page:id,name:"Flow 1",source:raw.prototypeStartNodeID});
  }
  layer(id:string,n:JsonObject) {
    if (children(n.interactions).length || typeof n.transitionNodeID==="string") this.#layers.push({id,source:n});
    if (typeof n.id==="string" && (n.overlayPositionType || n.overlayBackgroundInteraction || n.overlayBackground)) this.#overlays.set(n.id,n);
  }
  finish(draft:HierarchyDraft,variables:Variables) {
    const actions=new RestPrototypeActions(this.ids,this.#overlays,variables,this.warnings);
    for (const {id,source} of this.#layers) {
      const raw=children(source.interactions), result:PrototypeInteraction[]=[];
      if (!raw.length) {
        const target=string(source.transitionNodeID), dest=target!==undefined && this.ids.get(target);
        if (dest) {
          const duration=time(source.transitionDuration,0);
          result.push({trigger:{type:"onClick"},actions:[{type:"navigate",dest}],transition:{type:duration ? "dissolve" : "instant"},
            duration_ms:duration || 300,easing:easing(source.transitionEasing)});
        }
      }
      for (const v of raw) {
        const i=object(v);
        if (!i.trigger || typeof i.trigger!=="object" || Array.isArray(i.trigger)) continue;
        const t=object(i.trigger), gesture=trigger(t,this.warnings);
        if (!gesture) continue;
        const found:{transition?:JsonObject}={}, mapped=actions.decode(i.actions,found);
        if (!mapped.length) {this.warnings.add("prototype interactions without supported actions were skipped");continue;}
        const tr=found.transition, e=object(tr?.easing);
        const delay=gesture.type.startsWith("mouse") ? time(numeric(t.delay) ?? t.timeout,0) : 0;
        result.push({trigger:gesture,actions:mapped,transition:tr ? transition(tr,this.warnings) : {type:"instant"},
          duration_ms:time(tr?.duration,300),easing:easing(e.type,e),...(delay && {delay_ms:delay})});
      }
      if (result.length) draft.set({...draft.nodes[id],interactions:result});
    }
    const byPage=new Map<string,PrototypeFlow[]>();
    for (const f of this.#flows) {
      const start=this.ids.get(f.source);
      if (!start) continue;
      let ancestor=draft.nodes[start];
      while (ancestor.parent!==null) ancestor=draft.nodes[ancestor.parent];
      if (ancestor.id!==f.page) continue;
      const items=byPage.get(f.page) ?? [];
      items.push({name:f.name,start,description:""});byPage.set(f.page,items);
    }
    for (const [page,flows] of byPage) draft.set({...draft.nodes[page] as PageNode,flows});
  }
}
