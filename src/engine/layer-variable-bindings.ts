import { remapBindings } from "./list-variable-bindings";
import { withStyleRef } from "./shared-styles";
import { requiredTargets } from "./arrange";
import { isFrameLike, withRectanglePaints, type Document, type DocumentNode } from "./document";
import { HierarchyDraft } from "./hierarchy";
import { parseString } from "./parameters";
import type { Paint } from "./solid-paint";
import { nodeFills } from "./style-application";
import { effectBindingType } from "./style-definitions";
import { bindingItem, effectWithVariable, gridWithVariable, paintWithVariable, rebindPaintAlpha } from "./style-variables";
import { compareScalarKeys } from "./text-breaks";
import { variableScopes } from "./variable-metadata";
import { layerModes, variableConsumers } from "./variable-modes";
import { resolveVariable, variableIndex, type Variables, type VariableType } from "./variables";
import { sameComponentValue } from "./component-groups";
import { toCssHex } from "./colour";
import { trimNumber } from "./inspect-text";
import { frameTuning } from "./layout-properties";
import { detachEditedFields } from "./layer-variable-fields";
import { supportsLayerProperty, writeProperties } from "./properties";
import { matchingVariant, variantProperties, variantOptions } from "./component-variants";

type PaintList = "fills"|"strokes";
const empty=Object.freeze([]);

function paintsOf(node:DocumentNode,list:PaintList) {
  return list==="fills" ? nodeFills(node) : node.strokes ?? empty;
}

function withPaints<T extends DocumentNode>(node:T,list:PaintList,paints:readonly Paint[]):T {
  if (list==="fills" && node.kind!=="page") return withRectanglePaints(node,paints) as T;
  return Object.freeze({...node,[list]:paints.length ? paints : undefined});
}

/** Raw native keys are significant, including aliases that point to the same paint. */
export function withLayerBindings<T extends DocumentNode>(node:T,patch:unknown):T {
  if (!patch || typeof patch!=="object" || Array.isArray(patch)) return node;
  const fields=patch as Record<string,unknown>;
  const bindings:Record<string,string>=Object.assign(Object.create(null),node.boundVariables);
  let changed=false;
  for (const field of Object.keys(fields).sort(compareScalarKeys)) {
    const id=fields[field];
    if (typeof id==="string") {
      if (bindings[field]===id) continue;
      bindings[field]=id;
    } else {
      if (!Object.hasOwn(bindings,field)) continue;
      delete bindings[field];
    }
    changed=true;
    const item=bindingItem(field);
    if (item?.field==="color" && (item.list==="fills" || item.list==="strokes")) {
      const paints=paintsOf(node,item.list);
      const next=rebindPaintAlpha(paints,item.index,typeof id==="string");
      if (next!==paints) node=withPaints(node,item.list,next);
    }
  }
  if (!changed) return node;
  const {boundVariables,...rest}=node;
  return Object.freeze({...rest,...(Object.keys(bindings).length && {boundVariables:Object.freeze(bindings)})}) as T;
}

const fieldScopes:ReadonlyMap<string,string>=new Map([
  ["WIDTH_HEIGHT","width height minWidth maxWidth minHeight maxHeight"],
  ["GAP","gap columnGap rowGap crossGap padding paddingHorizontal paddingVertical paddingTop paddingRight paddingBottom paddingLeft"],
  ["CORNER_RADIUS","cornerRadius topLeftRadius topRightRadius bottomRightRadius bottomLeftRadius"],
  ["STROKE_FLOAT","strokeWeight strokeTopWeight strokeRightWeight strokeBottomWeight strokeLeftWeight"],
  ["OPACITY","opacity"],["FONT_SIZE","fontSize"],["FONT_WEIGHT","fontWeight"],["PARAGRAPH_SPACING","paragraphSpacing"],
  ["PARAGRAPH_INDENT","paragraphIndent"],["LINE_HEIGHT","lineHeight"],["LETTER_SPACING","letterSpacing"],
  ["TEXT_CONTENT","characters"],["FONT_FAMILY","fontFamily"],["FONT_STYLE","fontStyle"],
].flatMap(([scope,fields])=>fields.split(" ").map(field=>[field,scope] as const)));

export function layerFieldScope(node:DocumentNode,field:string) {
  const item=bindingItem(field);
  if (item?.list==="fills") return node.kind==="text" ? "TEXT_FILL" : isFrameLike(node) ? "FRAME_FILL" : "SHAPE_FILL";
  if (item?.list==="strokes") return "STROKE_COLOR";
  if (item?.list==="effects") return item.field==="color" ? "EFFECT_COLOR" : "EFFECT_FLOAT";
  return fieldScopes.get(field);
}

function acceptsVariable(doc:Document,node:DocumentNode,field:string,type:VariableType) {
  if (field.startsWith("componentProperties/")) {
    if (node.kind!=="instance") return false;
    const name=field.slice("componentProperties/".length),main=doc.nodes[node.component];
    if (main?.kind!=="component") return false;
    const set=doc.nodes[main.parent];
    if (set?.kind==="componentSet" && variantOptions(doc,set).has(name)) return type==="string";
    const def=Object.hasOwn(main.props,name) && main.props[name];
    return !!def && (def.type==="text" && type==="string" || def.type==="boolean" && type==="boolean");
  }
  const item=bindingItem(field);
  if (field.split("/",1)[0]==="effects") return !!item && effectBindingType(node.effects?.[item.index],item.field)===type;
  if (item?.list==="layoutGrids") return type==="number";
  if (field==="visible") return type==="boolean";
  const scope=layerFieldScope(node,field);
  return !scope || variableScopes[type].includes(scope);
}

export function bindLayerVariable(doc:Document,selection:readonly string[],params:Record<string,unknown>) {
  for (const key of Object.keys(params)) if (!["id","ids","field","variable"].includes(key)) throw new Error("Unknown variable.bind parameter "+key);
  const field=parseString(params.field);
  if (field===undefined) throw new Error("Variable binding requires a field");
  const ids=requiredTargets(doc,selection,params), ref=parseString(params.variable);
  const variable=ref===undefined ? undefined : doc.variables?.variables.find(v=>v.id===ref || v.name===ref);
  if (ref!==undefined && !variable) throw new Error("No such variable");
  if (variable) for (const id of ids)
    if (!acceptsVariable(doc,doc.nodes[id],field,variable.resolvedType)) throw new Error(field+" cannot bind a "+variable.resolvedType+" variable on layer "+id);
  const draft=new HierarchyDraft(doc);
  for (const id of ids) draft.set(withLayerBindings(draft.nodes[id],{[field]:variable?.id}));
  return draft.finish();
}

export function paintVariableWrappers(doc:Document,props:Record<string,unknown>) {
  const wrappers=new Map<PaintList,string>();
  for (const [key,value] of Object.entries(props)) {
    if (!value || typeof value!=="object" || !Object.hasOwn(value,"$var")) continue;
    if (key!=="fill" && key!=="stroke") throw new Error("Only fill and stroke accept $var in props");
    const ref=(value as Record<string,unknown>).$var;
    if (Object.keys(value).length!==1 || typeof ref!=="string" || !ref.length) throw new Error("Expected a variable ID or name in $var");
    const data=doc.variables;
    const direct=data && variableIndex(data).variables.get(ref);
    const matches=direct ? [direct] : data?.variables.filter(v=>{
      const collection=variableIndex(data).collections.get(v.collection)?.name ?? v.collection;
      return v.name===ref || collection+"/"+v.name===ref;
    }) ?? [];
    if (matches.length!==1) throw new Error(matches.length ? "Ambiguous variable "+ref+" (use a variable ID)" : "No such variable "+ref);
    if (matches[0].resolvedType!=="color") throw new Error(key+" requires a colour variable");
    wrappers.set(key==="fill" ? "fills" : "strokes",matches[0].id);
  }
  return wrappers;
}

export function bindWrappedPaint<T extends DocumentNode>(node:T,list:PaintList,id:string):T {
  const field=list==="fills" ? "fill" : "stroke";
  const unlinked=remapBindings(node,key=>{
    const item=bindingItem(key);
    return item?.list===list && item.index===0 && item.field==="color" ? undefined : key;
  });
  return withStyleRef(withLayerBindings(unlinked,{[field]:id}),field,null);
}

export function forgetLayerVariables(doc:Document,old:Variables,next:Variables) {
  const index=variableIndex(next).variables;
  const gone=new Set(old.variables.filter(v=>!index.has(v.id)).map(v=>v.id));
  if (!gone.size) return doc;
  let draft:HierarchyDraft|undefined;
  for (const node of Object.values(doc.nodes)) {
    if (!node.boundVariables) continue;
    const removed=Object.keys(node.boundVariables).filter(k=>gone.has(node.boundVariables![k]));
    if (removed.length) (draft??=new HierarchyDraft(doc)).set(withLayerBindings(node,Object.fromEntries(removed.map(k=>[k,null]))));
  }
  return draft?.finish() ?? doc;
}

type Resolved=NonNullable<ReturnType<typeof resolveVariable>>;

function scalarProperty(field:string,value:Resolved) {
  if (value.type==="color") return toCssHex(value.value);
  if (value.type!=="number") return value.value;
  if (field==="opacity") return Math.max(0,Math.min(1,value.value/100));
  if (field==="arcSweep") return value.value*3.6;
  if (field==="arcInner") return value.value/100;
  return field==="characters" ? trimNumber(value.value) : value.value;
}

function projectInstance(doc:Document,node:DocumentNode,values:Map<string,Resolved>):DocumentNode {
  if (node.kind!=="instance") return node;
  let component=node.component;
  const main=doc.nodes[component],set=main?.parent ? doc.nodes[main.parent] : undefined;
  if (set?.kind==="componentSet") {
    const wanted=variantProperties(main.name),options=variantOptions(doc,set);
    let changed=false;
    for (const [name,v] of values) if (v.type==="string" && options.get(name)?.includes(v.value) && wanted.get(name)!==v.value) {
      wanted.set(name,v.value);
      changed=true;
    }
    if (changed) component=matchingVariant(doc,set,wanted) ?? component;
  }
  const target=doc.nodes[component];
  if (target?.kind!=="component") return node;
  const props={...node.props};
  for (const [name,v] of values) {
    const def=Object.hasOwn(target.props,name) && target.props[name];
    if (def && (def.type==="text" && v.type==="string" || def.type==="boolean" && v.type==="boolean"))
      Object.defineProperty(props,name,{value:v.value,enumerable:true,configurable:true,writable:true});
  }
  return component===node.component && sameComponentValue(props,node.props) ? node : Object.freeze({...node,component,props:Object.freeze(props)});
}

export function refreshLayerBindings(doc:Document,before?:Document,paintOnly=false,explicit=false) {
  if (doc===before || !doc.variables?.variables.length) return doc;
  let draft:HierarchyDraft|undefined;
  for (const node of variableConsumers(doc,before)) {
    if (!node.boundVariables) continue;
    const current=draft?.nodes[node.id] ?? node, old=before?.nodes[node.id];
    let next=explicit && old ? detachEditedFields(old,current) : current;
    const scalars:Record<string,unknown>=Object.create(null);
    const properties=new Map<string,Resolved>();
    const modes=layerModes(doc,node.id);
    for (const field of Object.keys(next.boundVariables ?? {}).sort(compareScalarKeys)) {
      const item=bindingItem(field);
      const value=resolveVariable(doc.variables,next.boundVariables![field],modes);
      if (!value) continue;
      if (!item) {
        if (paintOnly) continue;
        if (field.startsWith("componentProperties/")) properties.set(field.slice("componentProperties/".length),value);
        else if (supportsLayerProperty(field) && (!frameTuning.has(field) || isFrameLike(next) && next.layout)) scalars[field]=scalarProperty(field,value);
        continue;
      }
      if ((item.list==="fills" || item.list==="strokes") && value.type==="color") {
        const paints=paintsOf(next,item.list);
        const resolved=paintWithVariable(paints,item.index,item.field,value.value);
        if (resolved!==paints) next=withPaints(next,item.list,resolved);
      } else if (!paintOnly && item.list==="effects" && next.effects) {
        const effects=effectWithVariable(next.effects,item.index,item.field,value);
        if (effects!==next.effects) next=Object.freeze({...next,effects});
      } else if (!paintOnly && item.list==="layoutGrids" && next.grids && value.type==="number") {
        const grids=gridWithVariable(next.grids,item.index,item.field,value.value);
        if (grids!==next.grids) next=Object.freeze({...next,grids});
      }
    }
    if (properties.size) next=projectInstance(doc,next,properties);
    if (next!==current) (draft??=new HierarchyDraft(doc)).set(next);
    if (Object.keys(scalars).length) {
      draft??=new HierarchyDraft(doc);
      try { writeProperties(draft,draft.document,[],{id:node.id,props:scalars},undefined,[],undefined,true); }
      catch { /* Native raw bindings may refer to properties this kind cannot accept. */ }
    }
  }
  return draft?.finish() ?? doc;
}
