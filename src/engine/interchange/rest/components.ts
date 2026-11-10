import { componentOverrides, type ComponentProperty, type InstanceValue } from "../../component-properties";
import { sameComponentValue, withOverrideSet } from "../../component-groups";
import { rebaseOwnedInstance } from "../../component-sync";
import { ancestors, type HierarchyDraft } from "../../hierarchy";
import { wireId } from "../../native-values";
import { compareScalarKeys } from "../../text-breaks";
import { entries, list, numeric, object, string, type ImportWarnings, type JsonObject } from "./values";

const bool=(v:unknown)=>v===true || v==="true" ? true : v===false || v==="false" ? false : undefined;
const shortName=(s:string)=>/^(.+)#[\d:]+$/s.exec(s)?.[1] ?? s;
const overrideGroups:Readonly<Record<string,string>>=Object.fromEntries(Object.entries({
  fills:"fills fillStyleId",strokes:"strokes strokeStyleId strokeWeight strokeAlign strokeCap strokeJoin strokeDashes individualStrokeWeights strokeTopWeight strokeRightWeight strokeBottomWeight strokeLeftWeight",
  effects:"effects effectStyleId",opacity:"opacity",visible:"visible",name:"name",corners:"cornerRadius rectangleCornerRadii topLeftRadius topRightRadius bottomLeftRadius bottomRightRadius cornerSmoothing",
  characters:"characters",textStyle:"fontName fontFamily fontStyle fontWeight fontSize letterSpacing lineHeight textCase textDecoration textStyleId textAlignHorizontal textAlignVertical textAutoResize paragraphSpacing paragraphIndent listSpacing hangingPunctuation hangingList textDecorationStyle textDecorationThickness textDecorationOffset textDecorationSkipInk textDecorationColor",
  size:"width height size",resizing:"layoutSizingHorizontal layoutSizingVertical layoutGrow layoutAlign primaryAxisSizingMode counterAxisSizingMode minWidth maxWidth minHeight maxHeight",
  padding:"paddingLeft paddingRight paddingTop paddingBottom horizontalPadding verticalPadding",gap:"itemSpacing counterAxisSpacing",alignment:"primaryAxisAlignItems counterAxisAlignItems",
  grids:"layoutGrids gridStyleId",exports:"exportSettings",interactions:"interactions reactions"
}).flatMap(([group,fields])=>fields.split(" ").map(field=>[field,group])));

export const figOrigin=Symbol("source of an expanded Fig layer");
export interface FigOrigin {id:string;sizeOverride:boolean}
export class ImportComponents {
  readonly #origins=new Map<string,FigOrigin>();
  readonly #defs=new Map<string,Record<string,ComponentProperty>>();
  readonly #swaps:{owner:string;name:string;rest:string}[]=[];
  readonly #defaults=new Map<string,Map<string,unknown>>();
  readonly #instances=new Map<string,JsonObject>();
  readonly #slots=new Map<string,JsonObject>();
  constructor(readonly draft:HierarchyDraft,readonly ids:Map<string,string>,readonly warnings:ImportWarnings) {}
  register(id:string,n:JsonObject) {
    const origin=(n as JsonObject & {[figOrigin]?:FigOrigin})[figOrigin];
    if (origin) this.#origins.set(id,origin);
    if (n.type==="INSTANCE") this.#instances.set(id,n);
    if (n.type==="SLOT") this.#slots.set(id,n);
    if (n.type!=="COMPONENT" && n.type!=="COMPONENT_SET") return;
    const defs:Record<string,ComponentProperty>=Object.create(null), defaults=new Map<string,unknown>();
    for (const [name,value] of entries(n.componentPropertyDefinitions).slice(0,256)) {
      const d=object(value), init=d.defaultValue;
      switch (d.type) {
        case "BOOLEAN": defs[name]={type:"boolean",default:bool(init) ?? true};break;
        case "TEXT": defs[name]={type:"text",default:string(init) ?? ""};break;
        case "INSTANCE_SWAP": if (typeof init==="string") this.#swaps.push({owner:id,name,rest:init});break;
        case "VARIANT": break;
        case "SLOT": {
          defs[name]={type:"slot",preferred:[]};
          if (Object.hasOwn(d,"defaultValue")) defaults.set(name,init);
          if (list(d.preferredValues).length) this.warnings.add("preferred slot component keys cannot be resolved to file nodes and were skipped");
          const s=object(d.slotSettings);
          if ((numeric(s.minChildren) ?? 0)!==0 || (numeric(s.maxChildren) ?? 0)!==0 || s.allowPreferredValuesOnly===true) this.warnings.add("non-default slot settings are not represented and were skipped");
          break;
        }
        default: this.warnings.add("unknown component property types were skipped");
      }
    }
    this.#defs.set(id,defs);this.#defaults.set(id,defaults);
  }
  #main(rest:unknown) {
    const id=typeof rest==="string" && this.ids.get(rest);
    return id && this.draft.nodes[id]?.kind==="component" ? id : undefined;
  }
  #instanceValues(n:JsonObject) {
    const props:Record<string,InstanceValue>=Object.create(null);
    for (const [key,v] of entries(n.componentProperties).slice(0,256)) {
      const p=object(v);
      if (p.type==="TEXT" && typeof p.value==="string") props[key]=p.value;
      if (p.type==="BOOLEAN" && bool(p.value)!==undefined) props[key]=bool(p.value)!;
      const swap=p.type==="INSTANCE_SWAP" && this.#main(p.value);
      if (swap) props[key]=wireId(swap);
    }
    return props;
  }
  #resolveSlots() {
    const bound=new Map<string,Set<string>>();
    for (const [id,n] of this.#slots) {
      const slot=this.draft.nodes[id];
      if (slot.kind!=="frame") continue;
      const owner=ancestors(this.draft.document,id).find(p=>this.draft.nodes[p].kind==="component" || this.#instances.has(p));
      const layer=owner ? this.draft.nodes[owner] : undefined;
      if (!layer) {this.warnings.add("slot layers without a matching slot property were imported as frames");continue;}
      const main=layer.kind==="instance" ? this.draft.nodes[layer.component] : layer;
      if (main.kind!=="component") continue;
      const names=Object.keys(main.props).sort(compareScalarKeys).filter(k=>main.props[k].type==="slot");
      const refs=entries(n.componentPropertyReferences).map(([,v])=>v);
      const used=bound.get(main.id) ?? new Set<string>();
      const free=names.filter(k=>layer.kind==="instance" || !used.has(k));
      const name=names.find(k=>refs.includes(k)) ?? names.find(k=>shortName(k)===(string(n.name) ?? "")) ?? (free.length===1 ? free[0] : undefined);
      if (layer.kind==="component") {
        if (name && !used.has(name)) {
          used.add(name);bound.set(main.id,used);
          this.draft.set({...slot,propRefs:{...slot.propRefs,slot:name}});
        } else this.warnings.add("slot layers without a matching slot property were imported as frames");
      } else if (name && layer.kind==="instance") {
        const defaults=this.#defaults.get(main.id)?.has(name) ? this.#defaults.get(main.id) : this.#defaults.get(main.parent);
        const input=object(object(this.#instances.get(layer.id)?.componentProperties)[name]);
        const own=defaults?.has(name) && Object.hasOwn(input,"value") ? !sameComponentValue(defaults.get(name),input.value) : slot.children.length>0;
        if (own) this.draft.set(withOverrideSet(slot,new Set([...componentOverrides(slot),"slot"])));
      }
    }
  }
  finish() {
    const {draft,ids}=this;
    for (const {owner,name,rest} of this.#swaps) {
      const id=this.#main(rest);
      if (id) this.#defs.get(owner)![name]={type:"instanceSwap",default:id,preferred:[]};
      else this.warnings.add("instance swap properties whose default component isn't in the file were skipped");
    }
    for (const [id,props] of this.#defs) {
      const node=draft.nodes[id];
      if (node.kind==="component") draft.set({...node,props:{...this.#defs.get(node.parent),...props}});
    }
    const uses=new Map<string,Set<string>>(), links:{id:string;main:string;owner?:string;depth:number}[]=[];
    for (const [id,n] of this.#instances) {
      const main=this.#main(n.componentId),parents=ancestors(draft.document,id);
      if (!main) {this.warnings.add("instances of components that aren't in the file were imported as frames");continue;}
      if (parents.includes(main)) {this.warnings.add("instances inside their own main component were imported as frames");continue;}
      const owner=parents.find(id=>draft.nodes[id].kind==="component");
      if (owner) {const set=uses.get(owner) ?? new Set<string>();set.add(main);uses.set(owner,set);}
      links.push({id,main,owner,depth:parents.length});
    }
    const linked=links.filter(({id,main,owner})=>{
      if (owner) {
        const stack=[main],seen=new Set<string>();
        while (stack.length) {
          const target=stack.pop()!;
          if (target===owner) {this.warnings.add("instances that would nest a component inside itself were imported as frames");return false;}
          if (seen.has(target)) continue;
          seen.add(target);for (const other of uses.get(target) ?? []) stack.push(other);
        }
      }
      const frame=draft.nodes[id];
      if (frame.kind!=="frame") throw new Error("Missing imported instance frame");
      draft.set({...frame,kind:"instance",component:main,props:this.#instanceValues(this.#instances.get(id)!)});
      return true;
    });
    this.#resolveSlots();
    for (const {id} of linked) for (const value of list(this.#instances.get(id)!.overrides)) {
      const o=object(value), target=ids.get(string(o.id) ?? ""), node=target && draft.nodes[target];
      if (!node || node.kind==="page" || target!==id && !ancestors(draft.document,node.id).includes(id)) continue;
      const groups=new Set(componentOverrides(node));
      for (const f of list(o.overriddenFields)) if (typeof f==="string" && Object.hasOwn(overrideGroups,f)) groups.add(overrideGroups[f]);
      draft.set(withOverrideSet(node,groups));
    }
    for (const [id,origin] of this.#origins) {
      const source=ids.get(origin.id), node=draft.nodes[id];
      if (!source || source===id || node.kind==="page") continue;
      const linked={...node,source};
      draft.set(origin.sizeOverride ? withOverrideSet(linked,new Set([...componentOverrides(node),"size"])) : linked);
    }
    this.#rename();
    for (const {id,main} of linked.sort((a,b)=>b.depth-a.depth)) {
      const instance=draft.nodes[id],source=draft.nodes[main];
      if (instance.kind==="instance" && source.kind==="component") rebaseOwnedInstance(draft,instance,source);
    }
  }
  #rename() {
    const {draft}=this,raws=new Map<string,Set<string>>();
    const relevant=Object.values(draft.nodes).filter(n=>n.propRefs || n.kind==="instance" || n.kind==="component");
    for (const n of relevant) for (const k of [...Object.values(n.propRefs ?? {}),...Object.keys(n.kind==="instance" || n.kind==="component" ? n.props : {})]) {
      const short=shortName(k),variants=raws.get(short) ?? new Set<string>();variants.add(k);raws.set(short,variants);
    }
    const rename=(k:string)=>{const short=shortName(k);return raws.get(short)?.size===1 ? short : k;};
    for (const n of relevant) {
      const refs=n.propRefs ? {propRefs:Object.fromEntries(Object.entries(n.propRefs).map(([k,v])=>[k,rename(v)]))} : {};
      if (n.kind==="component") draft.set({...n,...refs,props:Object.fromEntries(Object.entries(n.props).map(([k,v])=>[rename(k),v]))});
      else if (n.kind==="instance") draft.set({...n,...refs,props:Object.fromEntries(Object.entries(n.props).map(([k,v])=>[rename(k),v]))});
      else draft.set({...n,...refs});
    }
  }
}
