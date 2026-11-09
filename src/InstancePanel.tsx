import { LayerVariablePicker, type InspectorDispatch } from "./StyleVariablePicker";
import { variantOptions, variantProperties } from "./engine/component-variants";
import { useMemo, type ReactNode } from "react";
import type { Document, FrameNode, InstanceNode, NodeId } from "./engine/document";
import { isOverrideGroup } from "./engine/component-groups";
import { componentOverrides, orderedComponentPropertyNames } from "./engine/component-properties";
import { canExposeInstance, componentSlots, exposedCopies, localComponentChoices, owningInstance, propertyNodeId, slotDefinition } from "./engine/component-tree";
import { ancestors } from "./engine/hierarchy";

interface InstancePanelProps {
  document: Document;
  selection: readonly NodeId[];
  enabled: boolean;
  dispatch: InspectorDispatch;
}

function SlotControls({document,frame,name,preferred,components,dispatch}: Pick<InstancePanelProps,"document"|"dispatch"> & {
  frame:FrameNode; name:string; preferred:readonly NodeId[]; components:readonly NodeId[]
}) {
  const edited = frame.overrides?.includes("slot"), parents = new Set(ancestors(document,frame.id));
  const options = (ids:readonly NodeId[])=>ids.filter(id=>document.nodes[id]).map(id=><option key={id} value={id}>{document.nodes[id].name}</option>);
  return <div><label>{name}<select aria-label={name} value="" onChange={e=>dispatch("instance.slotInsert",{id:frame.id,component:e.currentTarget.value})}>
    <option value="">{edited ? frame.children.length+" layers" : frame.children.length ? "Default content" : "Empty"}</option>
    {preferred.length>0 && <optgroup label="Preferred">{options(preferred)}</optgroup>}
    <optgroup label="All components">{options(components.filter(id=>!parents.has(id)))}</optgroup>
  </select></label>
  <button type="button" onClick={()=>dispatch("select.set",{ids:[frame.id]})}>Select {name} slot</button>
  {edited && <button type="button" onClick={()=>dispatch("instance.resetSlot",{id:frame.id})}>Reset {name}</button>}</div>;
}

function PropertyControls({document,node,components,dispatch}: Pick<InstancePanelProps,"document"|"dispatch"> & {
  node: InstanceNode;
  components: readonly NodeId[];
}) {
  const main = document.nodes[node.component];
  if (main?.kind !== "component") return null;
  const parent = document.nodes[main.parent];
  const current = variantProperties(main.name);
  const change = (name:string,value:unknown) => dispatch("instance.setProperties",{id:node.id,properties:{[name]:value}});
  const options = (ids:readonly NodeId[]) => ids.map(id=><option key={id} value={id}>{document.nodes[id].name}</option>);
  const names = orderedComponentPropertyNames(main.props,main.propOrder);
  const slots = names.some(name=>main.props[name].type === "slot") ? componentSlots(document,node.id) : [];
  const bind = (name:string, type:"string"|"boolean", label:string, control:ReactNode) =>
    <LayerVariablePicker key={name} doc={document} ids={[node.id]} field={"componentProperties/"+name} label={label} type={type} run={dispatch}>{control}</LayerVariablePicker>;
  return <>
    {parent.kind === "componentSet" && [...variantOptions(document,parent)].map(([name,values])=>
      bind(name,"string","Variant "+name,<label>{name}<select aria-label={`Variant ${name}`} value={current.get(name) ?? ""}
        onChange={event=>change(name,event.currentTarget.value)}>
        {!current.has(name) && <option value=""/>}
        {values.map(value=><option key={value}>{value}</option>)}
      </select></label>))}
    {names.map(name=>{
      const def = main.props[name];
      const value = Object.hasOwn(node.props,name) ? node.props[name] : def.type !== "slot" ? def.default : undefined;
      if (def.type === "boolean") return bind(name,"boolean",name,<label><input type="checkbox" checked={value === true}
        onChange={event=>change(name,event.currentTarget.checked)}/>{name}</label>);
      if (def.type === "text") {
        const text = typeof value === "string" ? value : "";
        return bind(name,"string",name,<label>{name}<input key={JSON.stringify([node.id,text])} defaultValue={text}
          onKeyDown={event=>{if (event.key === "Enter") event.currentTarget.blur();}}
          onBlur={event=>{if (event.currentTarget.value !== text) change(name,event.currentTarget.value);}}/></label>);
      }
      if (def.type === "slot") {
        const slot = slots.find(entry=>entry.name === name);
        const frame = slot && document.nodes[slot.id];
        return frame?.kind === "frame" ? <SlotControls key={name} document={document} frame={frame} name={name}
          preferred={def.preferred} components={components} dispatch={dispatch}/> : null;
      }
      if (def.type !== "instanceSwap") return null;
      const selected = propertyNodeId(value) ?? "", preferred = def.preferred.filter(id=>document.nodes[id]);
      return <label key={name}>{name}<select aria-label={name} value={selected} onChange={e=>change(name,e.currentTarget.value)}>
        {!components.includes(selected) && !preferred.includes(selected) && <option value={selected}>{document.nodes[selected]?.name ?? "None"}</option>}
        {preferred.length>0 && <optgroup label="Preferred">{options(preferred)}</optgroup>}
        <optgroup label="All components">{options(components)}</optgroup>
      </select></label>;
    })}
  </>;
}

function InstanceActions({document,id,enabled,dispatch}: Omit<InstancePanelProps,"selection"> & {id:NodeId}) {
  const choices = useMemo(()=>localComponentChoices(document),[document.nodes,document.pages]);
  const node = document.nodes[id];
  if (node.kind !== "instance") return null;
  const main = document.nodes[node.component], set = main?.parent ? document.nodes[main.parent] : undefined;
  const nested = owningInstance(document,id,false);
  const components = choices.flatMap(group=>group.options);
  const description = main?.kind === "component" && (main.description.trim() || (set?.kind === "componentSet" && set.description.trim()));
  return <fieldset disabled={!enabled}>
    <legend>Instance</legend>
    <label>Main component <select aria-label="Swap instance" value={main ? set?.kind === "componentSet" ? set.id : main.id : ""}
      onChange={event=>dispatch("instance.swap",{id,component:event.currentTarget.value})}>
      {!main && <option value="">Missing main component</option>}
      {choices.map(({page,options})=><optgroup key={page} label={document.nodes[page].name}>
        {options.map(key=><option key={key} value={key}>{document.nodes[key].name}</option>)}
      </optgroup>)}
    </select></label>
    {description && <p>{description}</p>}
    {canExposeInstance(document,id) && <label><input type="checkbox" checked={!!node.exposed}
      onChange={event=>dispatch("component.exposeInstance",{id,exposed:event.currentTarget.checked})}/>Expose properties to instances</label>}
    <PropertyControls document={document} node={node} components={components} dispatch={dispatch}/>
    {!nested && exposedCopies(document,id).map(copy=><fieldset key={copy.id}><legend>{copy.name}</legend>
      <PropertyControls document={document} node={copy} components={components} dispatch={dispatch}/></fieldset>)}
    {main ? <>
      <button type="button" onClick={()=>dispatch("component.goToMain",{id})}>Go to main component</button>
      <button type="button" onClick={()=>dispatch("component.pushChanges",{id})}>Push changes to main</button>
    </> : !nested && <button type="button" onClick={()=>dispatch("component.restoreMain",{id})}>Restore main component</button>}
    <button type="button" onClick={()=>dispatch("component.resetInstance",{id})}>Reset all changes</button>
    {!nested && <button type="button" onClick={()=>dispatch("component.detach",{id})}>Detach instance</button>}
  </fieldset>;
}

export function InstancePanel({document,selection,enabled,dispatch}: InstancePanelProps) {
  const id = selection.length === 1 && selection[0], node = id ? document.nodes[id] : undefined;
  if (!node || node.kind === "page" || !owningInstance(document,node.id)) return null;
  const own = componentOverrides(node).filter(isOverrideGroup);
  const slot = node.kind === "frame" && slotDefinition(document,node.id);
  return <>
    {node.kind === "instance" && <InstanceActions document={document} id={node.id} enabled={enabled} dispatch={dispatch}/>}
    {slot && node.kind === "frame" && <fieldset disabled={!enabled}><legend>Slot</legend>
      <SlotControls document={document} frame={node} name={slot.name} preferred={slot.preferred}
        components={localComponentChoices(document).flatMap(g=>g.options)} dispatch={dispatch}/></fieldset>}
    {own.length>0 && <fieldset disabled={!enabled}><legend>Overrides</legend>
      {own.map(group=><button type="button" key={group} onClick={()=>dispatch("component.resetOverride",{id:node.id,group})}>Reset {group}</button>)}
      <button type="button" onClick={()=>dispatch("component.resetOverride",{id:node.id})}>Reset overrides</button>
    </fieldset>}
  </>;
}
