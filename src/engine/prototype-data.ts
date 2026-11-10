import type { Colour } from "./colour";
import { isLosslessNumber } from "lossless-json";
import { fail, id, number, wireId } from "./native-values";
import { textBool, textEnum, textRecord, textString } from "./text-style";
import { readVariableValue, type VariableValue } from "./variables";

const directions = ["left","right","top","bottom"] as const;
const plainTriggers = ["onClick","onHover","onPress","onDrag","mouseEnter","mouseLeave","mouseDown","mouseUp"] as const;
const directionalTransitions = ["moveIn","moveOut","push","slideIn","slideOut"] as const;
export const easingNames = ["linear","easeIn","easeOut","easeInOut","easeInBack","easeOutBack","easeInOutBack","gentle","quick","bouncy","slow"] as const;
const operators = ["add","subtract","multiply","divide","equals","notEqual","less","lessOrEqual","greater","greaterOrEqual","and","or","not","negate"] as const;
export const overlayPositions = ["center","topLeft","topCenter","topRight","bottomLeft","bottomCenter","bottomRight","manual"] as const;
type Pair = readonly [number,number];
export type PrototypeTrigger = {type:typeof plainTriggers[number]} | {type:"afterDelay";ms:number} | {type:"keyPress";key:string};
export type PrototypeTransition = {type:"instant"|"dissolve"|"smartAnimate"} | {type:typeof directionalTransitions[number];direction:typeof directions[number]};
export type PrototypeEasing = typeof easingNames[number] | {customBezier:{x1:number;y1:number;x2:number;y2:number}} |
  {customSpring:{mass:number;stiffness:number;damping:number}};
export type PrototypeExpression = {value:VariableValue} | {op:{op:typeof operators[number];args:readonly PrototypeExpression[]}} |
  {mode:{collection:string}} | {inMode:{variable:string;mode:string}};
export type PrototypeAction =
  | {type:"back"|"closeOverlay"}
  | {type:"navigate";dest:string;preserve_scroll?:true}
  | {type:"scrollTo";dest:string;offset?:Pair}
  | {type:"swapOverlay"|"changeTo";dest:string}
  | {type:"openOverlay";dest:string;position:typeof overlayPositions[number];close_on_outside:boolean;background:Colour|null;offset?:Pair;anchor?:"triggerInside"|"triggerOutside"}
  | {type:"openUrl";url:string;new_tab?:false}
  | {type:"setVariable";variable:string;value:unknown;expr?:PrototypeExpression}
  | {type:"setVariableMode";collection:string;mode:string}
  | {type:"conditional";blocks:readonly {condition?:PrototypeExpression;actions:readonly PrototypeAction[]}[]};
export interface PrototypeInteraction {
  readonly trigger:PrototypeTrigger; readonly actions:readonly PrototypeAction[]; readonly transition:PrototypeTransition;
  readonly duration_ms:number; readonly easing:PrototypeEasing; readonly delay_ms?:number;
}
export interface PrototypeFlow { readonly name:string;readonly start:string;readonly description:string }

function list<T>(v:unknown,read:(value:unknown)=>T):readonly T[] {
  if (!Array.isArray(v)) fail("prototype list must be an array");
  return Object.freeze(v.map(read));
}
function u32(value:unknown) {
  const n=number(value,"prototype time");
  if (!Number.isInteger(n) || n<0 || n>0xffffffff) fail("prototype time must be an unsigned 32-bit integer");
  return n;
}
function pair(value:unknown):Pair {
  if (!Array.isArray(value) || value.length!==2) fail("invalid prototype offset");
  return [number(value[0],"x offset"),number(value[1],"y offset")];
}
function trigger(raw:unknown):PrototypeTrigger {
  const t=textRecord(raw,"trigger");
  if (t.type==="keyPress") return {type:t.type,key:textString(t.key,"trigger key")};
  if (t.type==="afterDelay") return {type:t.type,ms:u32(t.ms)};
  return {type:textEnum(t.type,plainTriggers,"trigger type")};
}
function transition(raw:unknown):PrototypeTransition {
  const t=textRecord(raw,"transition");
  if (t.type==="instant" || t.type==="smartAnimate" || t.type==="dissolve") return {type:t.type};
  return {type:textEnum(t.type,directionalTransitions,"transition type"),direction:textEnum(t.direction ?? "left",directions,"transition direction")};
}
function easing(raw:unknown):PrototypeEasing {
  if (typeof raw==="string") return textEnum(raw,easingNames,"easing");
  const curve=textRecord(raw,"easing");
  if (Object.hasOwn(curve,"customBezier")) {
    const p=textRecord(curve.customBezier,"custom bezier");
    return {customBezier:{x1:number(p.x1,"x1"),y1:number(p.y1,"y1"),x2:number(p.x2,"x2"),y2:number(p.y2,"y2")}};
  }
  const p=textRecord(curve.customSpring,"custom spring");
  return {customSpring:{mass:number(p.mass,"mass"),stiffness:number(p.stiffness,"stiffness"),damping:number(p.damping,"damping")}};
}
function expression(raw:unknown,depth=0):PrototypeExpression {
  if (depth>128) fail("prototype expression is too deeply nested");
  const e=textRecord(raw,"prototype expression");
  if (Object.hasOwn(e,"value")) return {value:readVariableValue(e.value)};
  if (Object.hasOwn(e,"op")) {
    const op=textRecord(e.op,"prototype operator");
    return {op:{op:textEnum(op.op,operators,"operator"),args:list(op.args,v=>expression(v,depth+1))}};
  }
  if (Object.hasOwn(e,"mode")) return {mode:{collection:textString(textRecord(e.mode,"mode").collection,"collection")}};
  const m=textRecord(e.inMode,"inMode");
  return {inMode:{variable:textString(m.variable,"variable"),mode:textString(m.mode,"mode")}};
}
// Action values are arbitrary JSON. Retain integer tokens outside the JS safe range.
function actionValue(value:unknown):unknown {
  if (isLosslessNumber(value)) {
    if (/^-?\d+$/.test(value.value) && !Number.isSafeInteger(Number(value.value))) return value;
    return number(value,"prototype value");
  }
  if (Array.isArray(value)) return value.map(actionValue);
  if (value && typeof value==="object") return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,actionValue(v)]));
  if (value===undefined) fail("setVariable requires a value");
  return value;
}
function action(raw:unknown,depth=0):PrototypeAction {
  if (depth>128) fail("prototype action is too deeply nested");
  const a=textRecord(raw,"prototype action"), type=a.type;
  const dest=()=>id(a.dest,"prototype destination");
  switch(type) {
    case "back":case "closeOverlay":return {type};
    case "navigate":return {type,dest:dest(),...(textBool(a.preserve_scroll ?? a.preserveScroll ?? false,"preserve scroll") && {preserve_scroll:true})};
    case "changeTo":case "swapOverlay":return {type,dest:dest()};
    case "scrollTo": {
      const offset=a.offset===undefined ? undefined : pair(a.offset);
      return {type,dest:dest(),...(offset?.some(x=>x!==0) && {offset})};
    }
    case "openOverlay": {
      const anchor=textEnum(a.anchor ?? "screen",["screen","triggerInside","triggerOutside"],"overlay anchor");
      const bg=a.background==null ? undefined : textRecord(a.background,"overlay background");
      return {type,dest:dest(),position:textEnum(a.position ?? "center",overlayPositions,"overlay position"),
        close_on_outside:textBool(a.close_on_outside ?? a.closeOnOutside ?? true,"close on outside"),
        background:bg ? {r:Math.fround(number(bg.r,"red")),g:Math.fround(number(bg.g,"green")),b:Math.fround(number(bg.b,"blue")),a:Math.fround(number(bg.a,"alpha"))} : null,
        ...(a.offset!=null && {offset:pair(a.offset)}),...(anchor!=="screen" && {anchor})};
    }
    case "openUrl":return {type,url:textString(a.url,"prototype URL"),...(!textBool(a.new_tab ?? a.newTab ?? a.openInNewTab ?? true,"new tab") && {new_tab:false})};
    case "setVariable":return {type,variable:textString(a.variable,"variable"),value:actionValue(a.value),...(a.expr!=null && {expr:expression(a.expr)})};
    case "setVariableMode":return {type,collection:textString(a.collection,"collection"),mode:textString(a.mode,"mode")};
    case "conditional":return {type,blocks:list(a.blocks,rawBlock=>{
      const block=textRecord(rawBlock,"conditional block");
      return {...(block.condition!=null && {condition:expression(block.condition)}),actions:list(block.actions ?? [],v=>action(v,depth+1))};
    })};
    default:return fail("unsupported prototype action "+String(type));
  }
}
export function readInteractions(raw:unknown) {
  return list(raw,v=>{
    const i=textRecord(v,"interaction"),delay=u32(i.delay_ms ?? i.delayMs ?? 0);
    return {trigger:trigger(i.trigger ?? {type:"onClick"}),actions:list(i.actions,a=>action(a)),transition:transition(i.transition ?? {type:"instant"}),
      easing:easing(i.easing ?? "easeOut"),duration_ms:u32(i.duration_ms ?? i.durationMs ?? 300),...(delay && {delay_ms:delay})};
  });
}
function wireAction(a:PrototypeAction):unknown {
  if ("dest" in a) return {...a,dest:wireId(a.dest)};
  if (a.type==="conditional") return {...a,blocks:a.blocks.map(b=>({...b,actions:b.actions.map(wireAction)}))};
  return a;
}
export function wireInteractions(items:readonly PrototypeInteraction[]) {
  return items.map(i=>({...i,actions:i.actions.map(wireAction)}));
}
export function readFlows(raw:unknown):readonly PrototypeFlow[] {
  return list(raw,v=>{const f=textRecord(v,"prototype flow");return {name:textString(f.name,"flow name"),start:id(f.start,"flow start"),description:textString(f.description ?? "","flow description")};});
}
export function wireFlows(items:readonly PrototypeFlow[]) {return items.map(f=>({...f,start:wireId(f.start)}));}

export function remapInteractions(items:readonly PrototypeInteraction[],lookup:(id:string)=>string|undefined) {
  const remap=(a:PrototypeAction,depth:number):PrototypeAction=>{
    if (a.type==="conditional" && depth<16) return {...a,blocks:a.blocks.map(b=>({...b,actions:b.actions.map(x=>remap(x,depth+1))}))};
    return "dest" in a ? {...a,dest:lookup(a.dest) ?? a.dest} : a;
  };
  return items.map(i=>({...i,actions:i.actions.map(a=>remap(a,0))}));
}
export function remapFlows(items:readonly PrototypeFlow[],lookup:(id:string)=>string|undefined) {
  return items.flatMap(f=>{const start=lookup(f.start);return start===undefined ? [] : [{...f,start}];});
}
