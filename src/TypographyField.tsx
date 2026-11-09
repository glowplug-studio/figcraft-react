import { useState } from "react";
import type { TextStyle } from "./engine/text-style";

export const textMeasure = (v: TextStyle["lineHeight"]) => v.unit === "auto" ? "Auto" : String(v.value) + (v.unit === "percent" ? "%" : "");

export function TypographyField({label, value, apply, empty}: {label:string; value?:string; empty?:string; apply:(value:string) => void}) {
  const [draft, setDraft] = useState<string>();
  function commit() {
    if (draft !== undefined && draft !== value) {
      const next=draft.trim() || empty;
      if (next!==undefined) apply(next);
    }
    setDraft(undefined);
  }
  return <label>{label}<input aria-label={label} value={draft ?? value ?? ""} placeholder={value === undefined ? "Mixed" : undefined}
    onChange={event => setDraft(event.target.value)} onBlur={commit}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Enter") { event.preventDefault(); commit(); }
      if (event.key === "Escape") { event.preventDefault(); setDraft(undefined); }
    }} /></label>;
}
