import { compareScalarKeys } from "../../text-breaks";
import { emptyVariables, type Variables } from "../../variables";
import { hasRestVariables,readRestVariables } from "../../variable-rest";
import type { Paint } from "../../solid-paint";
import { children,clipped,entries,list,object,string,type ImportWarnings,type JsonObject } from "./values";

const direct=new Set("characters visible opacity strokeWeight strokeTopWeight strokeRightWeight strokeBottomWeight strokeLeftWeight paddingLeft paddingRight paddingTop paddingBottom topLeftRadius topRightRadius bottomLeftRadius bottomRightRadius minWidth maxWidth minHeight maxHeight".split(" "));
const textFields=new Set("fontFamily fontSize fontStyle fontWeight letterSpacing lineHeight paragraphSpacing paragraphIndent".split(" "));
const radius=["topLeftRadius","topRightRadius","bottomLeftRadius","bottomRightRadius"];
const corners=["RECTANGLE_TOP_LEFT_CORNER_RADIUS","RECTANGLE_TOP_RIGHT_CORNER_RADIUS","RECTANGLE_BOTTOM_LEFT_CORNER_RADIUS","RECTANGLE_BOTTOM_RIGHT_CORNER_RADIUS"];
const alias=(v:unknown)=>object(v).type==="VARIABLE_ALIAS" ? string(object(v).id) || undefined : undefined;
const effectFields=new Map(["color","radius","spread","offsetX","offsetY","startRadius"].map(k=>[k,k]));
const gridFields=new Map([["sectionSize","size"],["count","count"],["gutterSize","gutter"],["offset","offset"]]);

export class ImportVariables {
  readonly values:Variables;
  readonly #types;
  readonly #modes;
  constructor(source:JsonObject,companion:unknown,readonly warnings:ImportWarnings) {
    let state=emptyVariables;
    for (const entry of [source,companion]) if (hasRestVariables(entry)) {
      const read=readRestVariables(entry,state);
      state={collections:read.collections,variables:read.variables};
      for (const warning of read.warnings) {
        const repeated=/^(.*) \(×(\d+)\)$/.exec(warning);
        warnings.add(repeated?.[1] ?? warning,repeated ? Number(repeated[2]) : 1);
      }
    }
    this.values=state;
    this.#types=new Map(state.variables.map(v=>[v.id,v.resolvedType]));
    this.#modes=new Map(state.collections.map(c=>[c.id,new Set(c.modes.map(m=>m.id))]));
  }
  modes(n:JsonObject) {
    const pairs:[string,string][]=[];
    for (const [c,m] of entries(n.explicitVariableModes)) {
      if (typeof m==="string" && this.#modes.get(c)?.has(m)) pairs.push([c,m]);
      else this.warnings.add("variable modes of collections that aren't in the variables JSON were skipped");
    }
    return Object.fromEntries(pairs);
  }
  fields(n:JsonObject,type:string,hasLayout:boolean,props:{fills:Paint[];strokes:Paint[];effects:readonly unknown[]},grids:readonly unknown[]) {
    let found:[string,string][]=[];
    const skipped=new Set<string>();
    const push=(field:string,id:string|undefined)=>{if (id) found.push([field,id]);};
    const single=(key:"fills"|"strokes")=>props[key].length===1 && props[key][0].type==="solid";
    for (const [key,value] of entries(n.boundVariables)) {
      if (direct.has(key)) push(key,alias(value));
      else if (key==="size") {push("width",alias(object(value).x));push("height",alias(object(value).y));}
      else if (key==="itemSpacing" || key==="counterAxisSpacing") push(key==="itemSpacing" ? "gap" : "crossGap",alias(value));
      else if (key==="rectangleCornerRadii") corners.forEach((c,i)=>push(radius[i],alias(object(value)[c])));
      else if (key==="fills" || key==="strokes") {
        const id=alias(children(value)[0]);
        if (id && !single(key)) skipped.add(key);
        else push(key==="fills" ? "fill" : "stroke",id);
      } else if (textFields.has(key)) {
        const vals=Array.isArray(value) ? value : [value], id=alias(vals[0]);
        if (id && vals.every(v=>alias(v)===id)) push(key,id);
        else if (vals.length) skipped.add(key);
      } else skipped.add(key);
    }
    for (const key of ["fills","strokes"] as const) {
      const paints=list(n[key]), field=key==="fills" ? "fill" : "stroke";
      for (const [i,value] of paints.entries()) {
        const p=object(value), ours=paints.length===props[key].length ? props[key][i] : undefined;
        if (ours?.type==="gradient") list(p.gradientStops).slice(0,ours.stops.length).forEach((s,j)=>
          push(key+"/"+i+"/stops/"+j+"/color",alias(object(object(s).boundVariables).color)));
        const id=alias(object(p.boundVariables).color);
        if (!id) continue;
        if (!i && single(key)) {found=found.filter(([f])=>f!==field);push(field,id);}
        else if (ours?.type==="solid") push(key+"/"+i+"/color",id);
        else skipped.add(key);
      }
    }
    for (const [key,fields,expected] of [["effects",effectFields,props.effects],["layoutGrids",gridFields,grids]] as const) {
      const items=list(n[key]);
      if (items.length!==expected.length) continue;
      items.forEach((item,i)=>{for (const [k,v] of entries(object(item).boundVariables)) {
        const to=fields.get(k);if (to) push(key+"/"+i+"/"+to,alias(v));else skipped.add(key);
      }});
    }
    if (type==="text") for (const [k,v] of entries(object(n.style).boundVariables)) {
      if (!textFields.has(k)) skipped.add(k);
      else if (!found.some(([f])=>f===k)) push(k,alias(v));
    }
    for (const k of [...skipped].sort(compareScalarKeys)) this.warnings.add("variables bound to `"+clipped(k)+"` are not supported and were skipped");
    for (const [parts,into] of [[radius,"cornerRadius"],[["paddingLeft","paddingRight"],"paddingHorizontal"],[["paddingTop","paddingBottom"],"paddingVertical"]] as const) {
      const ids=parts.map(p=>found.find(([k])=>p===k)?.[1]);
      if (ids[0] && ids.every(v=>v===ids[0])) {found=found.filter(([k])=>!parts.some(p=>p===k));push(into,ids[0]);}
    }
    const bound:Record<string,string>=Object.create(null);
    for (const [field,id] of found) {
      const applies=field==="gap" || field==="crossGap" || field.startsWith("padding") ? hasLayout :
        field==="cornerRadius" || radius.includes(field) ? ["rectangle","frame","component","componentSet","instance","polygon","star","vector","section"].includes(type) :
        field==="characters" || textFields.has(field) ? type==="text" : true;
      const required=field==="fill" || field==="stroke" || field.endsWith("/color") ? "color" : ["characters","fontFamily","fontStyle"].includes(field) ? "string" :
        field==="visible" ? "boolean" : "number";
      const kind=this.#types.get(id);
      if (!applies) this.warnings.add("variable bindings to properties the layer doesn't have were skipped");
      else if (kind===required) bound[field]=id;
      else if (kind) this.warnings.add("variable bindings whose variable type doesn't fit the property were skipped");
      else if (this.#types.size) this.warnings.add("variable bindings to variables that aren't in the variables JSON (library variables) were skipped");
      else this.warnings.add("variable bindings were skipped: the file JSON has no variable definitions (pass the local variables JSON as `variables`, or embed its `meta` next to the file JSON)");
    }
    return {bound,var_modes:this.modes(n)};
  }
}
