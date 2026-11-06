import { ViewControls } from "./ViewControls";
import { ArrangePanel } from "./ArrangePanel";
import { ScalePanel } from "./ScalePanel";
import { SizePanel } from "./SizePanel";
import { RotationPanel } from "./RotationPanel";
import { SmartSelectionPanel } from "./SmartSelectionPanel";
import { framePresets } from "./engine/frame-presets";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from "react";
import type { DocumentCapability } from "./backends/access";
import type { IdentityAdapter } from "./backends/identity";
import { CanvasController } from "./engine/canvas";
import { EditorEngine } from "./engine/editor";
import { defaultConstraints, pageOf, rectangleTransform } from "./engine/document";
import { rotationDegrees } from "./engine/affine";
import type { RecoveryStore } from "./backends/recovery";
import { RecoveryController, base64Bytes } from "./engine/recovery";
import { MAX_FILE_BYTES } from "./engine/file-format";
import { PagePanel } from "./PagePanel";
import { AppearancePanel } from "./AppearancePanel";
import { LayerPanel } from "./LayerPanel";
import { frameRelative, pageForNode } from "./engine/hierarchy";

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
    const cancellingUndo = command === "edit.undo" && engine.interacting;
    controller.current?.cancel();
    setError("");
    if (cancellingUndo) return;
    try { engine.execute(command, params); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Command failed"); }
  }
  function key(event: KeyboardEvent) {
    if (!editable || busy) return;
    if (event.target instanceof HTMLElement && event.target.closest("input,textarea,select,dialog,[contenteditable=true]")) return;
    let command: string | undefined;
    if (!event.metaKey && !event.ctrlKey && event.altKey && event.code === "KeyR") command = "transform.rotationOrigin";
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save(); return; }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") { event.preventDefault(); fileInput.current?.click(); return; }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") command = "select.all";
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g") command = event.shiftKey ? "object.ungroup" : "object.group";
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "d") command = "edit.duplicate";
    if (event.key === "Delete" || event.key === "Backspace") command = "edit.delete";
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") command = event.shiftKey ? "edit.redo" : "edit.undo";
    else if (!event.metaKey && !event.ctrlKey && !event.altKey) {
      if (event.key.toLowerCase() === "r") command = "tool.rectangle";
      if (event.key.toLowerCase() === "v") command = "tool.move";
      if (event.key.toLowerCase() === "k") command = "tool.scale";
      if (event.shiftKey && event.key.toLowerCase() === "h") command = "object.flipH";
      if (event.shiftKey && event.key.toLowerCase() === "v") command = "object.flipV";
      if (event.key.toLowerCase() === "n") command = event.shiftKey ? "view.prevFrame" : "view.nextFrame";
      if (event.shiftKey && event.code === "Digit0") command = "view.zoom100";
      if (event.shiftKey && event.code === "Digit1") command = "view.zoomFit";
      if (event.shiftKey && event.code === "Digit2") command = "view.zoomSelection";
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault(); dispatch(snapshot.selection.length ? "transform.nudge" : "view.pan", { dx: event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0, dy: event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0, big: event.shiftKey }); return;
      }
      if (event.key === "Escape") { event.preventDefault(); controller.current?.cancel(); engine.endOriginEdit(); return; }
    }
    if (!event.altKey && (event.metaKey || event.ctrlKey) && snapshot.selection.length && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault(); dispatch("transform.nudgeSize", { dw: event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0, dh: event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0, big: event.shiftKey }); return;
    }
    if (!event.altKey && ["+", "="].includes(event.key)) command = "view.zoomIn";
    if (!event.altKey && ["-", "_"].includes(event.key)) command = "view.zoomOut";
    if (!event.altKey && (event.metaKey || event.ctrlKey) && event.code === "Digit0") command = "view.zoom100";
    if (!event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
      if (event.key === "PageUp") command = "view.prevPage";
      if (event.key === "PageDown") command = "view.nextPage";
      if (event.key === "Home") command = "view.prevFrame";
      if (event.key === "End") command = "view.nextFrame";
    }
    if (command) { event.preventDefault(); dispatch(command); }
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    dispatch(submitter?.value === "frame" ? "frame.create" : "shape.rectangle", { ...Object.fromEntries(["x", "y", "width", "height"].map(name => [name, Number(data.get(name))])), parent: String(data.get("parent")) });
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
          <ViewControls engine={engine} editable={editable && !busy} dispatch={dispatch} />
          <p id="canvas-instructions" className="figcraft-instructions">R: rectangle · Space/middle drag: pan · Z: zoom · Ctrl/⌘ wheel: zoom · Escape: cancel</p>
          <div className="figcraft-toolbar" role="toolbar" aria-label="Tools">
            <button disabled={!editable} aria-pressed={snapshot.tool === "move"} onClick={() => { dispatch("tool.move"); canvas.current?.focus(); }}>Move</button>
            <button disabled={!editable} aria-pressed={snapshot.tool === "scale"} onClick={() => { dispatch("tool.scale"); canvas.current?.focus(); }}>Scale</button>
            <button disabled={!editable} aria-pressed={snapshot.tool === "rectangle"} onClick={() => { dispatch("tool.rectangle"); canvas.current?.focus(); }}>Rectangle</button>
          </div>
        </div>
        <aside className="figcraft-properties" aria-label="Design"><h2>Design</h2>
          <form key={page.id} onSubmit={create}><fieldset disabled={!editable}><legend>Create layer</legend>
            {(["x", "y", "width", "height"] as const).map(name => <label key={name}>{name === "width" ? "Width" : name === "height" ? "Height" : name.toUpperCase()}<input name={name} type="number" step="any" required defaultValue={name === "x" || name === "y" ? 40 : 100} /></label>)}
            <label>Create in<select aria-label="Create in" name="parent" defaultValue={page.id}>
              {Object.values(snapshot.document.nodes).filter(node => node.kind !== "rectangle" && pageForNode(snapshot.document, node.id) === page.id).map(node => <option key={node.id} value={node.id}>{node.name}</option>)}
            </select></label>
            <button type="submit" value="rectangle">Create rectangle</button>
            <button type="submit" value="frame">Create frame</button>
          </fieldset></form>
          <details><summary>Frame presets</summary><form onSubmit={event => {
            event.preventDefault(); const data = new FormData(event.currentTarget);
            dispatch("frame.create", { preset: data.get("preset") });
          }}><label>Preset<select aria-label="Frame preset" name="preset" disabled={!editable}>
            {framePresets.map(preset => <option key={preset.name} value={preset.name}>{preset.category}: {preset.name}</option>)}
          </select></label><button type="submit" disabled={!editable}>Create preset frame</button></form></details>
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
          </form>
          <label><input type="checkbox" checked={selected.constrainProportions ?? false} disabled={!editable} onChange={event => dispatch("node.set", { props: { constrainProportions: event.currentTarget.checked } })} />Constrain proportions</label>
          {selected.kind === "frame" && <label><input type="checkbox" checked={selected.clip} disabled={!editable} onChange={event => dispatch("node.set", { id: selected.id, props: { clip: event.currentTarget.checked } })} />Clip content</label>}
          <form key={`${selected.id}:${selected.constraints?.horizontal}:${selected.constraints?.vertical}`} onSubmit={event => {
            event.preventDefault(); const data = new FormData(event.currentTarget);
            dispatch("node.set", { id: selected.id, props: { constraints: { horizontal: data.get("horizontal"), vertical: data.get("vertical") } } });
          }}><fieldset disabled={!editable}><legend>Constraints</legend>
            <label>Horizontal constraint<select aria-label="Horizontal constraint" name="horizontal" defaultValue={(selected.constraints ?? defaultConstraints).horizontal}>
              {["left", "right", "leftRight", "center", "scale"].map(value => <option key={value} value={value}>{({ left: "Left", right: "Right", leftRight: "Left and right", center: "Centre", scale: "Scale" })[value]}</option>)}
            </select></label>
            <label>Vertical constraint<select aria-label="Vertical constraint" name="vertical" defaultValue={(selected.constraints ?? defaultConstraints).vertical}>
              {["top", "bottom", "topBottom", "center", "scale"].map(value => <option key={value} value={value}>{({ top: "Top", bottom: "Bottom", topBottom: "Top and bottom", center: "Centre", scale: "Scale" })[value]}</option>)}
            </select></label><button type="submit">Apply constraints</button>
          </fieldset></form></section>}
          <ArrangePanel document={snapshot.document} selection={snapshot.selection} editable={editable && !busy} dispatch={dispatch} />
          <SmartSelectionPanel engine={engine} enabled={editable && !busy} dispatch={dispatch} onError={setError} />
          {snapshot.tool === "scale" ? <ScalePanel engine={engine} enabled={editable && !busy} dispatch={dispatch} onError={setError} /> : <SizePanel enabled={editable && !busy && snapshot.selection.length > 0} dispatch={dispatch} />}
          <RotationPanel engine={engine} enabled={editable && !busy && snapshot.selection.length > 0} dispatch={dispatch} />
          <AppearancePanel page={page} selected={selected && selected.kind !== "page" ? selected : undefined} editable={editable && !busy} dispatch={dispatch} />
        </aside>
      </div>
    </div>;
}
