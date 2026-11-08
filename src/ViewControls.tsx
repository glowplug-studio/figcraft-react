import { useSyncExternalStore } from "react";
import type { EditorEngine } from "./engine/editor";

/** Only this small control observes transient viewport changes. */
export function ViewControls({ engine, editable, dispatch }: { engine: EditorEngine; editable: boolean; dispatch: (command: string) => void }) {
  const view = useSyncExternalStore(engine.subscribeView, engine.getView, engine.getView);
  return <div role="group" aria-label="Canvas view" className="figcraft-view-controls">
    <button type="button" aria-label="Zoom out" disabled={!editable} onClick={() => dispatch("view.zoomOut")}>−</button>
    <output aria-label="Zoom level">{Math.round(view.zoom * 100)}%</output>
    <button type="button" aria-label="Zoom in" disabled={!editable} onClick={() => dispatch("view.zoomIn")}>+</button>
    <button type="button" aria-label="Zoom to 100%" disabled={!editable} onClick={() => dispatch("view.zoom100")}>100%</button>
    <button type="button" disabled={!editable} onClick={() => dispatch("view.zoomFit")}>Fit page</button>
    <button type="button" disabled={!editable} onClick={() => dispatch("view.zoomSelection")}>Fit selection</button>
    <button type="button" disabled={!editable} aria-pressed={view.snapObjects !== false} onClick={() => dispatch("view.snapObjects")}>Snap to objects</button>
    <button type="button" disabled={!editable} aria-pressed={view.snapPixel !== false} onClick={() => dispatch("view.snapPixel")}>Snap to pixel grid</button>
  </div>;
}

export function ViewMenu({ engine, editable, dispatch }: Parameters<typeof ViewControls>[0]) {
  const checked = () => engine.getView().proofSrgb === true;
  const proof = useSyncExternalStore(engine.subscribeView, checked, checked);
  return <details><summary>View</summary>
    <button type="button" disabled={!editable} aria-pressed={proof} onClick={event => {
      event.currentTarget.closest("details")?.removeAttribute("open");
      dispatch("view.proofSrgb");
    }}>Soft-proof sRGB</button>
  </details>;
}
