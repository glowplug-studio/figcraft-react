import { useSyncExternalStore } from "react";
import type { EditorEngine } from "./engine/editor";
import { selectedVectorPoints, vectorNetwork, vectorSelectionPosition } from "./engine/vector-edit";
import { networkMirroring } from "./engine/vector-network";
import { strokeCaps } from "./engine/stroke";
import { vectorPointBox } from "./engine/vector-point-transform";

interface Props { engine: EditorEngine; editable: boolean; dispatch: (command: string, params?: unknown) => void }
const common = <T,>(values: readonly T[]): T | undefined => values.every(v => v === values[0]) ? values[0] : undefined;
const capLabels = ["None", "Round", "Square", "Line arrow", "Triangle arrow", "Reversed triangle", "Circle", "Diamond"];

export function VectorToolbar({ engine, editable, dispatch }: Props) {
  const state = useSyncExternalStore(engine.subscribeVectorEdit, engine.getVectorEdit, engine.getVectorEdit);
  if (!state) return null;
  return <div className="figcraft-toolbar" role="toolbar" aria-label="Vector tools">
    <button disabled={!editable} aria-pressed={state.tool === "move"} onClick={() => dispatch("vector.edit.tool", { tool: "move" })}>Move points</button>
    <button disabled={!editable} aria-pressed={state.tool === "pen"} title="Pen · P" onClick={() => dispatch("vector.edit.tool", { tool: "pen" })}>Pen</button>
    <button disabled={!editable} aria-pressed={state.tool === "bend"} title="Bend · hold Ctrl/⌘ with Move" onClick={() => dispatch("vector.edit.tool", { tool: "bend" })}>Bend</button>
    <button disabled={!editable} onClick={() => dispatch("vector.edit.end")}>Done editing</button>
  </div>;
}

/** Subscribes to committed point selection, never drag frames. */
export function VectorPanel({ engine, editable, dispatch }: Props) {
  const state = useSyncExternalStore(engine.subscribeVectorEdit, engine.getVectorEdit, engine.getVectorEdit);
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  if (!state) return null;
  const net = vectorNetwork(snapshot.document, state.id); if (!net) return null;
  const indices = selectedVectorPoints(net, state), vertices = indices.flatMap(i => net.vertices[i] ? [net.vertices[i]] : []);
  const position = vectorSelectionPosition(snapshot.document, state), radius = common(vertices.map(v => v.radius));
  const mirroring = common(indices.map(i => networkMirroring(net, i)));
  const cap = common(vertices.map(v => v.cap ?? "layer")), join = common(vertices.map(v => v.join ?? "layer"));
  const box = vertices.length > 1 ? vectorPointBox(snapshot.document, state) : undefined;
  return <fieldset disabled={!editable} aria-label="Vector points"><legend>{vertices.length > 1 ? "Points" : "Point"}</legend>
    {!vertices.length ? <p>Select points to edit their position, radius and mirroring.</p> : <>
      <p>{vertices.length} selected {vertices.length === 1 ? "point" : "points"}</p>
      <form key={`${state.id}:${position?.x}:${position?.y}`} onSubmit={event => {
        event.preventDefault(); const data = new FormData(event.currentTarget);
        dispatch("vector.edit.position", { x: Number(data.get("x")), y: Number(data.get("y")) });
      }}>
        <label>Point X<input name="x" type="number" step="any" required defaultValue={position?.x} /></label>
        <label>Point Y<input name="y" type="number" step="any" required defaultValue={position?.y} /></label>
        <button type="submit">Apply point position</button>
      </form>
      {box && <form key={`${state.id}:${box.width}:${box.height}`} onSubmit={event => {
        event.preventDefault(); const data = new FormData(event.currentTarget);
        const width = Number(data.get("width")), height = Number(data.get("height"));
        dispatch("vector.edit.resize", { ...(width !== box.width ? { width } : {}), ...(height !== box.height ? { height } : {}) });
      }}>
        <label>Point width<input name="width" type="number" step="any" min="0" required defaultValue={box.width} /></label>
        <label>Point height<input name="height" type="number" step="any" min="0" required defaultValue={box.height} /></label>
        <button type="submit">Apply point dimensions</button>
      </form>}
      <form key={`${state.id}:${indices.join()}:${radius}`} onSubmit={event => {
        event.preventDefault(); const data = new FormData(event.currentTarget); dispatch("vector.edit.cornerRadius", { radius: Number(data.get("radius")) });
      }}><label>Point corner radius<input name="radius" type="number" step="any" min="0" max="1000000" required defaultValue={radius ?? ""} placeholder={radius === undefined ? "Mixed" : undefined} /></label><button type="submit">Apply point radius</button></form>
      <label>Handle mirroring<select aria-label="Handle mirroring" value={mirroring ?? "mixed"} onChange={event => dispatch("vector.edit.mirroring", { mode: event.currentTarget.value })}>
        {mirroring === undefined && <option value="mixed" disabled>Mixed</option>}
        <option value="none">No mirroring</option><option value="angle">Mirror angle</option><option value="angleAndLength">Mirror angle and length</option>
      </select></label>
      <label>Point end cap<select aria-label="Point end cap" value={cap ?? "mixed"} onChange={event => dispatch("vector.edit.strokeCap", { cap: event.currentTarget.value === "layer" ? null : event.currentTarget.value })}>
        {cap === undefined && <option value="mixed" disabled>Mixed</option>}<option value="layer">Same as layer</option>
        {strokeCaps.map((c, i) => <option key={c} value={c}>{capLabels[i]}</option>)}
      </select></label>
      <label>Point stroke join<select aria-label="Point stroke join" value={join ?? "mixed"} onChange={event => dispatch("vector.edit.strokeJoin", { join: event.currentTarget.value === "layer" ? null : event.currentTarget.value })}>
        {join === undefined && <option value="mixed" disabled>Mixed</option>}<option value="layer">Same as layer</option>
        <option value="miter">Miter</option><option value="bevel">Bevel</option><option value="round">Round</option>
      </select></label>
      <button type="button" onClick={() => dispatch("vector.edit.smooth", { smooth: true })}>Smooth points</button>
      <button type="button" onClick={() => dispatch("vector.edit.smooth", { smooth: false })}>Sharpen points</button>
    </>}
    <button type="button" onClick={() => dispatch("vector.edit.selectAll")}>Select all points</button>
    <button type="button" disabled={!vertices.length && !state.segments.length} onClick={() => dispatch("vector.edit.delete")}>Delete points</button>
    <button type="button" disabled={!state.vertices.length} onClick={() => dispatch("vector.deleteHeal")}>Delete and heal</button>
  </fieldset>;
}
