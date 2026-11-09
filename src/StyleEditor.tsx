import { useState } from "react";
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
  return <form onSubmit={event => {
    event.preventDefault();
    if (run("style.update", {style:style.id,name,description})) back();
  }}>
    <label>Name<input aria-label="Style name" autoFocus required value={name} onChange={e=>setName(e.target.value)}/></label>
    <label>Description<textarea aria-label="Style description" value={description} onChange={e=>setDescription(e.target.value)}/></label>
    <div className="figcraft-style-actions">
      <button type="submit">Save style</button><button type="button" onClick={back}>Back</button>
      {source && <button type="button" onClick={()=>run("style.update",{style:style.id,from:source})}>Update from selection</button>}
      <button type="button" onClick={()=>{if (run("style.duplicate",{style:style.id})) back();}}>Duplicate style</button>
      <button type="button" onClick={()=>{if (run("style.delete",{style:style.id})) back();}}>Delete style</button>
    </div>
  </form>;
}
