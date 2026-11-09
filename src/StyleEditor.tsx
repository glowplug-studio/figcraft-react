import { useState } from "react";
import { effectLabels } from "./EffectsPanel";
import { StyleTypography } from "./StyleTypography";
import { renderColour } from "./engine/colour";
import { paintColour } from "./engine/solid-paint";
import type { SharedStyle } from "./engine/shared-styles";

export function StyleSwatch({style}:{style:SharedStyle}) {
  const paint = style.type === "paint" ? style.paints.at(-1) : undefined;
  const background = paint?.type === "solid" ? renderColour(paintColour(paint)) :
    paint?.type === "gradient" && paint.stops.length === 1 ? renderColour(paint.stops[0].color) :
    paint?.type === "gradient" && paint.stops.length ? 'linear-gradient(90deg,' +
      paint.stops.map(stop => renderColour(stop.color) + ' ' + stop.position * 100 + '%').join(',') + ')' : undefined;
  return <span className="figcraft-style-swatch" aria-hidden="true" style={{background}}>
    {background ? "" : style.type === "text" ? "T" : style.type === "effect" ? "◐" : style.type === "grid" ? "▦" : "◇"}
  </span>;
}

export type Run = (cmd:string, p:Record<string,unknown>) => Record<string,unknown> | undefined;
export function EditStyle({style, run, back, source}:{style:SharedStyle;run:Run;back:()=>void;source?:string}) {
  const [name, setName] = useState(style.name), [description,setDescription] = useState(style.description);
  function finish() {
    const renamed=name.trim();
    const patch={...(renamed && renamed !== style.name && {name:renamed}), ...(description !== style.description && {description})};
    if (!Object.keys(patch).length || run("style.update",{style:style.id,...patch})) back();
  }
  return <form onSubmit={event=>{event.preventDefault();finish();}} onKeyDown={event=>{
    if (event.key === "Escape" && !event.defaultPrevented && !event.nativeEvent.isComposing) {
      event.preventDefault();event.stopPropagation();finish();
    }
  }}>
    <label>Name<input aria-label="Style name" autoFocus required value={name} onChange={e=>setName(e.target.value)}/></label>
    <label>Description<textarea aria-label="Style description" value={description} onChange={e=>setDescription(e.target.value)}/></label>
    {style.type === "text" && <StyleTypography value={style.style} change={value=>run("style.update",{style:style.id,value})}/>}
    {style.type === "effect" && <ul aria-label="Effect properties">{style.effects.map((fx,i)=><li key={i}>{effectLabels[fx.type]}</li>).reverse()}</ul>}
    {style.type === "grid" && <ul aria-label="Grid properties">{style.grids.map((g,i)=><li key={i}>
      {g.kind === "grid" ? "Grid "+g.size : (g.kind === "columns" ? "Columns " : "Rows ")+g.count}
    </li>)}</ul>}
    <div className="figcraft-style-actions">
      <button type="submit">Save style</button><button type="button" onClick={finish}>Back</button>
      {source && <button type="button" onClick={()=>run("style.update",{style:style.id,from:source})}>Update from selection</button>}
      <button type="button" onClick={()=>{if (run("style.duplicate",{style:style.id})) back();}}>Duplicate style</button>
      <button type="button" onClick={()=>{if (run("style.delete",{style:style.id})) back();}}>Delete style</button>
    </div>
  </form>;
}
