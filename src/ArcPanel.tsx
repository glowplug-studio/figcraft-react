import type { LayerNode } from "./engine/document";
import { modulo, TAU } from "./engine/ellipse";
import { pixelRound } from "./engine/geometry";

export function ArcPanel({ nodes, editable, dispatch }: { nodes: readonly LayerNode[]; editable: boolean; dispatch: (command: string, params?: unknown) => void }) {
  const ellipses = nodes.filter(n => n.kind === "ellipse");
  if (!nodes.length || ellipses.length !== nodes.length) return null;
  const fields = [
    { label: "Arc start", key: "arcStart", values: ellipses.map(n => modulo(n.start * 180 / Math.PI, 360)), factor: 1, min: undefined, max: undefined, suffix: "degrees" },
    { label: "Arc sweep", key: "arcSweep", values: ellipses.map(n => n.sweep / TAU * 100), factor: 3.6, min: -100, max: 100, suffix: "%" },
    { label: "Arc ratio", key: "arcInner", values: ellipses.map(n => n.inner * 100), factor: .01, min: 0, max: 99, suffix: "%" },
  ];
  return <fieldset disabled={!editable} aria-label="Arc"><legend>Arc</legend>{fields.map(field => {
    const values = field.values.map(v => pixelRound(v * 100) / 100), common = values.every(v => Math.abs(v - values[0]) < 1e-9) ? values[0] : undefined;
    return <form key={`${field.key}:${nodes.map(n => n.id).join()}:${common}`} onSubmit={event => {
      event.preventDefault(); const input = event.currentTarget.elements.namedItem(field.key) as HTMLInputElement;
      if (input.value && Number.isFinite(Number(input.value))) dispatch("node.set", { ids: nodes.map(n => n.id), props: { [field.key]: Number(input.value) * field.factor } });
    }}><label>{field.label}<input name={field.key} type="number" step="any" min={field.min} max={field.max} defaultValue={common ?? ""} placeholder={common === undefined ? "Mixed" : undefined} /></label><span>{field.suffix}</span><button type="submit">Apply {field.label.toLowerCase()}</button></form>;
  })}</fieldset>;
}
