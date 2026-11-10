import { toCssHex } from "../../colour";
import { overlayPositions, type PrototypeAction, type PrototypeExpression } from "../../prototype-data";
import { readRestVariableValue } from "../../variable-rest";
import type { Variables, VariableType } from "../../variables";
import { children, clamp, finite, object, restColour, string, type ImportWarnings, type JsonObject } from "./values";

const operations={ADDITION:"add",SUBTRACTION:"subtract",MULTIPLICATION:"multiply",DIVISION:"divide",EQUALS:"equals",NOT_EQUAL:"notEqual",
  LESS_THAN:"less",LESS_THAN_OR_EQUAL:"lessOrEqual",GREATER_THAN:"greater",GREATER_THAN_OR_EQUAL:"greaterOrEqual",AND:"and",OR:"or",NOT:"not",NEGATE:"negate"} as const;
const restKinds=new Map<string,VariableType>([["COLOR","color"],["FLOAT","number"],["STRING","string"],["BOOLEAN","boolean"]]);
const alias=(v:unknown)=>{const x=object(v);return x.type==="VARIABLE_ALIAS" && typeof x.id==="string" && x.id ? x.id : undefined;};
export class RestPrototypeActions {
  readonly #variables;
  readonly #modes;
  constructor(readonly ids:ReadonlyMap<string,string>, readonly overlays:ReadonlyMap<string,JsonObject>,variables:Variables,readonly warnings:ImportWarnings) {
    this.#variables=new Map(variables.variables.map(v=>[v.id,v]));
    this.#modes=new Map(variables.collections.map(c=>[c.id,new Set(c.modes.map(m=>m.id))]));
  }
  #warn(msg:string):undefined {this.warnings.add(msg);return undefined;}
  #expression(raw:unknown,depth:number):PrototypeExpression|undefined {
    if (depth>32) return;
    const data=object(raw),v=data.value,e=object(v),fn=string(e.expressionFunction);
    if (fn!==undefined) {
      const args=children(e.expressionArguments);
      if (fn==="VAR_MODE_LOOKUP") {
        const variable=alias(object(args[0]).value),mode=string(object(args[1]).value),entry=variable && this.#variables.get(variable);
        if (args.length===2 && entry && mode!==undefined && this.#modes.get(entry.collection)?.has(mode)) return {inMode:{variable:entry.id,mode}};
        return this.#warn("variable mode lookups in prototype expressions that aren't a variable and one of its modes were skipped");
      }
      if (!Object.hasOwn(operations,fn)) return this.#warn("prototype expressions with unsupported functions were skipped");
      if (!args.length || args.length>64) return;
      const mapped:PrototypeExpression[]=[];
      for (const arg of args) {const x=this.#expression(arg,depth+1);if (!x) return;mapped.push(x);}
      return {op:{op:operations[fn as keyof typeof operations],args:mapped}};
    }
    const ref=alias(v);
    if (ref) return this.#variables.has(ref) ? {value:{type:"alias",value:ref}} : this.#warn("prototype expressions on variables that aren't in the variables JSON were skipped");
    const type=restKinds.get(String(data.resolvedType ?? data.type)) ?? (typeof v==="number" ? "number" : typeof v==="string" ? "string" : typeof v==="boolean" ? "boolean" : "color");
    const value=readRestVariableValue(type,v);
    return value && {value};
  }
  #node(a:JsonObject):PrototypeAction|undefined {
    const target=string(a.destinationId), dest=target!==undefined && this.ids.get(target);
    if (!dest) return this.#warn("prototype actions without a destination in the file were skipped");
    switch(string(a.navigation)) {
      case undefined:case "NAVIGATE":return {type:"navigate",dest,...(a.preserveScrollPosition===true && {preserve_scroll:true})};
      case "SWAP":return {type:"swapOverlay",dest};
      case "SCROLL_TO":return {type:"scrollTo",dest};
      case "CHANGE_TO":return {type:"changeTo",dest};
      case "OVERLAY": {
        const meta=this.overlays.get(target!) ?? {}, bg=object(meta.overlayBackground);
        const position=overlayPositions.find(p=>p.replace(/[A-Z]/g,c=>"_"+c).toUpperCase()===meta.overlayPositionType) ?? "center";
        const {x,y}=object(a.overlayRelativePosition);
        return {type:"openOverlay",dest,position,close_on_outside:(string(meta.overlayBackgroundInteraction) ?? "CLOSE_ON_CLICK_OUTSIDE")==="CLOSE_ON_CLICK_OUTSIDE",
          background:bg.type==="SOLID_COLOR" ? restColour(bg.color) ?? null : null,
          ...(position==="manual" && finite(x) && finite(y) && {offset:[clamp(x,-1e5,1e5),clamp(y,-1e5,1e5)]})};
      }
      default:return this.#warn("prototype navigations of unknown types were skipped");
    }
  }
  decode(input:unknown,found:{transition?:JsonObject},depth=0):PrototypeAction[] {
    const out:PrototypeAction[]=[];
    for (const raw of children(input)) {
      const a=object(raw);
      switch(a.type) {
        case "BACK":out.push({type:"back"});break;
        case "CLOSE":out.push({type:"closeOverlay"});break;
        case "URL":{
          const url=string(a.url);
          if (url?.trim()) out.push({type:"openUrl",url:Array.from(url).slice(0,4096).join(""),...(a.openInNewTab===false && {new_tab:false})});
          break;
        }
        case "NODE":{
          const action=this.#node(a);
          if (action) {out.push(action); if (!found.transition && a.transition && typeof a.transition==="object" && !Array.isArray(a.transition)) found.transition=object(a.transition);}
          break;
        }
        case "SET_VARIABLE":{
          const entry=this.#variables.get(String(a.variableId));
          if (!entry) {this.#warn("set-variable actions on variables that aren't in the variables JSON were skipped");break;}
          if (!a.variableValue || typeof a.variableValue!=="object" || Array.isArray(a.variableValue)) {this.#warn("set-variable actions without a value were skipped");break;}
          const raw=object(a.variableValue).value;
          if (alias(raw) || object(raw).expressionFunction!==undefined) {
            const expr=this.#expression(a.variableValue,0);
            if (expr) out.push({type:"setVariable",variable:entry.id,value:null,expr});
            else this.#warn("set-variable actions with values that can't be evaluated were skipped");
          } else {
            const value=readRestVariableValue(entry.resolvedType,raw);
            if (!value || value.type==="alias" || value.type==="colorAlpha" || value.type==="colorMix") this.#warn("set-variable actions with values that don't fit the variable were skipped");
            else out.push({type:"setVariable",variable:entry.id,value:value.type==="color" ? toCssHex(value.value) : value.value});
          }
          break;
        }
        case "SET_VARIABLE_MODE":{
          const collection=string(a.variableCollectionId), mode=string(a.variableModeId);
          if (collection!==undefined && mode!==undefined && this.#modes.get(collection)?.has(mode)) out.push({type:"setVariableMode",collection,mode});
          else this.#warn("set-variable-mode actions on collections or modes that aren't in the variables JSON were skipped");
          break;
        }
        case "CONDITIONAL":{
          if (depth>=16) {this.#warn("conditional prototype actions nested too deeply were skipped");break;}
          const blocks=children(a.conditionalBlocks).map(object);
          if (blocks.length===1 && blocks[0].condition==null) {
            for (const action of this.decode(blocks[0].actions,found,depth+1)) out.push(action);
            break;
          }
          const mapped=[];
          for (const b of blocks.slice(0,64)) {
            const condition=b.condition==null ? undefined : this.#expression(b.condition,0);
            if (!condition && b.condition!=null) {this.#warn("conditional prototype actions with conditions that can't be evaluated were skipped");mapped.length=0;break;}
            mapped.push({...(condition && {condition}),actions:this.decode(b.actions,found,depth+1)});
            if (!condition) break;
          }
          if (mapped.some(b=>b.actions.length)) out.push({type:"conditional",blocks:mapped});
          break;
        }
        default:this.#warn(a.type==="UPDATE_MEDIA_RUNTIME" ? "video actions are not supported and were skipped" : "prototype actions of unknown types were skipped");
      }
    }
    return out;
  }
}
