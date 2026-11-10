import { ImportReportPanel } from "./ImportReportPanel";
import { importNotice, readImportReport, type ImportReport } from "./engine/interchange/import-report";
import { droppedDesigns,type DroppedDesign } from "./rest-folder-drop";
import { looksLikeSvg } from "./engine/svg-import/xml";
import { ExportPanel } from "./ExportPanel";
import { layerExportJobs, type ExportJob } from "./engine/export-jobs";
import { VersionPanel } from "./VersionPanel";
import type { ReactNode } from "react";
import type { WorkspaceRecoveryState } from "./engine/workspace-recovery";
import { LibrarySourceNeeded, type EditorWorkspace } from "./engine/workspace";
import {componentRoot} from "./engine/library-component-source";
import type {PublishedLibrary} from "./engine/published-library";
import {LibraryVariablesContext,libraryCatalogues} from "./LibraryVariablesContext";
import {MAX_CACHED_LIBRARIES} from "./engine/library-links";
import { GeometryPanel } from "./GeometryPanel";
import { textShortcut } from "./engine/text-shortcuts";
import { subtreeIds } from "./engine/hierarchy";
import { ColourProfileDialog } from "./ColourProfileDialog";
import { ArcPanel } from "./ArcPanel";
import { TypographyPanel } from "./TypographyPanel";
import { PointsPanel } from "./PointsPanel";
import { VectorPanel, VectorToolbar } from "./VectorPanel";
import { StrokePanel } from "./StrokePanel";
import { isFrameLike, isLeaf } from "./engine/document";
import { CornerPanel } from "./CornerPanel";
import { ViewControls, ViewMenu } from "./ViewControls";
import { ArrangePanel } from "./ArrangePanel";
import { ScalePanel } from "./ScalePanel";
import { SizePanel } from "./SizePanel";
import { RotationPanel } from "./RotationPanel";
import { SmartSelectionPanel } from "./SmartSelectionPanel";
import { framePresets } from "./engine/frame-presets";
import { ChildLayoutPanel } from "./ChildLayoutPanel";
import { FrameLayoutPanel } from "./FrameLayoutPanel";
import { GridTrackPanel } from "./GridTrackPanel";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ClipboardEvent, type FormEvent, type KeyboardEvent } from "react";
import type { DocumentCapability } from "./backends/access";
import type { IdentityAdapter } from "./backends/identity";
import { hitRectangle, type layersAt } from "./engine/selection";
import { topImageFill } from "./engine/image-commands";
import { screenToPage, visibleTopFrames } from "./engine/viewport";
import type { Point } from "./engine/geometry";
import { CanvasController } from "./engine/canvas";
import { EditorEngine } from "./engine/editor";
import { availableBuilderArrangement } from "./engine/shape-builder";
import { pageOf } from "./engine/document";
import type { RecoveryStore } from "./backends/recovery";
import { RecoveryController } from "./engine/recovery";
import { AssetsPanel, componentDragType } from "./AssetsPanel";
import { PagePanel } from "./PagePanel";
import { EffectsPanel } from "./EffectsPanel";
import { LayoutGuidesPanel } from "./LayoutGuidesPanel";
import { VariableModesPanel } from "./VariableModesPanel";
import { VariablesPanel } from "./VariablesPanel";
import { SharedStylesPanel } from "./SharedStylesPanel";
import { ComponentPanel } from "./ComponentPanel";
import { InstancePanel } from "./InstancePanel";
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

async function writeClipboard(type:"text/plain"|"image/png",prepare:()=>Promise<Blob>) {
  if (navigator.clipboard?.write && typeof ClipboardItem!=="undefined") {
    // Reserve the browser's clipboard write inside the original user gesture.
    const blob=prepare();
    await Promise.all([blob,navigator.clipboard.write([new ClipboardItem({[type]:blob})])]);
  } else if (type==="text/plain" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(await (await prepare()).text());
  } else throw new Error("This browser cannot write the requested clipboard format.");
}

function HistoryButtons({ engine, editable, undo, redo, dispatch }: { engine: EditorEngine; editable: boolean; undo: boolean; redo: boolean; dispatch: (command: string) => void }) {
  const pen = useSyncExternalStore(engine.pen.subscribeHistory, engine.pen.getHistory, engine.pen.getHistory);
  return <><button disabled={!editable || (!undo && !(pen & 1))} onClick={() => dispatch("edit.undo")}>Undo</button>
    <button disabled={!editable || (!redo && !(pen & 2))} onClick={() => dispatch("edit.redo")}>Redo</button></>;
}
/** Embeddable local rectangle workflow. The host owns authentication and styling. */
export function Editor(props: EditorProps) { return <DocumentEditor {...props} />; }

export function DocumentEditor({ identity, capabilities, engine: suppliedEngine, recoveryStore, workspace, workspaceRecovery, fileMenu, onWorkspaceNotice, onReviewBranch, onImportReport }: EditorProps & {
  workspace?: EditorWorkspace;
  workspaceRecovery?: WorkspaceRecoveryState;
  fileMenu?: ReactNode;
  onWorkspaceNotice?: (message: string) => void;
  onImportReport?: (report: ImportReport, owner?: number) => void;
  onReviewBranch?: (id: string) => void;
}) {
  const [engine] = useState(() => suppliedEngine ?? new EditorEngine());
  useEffect(()=>engine.observeLocalFonts(),[engine]);
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  const editingVector = useSyncExternalStore(engine.subscribeVectorEdit, () => Boolean(engine.getVectorEdit()), () => Boolean(engine.getVectorEdit()));
  const [signedIn, setSignedIn] = useState(() => identity.getSnapshot().status === "authenticated");
  const [localReport, setLocalReport] = useState<ImportReport>();
  function showReport(report: ImportReport | undefined, owner?: number) {
    if (!report) return;
    if (onImportReport) onImportReport(report, owner);
    else setLocalReport(report);
  }
  const [error, setError] = useState("");
  const [localStatus, setRecoveryStatus] = useState(recoveryStore ? "loading" : "ready");
  const [localError, setRecoveryError] = useState("");
  const recoveryStatus = workspaceRecovery?.status ?? localStatus;
  const recoveryError = workspaceRecovery ? workspaceRecovery.message : localError;
  const [busy, setBusy] = useState(false);
  const [newVersionForm, setNewVersionForm] = useState<"new" | "branch">();
  const [openingTab, setOpeningTab] = useState(false);
  const [assetsOpen,setAssetsOpen] = useState(false);
  const [mobileAssetsOpen,setMobileAssetsOpen] = useState(false);
  const mobileAssets=useRef<HTMLDetailsElement>(null);
  useLayoutEffect(()=>{
    if (!snapshot.libraryPanel) return;
    const mobile=mobileAssets.current;
    if (mobile && mobile.getClientRects().length) mobile.open=true;
    else setAssetsOpen(true);
  },[snapshot.libraryPanel]);
  const draggedAsset = useRef<{id:string;library?:PublishedLibrary} | undefined>(undefined);
  const [mobileLayersOpen, setMobileLayersOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [sourceRequest, setSourceRequest] = useState<Record<string, unknown>>();
  const imageInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const linkDialog = useRef<HTMLDialogElement>(null);
  const missingFontsDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (snapshot.missingFonts) missingFontsDialog.current?.showModal(); }, [snapshot.missingFonts]);
  const [exportJobs,setExportJobs] = useState<ExportJob[]>([]);
  const exportLayerCount = new Set(exportJobs.map(job=>job.id)).size;
  const exportDialog = useRef<HTMLDialogElement>(null);
  const replaceDialog = useRef<HTMLDialogElement>(null);
  const initialPrincipal = useRef(identity.getSnapshot().principal?.id);
  const canvas = useRef<HTMLCanvasElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const controller = useRef<CanvasController | null>(null);
  const pasteMenu = useRef<HTMLDivElement>(null);
  const textTools = useRef<HTMLDivElement>(null);
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
      if (!authenticated) { setLocalReport(undefined); setError(""); }
      engine.setEditable(authenticated && capabilities.includes("document.edit"));
    };
    update();
    return identity.subscribe(update);
  }, [engine, identity, capabilities]);
  useEffect(() => {
    if (workspace || !recoveryStore || !initialPrincipal.current) return;
    const recovery = new RecoveryController(engine, recoveryStore, initialPrincipal.current, (status, message) => {
      setRecoveryStatus(status); setRecoveryError(message ?? "");
    });
    void recovery.start();
    const flush = () => { if (document.visibilityState === "hidden") void recovery.flush(); };
    document.addEventListener("visibilitychange", flush);
    return () => { document.removeEventListener("visibilitychange", flush); recovery.dispose(); };
  }, [engine, recoveryStore, workspace]);
  useEffect(() => {
    if (!canvas.current || recoveryStatus === "loading") return;
    const instance = new CanvasController(canvas.current, engine, setError);
    controller.current = instance;
    return () => { controller.current = null; instance.dispose(); };
  }, [engine, recoveryStatus === "loading"]);
  async function visitMain(params: Record<string, unknown>, file?: File) {
    try {
      setSourceRequest(undefined);
      const result = await workspace!.goToMain(params, file);
      onWorkspaceNotice?.(result.id === null ? "The main component is no longer in this file" : "");
    } catch (error) {
      if (error instanceof LibrarySourceNeeded) setSourceRequest(params);
      setError(error instanceof Error ? error.message : "Could not open the library source");
    }
  }
  function dispatch(command: string, params: unknown = {}) {
    const cancellingUndo = command === "edit.undo" && engine.interacting;
    setError("");
    try {
      if (engine.pen.open && (command === "edit.undo" || command === "edit.redo")) {
        controller.current?.cancel(true); engine.execute(command, params); return;
      }
      if (engine.pen.open && command.startsWith("tool.") && !["tool.pen", "tool.scaleAnchor", "tool.pencilBrush"].includes(command)) engine.pen.finish();
      const preserve = engine.pen.open && command === "tool.pen" || (engine.pen.open || engine.pencil.active) && (command.startsWith("view.") || command === "tool.scaleAnchor" || command === "tool.pencilBrush");
      if (!preserve && !((command.startsWith("style.") || command==="library.applyStyle") && engine.currentTextEdit())) controller.current?.cancel();
      if (cancellingUndo) return;
      if (command === "component.goToMain" && workspace) {
        void visitMain(params as Record<string, unknown>);
        return;
      }
      const result = engine.execute(command, params);
      if (Array.isArray(result?.warnings)) setError(result.warnings.join("\n"));
      return result;
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Command failed"); }
  }
  function key(event: KeyboardEvent) {
    if (!editable || busy) return;
    if (snapshot.crop && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && (event.key==="Escape" || event.key==="Enter") && !(event.target instanceof Element && event.target.closest("input,textarea,select,[contenteditable=true]"))) {
      event.preventDefault(); engine.finishCrop(); canvas.current?.focus(); return;
    }
    if (event.target instanceof HTMLTextAreaElement && event.target.hasAttribute("data-figcraft-text-input") &&
      !event.nativeEvent.isComposing && !event.altKey && (event.ctrlKey || event.metaKey)) {
      if (event.code==="KeyS" && !event.shiftKey) { event.preventDefault(); void save(); return; }
      if (event.code==="KeyK" && !event.shiftKey || event.code==="KeyU" && event.shiftKey) {
        event.preventDefault(); linkDialog.current?.showModal(); return;
      }
    }
    if (event.key.toLowerCase() === "s" && (event.ctrlKey || event.metaKey) && !event.altKey &&
        event.target instanceof HTMLInputElement && event.target.hasAttribute("data-figcraft-number")) {
      event.preventDefault();
      event.target.blur();
      void save();
      return;
    }
    if (event.key.toLowerCase() === "v") modifiedPaste.current = (event.ctrlKey || event.metaKey) && (event.shiftKey || event.altKey);
    if (event.target instanceof HTMLElement && event.target.closest("input,textarea,select,dialog,[contenteditable=true]")) return;
    if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.code==="Digit3") {
      event.preventDefault();dispatch("libraries.open");return;
    }
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
    if (event.shiftKey && event.code === "KeyA" && !event.metaKey && snapshot.selection.length) {
      const mac = /Mac|iPhone|iPad/.test(navigator.platform);
      if (event.ctrlKey && event.altKey !== mac) { event.preventDefault(); dispatch("layout.suggest"); return; }
      if (!event.ctrlKey) { event.preventDefault(); dispatch(event.altKey ? "layout.remove" : "layout.add"); return; }
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") command = "select.all";
    if ((event.metaKey || event.ctrlKey) && event.altKey && !event.shiftKey && event.code === "KeyB") command = "component.detach";
    if ((event.metaKey || event.ctrlKey) && event.altKey && !event.shiftKey && event.code === "KeyK") command = "component.create";
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g") command = event.shiftKey ? "object.ungroup" : "object.group";
    const macGrid = /Mac|iPhone|iPad/.test(navigator.platform);
    if (!event.altKey && !event.metaKey && (event.code === "KeyG" && event.shiftKey && !event.ctrlKey ||
        macGrid && event.code === "KeyG" && event.ctrlKey && !event.shiftKey ||
        !macGrid && event.code === "Digit4" && event.ctrlKey && event.shiftKey)) command = "view.layoutGrids";
    if (!event.metaKey && !event.ctrlKey && event.altKey && event.shiftKey && event.code === "KeyF" || (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "e") command = "vector.flatten";
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "d") command = "edit.duplicate";
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.code==="KeyC") {
      event.preventDefault(); copyAs("png",event.isTrusted); return;
    }
    if ((event.metaKey || event.ctrlKey) && event.altKey && !event.shiftKey) {
      if (event.code === "KeyC") command = "edit.copyProperties";
      if (event.code === "KeyV") command = "edit.pasteProperties";
    }
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && engine.hasCopiedLayers()) {
      if (event.code === "KeyV") command = "edit.pasteOver";
      if (event.code === "KeyR") command = "edit.pasteReplace";
    }
    if (event.key === "Delete" || event.key === "Backspace") command = "edit.delete";
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") command = event.shiftKey ? "edit.redo" : "edit.undo";
    else if (!event.metaKey && !event.ctrlKey && !event.altKey) {
      if (event.key.toLowerCase() === "s") command = event.shiftKey ? "tool.section" : "tool.slice";
      if (event.key.toLowerCase() === "o") command = "tool.ellipse";
      if (event.key.toLowerCase() === "l") command = event.shiftKey ? "tool.arrow" : "tool.line";
      if (event.key.toLowerCase() === "t") command = "tool.text";
      if (event.key.toLowerCase() === "r") command = "tool.rectangle";
      if (event.shiftKey && event.key.toLowerCase() === "m") command = "tool.shapeBuilder";
      if (event.key.toLowerCase() === "p") command = event.shiftKey ? "tool.pencil" : "tool.pen";
      if (event.target instanceof HTMLTextAreaElement && event.target.hasAttribute("data-figcraft-text-input") &&
      !event.nativeEvent.isComposing && !event.altKey && (event.ctrlKey || event.metaKey)) {
      if (event.code==="KeyS" && !event.shiftKey) { event.preventDefault(); void save(); return; }
      if (event.code==="KeyK" && !event.shiftKey || event.code==="KeyU" && event.shiftKey) {
        event.preventDefault(); linkDialog.current?.showModal(); return;
      }
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
    if (!workspace && snapshot.dirty && Object.keys(snapshot.document.nodes).length > snapshot.document.pages.length) setPendingFile(file);
    else void open(file);
  }
  async function drop(input:File[]|Promise<DroppedDesign[]>, point?:Point, usePicker=false) {
    controller.current?.cancel(); setBusy(true); setError("");
    try {
      const batch=Array.isArray(input) ? input.map((file):DroppedDesign=>({file})) : await input;
      const folders=new Map(batch.flatMap(d=>d.folder ? [[d.file,d.folder] as const] : []));
      setError((await engine.dropImages(batch.map(d=>d.file),point,usePicker ? snapshot.paintPicker : undefined,folders,
        (file, result) => {
          showReport(readImportReport("file.import", file.name, result));
          return Array.isArray(result.warnings) ? importNotice(file.name, result.warnings) : "";
        })).join("\n"));
    }
    catch (e) { setError(e instanceof Error ? e.message : "File drop failed"); }
    finally {setBusy(false);}
  }
  function copyLayers(command:"edit.copy"|"edit.cut",event?:ClipboardEvent,trusted=event?.isTrusted) {
    if (!canCopyLayers || command==="edit.cut" && !editable) return;
    if (event?.target instanceof Element && event.target.closest("input,textarea,select,dialog,[contenteditable]:not([contenteditable=false])")) return;
    const selected=snapshot.selection.map(id=>snapshot.document.nodes[id]);
    const text=selected.every(node=>node.kind==="text") && selected.map(node=>node.text.characters).join("\n");
    if (!dispatch(command) || !trusted) return;
    const fallback=text || "figcraft://clipboard/"+selected.length;
    const mirrored=engine.trackLayerClipboardMirror(fallback);
    if (event) {
      event.preventDefault();
      event.clipboardData.setData("text/plain",fallback);
      if (text) return;
    }
    let exported=fallback;
    void writeClipboard("text/plain",async()=>{
      exported=text || await engine.prepareLayerClipboardMirror(fallback);
      return new Blob([exported],{type:"text/plain"});
    }).then(()=>mirrored(exported))
      .catch(()=>setError("Layers copied in Figcraft. The browser could not write the system clipboard."));
  }

  function copyAs(format:"svg"|"png",trusted:boolean) {
    if (!trusted || !canCopyLayers) return;
    const type=format==="png" ? "image/png" : "text/plain";
    setError("");
    void writeClipboard(type,async()=>{
      const {blob}=format === "png" ? await engine.exportRaster({format,colorProfile:"srgb",scale:2}, true) : await engine.exportGraphic({format});
      return format==="png" ? blob : blob.slice(0,blob.size,type);
    }).catch(error=>setError(error instanceof Error ? error.message : "Could not copy artwork"));
  }
  function copyAsMenu(context=false) {
    return <details onToggle={context ? positionCanvasMenu : undefined}><summary>Copy as</summary>
      {(["svg","png"] as const).map(format=><button type="button" key={format} disabled={!canCopyLayers} onClick={event=>{
        copyAs(format,event.isTrusted);
        event.currentTarget.closest("details")?.removeAttribute("open");
        if (context) pasteMenu.current?.hidePopover();
        else event.currentTarget.closest(".figcraft-bar-menu")?.removeAttribute("open");
        canvas.current?.focus();
      }}>Copy as {format.toUpperCase()}</button>)}
    </details>;
  }

  function pasteText(text: string, point?: Point) {
    if (engine.ownsLayerClipboardText(text)) { dispatch("edit.paste", point); return; }
    if (text.startsWith("figcraft://clipboard/")) return;
    if (looksLikeSvg(text)) {
      void paste(new File([text],"Pasted SVG.svg",{type:"image/svg+xml"}),point);
      return;
    }
    const view = engine.getView();
    controller.current?.cancel();
    void engine.executeAsync("text.create", { text, x: point?.x ?? view.cx, y: point?.y ?? view.cy })
      .catch(error => setError(error instanceof Error ? error.message : "Could not paste text"));
  }

  async function paste(file?:File, point?:Point, transfer?:{html:string;text:string;image?:File}) {
    const document = engine.getSnapshot().document;
    controller.current?.cancel(); setBusy(true); setError("");
    try {
      if (!file) {
        let items:ClipboardItems=[],html=transfer?.html ?? "",text=transfer?.text ?? "";
        if (!transfer) {
          if (!navigator.clipboard?.read) {
            if (engine.hasCopiedLayers()) { dispatch("edit.paste", point); return; }
            throw new Error("Use the browser’s Paste command");
          }
          try { items = await navigator.clipboard.read(); } catch (error) {
            if (document === engine.getSnapshot().document && engine.hasCopiedLayers()) { dispatch("edit.paste", point); return; }
            throw error;
          }
          const readText=async(type:string)=>{
            const item=items.find(item=>item.types.includes(type));
            return item ? (await item.getType(type)).text() : "";
          };
          html=await readText("text/html");
          text=await readText("text/plain");
        }
        if (document !== engine.getSnapshot().document) throw new Error("Paste was cancelled because the drawing changed");
        if (html.includes("(figma)")) {
          const result=await engine.pasteDesignLayers({html,...point});
          if (result) {
            showReport(readImportReport("edit.pasteDesignLayers", "", result));
            engine.trackLayerClipboardMirror(text);
            if (result.missingImages?.length) setError("Pasted design layers; the clipboard didn't carry the images of: "+result.missingImages.join(", "));
            else if (result.warnings?.length) {
              const count = result.warnings.length;
              setError("Pasted design layers; " + count + (count === 1 ? " kind of content was" : " kinds of content were") + " left out");
            }
            return;
          }
        }
        if (text && engine.ownsLayerClipboardText(text)) { pasteText(text, point); return; }
        if (looksLikeSvg(text)) file=new File([text],"Pasted SVG.svg",{type:"image/svg+xml"});
        file??=transfer?.image;
        for (const item of items) {
          if (file) break;
          const type = item.types.includes("image/svg+xml") ? "image/svg+xml" : item.types.includes("image/png") ? "image/png" : item.types.find(type=>type.startsWith("image/"));
          if (type) {file = new File([await item.getType(type)],"Pasted image",{type});break;}
        }
        if (!file && text) { pasteText(text, point); return; }
        if (!file && engine.hasCopiedLayers()) { dispatch("edit.paste", point); return; }
        if (!file && transfer) return;
        if (!file) throw new Error("The clipboard is empty");
      }
      if (document !== engine.getSnapshot().document) throw new Error("Paste was cancelled because the drawing changed");
      const result = await engine.pasteImage(file,point);
      showReport(readImportReport("file.import", file.name, result));
      if (Array.isArray(result?.warnings)) setError(importNotice(file.name, result.warnings));
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
    controller.current?.cancel(); setPendingFile(null); setBusy(true); setOpeningTab(!!workspace); setError("");
    try {
      if (workspace) {
        const result = await workspace.open(file);
        showReport(readImportReport("file.open", file.name, result), result.tabId);
        onWorkspaceNotice?.(importNotice(file.name, result.repairs, true));
      } else {
        const result = await engine.openFile(file);
        setLocalReport(readImportReport("file.open", file.name, result));
        setError(importNotice(file.name, result.repairs, true));
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "File could not be opened"); }
    finally { setBusy(false); setOpeningTab(false); }
  }
  function downloadBlob(blob: Blob, name: string) {
    const link = document.createElement("a"), url = URL.createObjectURL(blob);
    try {
      link.href = url; link.download = name;
      document.body.append(link); link.click();
    } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  async function exportLayers() {
    exportDialog.current?.close();
    setBusy(true); setError("");
    try {
      const {output,name,files} = await engine.prepareLayerExports({});
      if (output) downloadBlob(output,name);
      setError(files.flatMap(f=>(f.warnings ?? []).map(w=>files.length>1 ? f.name+": "+w : w)).join("\n"));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Export failed"); }
    finally { setBusy(false); }
  }
  async function exportDrawing(format: "penpot" | "fig" | "png" | "jpg" | "webp" | "svg" | "xml" | "pdf", scale: number, scope?: "page" | "frames") {
    exportDialog.current?.close();
    setBusy(true); setError("");
    try {
      const { document: design, selection } = engine.getSnapshot();
      const first = selection[0] ?? pageOf(design).children[0];
      const name = (format === "fig" || format === "penpot" || scope === "frames" ? design.name : scope === "page" ? pageOf(design).name : design.nodes[first]?.name ?? "Export") + (scale === 1 ? "" : "@" + scale + "x") + "." + format;
      const graphic = await engine.exportGraphic({ format, scale, ...(scope === "page" && {ids: pageOf(design).children}) },scope === "frames");
      downloadBlob(graphic.blob,name);
      if (graphic.warnings) setError(graphic.warnings.join("\n"));
    } catch (error) { setError(error instanceof Error ? error.message : "Export failed"); }
    finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setError("");
    try {
      engine.pen.finish();
      if (engine.currentTextEdit()) await controller.current?.flushTextForSave();
      else controller.current?.cancel();
      const result = workspace ? await workspace.prepareDownload() : await engine.saveFile();
      const url = URL.createObjectURL(result.data);
      try {
        const link = document.createElement("a"); link.href = url; link.download = String(result.name);
        document.body.append(link); link.click(); link.remove();
        if ("delivered" in result && typeof result.delivered === "function") result.delivered();
        else engine.execute("file.markSaved", { revision: result.revision });
      } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "File could not be saved"); }
    finally { setBusy(false); }
  }
  const canCopyLayers = signedIn && !busy && recoveryStatus !== "loading" && capabilities.includes("document.edit") && snapshot.selection.length > 0;
  const editable = signedIn && snapshot.editable && recoveryStatus !== "loading" && capabilities.includes("document.edit");
  const page = pageOf(snapshot.document);
  const selected = snapshot.document.nodes[snapshot.selection[0]];
  const canCrop = editable && snapshot.selection.length === 1 && selected && selected.kind !== "page" && topImageFill(selected)!==undefined;
  const relative = selected && selected.kind !== "page" ? frameRelative(snapshot.document, selected.id) : undefined;
  const endAssetDrag = () => {draggedAsset.current = undefined; controller.current?.previewAsset();};
  useEffect(()=>{
    const principal=initialPrincipal.current;
    if (!editable || !principal || !recoveryStore?.readLibrary) return;
    let active=true;
    async function restore() {
      for (const link of snapshot.document.libraryLinks?.slice(0,MAX_CACHED_LIBRARIES) ?? []) {
        if (!active) return;
        try {await engine.restoreLibrary(link,path=>recoveryStore!.readLibrary!(principal!,path));}
        catch (error) {if (active) setError(error instanceof Error ? error.message : "Could not restore local library");}
      }
    }
    void restore();
    return ()=>{active=false;};
  },[editable,engine,recoveryStore,snapshot.document.libraryLinks]);
  const libraryVariables=useMemo(()=>libraryCatalogues(snapshot.document.libraryLinks,snapshot.document.libraryRecords,path=>engine.librarySource(path)),
    [engine,engine.libraryRevision,snapshot.document.libraryLinks,snapshot.document.libraryRecords]);
  const publishableSelection=useMemo(()=>snapshot.selection.length>0 &&
    snapshot.selection.every(id=>componentRoot(snapshot.document,id)),[snapshot.document,snapshot.selection]);
  const assetsPanel = <AssetsPanel publish={snapshot.libraryPanel?.publish ?? false} key={engine.fileGeneration} save={save} doc={snapshot.document} editable={editable && !busy} dispatch={dispatch}
    source={path=>engine.librarySource(path)}
    addLibrary={async file=>{
      const principal=initialPrincipal.current;
      const result = await engine.pickLibrary(file,principal && recoveryStore?.writeLibrary ?
        (path,archive)=>recoveryStore.writeLibrary!(principal,path,archive) : undefined);
      if (typeof result.path === "string") workspace?.rememberLibrarySource(result.path, file);
    }}
    start={(id,e,library)=>{draggedAsset.current = {id,library}; e.dataTransfer.setData(componentDragType,id); e.dataTransfer.effectAllowed = "copy";}}
    end={endAssetDrag} place={(component,library)=>{
      const {cx:x,cy:y} = engine.getView();
      dispatch(library ? "library.place" : "instance.place",{component,x,y,...(library && {library})});
      const mobile = root.current?.querySelector<HTMLDetailsElement>(".figcraft-mobile-assets[open]");
      if (mobile) mobile.open = false;
      canvas.current?.focus();
    }}/>;
  return <LibraryVariablesContext.Provider value={libraryVariables}><div ref={root} className="figcraft-editor" inert={openingTab || undefined} aria-busy={openingTab || undefined} onKeyDown={key} data-figcraft-editor=""
    onKeyUp={e=>{if (e.key.toLowerCase()==="v") modifiedPaste.current=false;}} onBlurCapture={()=>{modifiedPaste.current=false;}}
    onDragOver={e=>{if (e.dataTransfer.types.includes("Files")) e.preventDefault();}}
    onDrop={e=>{
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      if (!editable || busy || pendingFile || !canvas.current) return;
      const well = e.target instanceof Element && !!e.target.closest("[data-figcraft-image-drop-target]");
      void drop(droppedDesigns(e.dataTransfer),pagePoint(e.clientX,e.clientY),well);
    }}
    onCopy={e => copyLayers("edit.copy", e)} onCut={e => copyLayers("edit.cut", e)}
    onPaste={e=>{
      if (!editable || busy || pendingFile || modifiedPaste.current) return;
      if (e.target instanceof Element && e.target.closest("input,textarea,select,dialog,[contenteditable]:not([contenteditable=false])")) return;
      const text = e.clipboardData.getData("text/plain") || e.clipboardData.getData("image/svg+xml");
      const html=e.clipboardData.getData("text/html");
      const image=Array.from(e.clipboardData.files).find(file=>file.type.startsWith("image/"));
      if (html.includes("(figma)") || text || image || !e.clipboardData.types.length && engine.hasCopiedLayers()) {
        e.preventDefault();
        void paste(undefined,undefined,{html,text,image});
      }
    }}>
      <header className="figcraft-document-bar"><h1>{snapshot.document.name}</h1><span>{snapshot.dirty ? "Unsaved" : snapshot.hasSaved ? "Downloaded" : "Unmodified"} · Local document</span>
        <details className="figcraft-bar-menu"><summary>File</summary><div className="figcraft-menu-items">{fileMenu}
          <button type="button" disabled={!editable || busy || recoveryStatus==="loading"} onClick={event=>{
            event.currentTarget.closest("details")?.removeAttribute("open");importInput.current?.click();
          }}>Import…</button>
          <button type="button" disabled={!signedIn || busy || recoveryStatus === "loading"} onClick={event => {
            event.currentTarget.closest("details")?.removeAttribute("open");
            setExportJobs(layerExportJobs(snapshot.document,snapshot.selection,{}).jobs); exportDialog.current?.showModal();
          }}>Export…</button>
          <button type="button" disabled={!signedIn || busy || recoveryStatus === "loading" || visibleTopFrames(snapshot.document,page.children).next().done} onClick={event => {
            event.currentTarget.closest("details")?.removeAttribute("open");
            void exportDrawing("pdf",1,"frames");
          }}>Export frames to PDF…</button>
          {(["Version history", "Save to version history…", ...(workspace && !workspace.onBranch ? ["Create branch…"] : [])]).map((label, index) => <button key={label} type="button"
            disabled={!signedIn || busy || recoveryStatus === "loading" || !capabilities.includes("document.edit")} onClick={event => {
              event.currentTarget.closest("details")?.removeAttribute("open"); setNewVersionForm(index === 2 ? "branch" : index === 1 ? "new" : undefined);
              dispatch("file.versionHistory");
            }}>{label}</button>)}
          <button disabled={!editable || busy} type="button" onClick={event => {
          event.currentTarget.closest("details")?.removeAttribute("open"); dispatch("file.colorProfile");
        }}>Color profile</button></div></details>
        <details className="figcraft-bar-menu"><summary>Edit</summary><div className="figcraft-menu-items">
          {([
            ["Cut", "edit.cut", editable && canCopyLayers],
            ["Copy", "edit.copy", canCopyLayers],
            ["Paste", "edit.paste", editable],
            ["Paste over selection", "edit.pasteOver", editable && engine.hasCopiedLayers()],
            ["Paste to replace", "edit.pasteReplace", editable && engine.hasCopiedLayers() && !!snapshot.selection.length],
            ["Copy properties", "edit.copyProperties", canCopyLayers],
            ["Paste properties", "edit.pasteProperties", editable && engine.hasCopiedProperties() && !!snapshot.selection.length],
          ] as const).map(([label, command, enabled]) =>
            <button key={command} type="button" disabled={busy || !enabled} onClick={event => {
              event.currentTarget.closest("details")?.removeAttribute("open");
              if (command === "edit.copy" || command === "edit.cut") copyLayers(command,undefined,event.isTrusted);
              else if (command === "edit.paste") void paste();
              else dispatch(command);
              canvas.current?.focus();
            }}>{label}</button>)}
          {copyAsMenu()}
        </div></details>
        <details><summary>Libraries</summary>
          {([["libraries.open","Open libraries"],["libraries.publish","Publish library…"]] as const).map(([command,label])=>
            <button key={command} type="button" disabled={!editable || busy} onClick={event=>{
              event.currentTarget.closest("details")?.removeAttribute("open");dispatch(command);
            }}>{label}</button>)}
          <button type="button" disabled={!editable || busy || !publishableSelection} onClick={event=>{
            event.currentTarget.closest("details")?.removeAttribute("open");dispatch("component.hideWhenPublishing");
          }}>Hide when publishing</button>
        </details>
        <ViewMenu engine={engine} editable={editable && !busy} dispatch={dispatch} />
        <details><summary>Object</summary><button type="button" disabled={!editable || busy || !selected || !isFrameLike(selected)}
          onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); dispatch("object.setThumbnail"); }}>Set as thumbnail</button>
          <button disabled={!canCrop || busy} type="button" onClick={e=>{
          e.currentTarget.closest("details")?.removeAttribute("open");dispatch("image.crop");canvas.current?.focus();
        }}>Crop image</button></details>
        <button disabled={!editable || busy} onClick={() => fileInput.current?.click()}>Open</button>
        <button disabled={!editable || busy} onClick={() => imageInput.current?.click()}>Place image</button>
        <input ref={imageInput} aria-label="Place image file" type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff" hidden onChange={event => {
          const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
          if (file) void place(file);
        }} />
        <button disabled={(!editable && !snapshot.previewVersionId) || !signedIn || busy} onClick={() => void save()}>Save as</button>
        <input ref={importInput} aria-label="Import into current document" type="file" accept=".figcraft,.fig,.jam,.sketch,.penpot,.json,.svg,.svgz,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff" hidden onChange={event=>{
          const file=event.currentTarget.files?.[0];event.currentTarget.value="";if (file) void drop([file]);
        }}/>
        <input ref={fileInput} aria-label="Open Figcraft file" type="file" accept=".figcraft,.fig,.jam,.sketch,.penpot,.json,.svg,.svgz,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff" hidden onChange={event => {
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
        <details ref={mobileAssets} className="figcraft-mobile-assets" onToggle={e=>{
          setMobileAssetsOpen(e.currentTarget.open);
          if (!e.currentTarget.open && e.currentTarget.getClientRects().length) engine.closeLibraryPanel();
        }}><summary>Assets</summary>
          {mobileAssetsOpen && assetsPanel}
        </details>
      </header>
      {!signedIn && <p role="status">Sign in to edit this document.</p>}
      {signedIn && localReport && <ImportReportPanel report={localReport} close={() => setLocalReport(undefined)} />}
      {error && <p role="alert">{error}</p>}
      {sourceRequest && <label>Choose library source<input type="file" accept=".figcraft" disabled={!editable} onChange={event => {
        const file = event.currentTarget.files?.[0];
        if (file) void visitMain(sourceRequest, file);
      }} /></label>}
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
      <dialog ref={exportDialog} aria-label="Export" onClose={()=>setExportJobs([])}>
        {exportJobs.length > 0 && <><p>With the layers’ export settings</p><ul>{exportJobs.slice(0,6).map(job=><li key={job.name}>{job.name}</li>)}</ul>
          {exportJobs.length > 6 && <p>and {exportJobs.length - 6} more</p>}
          <button type="button" onClick={()=>void exportLayers()}>Export {exportLayerCount} {exportLayerCount === 1 ? "layer" : "layers"}</button>
        </>}
        <p>{snapshot.selection.length || page.children.length} layers as one file</p>
        {([["png",1], ["png",2], ["png",3], ["jpg",2], ["webp",2]] as const).map(([format, scale]) =>
          <button type="button" key={format + scale} onClick={() => void exportDrawing(format, scale)}>{format.toUpperCase()} @{scale}x</button>)}
        <button type="button" onClick={()=>void exportDrawing("svg",1)}>SVG</button>
        <button type="button" onClick={()=>void exportDrawing("pdf",1)}>PDF</button>
        <button type="button" onClick={()=>void exportDrawing("xml",1)}>Android XML</button>
        <p>The whole file</p>
        <button type="button" onClick={()=>void exportDrawing("penpot",1)}>Penpot (.penpot)</button>
        <button type="button" onClick={()=>void exportDrawing("fig",1)}>.fig (experimental)</button>
        <p>Other apps may not open every .fig file exported here.</p>
        <button type="button" onClick={() => exportDialog.current?.close()}>Close</button>
      </dialog>
      <dialog ref={replaceDialog} aria-label="Replace unsaved document" onCancel={() => setPendingFile(null)}>
        <p>Open {pendingFile?.name} and replace the unsaved document?</p>
        <button onClick={() => setPendingFile(null)}>Cancel</button>
        <button onClick={() => { if (pendingFile) void open(pendingFile); }}>Replace document</button>
      </dialog>
      {workspace?.activeBranchId && !snapshot.previewVersionId && <div className="figcraft-branch-banner">
        <span>Branch of {workspace.branchOwner?.getSnapshot().document.name}</span>
        <button type="button" disabled={!editable || workspace.fileBranches.find(b => b.id === workspace.activeBranchId)?.state !== "active"}
          onClick={() => onReviewBranch?.(workspace.activeBranchId!)}>Review and merge</button>
      </div>}
      <div className="figcraft-workspace">
        {snapshot.versionPanel && signedIn ? <VersionPanel key={String(newVersionForm)} engine={engine} workspace={workspace} initialForm={newVersionForm} onReviewBranch={onReviewBranch} /> : <aside className="figcraft-layers" aria-label={assetsOpen ? "Assets browser" : "Layers"}>
          <div role="group" aria-label="Sidebar">
            <button type="button" aria-pressed={!assetsOpen} onClick={()=>{setAssetsOpen(false);engine.closeLibraryPanel();}}>Layers</button>
            <button type="button" aria-pressed={assetsOpen} onClick={()=>setAssetsOpen(true)}>Assets</button>
          </div>
          {assetsOpen ? assetsPanel : <>
          <PagePanel document={snapshot.document} editable={editable && !busy} dispatch={dispatch} />
          <LayerPanel document={snapshot.document} selection={snapshot.selection} editable={editable && !busy} dispatch={dispatch} />
          </>}
        </aside>}
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
            {canCopyLayers && copyAsMenu(true)}
            {canCrop && <button onClick={()=>{pasteMenu.current?.hidePopover();dispatch("image.crop");canvas.current?.focus();}}>Crop image</button>}
            {snapshot.selection.length > 0 && <>
              <button onClick={()=>{pasteMenu.current?.hidePopover();dispatch("layout.add");canvas.current?.focus();}}>Add auto layout</button>
              <button onClick={()=>{pasteMenu.current?.hidePopover();dispatch("layout.removeAll");canvas.current?.focus();}}>Remove all auto layout</button>
            </>}
            <button onClick={()=>{pasteMenu.current?.hidePopover();canvas.current?.focus();void paste(undefined,pasteAt.current);}}>Paste here</button>
          </div>
          <canvas ref={canvas} onDragOver={e=>{
            const asset = draggedAsset.current;
            if (!asset || !editable || busy || !e.dataTransfer.types.includes(componentDragType)) return;
            e.preventDefault(); e.dataTransfer.dropEffect = "copy";
            controller.current?.previewAsset(asset.id,pagePoint(e.clientX,e.clientY),e.altKey,asset.library?.document);
          }} onDragLeave={()=>controller.current?.previewAsset()} onDrop={e=>{
            const asset = draggedAsset.current;
            if (!asset || !editable || busy || !e.dataTransfer.types.includes(componentDragType)) return;
            e.preventDefault();
            const point = pagePoint(e.clientX,e.clientY);
            const swap = controller.current?.previewAsset(asset.id,point,e.altKey,asset.library?.document);
            endAssetDrag();
            const command=asset.library ? (swap ? "library.swapAt" : "library.place") : (swap ? "instance.swapAt" : "instance.place");
            dispatch(command,{component:asset.id,...point,...(asset.library && {library:asset.library.manifest.id})});
            e.currentTarget.focus();
          }} onContextMenu={event=>{
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
            <button disabled={!editable} aria-pressed={snapshot.tool === "text" || snapshot.tool === "textOnPath"}
              aria-haspopup="dialog" title="Text · T · Text tool options" onClick={event=>{
                const menu=textTools.current;
                if (!menu) return;
                const rect=event.currentTarget.getBoundingClientRect();
                menu.style.left=rect.left+"px";menu.style.bottom=(window.innerHeight-rect.top+6)+"px";
                dispatch("tool.text");
                if (menu.matches(":popover-open")) menu.hidePopover();
                else {menu.showPopover();if (event.detail===0) menu.querySelector("button")?.focus();}
              }}>Text</button>
            <div ref={textTools} role="dialog" aria-label="Text tools" popover="auto"
              style={{position:"fixed",top:"auto",right:"auto",margin:0,padding:4,border:"1px solid #ddd",borderRadius:6}}>
              {(["text","textOnPath"] as const).map(tool=><button key={tool} disabled={!editable}
                onClick={()=>{textTools.current?.hidePopover();dispatch("tool."+tool);canvas.current?.focus();}}>
                {tool==="text" ? "Use Text tool" : "Text on a path"}
              </button>)}
            </div>
            <button disabled={!editable} aria-pressed={snapshot.tool === "pen"} title="Pen · P" onClick={() => { dispatch("tool.pen"); canvas.current?.focus(); }}>Pen</button>
            <button disabled={!editable} aria-pressed={snapshot.tool === "pencil"} title="Pencil · Shift+P" onClick={() => { dispatch("tool.pencil"); canvas.current?.focus(); }}>Pencil</button>
            <button disabled={!editable} aria-pressed={snapshot.tool === "scale"} onClick={() => { dispatch("tool.scale"); canvas.current?.focus(); }}>Scale</button>
            <button disabled={!editable} aria-pressed={snapshot.tool === "ellipse"} onClick={() => { dispatch("tool.ellipse"); canvas.current?.focus(); }}>Ellipse</button>
            <button disabled={!editable} aria-pressed={snapshot.tool === "polygon"} onClick={() => { dispatch("tool.polygon"); canvas.current?.focus(); }}>Polygon</button>
            <button disabled={!editable} aria-pressed={snapshot.tool === "star"} onClick={() => { dispatch("tool.star"); canvas.current?.focus(); }}>Star</button>
            <button disabled={!editable} aria-pressed={snapshot.tool === "section"} title="Section · Shift+S" onClick={() => { dispatch("tool.section"); canvas.current?.focus(); }}>Section</button>
            <button disabled={!editable} aria-pressed={snapshot.tool === "slice"} onClick={() => { dispatch("tool.slice"); canvas.current?.focus(); }}>Slice</button>
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
          <GeometryPanel key={"GeometryPanel:"+snapshot.selection.join(",")} document={snapshot.document} selection={snapshot.selection}
            enabled={editable && !busy} engine={engine} dispatch={dispatch} onError={setError}/>
          </section>}
          {!editingVector && <ChildLayoutPanel engine={engine} onError={setError} document={snapshot.document} selection={snapshot.selection} enabled={editable && !busy} dispatch={dispatch}/>}
          {!editingVector && <FrameLayoutPanel engine={engine} onError={setError} document={snapshot.document} selection={snapshot.selection} enabled={editable && !busy} dispatch={dispatch}/>}
          {!editingVector && snapshot.selection.length === 1 && isFrameLike(selected) && selected.layout?.mode === "grid" &&
            <GridTrackPanel engine={engine} onError={setError} document={snapshot.document} frame={selected} enabled={editable && !busy} dispatch={dispatch}/>}
          {!editingVector && <><ArrangePanel document={snapshot.document} selection={snapshot.selection} editable={editable && !busy} dispatch={dispatch} />
          <SmartSelectionPanel engine={engine} enabled={editable && !busy} dispatch={dispatch} onError={setError} />
          {snapshot.tool === "scale" ? <ScalePanel engine={engine} enabled={editable && !busy} dispatch={dispatch} onError={setError} /> : <SizePanel enabled={editable && !busy && snapshot.selection.length > 0} dispatch={dispatch} />}
          <RotationPanel engine={engine} enabled={editable && !busy && snapshot.selection.length > 0} dispatch={dispatch} />
          <ArcPanel document={snapshot.document} nodes={snapshot.selection.flatMap(id => { const n = snapshot.document.nodes[id]; return n && n.kind !== "page" ? [n] : []; })} editable={editable && !busy} dispatch={dispatch} />
          <PointsPanel nodes={snapshot.selection.flatMap(id => { const n = snapshot.document.nodes[id]; return n && n.kind !== "page" ? [n] : []; })} editable={editable && !busy} dispatch={dispatch} />
          <CornerPanel document={snapshot.document} nodes={snapshot.selection.flatMap(id => { const n = snapshot.document.nodes[id]; return n && n.kind !== "page" ? [n] : []; })} editable={editable && !busy} dispatch={dispatch} /></>}
          {!editingVector && <TypographyPanel bind={dispatch} engine={engine} linkDialog={linkDialog} run={(command,params) => {
            setError("");
            if (command==="text.loadFont") {
              controller.current?.finishText();
              void engine.executeAsync(command,params).catch(e=>setError(e instanceof Error ? e.message : "Could not load font"));
            } else {
              try { engine.execute(command,params); } catch (e) { setError(e instanceof Error ? e.message : "Could not edit text"); }
            }
          }} link={(ids,url) => {
            try { engine.execute("text.link",{ids,url}); } catch (e) { setError(e instanceof Error ? e.message : "Could not create link"); }
          }} editable={editable && !busy} onLeave={() => controller.current?.finishText()}
            apply={(ids, props) => {
              try { if (!controller.current?.formatText(props)) dispatch("node.set", {ids, props}); }
              catch (e) { setError(e instanceof Error ? e.message : "Could not format text"); }
            }} />}
          {!editingVector && <ComponentPanel document={snapshot.document} selection={snapshot.selection} enabled={editable && !busy} dispatch={dispatch}/>}
          {!editingVector && <InstancePanel document={snapshot.document} selection={snapshot.selection} enabled={editable && !busy} dispatch={dispatch}/>}
          <AppearancePanel engine={engine} page={page} selected={selected && selected.kind !== "page" ? selected : undefined} editable={editable && !busy} dispatch={dispatch} />
          <StrokePanel engine={engine} nodes={snapshot.selection.flatMap(id => { const n = snapshot.document.nodes[id]; return n && n.kind !== "page" ? [n] : []; })} editable={editable && !busy} dispatch={dispatch} />
          <EffectsPanel engine={engine} editable={editable && !busy} dispatch={dispatch} />
          {!editingVector && <LayoutGuidesPanel key={"LayoutGuidesPanel:"+snapshot.selection.join(",")} nodes={snapshot.selection.map(id=>snapshot.document.nodes[id])}
            engine={engine} enabled={editable && !busy} dispatch={dispatch} onError={setError}/>}
          {!editingVector && <VariableModesPanel document={snapshot.document} selection={snapshot.selection} enabled={editable && !busy} run={dispatch}/>}
          {!editingVector && !snapshot.selection.length && <VariablesPanel documentName={snapshot.document.name} importFile={file=>engine.importVariableFile(file)} error={error} data={snapshot.document.variables} enabled={editable && !busy} run={dispatch}/>}
          {!editingVector && <SharedStylesPanel engine={engine} enabled={editable && !busy} run={dispatch} leave={()=>controller.current?.finishText()}/>}
          {!editingVector && !snapshot.selection.length && <fieldset><legend>Export</legend><button type="button" disabled={!signedIn || busy} onClick={()=>void exportDrawing("png",1,"page")}>Export page as PNG</button></fieldset>}
          {!editingVector && <ExportPanel key={"ExportPanel:"+snapshot.selection.join(",")} doc={snapshot.document} ids={snapshot.selection} enabled={editable && !busy}
            run={dispatch} download={()=>void exportLayers()}/>}
        </aside>
      </div>
    </div></LibraryVariablesContext.Provider>;
}
