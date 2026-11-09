import { LayerList } from "./LayerList";
import { isGroupLike, isLeaf } from "./engine/document";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
  const [filter, setFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [target, setTarget] = useState<NodeId>(document.currentPage);
  useEffect(() => {
    setTarget(document.currentPage);
    setFilter("");
    setOffset(0);
  }, [document.currentPage]);
  const page = document.nodes[document.currentPage] as PageNode;
  const containers = useMemo(() => {
    const result = [{ id: page.id, name: page.name, depth: 0 }];
    function collect(ids: readonly NodeId[], depth: number) {
      for (let i = ids.length - 1; i >= 0; i--) {
        const node = document.nodes[ids[i]];
        if (node && !isLeaf(node) && node.kind !== "page") {
          result.push({id: node.id, name: node.name, depth});
          collect(node.children, depth + 1);
        }
      }
    }
    collect(page.children, 1);
    return result;
  }, [document.nodes, page]);
  const pageSize = 64, paged = containers.length > pageSize;
  const matches = useMemo(() => paged && filter ? containers.filter(item =>
    item.name.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()) || item.id === filter.trim()) : containers, [containers, filter, paged]);
  const first = Math.min(offset, Math.max(0, Math.floor((matches.length - 1) / pageSize) * pageSize));
  const choices = paged ? matches.slice(first, first + pageSize) : containers;
  const destination = choices.find(item => item.id === target)?.id ?? choices[0]?.id;
  const active = selection.length === 1 ? document.nodes[selection[0]] : undefined;
  const parent = active && active.kind !== "page" ? document.nodes[active.parent] : undefined;
  const siblings = parent && !isLeaf(parent) ? parent.children : [];
  const position = active ? siblings.indexOf(active.id) : -1;

  function move(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (editable && selection.length && destination) dispatch("node.reparent", { ids: selection, parent: destination });
  }
  const reorder = (index: number): void => {
    if (editable && active) dispatch("node.reorder", { id: active.id, index });
  };

  return <section aria-label="Layers">
    <h2>{page.name}</h2><p>{page.children.length} {page.children.length === 1 ? "layer" : "layers"}</p>
    <LayerList key={page.id} document={document} selection={selection} editable={editable} dispatch={dispatch}/>
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
      <button type="button" disabled={!editable || !selection.some(id => document.nodes[id]?.kind === "vector")} onClick={() => dispatch("vector.simplify")}>Simplify vector</button>
      <button type="button" disabled={!editable || selection.length === 0} onClick={() => dispatch("vector.join")}>Join selection</button>
      <button type="button" disabled={!editable || selection.length === 0} onClick={() => dispatch("vector.smoothJoin")}>Smooth join selection</button>
      <button type="button" disabled={!editable || !selection.some(id => document.nodes[id]?.kind === "vector")} onClick={() => dispatch("vector.reverse")}>Reverse path direction</button>
      <button type="button" disabled={!editable || !selection.some(id => document.nodes[id] && document.nodes[id].kind !== "page" && !isLeaf(document.nodes[id]))} onClick={() => dispatch("select.children")}>Select children</button>
      <button type="button" disabled={!editable || !parent || parent.kind === "page"} onClick={() => dispatch("select.parent")}>Select parent</button>
      {selection.length === 1 && ["component","componentSet"].includes(document.nodes[selection[0]]?.kind) &&
        <button type="button" disabled={!editable} onClick={() => dispatch("instance.create",{component:selection[0]})}>Create instance</button>}
      <button type="button" disabled={!editable || !selection.length} onClick={() => dispatch("component.create")}>Create component</button>
      <button type="button" disabled={!editable || !selection.length} onClick={() => dispatch("component.createMultiple")}>Create multiple components</button>
      <button type="button" disabled={!editable || selection.length === 0} onClick={() => dispatch("object.frameSelection", { ids: selection })}>Frame selection</button>
      <button type="button" disabled={!editable || !selection.some(id => document.nodes[id]?.kind === "frame")} onClick={() => dispatch("object.removeFrame", { ids: selection })}>Remove frame</button>
      <button type="button" disabled={!editable || !selection.some(id => document.nodes[id]?.kind === "group")} onClick={() => dispatch("object.convertToFrame", { ids: selection })}>Convert to frame</button>
      <button type="button" disabled={!editable || !selection.some(id => document.nodes[id]?.kind === "frame")} onClick={() => dispatch("object.convertToGroup", { ids: selection })}>Convert to group</button>
      <button type="button" disabled={!editable || selection.length === 0} onClick={() => dispatch("edit.delete", { ids: selection })}>Delete layers</button>
      <button type="button" disabled={!editable || position < 0 || position === siblings.length - 1} onClick={() => reorder(position + 1)}>Move layer up</button>
      <button type="button" disabled={!editable || position <= 0} onClick={() => reorder(position - 1)}>Move layer down</button>
    </div>
    <form onSubmit={move}>
      {paged && <label>Find destination<input type="search" value={filter} onChange={event => {
        setFilter(event.currentTarget.value); setOffset(0);
      }}/></label>}
      <label>Move selection into
        <select value={destination ?? ""} onChange={event => setTarget(event.currentTarget.value)} disabled={!editable || selection.length === 0}>
          {choices.map(container => <option key={container.id} value={container.id}>{"  ".repeat(container.depth)}{container.name}</option>)}
        </select>
      </label>
      {paged && <div>
        <button type="button" disabled={!first} onClick={() => setOffset(first - pageSize)}>Previous destinations</button>
        <button type="button" disabled={first + pageSize >= matches.length} onClick={() => setOffset(first + pageSize)}>Next destinations</button>
        <span aria-live="polite">{matches.length ? `${first + 1}–${first + choices.length} of ${matches.length}` : "No matching destinations"}</span>
      </div>}
      <button type="submit" disabled={!editable || !destination || selection.length === 0}>Move selection</button>
    </form>
  </section>;
}
