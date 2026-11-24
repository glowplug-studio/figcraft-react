import type { MouseEvent } from "react";
import type { EditorEngine } from "./engine/editor";
import type { PropertyKind } from "./engine/property-rows";

/** Native property_rows.rs: a click on a fill, stroke or effect row's background (beside and between its controls, or on its reorder
 * grip) highlights it in the selected-row colour, one row at a time; the row is no extra tab stop. */
export function propertyRowProps(engine: EditorEngine, kind: PropertyKind, index: number) {
  const row = engine.propertyRow(), highlighted = row?.kind === kind && row.index === index;
  return {
    "data-property-row": kind + ":" + index,
    "aria-current": highlighted ? true : undefined,
    style: highlighted ? { background: "rgba(42,125,230,.18)" } : undefined,
    onClick: (event: MouseEvent<HTMLElement>) => {
      const target = event.target as HTMLElement;
      if (target === event.currentTarget || target.dataset.propertyGrip !== undefined) engine.highlightPropertyRow(kind, index);
    },
  } as const;
}

/** A press anywhere in the Design panel but the highlighted row, or on the canvas, lets the highlight go. */
export function releasePropertyRow(engine: EditorEngine, target: EventTarget | null) {
  const row = engine.propertyRow();
  if (!row) return;
  if (target instanceof Element && target.closest(`[data-property-row="${row.kind}:${row.index}"]`)) return;
  engine.clearPropertyRow();
}
