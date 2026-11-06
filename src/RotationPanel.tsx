import { useSyncExternalStore } from "react";
import type { EditorEngine } from "./engine/editor";
import { rotationSpecs } from "./engine/rotation";

/** Only this small panel observes frame-frequency origin changes. */
export function RotationPanel({ engine, enabled, dispatch }: { engine: EditorEngine; enabled: boolean; dispatch: (command: string, params?: unknown) => void }) {
  const origin = useSyncExternalStore(engine.subscribeOrigin, engine.getRotationOrigin, engine.getRotationOrigin);
  return <details className="figcraft-rotation"><summary>Rotation and flips</summary>
    <fieldset disabled={!enabled}><legend>Rotation origin</legend>
      <button type="button" aria-pressed={origin.editing} onClick={() => dispatch("transform.rotationOrigin")}>Move rotation origin</button>
      <output aria-label="Current rotation origin">{origin.point ? `${origin.point.x}, ${origin.point.y}${origin.moved ? " (moved)" : " (centre)"}` : "Nothing selected"}</output>
      <form onSubmit={event => {
        event.preventDefault(); const data = new FormData(event.currentTarget);
        dispatch("transform.setRotationOrigin", { x: data.get("x"), y: data.get("y") });
      }}><label>Origin X<input name="x" type="number" step="any" required /></label>
        <label>Origin Y<input name="y" type="number" step="any" required /></label>
        <button type="submit">Set rotation origin</button>
      </form>
      <button type="button" onClick={() => dispatch("transform.setRotationOrigin", { reset: true })}>Reset rotation origin</button>
    </fieldset>
    <form onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      dispatch("transform.rotate", { degrees: data.get("degrees"), ...(data.get("cx") !== "" ? { cx: data.get("cx") } : {}), ...(data.get("cy") !== "" ? { cy: data.get("cy") } : {}) });
    }}><fieldset disabled={!enabled}><legend>Rotate selection</legend>
      <label>Turn by degrees<input name="degrees" type="number" step="any" defaultValue="15" required /></label>
      <label>Rotation pivot X<input name="cx" type="number" step="any" placeholder="Rotation origin" /></label>
      <label>Rotation pivot Y<input name="cy" type="number" step="any" placeholder="Rotation origin" /></label>
      <button type="submit">Rotate selection</button>
      {Object.entries(rotationSpecs).filter(([id]) => id !== "transform.rotate").map(([id, spec]) => <button key={id} type="button" onClick={() => dispatch(id)}>{spec.label}</button>)}
    </fieldset></form>
  </details>;
}
