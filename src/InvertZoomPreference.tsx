import { useEffect, useState } from "react";
import type { EditorEngine } from "./engine/editor";

const key = "figcraft.pref.invertZoom";
/** The saved preference: on, off, or not saved yet. Storage can be unavailable; the preference then lasts the session. */
function saved(): boolean | undefined {
  try { const value = localStorage.getItem(key); return value === null ? undefined : value === "true"; } catch { return undefined; }
}
/**
 * Preferences ▸ Invert zoom direction (native ui-egui/src/dialogs.rs, upstream 6fce958a): Ctrl or Cmd with the wheel
 * zooms the other way. The value is saved in this browser, off as well as on, and applied when the editor opens.
 */
export function InvertZoomPreference({ engine }: { engine: EditorEngine }) {
  const [on, setOn] = useState(engine.invertZoom);
  useEffect(() => {
    const stored = saved();
    if (stored !== undefined && stored !== engine.invertZoom) engine.execute("pref.invertZoom", { on: stored });
    setOn(engine.invertZoom);
  }, [engine]);
  return <label><input type="checkbox" checked={on} onChange={event => {
    const next = Boolean(engine.execute("pref.invertZoom", { on: event.currentTarget.checked }).on);
    setOn(next);
    try { localStorage.setItem(key, String(next)); } catch { /* In memory for private browsing. */ }
  }} />Invert zoom direction</label>;
}
