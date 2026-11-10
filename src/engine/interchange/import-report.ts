import { clippedText } from "../file-versions";
import { importNoteKeys } from "./import-note-keys";

interface ImportResult {
  warnings?: unknown;
  pages?: unknown;
  summary?: unknown;
}

export interface ImportReport {
  name: string;
  action: "Opened as a new document" | "Pages added to the document" | "Placed on the current page";
  counts: string[];
  notes: string[];
  omitted: number;
}

export function importNotice(name: string, notes: readonly string[], opened = false) {
  if (!notes.length) return "";
  const stem = clippedText(name.replace(/\.[^.]*$/, ""), 512);
  const first = clippedText(notes[0], 2000);
  if (notes.length === 1) return stem + ": " + first;
  return stem + ": " + notes.length + (opened ? " problems were repaired or left out while opening it, e.g. " : " import warnings; first: ") + first;
}

function shownNote(note: string) {
  const suffix = / \(×[0-9]+\)$/.exec(note);
  const base = suffix ? note.slice(0, suffix.index) : note;
  return importNoteKeys.has(base) ? note.charAt(0).toUpperCase() + note.slice(1) : note;
}

export function readImportReport(command: string, name: string, result?: ImportResult | null): ImportReport | undefined {
  if (!result || !Array.isArray(result.warnings)) return;
  const opened = command === "file.open" || command === "file.openRecent";
  const paste = command === "edit.pasteDesignLayers";
  if (!opened && !paste && command !== "file.import") return;
  const appended = command === "file.import" && Object.hasOwn(result, "pages");
  if (!result.warnings.length && !appended && (!opened || /\.svg$/i.test(name))) return;

  const summary = result.summary && typeof result.summary === "object" ? result.summary as Record<string, unknown> : {};
  const title = typeof summary.name === "string" ? summary.name : name || (paste ? "Pasted design layers" : "Imported document");
  const counts: string[] = [], notes: string[] = [];
  for (const label of ["Pages", "Layers", "Images"]) {
    const value = summary[label.toLowerCase()];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) counts.push(label + ": " + value);
  }
  let omitted = 0;
  for (const warning of result.warnings) {
    if (typeof warning !== "string") continue;
    if (notes.length === 500) { omitted++; continue; }
    const clipped = clippedText(warning, 2000);
    notes.push(shownNote(clipped.length < warning.length ? clipped + "…" : clipped));
  }
  return {
    name: clippedText(title, 512),
    action: opened ? "Opened as a new document" : appended ? "Pages added to the document" : "Placed on the current page",
    counts, notes, omitted,
  };
}
