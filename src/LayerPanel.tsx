import { BooleanIcon } from "./BooleanMenu";
import { booleanLabel } from "./engine/structure";
import { isGroupLike, isLeaf } from "./engine/document";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Document, NodeId, PageNode } from "./engine/document";

export interface LayerPanelProps {
  document: Document;
  selection: readonly NodeId[];
  editable: boolean;
  dispatch: (command: string, params?: unknown) => void;
}

/** Top-first layer tree; document children remain in bottom-to-top paint order. */
export function LayerPanel({ document, selection, editable, dispatch }: LayerPanelProps) {
  const offsetDialog = useRef<HTMLDialogElement>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<NodeId>>(() => new Set());
  const [target, setTarget] = useState<NodeId>(document.currentPage);
  useEffect(() => setTarget(document.currentPage), [document.currentPage]);
  const page = document.nodes[document.currentPage] as PageNode;
  const selected = new Set(selection);
  const containers: { id: NodeId; name: string; depth: number }[] = [{ id: page.id, name: page.name, depth: 0 }];
  const seen = new Set<NodeId>();
  const collect = (ids: readonly NodeId[], depth: number): void => {
    for (const id of [...ids].reverse()) {
      if (seen.has(id)) continue;
      seen.add(id);
      const node = document.nodes[id];
      if (node && !isLeaf(node) && node.kind !== "page") {
        containers.push({ id, name: node.name, depth });
        collect(node.children, depth + 1);
      }
    }
  };
  collect(page.children, 1);
  const destination = containers.some(container => container.id === target) ? target : page.id;
  const active = selection.length === 1 ? document.nodes[selection[0]] : undefined;
  const parent = active && active.kind !== "page" ? document.nodes[active.parent] : undefined;
  const siblings = parent && !isLeaf(parent) ? parent.children : [];
  const position = active ? siblings.indexOf(active.id) : -1;

  const toggle = (id: NodeId): void => setCollapsed(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const rows = (ids: readonly NodeId[], depth: number): ReactNode => [...ids].reverse().map(id => {
    const node = document.nodes[id];
    if (!node || node.kind === "page") return null;
    const parent = document.nodes[node.parent];
    const own = parent?.kind === "booleanOp" && parent.children[0] !== id && node.boolOp !== parent.op ? node.boolOp : undefined;
    const group = !isLeaf(node) ? node : undefined;
    const expanded = group !== undefined && !collapsed.has(id);
    return <li key={id} aria-current={selected.has(id) ? "true" : undefined} data-layer-id={id} style={{ paddingInlineStart: `${depth * 1.1}rem` }}>
      {group && <button type="button" aria-label={`${expanded ? "Collapse" : "Expand"} ${group.kind} ${group.name}`} aria-expanded={expanded}
        onClick={() => toggle(id)}>{expanded ? "▾" : "▸"}</button>}
      <button type="button" disabled={!editable} onClick={event => dispatch("select.set", {
        ids: event.shiftKey ? selected.has(id) ? selection.filter(current => current !== id) : [...selection, id] : [id],
      })}>{node.kind === "booleanOp" && <BooleanIcon op={node.op}/>} {node.name}</button>
      {own && <span aria-label={booleanLabel(own) + " operand"} title={booleanLabel(own)}><BooleanIcon op={own} /></span>}
      {group && expanded && <ul aria-label={`Children of ${group.name}`}>{rows(group.children, depth + 1)}</ul>}
    </li>;
  });
  function move(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (editable && selection.length) dispatch("node.reparent", { ids: selection, parent: destination });
  }
  const reorder = (index: number): void => {
    if (editable && active) dispatch("node.reorder", { id: active.id, index });
  };

  return <section aria-label="Layers">
    <h2>{page.name}</h2><p>{page.children.length} {page.children.length === 1 ? "layer" : "layers"}</p>
    <ul aria-label="Page layers">{rows(page.children, 0)}</ul>
    <div role="group" aria-label="Layer actions">
      <button type="button" disabled={!editable || selection.length === 0} onClick={() => dispatch("edit.duplicate")}>Duplicate layers</button>
      <button type="button" disabled={!editable || selection.length === 0} onClick={() => dispatch("object.group", { ids: selection })}>Group</button>
      <button type="button" disabled={!editable || !selection.some(id => isGroupLike(document.nodes[id]))} onClick={() => dispatch("object.ungroup", { ids: selection })}>Ungroup</button>
      <button type="button" disabled={!editable || selection.length === 0} onClick={() => dispatch("vector.flatten")}>Flatten</button>
      <button type="button" disabled={!editable || selection.length === 0} onClick={() => {
        const dialog = offsetDialog.current!;
        dialog.querySelector("form")?.reset();
        dialog.showModal();
      }}>Offset path</button>
      <dialog ref={offsetDialog} aria-label="Offset path">
        <form onSubmit={event => {
          event.preventDefault();
          const value = Number(new FormData(event.currentTarget).get("offset"));
          if (editable && selection.length && Number.isFinite(value)) dispatch("vector.offset", { offset: Math.max(-100000, Math.min(100000, value)) });
          offsetDialog.current?.close();
        }}>
          <label>Offset distance<input name="offset" type="number" step="any" required defaultValue="0" autoFocus /></label>
          <button type="submit">Offset</button>
          <button type="button" onClick={() => offsetDialog.current?.close()}>Cancel</button>
        </form>
      </dialog>
      <button type="button" disabled={!editable || selection.length === 0} onClick={() => dispatch("vector.outlineStroke")}>Outline stroke</button>
      <button type="button" disabled={!editable || selection.length === 0} onClick={() => dispatch("vector.join")}>Join selection</button>
      <button type="button" disabled={!editable || selection.length === 0} onClick={() => dispatch("vector.smoothJoin")}>Smooth join selection</button>
      <button type="button" disabled={!editable || !selection.some(id => document.nodes[id]?.kind === "vector")} onClick={() => dispatch("vector.reverse")}>Reverse path direction</button>
      <button type="button" disabled={!editable || !selection.some(id => ["group", "frame", "booleanOp"].includes(document.nodes[id]?.kind))} onClick={() => dispatch("select.children")}>Select children</button>
      <button type="button" disabled={!editable || !parent || parent.kind === "page"} onClick={() => dispatch("select.parent")}>Select parent</button>
      <button type="button" disabled={!editable || selection.length === 0} onClick={() => dispatch("object.frameSelection", { ids: selection })}>Frame selection</button>
      <button type="button" disabled={!editable || !selection.some(id => document.nodes[id]?.kind === "frame")} onClick={() => dispatch("object.removeFrame", { ids: selection })}>Remove frame</button>
      <button type="button" disabled={!editable || !selection.some(id => document.nodes[id]?.kind === "group")} onClick={() => dispatch("object.convertToFrame", { ids: selection })}>Convert to frame</button>
      <button type="button" disabled={!editable || !selection.some(id => document.nodes[id]?.kind === "frame")} onClick={() => dispatch("object.convertToGroup", { ids: selection })}>Convert to group</button>
      <button type="button" disabled={!editable || selection.length === 0} onClick={() => dispatch("edit.delete", { ids: selection })}>Delete layers</button>
      <button type="button" disabled={!editable || position < 0 || position === siblings.length - 1} onClick={() => reorder(position + 1)}>Move layer up</button>
      <button type="button" disabled={!editable || position <= 0} onClick={() => reorder(position - 1)}>Move layer down</button>
    </div>
    <form onSubmit={move}>
      <label>Move selection into
        <select value={destination} onChange={event => setTarget(event.currentTarget.value)} disabled={!editable || selection.length === 0}>
          {containers.map(container => <option key={container.id} value={container.id}>{"  ".repeat(container.depth)}{container.name}</option>)}
        </select>
      </label>
      <button type="submit" disabled={!editable || selection.length === 0}>Move selection</button>
    </form>
  </section>;
}
