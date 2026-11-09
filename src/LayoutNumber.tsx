import { useRef } from "react";

export function LayoutNumber({label,value,commit,placeholder,min}: {
  label: string; value?: number; commit: (value: number, all: boolean) => void; placeholder?: string; min?: number;
}) {
  const all = useRef(false);
  return <label>{label}<input type="number" step="any" min={min} defaultValue={value ?? ""} placeholder={placeholder}
    onPointerDown={e => { all.current = e.metaKey || e.ctrlKey; }}
    onKeyDown={e => {
      if (e.key === "Escape") e.currentTarget.value = value?.toString() ?? "";
      if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); e.currentTarget.blur(); }
    }}
    onBlur={e => {
      const n = e.currentTarget.valueAsNumber;
      if (!Number.isFinite(n)) e.currentTarget.value = value?.toString() ?? "";
      else {
        const next = min === undefined ? n : Math.max(min,n);
        e.currentTarget.value = String(next);
        if (next !== value || all.current) commit(next,all.current);
      }
      all.current = false;
    }}/></label>;
}
