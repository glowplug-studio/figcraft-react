import type { LayerNode } from "./engine/document";
import { pixelRound } from "./engine/geometry";

export function PointsPanel({ nodes, editable, dispatch }: { nodes: readonly LayerNode[]; editable: boolean; dispatch: (command: string, params?: unknown) => void }) {
  const shapes = nodes.filter(n => n.kind === "polygon" || n.kind === "star");
  if (!nodes.length || shapes.length !== nodes.length) return null;
  const stars = shapes.filter(n => n.kind === "star"), allStars = stars.length === shapes.length;
  const common = (values: readonly number[]) => values.every(v => v === values[0]) ? values[0] : undefined;
  const count = common(shapes.map(n => n.count)), ratio = common(stars.map(n => pixelRound(n.innerRatio * 1000) / 10));
  const ids = nodes.map(n => n.id), title = allStars ? "Star" : "Polygon";
  return <fieldset disabled={!editable} aria-label={title}><legend>{title}</legend>
    <form key={`count:${ids.join()}:${count}`} onSubmit={event => {
      event.preventDefault(); const input = event.currentTarget.elements.namedItem("pointCount") as HTMLInputElement;
      if (input.value && Number.isFinite(Number(input.value))) dispatch("node.set", { ids, props: { pointCount: Math.max(3, Math.min(120, pixelRound(Number(input.value)))) } });
    }}><label>Point count<input name="pointCount" type="number" step="any" min="3" max="120" defaultValue={count ?? ""} placeholder={count === undefined ? "Mixed" : undefined} /></label><button type="submit">Apply point count</button></form>
    {allStars && <form key={`ratio:${ids.join()}:${ratio}`} onSubmit={event => {
      event.preventDefault(); const input = event.currentTarget.elements.namedItem("ratio") as HTMLInputElement;
      if (input.value && Number.isFinite(Number(input.value))) dispatch("node.set", { ids, props: { innerRadius: Math.max(.001, Math.min(1, Number(input.value) / 100)) } });
    }}><label>Star ratio<input name="ratio" type="number" step="any" min="0.1" max="100" defaultValue={ratio ?? ""} placeholder={ratio === undefined ? "Mixed" : undefined} /></label><span>%</span><button type="submit">Apply star ratio</button></form>}
  </fieldset>;
}
