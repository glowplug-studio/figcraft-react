import { useState } from "react";
import type { LayerNode } from "./engine/document";
import { cornerKeys, zeroCorners } from "./engine/corners";

export function CornerPanel({ nodes, editable, dispatch }: { nodes: readonly LayerNode[]; editable: boolean; dispatch: (command: string, params?: unknown) => void }) {
  const [individual, setIndividual] = useState(false);
  if (!nodes.length || nodes.some(n => n.kind === "group" || n.kind === "ellipse" || n.kind === "line")) return null;
  const corners = nodes.map(n => n.corners ?? zeroCorners), ids = nodes.map(n => n.id);
  const common = (values: readonly number[]): number | undefined => values.every(n => n === values[0]) ? values[0] : undefined;
  const uniform = common(corners.flatMap(c => [...c.radii]));
  const independent = nodes.every(n => n.kind === "rectangle" || n.kind === "frame");
  const smoothing = nodes.every(n => n.kind !== "vector" || n.network.regions.length > 0);
  const field = (label: string, key: string, value: number | undefined, percent = false) => <form style={{ minWidth: 0 }} key={`${key}:${ids.join()}:${value}`} onSubmit={event => {
    event.preventDefault(); const input = event.currentTarget.elements.namedItem(key) as HTMLInputElement;
    if (!input.value) return;
    const next = Number(input.value); if (Number.isFinite(next)) dispatch("node.set", { ids, props: { [key]: percent ? next / 100 : next } });
  }}>
    <label>{label}<input style={{ minWidth: 0, width: "100%", boxSizing: "border-box" }} name={key} type="number" min="0" max={percent ? 100 : undefined} step="any" placeholder={value === undefined ? "Mixed" : undefined} defaultValue={value === undefined ? "" : Math.round(value * (percent ? 10000 : 100)) / 100} /></label>
    <button type="submit">Apply {label.toLowerCase()}</button>
  </form>;
  return <fieldset disabled={!editable} aria-label="Corners"><legend>Corners</legend>
    {field("Corner radius", "cornerRadius", uniform)}
    {smoothing && <button type="button" aria-expanded={individual} onClick={() => setIndividual(!individual)}>{independent ? "Individual corners" : "Corner smoothing"}</button>}
    {individual && smoothing && <>
      {independent && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {[0, 1, 3, 2].map(i => field(["Top left radius", "Top right radius", "Bottom right radius", "Bottom left radius"][i], cornerKeys[i], common(corners.map(c => c.radii[i]))))}
      </div>}
      {field("Corner smoothing", "cornerSmoothing", common(corners.map(c => c.smoothing)), true)}
      <button type="button" title="Set corner smoothing to 60%" onClick={() => dispatch("node.set", { ids, props: { cornerSmoothing: .6 } })}>iOS</button>
    </>}
  </fieldset>;
}
