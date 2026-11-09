import { useMemo, useState } from "react";
import { orderedComponentPropertyNames } from "./engine/component-properties";
import { defaultMain, localComponentChoices, owningInstance, owningMainComponent, propertyMains, propertyOwner } from "./engine/component-tree";
import { variantOptions, variantProperties } from "./engine/component-variants";
import type { ComponentNode, ComponentSetNode, Document, LayerNode, NodeId } from "./engine/document";

type Dispatch = (command:string,params?:unknown)=>void;
interface PanelProps { document:Document; selection:readonly NodeId[]; enabled:boolean; dispatch:Dispatch }

function TextField({label,value,save}:{label:string;value:string;save:(value:string)=>void}) {
  return <input key={value} aria-label={label} defaultValue={value}
    onKeyDown={e=>{if (e.key === "Enter") e.currentTarget.blur();}}
    onBlur={e=>{
      if (e.currentTarget.value !== value) {
        const next = e.currentTarget.value;
        e.currentTarget.value = value;
        save(next);
      }
    }}/>;
}

function freshName(base:string, names:readonly string[], numbered=false) {
  for (let i=1;; i++) {
    const name = i === 1 && !numbered ? base : base+" "+i;
    if (!names.includes(name)) return name;
  }
}

function Definitions({document,owner,dispatch}: {document:Document;owner:ComponentNode|ComponentSetNode;dispatch:Dispatch}) {
  const main = propertyMains(document,owner)[0];
  const names = main ? orderedComponentPropertyNames(main.props,main.propOrder) : [];
  const variants = owner.kind === "componentSet" ? [...variantOptions(document,owner)] : [];
  const defaults = variantProperties(defaultMain(document,owner.id)?.name ?? "");
  const choices = useMemo(()=>localComponentChoices(document).flatMap(g=>g.options),[document.nodes,document.pages]);
  const others = choices.filter(id=>id !== owner.id && id !== main?.id);
  const create = (type:string)=>{
    const name = freshName("Property",[...names,...variants.map(([key])=>key)],true);
    dispatch("component.addProperty",{id:owner.id,name,type,default:type === "variant" ? "Default" : type === "boolean" ? true : type === "text" ? "Text" : others[0]});
  };
  const edit = (name:string,params:Record<string,unknown>)=>dispatch("component.editProperty",{id:owner.id,name,...params});
  const remove = (name:string)=>dispatch("component.deleteProperty",{id:owner.id,name});
  const options = (ids:readonly NodeId[])=>ids.map(id=><option key={id} value={id}>{document.nodes[id]?.name ?? id}</option>);
  const dragged = "application/x-figcraft-variant-property";
  const combinations = propertyMains(document,owner).map(n=>JSON.stringify([...variantProperties(n.name)].sort(([a],[b])=>a<b?-1:a>b?1:0)));
  return <fieldset><legend>Component properties</legend>
    <select aria-label="Create component property" value="" onChange={e=>create(e.currentTarget.value)}>
      <option value="" disabled>Add property</option>
      <option value="variant">Variant</option><option value="boolean">Boolean</option><option value="text">Text</option>
      <option value="instanceSwap" disabled={!others.length}>Instance swap</option>
    </select>
    {owner.kind === "componentSet" && combinations.length !== new Set(combinations).size &&
      <p role="status">Some variants share the same property values.</p>}
    {variants.map(([name,values],index)=><fieldset key={name} onDragOver={e=>{if (e.dataTransfer.types.includes(dragged)) e.preventDefault();}}
      onDrop={e=>{if (e.dataTransfer.types.includes(dragged)) {e.preventDefault();edit(e.dataTransfer.getData(dragged),{index});}}}>
      <legend draggable onDragStart={e=>e.dataTransfer.setData(dragged,name)}>{name}</legend>
      <TextField label={"Rename "+name} value={name} save={newName=>edit(name,{newName})}/>
      <select aria-label={"Default "+name} value={defaults.get(name) ?? values[0]} onChange={e=>edit(name,{default:e.currentTarget.value})}>
        {values.map(v=><option key={v}>{v}</option>)}</select>
      {values.map(v=><TextField key={v} label={"Rename "+name+" value "+v} value={v} save={newValue=>edit(name,{value:v,newValue})}/>)}
      <button type="button" onClick={()=>{
        let i=values.length+1;
        while (values.includes("Value "+i)) i++;
        dispatch("component.addVariant",{id:owner.id,property:name,value:"Value "+i});
      }}>Add {name} value</button>
      {variants.length>1 && <>
        <button type="button" disabled={!index} onClick={()=>edit(name,{index:index-1})}>Move {name} up</button>
        <button type="button" disabled={index===variants.length-1} onClick={()=>edit(name,{index:index+1})}>Move {name} down</button></>}
      <button type="button" onClick={()=>remove(name)}>Delete {name}</button>
    </fieldset>)}
    {main && names.map(name=>{
      const def = main.props[name];
      return <fieldset key={name}><legend>{name}</legend>
        <TextField label={"Rename "+name} value={name} save={newName=>edit(name,{newName})}/>
        {def.type === "boolean" && <label><input type="checkbox" checked={def.default} onChange={e=>edit(name,{default:e.currentTarget.checked})}/>Default {name}</label>}
        {def.type === "text" && <TextField label={"Default "+name} value={def.default} save={value=>edit(name,{default:value})}/>}
        {def.type === "instanceSwap" && <select aria-label={"Default "+name} value={def.default} onChange={e=>edit(name,{default:e.currentTarget.value})}>
          {options(choices.includes(def.default) ? choices : [def.default,...choices])}</select>}
        {(def.type === "slot" || def.type === "instanceSwap") && <details><summary>Preferred components for {name}</summary>
          {others.map(id=><label key={id}><input type="checkbox" checked={def.preferred.includes(id)}
            onChange={e=>edit(name,{preferred:e.currentTarget.checked ? [...def.preferred,id] : def.preferred.filter(p=>p!==id)})}/>{document.nodes[id].name}</label>)}</details>}
        <button type="button" onClick={()=>remove(name)}>Delete {name}</button>
      </fieldset>;
    })}
  </fieldset>;
}

function LayerBindings({node,main,dispatch}: {node:LayerNode;main:ComponentNode;dispatch:Dispatch}) {
  const [naming,setNaming] = useState(false);
  const [slot,setSlot] = useState(node.name);
  const fields = [{key:"visible",label:"Visibility",type:"boolean"}];
  if (node.kind === "text") fields.push({key:"characters",label:"Text",type:"text"});
  if (node.kind === "instance") fields.push({key:"mainComponent",label:"Instance",type:"instanceSwap"});
  if (node.kind === "frame") fields.push({key:"slot",label:"Slot",type:"slot"});
  const names = orderedComponentPropertyNames(main.props,main.propOrder);
  return <fieldset><legend>Component property bindings</legend>
    {fields.map(({key,label,type})=>{
      const bound = node.propRefs?.[key], isSlot = type === "slot";
      return <div key={key}><label>{label}<select aria-label={"Bind "+label} value={bound ?? ""}
        onChange={e=>dispatch("component.bindProperty",{layer:node.id,property:e.currentTarget.value,field:key})}>
        <option value="" disabled={isSlot && bound !== undefined}>Unbound</option>
        {names.filter(n=>main.props[n].type===type).map(n=><option key={n}>{n}</option>)}</select></label>
        {isSlot ? bound !== undefined ? <button type="button" onClick={()=>dispatch("component.removeSlot",{id:node.id})}>Remove slot</button>
          : <button type="button" onClick={()=>{setSlot(freshName([...node.name.replace(/[,=]/g,"")].slice(0,100).join("").trim()||"Slot",names));setNaming(true);}}>Name slot</button>
          : <button type="button" onClick={()=>dispatch("component.addProperty",{id:node.id,type,name:freshName(label,names)})}>Create {label.toLowerCase()} property</button>}
      </div>;
    })}
    {naming && <form onSubmit={e=>{e.preventDefault();dispatch("component.makeSlot",{id:node.id,name:slot});setNaming(false);}}>
      <label>Slot name<input autoFocus value={slot} onChange={e=>setSlot(e.currentTarget.value)} onKeyDown={e=>{if(e.key==="Escape") setNaming(false);}}/></label>
      <button type="submit">Make slot</button><button type="button" onClick={()=>setNaming(false)}>Cancel</button></form>}
  </fieldset>;
}

export function ComponentPanel({document,selection,enabled,dispatch}:PanelProps) {
  const node = selection.length===1 ? document.nodes[selection[0]] : undefined;
  if (!node || node.kind==="page") return null;
  if (node.kind === "component" || node.kind === "componentSet") {
    const owner = propertyOwner(document,node.id)!;
    return <fieldset disabled={!enabled}><Definitions document={document} owner={owner} dispatch={dispatch}/>
      <label>Description<textarea key={JSON.stringify([node.id,node.description])} defaultValue={node.description}
        onBlur={e=>{const value=[...e.currentTarget.value].slice(0,10000).join(""); if (value!==node.description) dispatch("node.set",{id:node.id,props:{description:value}});}}/></label></fieldset>;
  }
  if (owningInstance(document,node.id,false)) return null;
  const main = owningMainComponent(document,node.id);
  return main ? <fieldset disabled={!enabled}><LayerBindings key={node.id} node={node} main={main} dispatch={dispatch}/></fieldset> : null;
}
