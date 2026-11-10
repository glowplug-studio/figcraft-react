import { useEffect, useRef } from "react";
import type { ImportReport } from "./engine/interchange/import-report";

export function ImportReportPanel({ report, close }: { report: ImportReport; close: () => void }) {
  const panel = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = panel.current;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented || document.querySelector("dialog:modal")) return;
      // Leave native popovers and menus their own Escape.
      if (document.querySelector(":popover-open") || event.target instanceof Element && event.target.closest("details[open]")) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    element?.ownerDocument.addEventListener("keydown", dismiss, true);
    return () => element?.ownerDocument.removeEventListener("keydown", dismiss, true);
  }, [close]);
  return <dialog open ref={panel} aria-label="Import report" className="figcraft-import-report">
    <h2>Import report</h2>
    <strong>{report.name}</strong>
    <p>{report.action}</p>
    {report.counts.length > 0 && <p>{report.counts.join(" · ")}</p>}
    {report.notes.length ? <>
      <h3>Compatibility notes</h3>
      <p>These notes describe changes made to the imported copy.</p>
      <ul>{report.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
    </> : <p>No compatibility warnings reported</p>}
    {report.omitted > 0 && <p>{report.omitted} more {report.omitted === 1 ? "note" : "notes"} omitted from this report</p>}
    <button type="button" onClick={close}>Close</button>
  </dialog>;
}
