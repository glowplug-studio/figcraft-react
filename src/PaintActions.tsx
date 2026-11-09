import { useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { NodeId } from "./engine/document";

/** The property row replaces its paint on paste. The legend and add button append. */
export function usePaintActions(list: "fill" | "stroke", editable: boolean, hasCopied: boolean, ids: readonly NodeId[],
  dispatch: (command: string, params?: unknown) => void) {
  const [menu, setMenu] = useState<{ x: number; y: number; index?: number }>();
  const popup = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = popup.current;
    if (!element || !menu) return;
    element.showPopover();
    const bounds = element.getBoundingClientRect();
    element.style.left = Math.max(0, Math.min(menu.x, window.innerWidth - bounds.width)) + "px";
    element.style.top = Math.max(0, Math.min(menu.y, window.innerHeight - bounds.height)) + "px";
    element.querySelector("button")?.focus();
  }, [menu]);
  function openMenu(event: MouseEvent | KeyboardEvent, index?: number) {
    if (!editable || ("key" in event && event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))) return;
    if (index === undefined && !hasCopied) return;
    event.preventDefault(); event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ index, x: "clientX" in event ? event.clientX : rect.left, y: "clientY" in event ? event.clientY : rect.bottom });
  }
  function menuAction(command: string) {
    popup.current?.hidePopover();
    dispatch(list+"."+command, { ids, index: menu?.index });
    setMenu(undefined);
  }
  return {openMenu, popup: menu && <div ref={popup} popover="auto" role="group" aria-label={list === "fill" ? "Fill actions" : "Stroke actions"}
          style={{ position: "fixed", inset: "auto", margin: 0 }}
          onToggle={event => { if (event.newState === "closed") setMenu(undefined); }}>
          {menu.index !== undefined && <button type="button" onClick={() => menuAction("copy")}>Copy {list}</button>}
          {hasCopied && <button type="button" onClick={() => menuAction("paste")}>Paste {list}</button>}
        </div>};
}
