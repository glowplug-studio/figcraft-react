import { textShortcut } from "./engine/text-shortcuts";
import { subtreeIds } from "./engine/hierarchy";
import { ColourProfileDialog } from "./ColourProfileDialog";
import { ArcPanel } from "./ArcPanel";
import { TypographyPanel } from "./TypographyPanel";
import { PointsPanel } from "./PointsPanel";
import { VectorPanel, VectorToolbar } from "./VectorPanel";
import { StrokePanel } from "./StrokePanel";
import { isLeaf } from "./engine/document";
import { CornerPanel } from "./CornerPanel";
import { ViewControls, ViewMenu } from "./ViewControls";
import { ArrangePanel } from "./ArrangePanel";
import { ScalePanel } from "./ScalePanel";
import { SizePanel } from "./SizePanel";
import { RotationPanel } from "./RotationPanel";
import { SmartSelectionPanel } from "./SmartSelectionPanel";
import { framePresets } from "./engine/frame-presets";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from "react";
import type { DocumentCapability } from "./backends/access";
import type { IdentityAdapter } from "./backends/identity";
import { hitRectangle, type layersAt } from "./engine/selection";
import { topImageFill } from "./engine/image-commands";
import { screenToPage } from "./engine/viewport";
import type { Point } from "./engine/geometry";
import { CanvasController } from "./engine/canvas";
import { EditorEngine } from "./engine/editor";
import { availableBuilderArrangement } from "./engine/shape-builder";
import { defaultConstraints, pageOf, rectangleTransform } from "./engine/document";
import { rotationDegrees } from "./engine/affine";
import type { RecoveryStore } from "./backends/recovery";
import { RecoveryController } from "./engine/recovery";
import { PagePanel } from "./PagePanel";
import { EffectsPanel } from "./EffectsPanel";
import { AppearancePanel } from "./AppearancePanel";
import { BooleanMenu } from "./BooleanMenu";
import { LayerPanel } from "./LayerPanel";
import { frameRelative, pageForNode } from "./engine/hierarchy";

export interface EditorProps {
  identity: IdentityAdapter;
  capabilities: readonly DocumentCapability[];
  /** Host-owned instance; omit for a fresh unsaved local document. */
  engine?: EditorEngine;
  recoveryStore?: RecoveryStore;
}

function HistoryButtons({ engine, editable, undo, redo, dispatch }: { engine: EditorEngine; editable: boolean; undo: boolean; redo: boolean; dispatch: (command: string) => void }) {
  const pen = useSyncExternalStore(engine.pen.subscribeHistory, engine.pen.getHistory, engine.pen.getHistory);
  return <><button disabled={!editable || (!undo && !(pen & 1))} onClick={() => dispatch("edit.undo")}>Undo</button>
    <button disabled={!editable || (!redo && !(pen & 2))} onClick={() => dispatch("edit.redo")}>Redo</button></>;
}
/** Embeddable local rectangle workflow. The host owns authentication and styling. */
export function Editor({ identity, capabilities, engine: suppliedEngine, recoveryStore }: EditorProps) {
  const [engine] = useState(() => suppliedEngine ?? new EditorEngine());
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  const editingVector = useSyncExternalStore(engine.subscribeVectorEdit, () => Boolean(engine.getVectorEdit()), () => Boolean(engine.getVectorEdit()));
  const [signedIn, setSignedIn] = useState(() => identity.getSnapshot().status === "authenticated");
  const [error, setError] = useState("");
  const [recoveryStatus, setRecoveryStatus] = useState(recoveryStore ? "loading" : "ready");
  const [recoveryError, setRecoveryError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mobileLayersOpen, setMobileLayersOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const linkDialog = useRef<HTMLDialogElement>(null);
  const missingFontsDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (snapshot.missingFonts) missingFontsDialog.current?.showModal(); }, [snapshot.missingFonts]);
  const replaceDialog = useRef<HTMLDialogElement>(null);
  const initialPrincipal = useRef(identity.getSnapshot().principal?.id);
  const canvas = useRef<HTMLCanvasElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const controller = useRef<CanvasController | null>(null);
  const pasteMenu = useRef<HTMLDivElement>(null);
  const [pointLayers, setPointLayers] = useState<ReturnType<typeof layersAt>["layers"]>([]);
  const menuOrigin = useRef<Point>({x:0,y:0});
  const pasteAt = useRef<Point | undefined>(undefined);
  const modifiedPaste = useRef(false);
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
    setError("");
    try {
      if (engine.pen.open && (command === "edit.undo" || command === "edit.redo")) {
        controller.current?.cancel(true); engine.execute(command, params); return;
      }
      if (engine.pen.open && command.startsWith("tool.") && !["tool.pen", "tool.scaleAnchor", "tool.pencilBrush"].includes(command)) engine.pen.finish();
      const preserve = engine.pen.open && command === "tool.pen" || (engine.pen.open || engine.pencil.active) && (command.startsWith("view.") || command === "tool.scaleAnchor" || command === "tool.pencilBrush");
      if (!preserve) controller.current?.cancel();
      if (cancellingUndo) return;
      engine.execute(command, params);
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Command failed"); }
  }
  function key(event: KeyboardEvent) {
    if (!editable || busy) return;
    if (snapshot.crop && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && (event.key==="Escape" || event.key==="Enter") && !(event.target instanceof Element && event.target.closest("input,textarea,select,[contenteditable=true]"))) {
      event.preventDefault(); engine.finishCrop(); canvas.current?.focus(); return;
    }
    if (event.target instanceof HTMLTextAreaElement && event.target.hasAttribute("data-figcraft-text-input") &&
      !event.nativeEvent.isComposing && !event.altKey && (event.ctrlKey || event.metaKey) &&
      (event.code==="KeyK" && !event.shiftKey || event.code==="KeyU" && event.shiftKey)) {
      event.preventDefault(); linkDialog.current?.showModal(); return;
    }
    if (event.key.toLowerCase() === "v") modifiedPaste.current = (event.ctrlKey || event.metaKey) && (event.shiftKey || event.altKey);
    if (event.target instanceof HTMLElement && event.target.closest("input,textarea,select,dialog,[contenteditable=true]")) return;
    const formatting = textShortcut(event,false);
    if (formatting && snapshot.selection.some(id=>subtreeIds(snapshot.document,id).some(child=>snapshot.document.nodes[child].kind==="text"))) {
      event.preventDefault(); dispatch(formatting); return;
    }
    if ((event.key === "Enter" || event.key === " ") && event.target instanceof HTMLElement && event.target.closest("button,summary,a[href]")) return;
    let command: string | undefined;
    if (engine.pen.open && !event.altKey && !event.metaKey && !event.ctrlKey && (event.key === "Escape" || event.key === "Enter")) {
      event.preventDefault(); engine.pen.finish(event.key === "Escape" ? "pen" : "move"); return;
    }
    if (snapshot.tool === "shapeBuilder" && (event.key === "Escape" || event.key === "Enter")) {
      event.preventDefault(); dispatch("tool.move"); return;
    }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && (event.key === "Delete" || event.key === "Backspace")) {
      const target = engine.pickedGradient();
      if (target) {
        event.preventDefault();
        const { paint, picker } = target;
        if (paint.stops.length > 2) {
          const index = Math.min(picker.stop, paint.stops.length-1);
          dispatch(picker.list+".set", {id:target.node.id,index:picker.index,paint:{...paint,stops:paint.stops.filter((_,i)=>i!==index)}});
          engine.setPaintPicker({...picker,stop:Math.max(0,index-1)});
        }
        return;
      }
    }
    if (engine.getVectorEdit()) {
      const modified = event.metaKey || event.ctrlKey;
      if (!event.altKey && !modified && (event.key === "Escape" || event.key === "Enter")) {
        event.preventDefault(); const state = engine.getVectorEdit()!;
        if (event.key === "Enter" && state.tool === "pen") dispatch("vector.edit.tool", { tool: "move" });
        else dispatch(state.anchor !== undefined ? "vector.edit.penEnd" : "vector.edit.end");
        return;
      }
      if (!event.altKey && !modified && event.key.toLowerCase() === "b") { event.preventDefault(); dispatch("vector.edit.tool", { tool: "paint" }); return; }
      if (!event.altKey && !modified) {
        const key = event.key.toLowerCase();
        const tool = event.shiftKey ? (key === "e" ? "eraser" : undefined) : key === "q" ? "lasso" : key === "x" ? "cut" : undefined;
        if (tool) { event.preventDefault(); dispatch("vector.edit.tool", { tool }); return; }
      }
      if (!event.altKey && event.shiftKey && !modified && event.key.toLowerCase() === "w") { event.preventDefault(); dispatch("vector.edit.tool", { tool: "width" }); return; }
      if (!event.altKey && !event.shiftKey && !modified && event.key.toLowerCase() === "p") { event.preventDefault(); dispatch("vector.edit.tool", { tool: "pen" }); return; }
      if (!event.altKey && !modified && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        const amount = event.shiftKey ? 10 : 1; event.preventDefault();
        dispatch("vector.edit.nudge", { dx: event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0, dy: event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0 }); return;
      }
      if (!event.altKey && !modified && (event.key === "Delete" || event.key === "Backspace")) { event.preventDefault();
        const state = engine.getVectorEdit()!;
        if (!event.shiftKey && state.tool === "width") {
          if (state.widthPoint !== undefined) dispatch("vector.edit.widthPoint", { action: "remove", index: state.widthPoint });
        } else dispatch(event.shiftKey ? "vector.deleteHeal" : "vector.edit.delete");
        return; }
      if (!event.altKey && !event.shiftKey && modified && event.key.toLowerCase() === "a") { event.preventDefault(); dispatch("vector.edit.selectAll"); return; }
      if (!event.altKey && !event.shiftKey && !modified && event.key.toLowerCase() === "v") { event.preventDefault(); dispatch("vector.edit.tool", { tool: "move" }); return; }
    } else if (event.key === "Enter" && snapshot.selection.length && snapshot.selection.every(id => { const n = snapshot.document.nodes[id]; return n && isLeaf(n); })) {
      event.preventDefault(); dispatch("vector.edit.begin"); return;
    }
    if (event.code === "KeyM" && event.ctrlKey && !event.shiftKey && snapshot.selection.length) {
      const mac = /Mac|iPhone|iPad/.test(navigator.platform);
      if (mac ? event.metaKey && !event.altKey : event.altKey && !event.metaKey) command = "object.mask";
    }
    if (!event.metaKey && !event.ctrlKey && event.altKey && event.code === "KeyR") command = "transform.rotationOrigin";
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save(); return; }
    if ((event.metaKey || event.ctrlKey) && event.altKey && !event.shiftKey && event.code === "KeyO") {
      event.preventDefault(); dispatch("vector.outlineStroke"); return;
    }
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
      event.preventDefault(); imageInput.current?.click(); return;
    }
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "o") { event.preventDefault(); fileInput.current?.click(); return; }
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "j") command = event.shiftKey ? "vector.smoothJoin" : "vector.join";
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") command = "select.all";
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g") command = event.shiftKey ? "object.ungroup" : "object.group";
    if (!event.metaKey && !event.ctrlKey && event.altKey && event.shiftKey && event.code === "KeyF" || (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "e") command = "vector.flatten";
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "d") command = "edit.duplicate";
    if (event.key === "Delete" || event.key === "Backspace") command = "edit.delete";
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") command = event.shiftKey ? "edit.redo" : "edit.undo";
    else if (!event.metaKey && !event.ctrlKey && !event.altKey) {
      if (event.key.toLowerCase() === "o") command = "tool.ellipse";
      if (event.key.toLowerCase() === "l") command = event.shiftKey ? "tool.arrow" : "tool.line";
      if (event.key.toLowerCase() === "t") command = "tool.text";
      if (event.key.toLowerCase() === "r") command = "tool.rectangle";
      if (event.shiftKey && event.key.toLowerCase() === "m") command = "tool.shapeBuilder";
      if (event.key.toLowerCase() === "p") command = event.shiftKey ? "tool.pencil" : "tool.pen";
      if (event.target instanceof HTMLTextAreaElement && event.target.hasAttribute("data-figcraft-text-input") &&
      !event.nativeEvent.isComposing && !event.altKey && (event.ctrlKey || event.metaKey) &&
      (event.code==="KeyK" && !event.shiftKey || event.code==="KeyU" && event.shiftKey)) {
      event.preventDefault(); linkDialog.current?.showModal(); return;
    }
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
    const kind = submitter?.value ?? "rectangle";
    dispatch(kind === "frame" ? "frame.create" : `shape.${kind}`, { ...Object.fromEntries(["x", "y", "width", "height"].map(name => [name, Number(data.get(name))])), parent: String(data.get("parent")) });
  }
  function pagePoint(x: number, y: number) {
    const bounds = canvas.current!.getBoundingClientRect();
    return screenToPage(engine.getView(), {x:x-bounds.left,y:y-bounds.top});
  }
  function positionCanvasMenu() {
    const menu=pasteMenu.current;
    if (!menu?.matches(":popover-open")) return;
    const bounds=menu.getBoundingClientRect(), {x,y}=menuOrigin.current;
    menu.style.left=Math.max(0,Math.min(x,window.innerWidth-bounds.width))+"px";
    menu.style.top=Math.max(0,Math.min(y,window.innerHeight-bounds.height))+"px";
  }
  function requestOpen(file:File) {
    if (snapshot.dirty && Object.keys(snapshot.document.nodes).length > snapshot.document.pages.length) setPendingFile(file);
    else void open(file);
  }
  async function drop(files:File[], point:Point, usePicker:boolean) {
    const documents = files.filter(file=>/\.(?:figcraft|json)$/i.test(file.name));
    if (documents.length) {
      if (files.length === 1) requestOpen(documents[0]);
      else setError("Open each drawing separately in this workspace.");
      return;
    }
    controller.current?.cancel(); setBusy(true); setError("");
    try { setError((await engine.dropImages(files,point,usePicker ? snapshot.paintPicker : undefined)).join("\n")); }
    catch (e) { setError(e instanceof Error ? e.message : "File drop failed"); }
    finally {setBusy(false);}
  }
  async function paste(file?:File, point?:Point) {
    const document = engine.getSnapshot().document;
    controller.current?.cancel(); setBusy(true); setError("");
    try {
      if (!file) {
        if (!navigator.clipboard?.read) throw new Error("Use the browser’s Paste command to paste an image");
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const type = item.types.includes("image/png") ? "image/png" : item.types.find(type=>type.startsWith("image/"));
          if (type) {file = new File([await item.getType(type)],"Pasted image",{type});break;}
        }
        if (!file) throw new Error("The clipboard contains no image");
      }
      if (document !== engine.getSnapshot().document) throw new Error("Paste was cancelled because the drawing changed");
      await engine.pasteImage(file,point);
    } catch (e) {setError(e instanceof Error ? e.message : "Image paste failed");}
    finally {setBusy(false);}
  }
  async function place(file: File) {
    controller.current?.cancel(); setBusy(true); setError("");
    try {
      await engine.placeFile(file);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Image could not be placed"); }
    finally { setBusy(false); }
  }
  async function open(file: File) {
    controller.current?.cancel(); setPendingFile(null); setBusy(true); setError("");
    try {
      const { repairs } = await engine.openFile(file);
      if (repairs.length) setError(repairs.join("\n"));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "File could not be opened"); }
    finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setError("");
    try {
      engine.pen.finish(); controller.current?.cancel();
      const result = await engine.saveFile();
      const url = URL.createObjectURL(result.data);
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
  const canCrop = editable && snapshot.selection.length === 1 && selected && selected.kind !== "page" && topImageFill(selected)!==undefined;
  const relative = selected && selected.kind !== "page" ? frameRelative(snapshot.document, selected.id) : undefined;
  return <div ref={root} className="figcraft-editor" onKeyDown={key} data-figcraft-editor=""
    onKeyUp={e=>{if (e.key.toLowerCase()==="v") modifiedPaste.current=false;}} onBlurCapture={()=>{modifiedPaste.current=false;}}
    onDragOver={e=>{if (e.dataTransfer.types.includes("Files")) e.preventDefault();}}
    onDrop={e=>{
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      if (!editable || busy || pendingFile || !canvas.current) return;
      const well = e.target instanceof Element && !!e.target.closest("[data-figcraft-image-drop-target]");
      void drop(Array.from(e.dataTransfer.files),pagePoint(e.clientX,e.clientY),well);
    }}
    onPaste={e=>{
      if (!editable || busy || pendingFile || modifiedPaste.current || e.clipboardData.getData("text/plain")) return;
      if (e.target instanceof Element && e.target.closest("input,textarea,select,dialog,[contenteditable]:not([contenteditable=false])")) return;
      const file = Array.from(e.clipboardData.files).find(file=>file.type.startsWith("image/"));
      if (file) { e.preventDefault(); void paste(file); }
    }}>
      <header className="figcraft-document-bar"><h1>{snapshot.document.name}</h1><span>{snapshot.dirty ? "Unsaved" : "Downloaded"} · Local document</span>
        <details><summary>File</summary><button disabled={!editable || busy} type="button" onClick={event => {
          event.currentTarget.closest("details")?.removeAttribute("open"); dispatch("file.colorProfile");
        }}>Color profile</button></details>
        <ViewMenu engine={engine} editable={editable && !busy} dispatch={dispatch} />
        <details><summary>Object</summary><button disabled={!canCrop || busy} type="button" onClick={e=>{
          e.currentTarget.closest("details")?.removeAttribute("open");dispatch("image.crop");canvas.current?.focus();
        }}>Crop image</button></details>
        <button disabled={!editable || busy} onClick={() => fileInput.current?.click()}>Open</button>
        <button disabled={!editable || busy} onClick={() => imageInput.current?.click()}>Place image</button>
        <input ref={imageInput} aria-label="Place image file" type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff" hidden onChange={event => {
          const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
          if (file) void place(file);
        }} />
        <button disabled={!editable || busy} onClick={() => void save()}>Save as</button>
        <input ref={fileInput} aria-label="Open Figcraft file" type="file" accept=".figcraft,.json,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff" hidden onChange={event => {
          const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
          if (!file) return;
          requestOpen(file);
        }} />
        <HistoryButtons engine={engine} editable={editable} undo={snapshot.canUndo} redo={snapshot.canRedo} dispatch={dispatch} />
        <details className="figcraft-mobile-pages"><summary>Pages</summary>
          <PagePanel document={snapshot.document} editable={editable && !busy} dispatch={dispatch} />
        </details>
        <details className="figcraft-mobile-layers" onToggle={event => setMobileLayersOpen(event.currentTarget.open)}><summary>Layers</summary>
          {mobileLayersOpen && <LayerPanel document={snapshot.document} selection={snapshot.selection} editable={editable && !busy} dispatch={dispatch} />}
        </details>
      </header>
      {!signedIn && <p role="status">Sign in to edit this document.</p>}
      {error && <p role="alert">{error}</p>}
      {recoveryError && <p role="alert">{recoveryStatus === "error" ? "Recovery unavailable" : "Recovery notice"}: {recoveryError}</p>}
      {snapshot.missingFonts && editable && <dialog ref={missingFontsDialog} aria-label="Missing fonts" onCancel={()=>engine.closeMissingFonts()}>
        <h2>Missing fonts</h2>
        {snapshot.missingFonts.length ? <>
          <p>Text using these families is drawn in a fallback font.</p>
          <ul>{snapshot.missingFonts.map(({family,layers})=><li key={family}>{family} · {layers} {layers===1 ? "layer" : "layers"}</li>)}</ul>
        </> : <p>All the fonts this file uses are installed.</p>}
        <button type="button" onClick={()=>engine.closeMissingFonts()}>Close</button>
      </dialog>}
      {snapshot.profileDialog && editable && <ColourProfileDialog current={snapshot.document.colourProfile ?? "srgb"}
        close={() => engine.closeProfileDialog()} apply={(profile, convert) => dispatch("file.colorProfile", {profile, convert})} />}
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
          <div ref={pasteMenu} popover="auto" role="group" aria-label="Canvas actions" onToggle={positionCanvasMenu}
            style={{position:"fixed",inset:"auto",margin:0,maxHeight:"95dvh",maxWidth:"95vw",overflow:"auto"}}>
            {pointLayers.length>0 && <details onToggle={positionCanvasMenu}><summary>Select layer</summary>
              <div role="group" aria-label="Layers at point">{pointLayers.map(layer=><button key={layer.id}
                style={{display:"block",paddingInlineStart:8+12*Math.min(8,layer.depth)}} aria-pressed={snapshot.selection.includes(String(layer.id))}
                onClick={()=>{pasteMenu.current?.hidePopover();dispatch("select.set",{ids:[layer.id]});canvas.current?.focus();}}>
                {layer.name || layer.type.toLowerCase()}
              </button>)}</div>
            </details>}
            {canCrop && <button onClick={()=>{pasteMenu.current?.hidePopover();dispatch("image.crop");canvas.current?.focus();}}>Crop image</button>}
            <button onClick={()=>{pasteMenu.current?.hidePopover();canvas.current?.focus();void paste(undefined,pasteAt.current);}}>Paste here</button>
          </div>
          <canvas ref={canvas} onContextMenu={event=>{
            // Chromium on macOS can emit contextmenu for the primary Control-drag used to resize.
            if (event.ctrlKey || engine.interacting) {event.preventDefault();return;}
            if (!editable || busy || !pasteMenu.current) return;
            event.preventDefault();
            const menu = pasteMenu.current;
            pasteAt.current = pagePoint(event.clientX,event.clientY);
            const target=hitRectangle(snapshot.document,pasteAt.current,event.metaKey,snapshot.selection,2/engine.getView().zoom);
            if (target && !snapshot.selection.includes(target)) dispatch("select.set",{ids:[target]});
            setPointLayers(engine.execute("select.layersAt",pasteAt.current).layers.slice(0,40));
            const submenu=menu.querySelector("details");
            if (submenu) submenu.open=false;
            menuOrigin.current={x:event.clientX,y:event.clientY};
            menu.showPopover();
            positionCanvasMenu();
            menu.querySelector<HTMLElement>("summary,button")?.focus();
          }} aria-label="Design canvas" tabIndex={0} aria-describedby="canvas-instructions" />
          <ViewControls engine={engine} editable={editable && !busy} dispatch={dispatch} />
          <p id="canvas-instructions" className="figcraft-instructions">R: rectangle · O: ellipse · Space/middle drag: pan · Z: zoom · Ctrl/⌘ wheel: zoom · Escape: cancel</p>
          {snapshot.tool === "shapeBuilder" ? <div className="figcraft-toolbar" role="toolbar" aria-label="Shape Builder">
            {(["merge", "remove"] as const).map(mode => <button key={mode} disabled={!editable || busy} aria-pressed={snapshot.builderMode === mode} onClick={() => { dispatch("shapeBuilder.mode", {mode}); canvas.current?.focus(); }}>{mode === "merge" ? "Merge regions" : "Remove regions"}</button>)}
            <span>{!availableBuilderArrangement(snapshot.document, snapshot.selection)?.regions.length ? "Select overlapping shapes" : snapshot.builderMode === "merge" ? "Click or drag to merge · Alt removes" : "Click or drag to remove · Alt merges"}</span>
            <button disabled={!editable || busy} onClick={() => { dispatch("tool.move"); canvas.current?.focus(); }}>Done</button>
          </div> : editingVector ? <VectorToolbar engine={engine} editable={editable && !busy} dispatch={(command, params) => { dispatch(command, params); canvas.current?.focus(); }} /> : <div className="figcraft-toolbar" role="toolbar" aria-label="Tools">
            <button disabled={!editable} aria-pressed={snapshot.tool === "move"} onClick={() => { dispatch("tool.move"); canvas.current?.focus(); }}>Move</button>
            <button disabled={!editable} aria-pressed={snapshot.tool === "text"} title="Text · T" onClick={() => { dispatch("tool.text"); canvas.current?.focus(); }}>Text</button>
            <button disabled={!editable} aria-pressed={snapshot.tool === "pen"} title="Pen · P" onClick={() => { dispatch("tool.pen"); canvas.current?.focus(); }}>Pen</button>
            <button disabled={!editable} aria-pressed={snapshot.tool === "pencil"} title="Pencil · Shift+P" onClick={() => { dispatch("tool.pencil"); canvas.current?.focus(); }}>Pencil</button>
            <button disabled={!editable} aria-pressed={snapshot.tool === "scale"} onClick={() => { dispatch("tool.scale"); canvas.current?.focus(); }}>Scale</button>
            <button disabled={!editable} aria-pressed={snapshot.tool === "ellipse"} onClick={() => { dispatch("tool.ellipse"); canvas.current?.focus(); }}>Ellipse</button>
            <button disabled={!editable} aria-pressed={snapshot.tool === "polygon"} onClick={() => { dispatch("tool.polygon"); canvas.current?.focus(); }}>Polygon</button>
            <button disabled={!editable} aria-pressed={snapshot.tool === "star"} onClick={() => { dispatch("tool.star"); canvas.current?.focus(); }}>Star</button>
            <button disabled={!editable} aria-pressed={snapshot.tool === "line"} onClick={() => { dispatch("tool.line"); canvas.current?.focus(); }}>Line</button>
            <button disabled={!editable} aria-pressed={snapshot.tool === "arrow"} onClick={() => { dispatch("tool.arrow"); canvas.current?.focus(); }}>Arrow</button>
            <button disabled={!editable} aria-pressed={snapshot.tool === "rectangle"} onClick={() => { dispatch("tool.rectangle"); canvas.current?.focus(); }}>Rectangle</button>
            <button disabled={!editable || busy} title="Shape Builder · Shift+M" onClick={() => { dispatch("tool.shapeBuilder"); canvas.current?.focus(); }}>Shape Builder</button>
          </div>}
        </div>
        <aside className="figcraft-properties" aria-label="Design"><div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}><h2>Design</h2>
          {!editingVector && snapshot.selection.length > 0 && <BooleanMenu document={snapshot.document} selection={snapshot.selection} editable={editable && !busy} dispatch={dispatch} />}</div>
          <VectorPanel engine={engine} editable={editable && !busy} dispatch={dispatch} />
          <div hidden={editingVector}>
          <form key={page.id} onSubmit={create}><fieldset disabled={!editable}><legend>Create layer</legend>
            {(["x", "y", "width", "height"] as const).map(name => <label key={name}>{name === "width" ? "Width" : name === "height" ? "Height" : name.toUpperCase()}<input name={name} type="number" step="any" required defaultValue={name === "x" || name === "y" ? 40 : 100} /></label>)}
            <label>Create in<select aria-label="Create in" name="parent" defaultValue={page.id}>
              {Object.values(snapshot.document.nodes).filter(node => !isLeaf(node) && pageForNode(snapshot.document, node.id) === page.id).map(node => <option key={node.id} value={node.id}>{node.name}</option>)}
            </select></label>
            <button type="submit" value="rectangle">Create rectangle</button>
            <button type="submit" value="ellipse">Create ellipse</button>
            <button type="submit" value="polygon">Create polygon</button>
            <button type="submit" value="star">Create star</button>
            <button type="submit" value="line">Create line</button>
            <button type="submit" value="arrow">Create arrow</button>
            <button type="submit" value="frame">Create frame</button>
          </fieldset></form>
          <details><summary>Frame presets</summary><form onSubmit={event => {
            event.preventDefault(); const data = new FormData(event.currentTarget);
            dispatch("frame.create", { preset: data.get("preset") });
          }}><label>Preset<select aria-label="Frame preset" name="preset" disabled={!editable}>
            {framePresets.map(preset => <option key={preset.name} value={preset.name}>{preset.category}: {preset.name}</option>)}
          </select></label><button type="submit" disabled={!editable}>Create preset frame</button></form></details>
          </div>
          {recoveryStore && <p className="figcraft-recovery" role="status">{recoveryStatus === "loading" ? "Restoring local recovery…" : recoveryStatus === "stored" ? "Recovery saved on this device" : recoveryStatus === "pending" ? "Saving recovery…" : recoveryStatus === "error" ? "Recovery failed" : "Local recovery ready"}</p>}
          {!editingVector && selected && selected.kind !== "page" && relative && <section aria-label={`Selected ${selected.kind}`}><h3>{selected.name}</h3>
          {snapshot.selection.every(id => { const n = snapshot.document.nodes[id]; return n && isLeaf(n); }) && <button disabled={!editable || busy} onClick={() => { dispatch("vector.edit.begin"); canvas.current?.focus(); }}>Edit vector</button>}
          <dl>
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
          {!editingVector && <><ArrangePanel document={snapshot.document} selection={snapshot.selection} editable={editable && !busy} dispatch={dispatch} />
          <SmartSelectionPanel engine={engine} enabled={editable && !busy} dispatch={dispatch} onError={setError} />
          {snapshot.tool === "scale" ? <ScalePanel engine={engine} enabled={editable && !busy} dispatch={dispatch} onError={setError} /> : <SizePanel enabled={editable && !busy && snapshot.selection.length > 0} dispatch={dispatch} />}
          <RotationPanel engine={engine} enabled={editable && !busy && snapshot.selection.length > 0} dispatch={dispatch} />
          <ArcPanel nodes={snapshot.selection.flatMap(id => { const n = snapshot.document.nodes[id]; return n && n.kind !== "page" ? [n] : []; })} editable={editable && !busy} dispatch={dispatch} />
          <PointsPanel nodes={snapshot.selection.flatMap(id => { const n = snapshot.document.nodes[id]; return n && n.kind !== "page" ? [n] : []; })} editable={editable && !busy} dispatch={dispatch} />
          <CornerPanel nodes={snapshot.selection.flatMap(id => { const n = snapshot.document.nodes[id]; return n && n.kind !== "page" ? [n] : []; })} editable={editable && !busy} dispatch={dispatch} /></>}
          {!editingVector && <TypographyPanel engine={engine} linkDialog={linkDialog} run={(command,params) => {
            try { engine.execute(command,params); } catch (e) { setError(e instanceof Error ? e.message : "Could not edit text path"); }
          }} link={(ids,url) => {
            try { engine.execute("text.link",{ids,url}); } catch (e) { setError(e instanceof Error ? e.message : "Could not create link"); }
          }} editable={editable && !busy} onLeave={() => controller.current?.finishText()}
            apply={(ids, props) => {
              try { if (!controller.current?.formatText(props)) dispatch("node.set", {ids, props}); }
              catch (e) { setError(e instanceof Error ? e.message : "Could not format text"); }
            }} />}
          <AppearancePanel engine={engine} page={page} selected={selected && selected.kind !== "page" ? selected : undefined} editable={editable && !busy} dispatch={dispatch} />
          <StrokePanel engine={engine} nodes={snapshot.selection.flatMap(id => { const n = snapshot.document.nodes[id]; return n && n.kind !== "page" ? [n] : []; })} editable={editable && !busy} dispatch={dispatch} />
          <EffectsPanel engine={engine} editable={editable && !busy} dispatch={dispatch} />
        </aside>
      </div>
    </div>;
}
