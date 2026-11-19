import { LayerVariablePicker, type InspectorDispatch } from "./StyleVariablePicker";
import { useState } from "react";
import type { Document, LayerNode } from "./engine/document";
import { cornerKeys } from "./engine/corners";
import { cornerFields } from "./engine/corner-fields";

export function CornerPanel({ document, nodes, editable, dispatch }: { document: Document; nodes: readonly LayerNode[]; editable: boolean; dispatch: InspectorDispatch }) {
  const [individual, setIndividual] = useState(false);
  const fields = cornerFields(nodes);
  if (!fields) return null;
  const ids = nodes.map(n => n.id), { independent, smoothing } = fields;
  const field = (label: string, key: string, value: number | undefined, percent = false) => <LayerVariablePicker key={key} doc={document} ids={ids} field={percent ? undefined : key} label={label} type="number" run={dispatch}><form style={{ minWidth: 0 }} key={`${key}:${ids.join()}:${value}`} onSubmit={event => {
    event.preventDefault(); const input = event.currentTarget.elements.namedItem(key) as HTMLInputElement;
    if (!input.value) return;
    const next = Number(input.value); if (Number.isFinite(next)) dispatch("node.set", { ids, props: { [key]: percent ? next / 100 : next } });
  }}>
    <label>{label}<input style={{ minWidth: 0, width: "100%", boxSizing: "border-box" }} name={key} type="number" min="0" max={percent ? 100 : undefined} step="any" placeholder={value === undefined ? "Mixed" : undefined} defaultValue={value === undefined ? "" : Math.round(value * (percent ? 10000 : 100)) / 100} /></label>
    <button type="submit">Apply {label.toLowerCase()}</button>
  </form></LayerVariablePicker>;
  return <fieldset disabled={!editable} aria-label="Corners"><legend>Corners</legend>
    {field("Corner radius", "cornerRadius", fields.radius)}
    {smoothing && <button type="button" aria-expanded={individual} onClick={() => setIndividual(!individual)}>{independent ? "Individual corners" : "Corner smoothing"}</button>}
    {individual && smoothing && <>
      {independent && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {[0, 1, 3, 2].map(i => field(["Top left radius", "Top right radius", "Bottom right radius", "Bottom left radius"][i], cornerKeys[i], fields.radii?.[i]))}
      </div>}
      {field("Corner smoothing", "cornerSmoothing", fields.smoothingPercent === undefined ? undefined : fields.smoothingPercent / 100, true)}
      <button type="button" title="Set corner smoothing to 60%" onClick={() => dispatch("node.set", { ids, props: { cornerSmoothing: .6 } })}>iOS</button>
    </>}
  </fieldset>;
}
