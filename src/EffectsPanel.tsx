import { LayerVariablePicker, type InspectorDispatch } from "./StyleVariablePicker";
import { useRef } from "react";
import { EffectSettings } from "./EffectSettings";
import { usePaintActions } from "./PaintActions";
import { effectTypes, wireEffect, type Effect } from "./engine/effects";
import type { EditorEngine } from "./engine/editor";

export const effectLabels: Record<Effect["type"], string> = {
  dropShadow:"Drop shadow", innerShadow:"Inner shadow", layerBlur:"Layer blur",
  backgroundBlur:"Background blur", noise:"Noise", texture:"Texture", glass:"Glass",
};

export function EffectsPanel({engine, editable, dispatch}: {engine: EditorEngine; editable: boolean;
  dispatch: InspectorDispatch}) {
  const {document, selection: ids, openEffects} = engine.getSnapshot();
  const first = document.nodes[ids[0]], stack = first?.effects ?? [];
  const mixed = ids.length > 1 && ids.slice(1).some(id => {
    const other = document.nodes[id].effects ?? [];
    return stack !== other && (stack.length !== other.length || JSON.stringify(stack) !== JSON.stringify(other));
  });
  const drag = useRef<{index: number; selection: readonly string[]} | undefined>(undefined);
  const {openMenu, popup} = usePaintActions("effect", editable, engine.hasCopiedEffect(), ids, dispatch);
  if (!first || first.kind === "page") return null;
  const move = (from: number, to: number) => dispatch("effect.move", {ids, from, to});
  return <section aria-label="Effects"><fieldset className="figcraft-effects" disabled={!editable}>
    <legend onContextMenu={openMenu} onKeyDown={openMenu}>Effects</legend>
    <button type="button" onClick={()=>dispatch("effect.add",{ids,type:"dropShadow"})}
      onContextMenu={openMenu} onKeyDown={openMenu}>Add effect</button>
    {!mixed && stack.length > 0 && <ol aria-label="Effect stack">{[...stack].reverse().map((e, row) => {
      const index = stack.length - 1 - row;
      const change = (effect: Effect) => dispatch("effect.set", {ids, index, effect:wireEffect(effect)});
      const open = !!openEffects?.includes(index);
      return <li key={index} aria-label={'Effect ' + (row + 1)}
        onContextMenu={event => openMenu(event,index)} onKeyDown={event => openMenu(event,index)}
        onDragOver={event => { if (editable && drag.current?.selection === ids) event.preventDefault(); }}
        onDrop={event => {
          event.preventDefault();
          const source = drag.current; drag.current = undefined;
          if (editable && source?.selection === ids) move(source.index,index);
        }}>
        <div draggable={editable} onDragStart={event => {
          drag.current = {index, selection:ids}; event.dataTransfer.setData("text/plain", effectLabels[e.type]); event.dataTransfer.effectAllowed = "move";
        }} onDragEnd={()=>{drag.current = undefined;}}>
          <button type="button" aria-label={'Effect ' + (row + 1) + ' settings'} aria-expanded={open}
            onClick={()=>engine.toggleEffectSettings(index)}>Settings</button>
          <label>Effect type<select value={e.type} onChange={event=>dispatch("effect.set", {ids,index,effect:{type:event.target.value}})}>
            {effectTypes.map(type=><option key={type} value={type}>{effectLabels[type]}</option>)}</select></label>
          <label><input type="checkbox" checked={e.visible} onChange={event=>change({...e,visible:event.target.checked})}/>Visible</label>
          <button type="button" aria-label={'Remove effect ' + (row + 1)} onClick={()=>dispatch("effect.remove",{ids,index})}>Remove</button>
          <button type="button" disabled={!row} onClick={()=>move(index,index+1)}>Move up</button>
          <button type="button" disabled={!index} onClick={()=>move(index,index-1)}>Move down</button>
        </div>
        {open && <EffectSettings key={ids.join(",") + "/" + e.type} effect={e} change={change} bind={(field,label,control)=>
          <LayerVariablePicker doc={document} ids={ids} field={`effects/${index}/${field}`} label={label} type={field==="color" ? "color" : "number"} run={dispatch}>{control}</LayerVariablePicker>} begin={()=>engine.beginEffectPreview(index)}/>}
      </li>;
    })}</ol>}
    {popup}
  </fieldset></section>;
}
