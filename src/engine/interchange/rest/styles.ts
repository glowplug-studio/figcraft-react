import { reconcileNodeStyles } from "../../style-application";
import type { DocumentNode } from "../../document";
import { readNode } from "../../file-format";
import type { HierarchyDraft } from "../../hierarchy";
import { wireId } from "../../native-values";
import { withStyleRef, type SharedStyle, type StyleSlot } from "../../shared-styles";
import { nodeDefinition } from "../../style-definitions";
import { restEffects } from "./effects";
import { layoutGrids } from "./layout";
import { restPaints,type ImportImages } from "./paint";
import { textFields } from "./text";
import type { ImportVariables } from "./bindings";
import { clipped,entries,list,object,string,type ImportWarnings,type JsonObject } from "./values";

const slots=new Map<string,StyleSlot>([["fill","fill"],["fills","fill"],["stroke","stroke"],["strokes","stroke"],["effect","effect"],["effects","effect"],["grid","grid"],["grids","grid"],["text","text"]]);
const definitions=new Map<string,StyleSlot>([["FILL","fill"],["EFFECT","effect"],["GRID","grid"],["TEXT","text"]]);
function bindingKey(slot:StyleSlot,key:string) {
  if (slot==="fill" && ["fill","fills","fills/0"].includes(key) || slot==="stroke" && key==="stroke") return "fills/0/color";
  if (slot==="fill" && key.startsWith("fills/")) return key;
  if (slot==="stroke" && key.startsWith("strokes/")) return "fills/"+key.slice(8);
  if (slot==="effect" && key.startsWith("effects/") || slot==="grid" && key.startsWith("layoutGrids/") ||
    slot==="text" && ["fontSize","lineHeight","letterSpacing","fontFamily","fontStyle"].includes(key)) return key;
}
function styleOf(slot:StyleSlot,node:DocumentNode,id:string,meta:JsonObject|undefined) {
  const def=nodeDefinition(slot,node);
  if (!def) return;
  return {id,...def,name:clipped(string(meta?.name) || "Style "+id),description:clipped(string(meta?.description) ?? "")};
}
export class ImportStyles {
  readonly #styles=new Map<string,SharedStyle>();
  readonly #metadata=new Map<string,JsonObject>();
  constructor(roots:readonly JsonObject[],source:JsonObject,images:ImportImages,vars:ImportVariables,readonly warnings:ImportWarnings) {
    for (const e of roots) for (const [key,meta] of entries(e.styles)) if (!this.#metadata.has(key)) this.#metadata.set(key,object(meta));
    for (const value of list(source.styleDefinitions)) {
      const d=object(value), id=clipped(string(d.id) ?? ""), slot=definitions.get(string(d.styleType) ?? "");
      if (!id || !Object.hasOwn(d,"node") || this.#styles.has(id) || !slot) continue;
      const n=object(d.node),type=slot==="text" ? "text" : slot==="grid" ? "frame" : "rectangle";
      const props={fills:slot==="fill" ? restPaints(n.fills,images,warnings) : [],strokes:[],effects:slot==="effect" ? restEffects(n.effects,warnings) : []};
      const grids=slot==="grid" ? layoutGrids(n.layoutGrids) : [];
      const text=slot==="text" ? textFields(n,images,warnings) : undefined;
      // The native sample is decoded a second time to collect text variable bindings.
      if (slot==="text") textFields(n,images,warnings);
      const bindings=vars.fields(n,type,false,props,grids);
      const sample=readNode("0",{type,id:wireId("0"),parent:wireId("1"),width:0,height:0,name:"",...props,...text,grids});
      const style=styleOf(slot,sample,id,d);
      if (style) {
        const bound=Object.fromEntries(Object.entries(bindings.bound).flatMap(([key,v])=>{const k=bindingKey(slot,key);return k ? [[k,v]] : [];}));
        this.#styles.set(id,{...style,...(Object.keys(bound).length && {bound})});
      }
    }
  }
  link(node:DocumentNode,n:JsonObject) {
    for (const [key,value] of entries(n.styles)) {
      const slot=slots.get(key);
      if (!slot || typeof value!=="string" || slot==="text" && node.kind!=="text") continue;
      const id=clipped(value);
      node=withStyleRef(node,slot,id);
      if (this.#styles.has(id)) continue;
      const style=styleOf(slot,node,id,this.#metadata.get(id));
      if (style) this.#styles.set(id,style);
    }
    return node;
  }
  takeBindings(draft:HierarchyDraft) {
    if (!this.#styles.size) return;
    for (const n of Object.values(draft.nodes)) {
      if (!n.boundVariables || !n.styles) continue;
      const layer={...n.boundVariables};
      for (const [slot,id] of Object.entries(n.styles)) {
        const style=id && this.#styles.get(id);
        if (!style) continue;
        const bound={...style.bound},take=!Object.keys(bound).length;
        for (const [k,v] of entries(n.boundVariables)) {
          const field=bindingKey(slot as StyleSlot,k);
          if (!field || typeof v!=="string") continue;
          if (take) bound[field]=v;
          else if (bound[field]!==v) continue;
          delete layer[k];
        }
        if (take && Object.keys(bound).length) this.#styles.set(style.id,{...style,bound});
      }
      draft.set({...n,boundVariables:Object.keys(layer).length ? layer : undefined});
    }
  }
  settleText(draft:HierarchyDraft) {
    for (const node of Object.values(draft.nodes)) if (node.kind==="text" && node.styles?.text) {
      draft.set(reconcileNodeStyles(undefined,node,id=>this.#styles.get(id)));
    }
  }
  finish() {
    let unused=0;
    for (const key of this.#metadata.keys()) if (!this.#styles.has(key)) unused++;
    if (unused) this.warnings.add(unused+(unused===1 ? " style that no layer uses was" : " styles that no layer uses were")+" skipped (the file JSON carries style values only on layers)");
    return [...this.#styles.values()];
  }
}
