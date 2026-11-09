import { variantOptions, variantProperties } from "./engine/component-variants";
import { useMemo } from "react";
import type { Document, InstanceNode, NodeId } from "./engine/document";
import { isOverrideGroup } from "./engine/component-groups";
import { componentOverrides, orderedComponentPropertyNames } from "./engine/component-properties";
import { canExposeInstance, componentSlots, exposedCopies, owningInstance, propertyNodeId } from "./engine/component-tree";
import { ancestors, subtreeIds } from "./engine/hierarchy";

interface InstancePanelProps {
  document: Document;
  selection: readonly NodeId[];
  enabled: boolean;
  dispatch: (command: string, params?: unknown) => void;
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
  return <>
    {parent.kind === "componentSet" && [...variantOptions(document,parent)].map(([name,values])=>
      <label key={name}>{name}<select aria-label={`Variant ${name}`} value={current.get(name) ?? ""}
        onChange={event=>change(name,event.currentTarget.value)}>
        {!current.has(name) && <option value=""/>}
        {values.map(value=><option key={value}>{value}</option>)}
      </select></label>)}
    {names.map(name=>{
      const def = main.props[name];
      const value = Object.hasOwn(node.props,name) ? node.props[name] : def.type !== "slot" ? def.default : undefined;
      if (def.type === "boolean") return <label key={name}><input type="checkbox" checked={value === true}
        onChange={event=>change(name,event.currentTarget.checked)}/>{name}</label>;
      if (def.type === "text") {
        const text = typeof value === "string" ? value : "";
        return <label key={name}>{name}<input key={JSON.stringify([node.id,text])} defaultValue={text}
          onKeyDown={event=>{if (event.key === "Enter") event.currentTarget.blur();}}
          onBlur={event=>{if (event.currentTarget.value !== text) change(name,event.currentTarget.value);}}/></label>;
      }
      if (def.type !== "slot" && def.type !== "instanceSwap") return null;
      const slot = slots.find(entry=>entry.name === name);
      const frame = slot && document.nodes[slot.id];
      if (def.type === "slot" && frame?.kind !== "frame") return null;
      const edited = frame?.overrides?.includes("slot");
      const selected = def.type === "instanceSwap" ? propertyNodeId(value) ?? "" : "";
      const preferred = def.preferred.filter(id=>document.nodes[id]);
      const parents = slot ? new Set(ancestors(document,slot.id)) : undefined;
      const choices = parents ? components.filter(id=>!parents.has(id)) : components;
      return <div key={name}><label>{name}<select aria-label={name} value={selected}
        onChange={event=>{const component = event.currentTarget.value;
          if (slot) dispatch("instance.slotInsert",{id:slot.id,component});
          else change(name,component);
        }}>
        {frame?.kind === "frame" ? <option value="">{edited ? frame.children.length+" layers" : frame.children.length ? "Default content" : "Empty"}</option>
          : !choices.includes(selected) && !preferred.includes(selected) && <option value={selected}>{document.nodes[selected]?.name ?? "None"}</option>}
        {preferred.length>0 && <optgroup label="Preferred">{options(preferred)}</optgroup>}
        <optgroup label="All components">{options(choices)}</optgroup>
      </select></label>
      {slot && edited && <button type="button" onClick={()=>dispatch("instance.resetSlot",{id:slot.id})}>Reset {name}</button>}</div>;
    })}
  </>;
}

function InstanceActions({document,id,enabled,dispatch}: Omit<InstancePanelProps,"selection"> & {id:NodeId}) {
  const choices = useMemo(() => document.pages.map(page => ({
    page,
    options:subtreeIds(document,page).filter(id => {
      const layer = document.nodes[id];
      return (layer.kind === "componentSet" || layer.kind === "component" && document.nodes[layer.parent].kind !== "componentSet") &&
        !owningInstance(document,id,false);
    }),
  })).filter(group=>group.options.length), [document.nodes,document.pages]);
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
  return <>
    {node.kind === "instance" && <InstanceActions document={document} id={node.id} enabled={enabled} dispatch={dispatch}/>}
    {own.length>0 && <fieldset disabled={!enabled}><legend>Overrides</legend>
      {own.map(group=><button type="button" key={group} onClick={()=>dispatch("component.resetOverride",{id:node.id,group})}>Reset {group}</button>)}
      <button type="button" onClick={()=>dispatch("component.resetOverride",{id:node.id})}>Reset overrides</button>
    </fieldset>}
  </>;
}
