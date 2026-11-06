import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Document, PageNode } from "./engine/document";
import { isDivider } from "./engine/pages";

export interface PagePanelProps {
  document: Document;
  editable: boolean;
  dispatch: (command: string, params?: unknown) => void;
}

/** Browser controls for the upstream page list and its per-page actions. */
export function PagePanel({ document, editable, dispatch }: PagePanelProps) {
  const [name, setName] = useState("");
  const headingId = useId();
  const nameId = useId();
  const hintId = useId();
  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable) return;
    dispatch("page.add", name === "" ? {} : { name });
    setName("");
  }
  return <section className="figcraft-pages" aria-labelledby={headingId}>
    <h2 id={headingId}>Pages</h2>
    <ul className="figcraft-page-list">
      {document.pages.map((id, index) => {
        const page = document.nodes[id];
        return page?.kind === "page" ? <PageRow key={id} page={page} index={index}
          count={document.pages.length} current={id === document.currentPage}
          divider={isDivider(document, id)} editable={editable} dispatch={dispatch} /> : null;
      })}
    </ul>
    <form className="figcraft-add-page" onSubmit={add}>
      <label htmlFor={nameId}>New page name</label>
      <input id={nameId} value={name} onChange={event => setName(event.currentTarget.value)}
        disabled={!editable} aria-describedby={hintId} />
      <p id={hintId}>Leave blank for a default name. Start with a hyphen to add a divider.</p>
      <button type="submit" disabled={!editable}>Add page</button>
    </form>
  </section>;
}

interface PageRowProps {
  page: PageNode;
  index: number;
  count: number;
  current: boolean;
  divider: boolean;
  editable: boolean;
  dispatch: PagePanelProps["dispatch"];
}

function PageRow({ page, index, count, current, divider, editable, dispatch }: PageRowProps) {
  const [name, setName] = useState<string | null>(null);
  const renaming = name !== null;
  const input = useRef<HTMLInputElement>(null);
  const renameButton = useRef<HTMLButtonElement>(null);
  const inputId = useId();
  useEffect(() => {
    if (renaming) { input.current?.focus(); input.current?.select(); }
  }, [renaming]);
  function finish() {
    setName(null);
    renameButton.current?.focus();
  }
  function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable || name === null) return;
    dispatch("page.rename", { id: page.id, name });
    finish();
  }
  return <li className="figcraft-page-row" data-page-id={page.id} data-divider={divider || undefined}>
    {divider ? <div className="figcraft-page-divider"><span>{page.name}</span><hr aria-label={`Divider: ${page.name}`} /></div> : <button type="button"
      className="figcraft-page-select" disabled={!editable} aria-current={current ? "page" : undefined}
      onClick={() => dispatch("page.select", { id: page.id })}>{page.name || "Unnamed page"}</button>}
    <details className="figcraft-page-actions">
      <summary aria-label={`Actions for ${divider ? "divider" : "page"} ${page.name}`}>Actions</summary>
      <button ref={renameButton} type="button" disabled={!editable} onClick={() => setName(page.name)}>Rename</button>
      <button type="button" disabled={!editable} onClick={() => dispatch("page.duplicate", { id: page.id })}>Duplicate</button>
      <button type="button" disabled={!editable} onClick={() => dispatch("page.delete", { id: page.id })}>Delete</button>
      <button type="button" disabled={!editable || index === 0} onClick={() => dispatch("page.move", { id: page.id, index: index - 1 })}>Move up</button>
      <button type="button" disabled={!editable || index === count - 1} onClick={() => dispatch("page.move", { id: page.id, index: index + 1 })}>Move down</button>
    </details>
    {renaming && <form className="figcraft-rename-page" onSubmit={rename} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(); }
    }}>
      <label htmlFor={inputId}>Rename {divider ? "divider" : "page"}</label>
      <input ref={input} id={inputId} value={name} disabled={!editable} onChange={event => setName(event.currentTarget.value)} />
      <button type="submit" disabled={!editable}>Apply name</button>
      <button type="button" disabled={!editable} onClick={finish}>Cancel</button>
    </form>}
  </li>;
}
