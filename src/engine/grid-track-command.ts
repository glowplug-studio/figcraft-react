import { arrangementTargets } from "./arrange";
import { commandSizing } from "./layout-properties";
import type { Document, NodeId } from "./document";
import { gridGeometry } from "./grid-layout";
import { HierarchyDraft } from "./hierarchy";
import { parseNumber } from "./parameters";
import { validateChangedGeometry } from "./rotation";

export function setGridTrack(document: Document, selection: readonly NodeId[], p: Record<string, unknown>) {
  const ids = arrangementTargets(document, selection, p, false);
  const axis = typeof p.axis === "string" ? p.axis.toLowerCase() : "";
  const columns = ["columns", "column", "col", "x"].includes(axis);
  if (!columns && !["rows", "row", "y"].includes(axis)) throw new Error("axis must be columns or rows");
  const index = parseNumber(p.index, "index"), sizing = commandSizing(p.sizing);
  let value: number | undefined;
  try { value = parseNumber(p.value); } catch { /* Native optional numeric argument defaults when unreadable. */ }
  const draft = new HierarchyDraft(document);
  for (const id of ids) {
    const frame = draft.nodes[id];
    if (frame.kind !== "frame" || frame.layout?.mode !== "grid") throw new Error(`Node ${id} is not a grid auto layout frame`);
    const geometry = gridGeometry(draft.document, frame);
    const ranges = columns ? geometry.columns : geometry.rows;
    if (!Number.isInteger(index) || index < 0 || index >= ranges.length) throw new Error(`index must be an integer in 0..${ranges.length}`);
    const [start, end] = ranges[index];
    const size = sizing === "fixed" ? Math.min(1e6, Math.max(0, value ?? end-start)) :
      sizing === "fill" ? Math.min(1e4, Math.max(0, value ?? 1)) : 0;
    const prop = columns ? "columnTracks" : "rowTracks";
    const original = frame.layout[prop];
    if (original[index]?.sizing === sizing && original[index].value === size) continue;
    const tracks = [...original];
    while (tracks.length < index) tracks.push(Object.freeze({sizing: "fill", value: 1}));
    tracks[index] = Object.freeze({sizing, value: size});
    draft.set({...frame, layout: Object.freeze({...frame.layout, [prop]: Object.freeze(tracks)})});
  }
  return validateChangedGeometry(draft);
}
