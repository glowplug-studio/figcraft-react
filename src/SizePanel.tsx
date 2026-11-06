import { anchors } from "./engine/sizing";

const names = ["Top left", "Top", "Top right", "Left", "Centre", "Right", "Bottom left", "Bottom", "Bottom right"];

export function SizePanel({ enabled, dispatch }: { enabled: boolean; dispatch: (command: string, params?: unknown) => void }) {
  return <details className="figcraft-sizing"><summary>Resize and scale</summary>
    <form onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      dispatch("transform.resize", { anchor: data.get("anchor"), ...(data.get("width") !== "" ? { width: data.get("width") } : {}), ...(data.get("height") !== "" ? { height: data.get("height") } : {}) });
    }}><fieldset disabled={!enabled}><legend>Resize around anchor</legend>
      <label>Resize width<input name="width" type="number" step="any" placeholder="Unchanged" /></label>
      <label>Resize height<input name="height" type="number" step="any" placeholder="Unchanged" /></label>
      <label>Resize anchor<select name="anchor" aria-label="Resize anchor">{anchors.map((anchor, index) => <option key={anchor} value={anchor}>{names[index]}</option>)}</select></label>
      <button type="submit">Resize selection</button>
    </fieldset></form>
    <form onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      dispatch("transform.scale", { factor: data.get("factor"), ...(data.get("cx") !== "" ? { cx: data.get("cx") } : {}), ...(data.get("cy") !== "" ? { cy: data.get("cy") } : {}) });
    }}><fieldset disabled={!enabled}><legend>Uniform scale</legend>
      <label>Scale factor<input name="factor" type="number" step="any" defaultValue="2" required /></label>
      <label>Scale pivot X<input name="cx" type="number" step="any" placeholder="Selection left" /></label>
      <label>Scale pivot Y<input name="cy" type="number" step="any" placeholder="Selection top" /></label>
      <button type="submit">Scale selection</button>
    </fieldset></form>
  </details>;
}
