import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from "react";
import type { DocumentCapability } from "./backends/access";
import type { IdentityAdapter } from "./backends/identity";
import { CanvasController } from "./engine/canvas";
import { EditorEngine } from "./engine/editor";
import { pageOf, rectangleTransform } from "./engine/document";
import { rotationDegrees } from "./engine/affine";
import type { RecoveryStore } from "./backends/recovery";
import { RecoveryController, base64Bytes } from "./engine/recovery";
import { MAX_FILE_BYTES } from "./engine/file-format";
import { PagePanel } from "./PagePanel";
import { AppearancePanel } from "./AppearancePanel";
import { LayerPanel } from "./LayerPanel";
import { frameRelative } from "./engine/hierarchy";

export interface EditorProps {
  identity: IdentityAdapter;
  capabilities: readonly DocumentCapability[];
  /** Host-owned instance; omit for a fresh unsaved local document. */
  engine?: EditorEngine;
  recoveryStore?: RecoveryStore;
}
/** Embeddable local rectangle workflow. The host owns authentication and styling. */
export function Editor({ identity, capabilities, engine: suppliedEngine, recoveryStore }: EditorProps) {
  const [engine] = useState(() => suppliedEngine ?? new EditorEngine());
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  const [signedIn, setSignedIn] = useState(() => identity.getSnapshot().status === "authenticated");
  const [error, setError] = useState("");
  const [recoveryStatus, setRecoveryStatus] = useState(recoveryStore ? "loading" : "ready");
  const [recoveryError, setRecoveryError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mobileLayersOpen, setMobileLayersOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const replaceDialog = useRef<HTMLDialogElement>(null);
  const initialPrincipal = useRef(identity.getSnapshot().principal?.id);
  const canvas = useRef<HTMLCanvasElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const controller = useRef<CanvasController | null>(null);
  useEffect(() => {
    if (pendingFile) replaceDialog.current?.showModal();
    else replaceDialog.current?.close();
  }, [pendingFile]);
  // Count committed chrome renders in development and production without scheduling a render.
  useLayoutEffect(() => {
    if (root.current) root.current.dataset.commits = String(Number(root.current.dataset.commits ?? 0) + 1);
  });
  useEffect(() => {
    const update = () => {
      const current = identity.getSnapshot();
      const authenticated = current.status === "authenticated" && current.principal.id === initialPrincipal.current;
      setSignedIn(authenticated);
      engine.setEditable(authenticated && capabilities.includes("document.edit"));
    };
    update();
    return identity.subscribe(update);
  }, [engine, identity, capabilities]);
  useEffect(() => {
    if (!recoveryStore || !initialPrincipal.current) return;
    const recovery = new RecoveryController(engine, recoveryStore, initialPrincipal.current, (status, message) => {
      setRecoveryStatus(status); setRecoveryError(message ?? "");
    });
    void recovery.start();
    const flush = () => { if (document.visibilityState === "hidden") void recovery.flush(); };
    document.addEventListener("visibilitychange", flush);
    return () => { document.removeEventListener("visibilitychange", flush); recovery.dispose(); };
  }, [engine, recoveryStore]);
  useEffect(() => {
    if (!canvas.current || recoveryStatus === "loading") return;
    const instance = new CanvasController(canvas.current, engine, setError);
    controller.current = instance;
    return () => { controller.current = null; instance.dispose(); };
  }, [engine, recoveryStatus === "loading"]);
  function dispatch(command: string, params: unknown = {}) {
    controller.current?.cancel();
    setError("");
    try { engine.execute(command, params); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Command failed"); }
  }
  function key(event: KeyboardEvent) {
    if (!editable || busy) return;
    if (event.target instanceof HTMLElement && event.target.closest("input,textarea,select,dialog,[contenteditable=true]")) return;
    let command: string | undefined;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save(); return; }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") { event.preventDefault(); fileInput.current?.click(); return; }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") command = "select.all";
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g") command = event.shiftKey ? "object.ungroup" : "object.group";
    if (event.key === "Delete" || event.key === "Backspace") command = "edit.delete";
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
  async function open(file: File) {
    controller.current?.cancel(); setPendingFile(null); setBusy(true); setError("");
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error("File exceeds the 16 MiB browser import limit");
      await engine.executeAsync("file.open", { data: base64Bytes(new Uint8Array(await file.arrayBuffer())), name: file.name });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "File could not be opened"); }
    finally { setBusy(false); }
  }
  async function save() {
    controller.current?.cancel(); setBusy(true); setError("");
    try {
      const result = await engine.executeAsync("file.saveAs", { data: true });
      const bytes = Uint8Array.from(atob(String(result.data)), value => value.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
      try {
        const link = document.createElement("a"); link.href = url; link.download = String(result.name);
        document.body.append(link); link.click(); link.remove();
        engine.execute("file.markSaved", { revision: result.revision });
      } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "File could not be saved"); }
    finally { setBusy(false); }
  }
  const editable = signedIn && snapshot.editable && recoveryStatus !== "loading" && capabilities.includes("document.edit");
  const page = pageOf(snapshot.document);
  const selected = snapshot.document.nodes[snapshot.selection[0]];
  const relative = selected && selected.kind !== "page" ? frameRelative(snapshot.document, selected.id) : undefined;
  return <div ref={root} className="figcraft-editor" onKeyDown={key} data-figcraft-editor="">
      <header className="figcraft-document-bar"><h1>{snapshot.document.name}</h1><span>{snapshot.dirty ? "Unsaved" : "Downloaded"} · Local document</span>
        <button disabled={!editable || busy} onClick={() => fileInput.current?.click()}>Open</button>
        <button disabled={!editable || busy} onClick={() => void save()}>Save as</button>
        <input ref={fileInput} aria-label="Open Figcraft file" type="file" accept=".figcraft,.json" hidden onChange={event => {
          const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
          if (!file) return;
          if (snapshot.dirty && Object.keys(snapshot.document.nodes).length > snapshot.document.pages.length) setPendingFile(file);
          else void open(file);
        }} />
        <button disabled={!editable || !snapshot.canUndo} onClick={() => dispatch("edit.undo")}>Undo</button>
        <button disabled={!editable || !snapshot.canRedo} onClick={() => dispatch("edit.redo")}>Redo</button>
        <details className="figcraft-mobile-pages"><summary>Pages</summary>
          <PagePanel document={snapshot.document} editable={editable && !busy} dispatch={dispatch} />
        </details>
        <details className="figcraft-mobile-layers" onToggle={event => setMobileLayersOpen(event.currentTarget.open)}><summary>Layers</summary>
          {mobileLayersOpen && <LayerPanel document={snapshot.document} selection={snapshot.selection} editable={editable && !busy} dispatch={dispatch} />}
        </details>
      </header>
      {!signedIn && <p role="status">Sign in to edit this document.</p>}
      {error && <p role="alert">{error}</p>}
      {recoveryError && <p role="alert">Recovery unavailable: {recoveryError}</p>}
      <dialog ref={replaceDialog} aria-label="Replace unsaved document" onCancel={() => setPendingFile(null)}>
        <p>Open {pendingFile?.name} and replace the unsaved document?</p>
        <button onClick={() => setPendingFile(null)}>Cancel</button>
        <button onClick={() => { if (pendingFile) void open(pendingFile); }}>Replace document</button>
      </dialog>
      <div className="figcraft-workspace">
        <aside className="figcraft-layers" aria-label="Layers">
          <PagePanel document={snapshot.document} editable={editable && !busy} dispatch={dispatch} />
          <LayerPanel document={snapshot.document} selection={snapshot.selection} editable={editable && !busy} dispatch={dispatch} />
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
          {recoveryStore && <p className="figcraft-recovery" role="status">{recoveryStatus === "loading" ? "Restoring local recovery…" : recoveryStatus === "stored" ? "Recovery saved on this device" : recoveryStatus === "pending" ? "Saving recovery…" : recoveryStatus === "error" ? "Recovery failed" : "Local recovery ready"}</p>}
          {selected && selected.kind !== "page" && relative && <section aria-label={`Selected ${selected.kind}`}><h3>{selected.name}</h3><dl>
            <dt>X</dt><dd>{relative[4]}</dd><dt>Y</dt><dd>{relative[5]}</dd><dt>Width</dt><dd>{selected.width}</dd><dt>Height</dt><dd>{selected.height}</dd>
          </dl>
          <form key={[selected.id, relative[4], relative[5], selected.width, selected.height, ...(selected.transform ?? [])].join(",")} onSubmit={event => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const previous = { x: relative[4], y: relative[5], width: selected.width, height: selected.height, rotation: rotationDegrees(rectangleTransform(selected)) };
            const props = Object.fromEntries(Object.entries(previous).map(([name, value]) => [name, Number(data.get(name)), value]).filter(([, value, old]) => value !== old).map(([name, value]) => [name, value]));
            if (Object.keys(props).length) dispatch("node.set", { props });
          }}>
            <fieldset disabled={!editable}><legend>Geometry</legend>
              {(["x", "y", "width", "height", "rotation"] as const).map(name => <label key={name}>{name === "rotation" ? "Rotation" : `Edit ${name === "x" || name === "y" ? name.toUpperCase() : name[0].toUpperCase() + name.slice(1)}`}
                <input name={name} type="number" step="any" required defaultValue={name === "rotation" ? rotationDegrees(rectangleTransform(selected)) : name === "x" ? relative[4] : name === "y" ? relative[5] : selected[name]} />
              </label>)}
              <button type="submit">Apply geometry</button>
            </fieldset>
          </form></section>}
          <AppearancePanel page={page} selected={selected && selected.kind !== "page" ? selected : undefined} editable={editable && !busy} dispatch={dispatch} />
        </aside>
      </div>
    </div>;
}
