import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from "react";
import type { DocumentCapability } from "./backends/access";
import type { IdentityAdapter } from "./backends/identity";
import { CanvasController } from "./engine/canvas";
import { EditorEngine } from "./engine/editor";
import { pageOf } from "./engine/document";

export interface EditorProps {
  identity: IdentityAdapter;
  capabilities: readonly DocumentCapability[];
  /** Host-owned instance; omit for a fresh unsaved local document. */
  engine?: EditorEngine;
}
/** Embeddable local rectangle workflow. The host owns authentication and styling. */
export function Editor({ identity, capabilities, engine: suppliedEngine }: EditorProps) {
  const [engine] = useState(() => suppliedEngine ?? new EditorEngine());
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  const [signedIn, setSignedIn] = useState(() => identity.getSnapshot().status === "authenticated");
  const [error, setError] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const controller = useRef<CanvasController | null>(null);
  // Count committed chrome renders in development and production without scheduling a render.
  useLayoutEffect(() => {
    if (root.current) root.current.dataset.commits = String(Number(root.current.dataset.commits ?? 0) + 1);
  });
  useEffect(() => {
    const update = () => {
      const authenticated = identity.getSnapshot().status === "authenticated";
      setSignedIn(authenticated);
      engine.setEditable(authenticated && capabilities.includes("document.edit"));
    };
    update();
    return identity.subscribe(update);
  }, [engine, identity, capabilities]);
  useEffect(() => {
    if (!canvas.current) return;
    const instance = new CanvasController(canvas.current, engine, setError);
    controller.current = instance;
    return () => { controller.current = null; instance.dispose(); };
  }, [engine]);
  function dispatch(command: string, params: unknown = {}) {
    controller.current?.cancel();
    setError("");
    try { engine.execute(command, params); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Command failed"); }
  }
  function key(event: KeyboardEvent) {
    if (event.target instanceof HTMLElement && event.target.closest("input,textarea,select,[contenteditable=true]")) return;
    let command: string | undefined;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") command = event.shiftKey ? "edit.redo" : "edit.undo";
    else if (!event.metaKey && !event.ctrlKey && !event.altKey) {
      if (event.key.toLowerCase() === "r") command = "tool.rectangle";
      if (event.key.toLowerCase() === "v") command = "tool.move";
      if (event.key === "Escape") { controller.current?.cancel(); return; }
    }
    if (command) { event.preventDefault(); dispatch(command); }
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    dispatch("shape.rectangle", Object.fromEntries(["x", "y", "width", "height"].map(name => [name, Number(data.get(name))])));
  }
  const editable = signedIn && snapshot.editable && capabilities.includes("document.edit");
  const page = pageOf(snapshot.document);
  const selected = snapshot.document.nodes[snapshot.selection[0]];
  return <div ref={root} className="figcraft-editor" onKeyDown={key} data-figcraft-editor="">
      <header className="figcraft-document-bar"><h1>{snapshot.document.name}</h1><span>Unsaved · Local document</span>
        <button disabled={!editable || !snapshot.canUndo} onClick={() => dispatch("edit.undo")}>Undo</button>
        <button disabled={!editable || !snapshot.canRedo} onClick={() => dispatch("edit.redo")}>Redo</button>
      </header>
      {!signedIn && <p role="status">Sign in to edit this document.</p>}
      {error && <p role="alert">{error}</p>}
      <div className="figcraft-workspace">
        <aside className="figcraft-layers" aria-label="Layers"><h2>{page.name}</h2><p>{page.children.length} {page.children.length === 1 ? "layer" : "layers"}</p>
          <ul>{page.children.map(id => <li key={id} aria-current={snapshot.selection.includes(id) ? "true" : undefined}>{snapshot.document.nodes[id].name}</li>)}</ul>
        </aside>
        <div className="figcraft-canvas-area">
          <canvas ref={canvas} aria-label="Design canvas" tabIndex={0} aria-describedby="canvas-instructions" />
          <p id="canvas-instructions" className="figcraft-instructions">R: rectangle · Drag to draw · Shift: square · Alt: centre · Escape: cancel</p>
          <div className="figcraft-toolbar" role="toolbar" aria-label="Tools">
            <button disabled={!editable} aria-pressed={snapshot.tool === "move"} onClick={() => { dispatch("tool.move"); canvas.current?.focus(); }}>Move</button>
            <button disabled={!editable} aria-pressed={snapshot.tool === "rectangle"} onClick={() => { dispatch("tool.rectangle"); canvas.current?.focus(); }}>Rectangle</button>
          </div>
        </div>
        <aside className="figcraft-properties" aria-label="Design"><h2>Design</h2>
          <form onSubmit={create}><fieldset disabled={!editable}><legend>Create rectangle</legend>
            {(["x", "y", "width", "height"] as const).map(name => <label key={name}>{name === "width" ? "Width" : name === "height" ? "Height" : name.toUpperCase()}<input name={name} type="number" step="any" required defaultValue={name === "x" || name === "y" ? 40 : 100} /></label>)}
            <button type="submit">Create rectangle</button>
          </fieldset></form>
          {selected?.kind === "rectangle" && <section aria-label="Selected rectangle"><h3>{selected.name}</h3><dl>
            <dt>X</dt><dd>{selected.x}</dd><dt>Y</dt><dd>{selected.y}</dd><dt>Width</dt><dd>{selected.width}</dd><dt>Height</dt><dd>{selected.height}</dd>
          </dl></section>}
        </aside>
      </div>
    </div>;
}
