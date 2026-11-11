import {peopleCommands,executePeople,type LivePeople} from "./sharing/live-people";
import type {LivePresence} from "./sharing/live-presence";
import {commentBrief} from "./comment-brief";
import {commentQueries,queryComments,readCommentsCommand} from "./comment-query";
import {cleanDisplayName,commentActions,commentId,editComment} from "./comment-actions";
import {normaliseLive} from "./sharing/live-normalise";
import {commentPosition,followCommentAnchors} from "./comments";
import {libraryUsageReport} from "./sharing/library-usage";
import type {OnlineTeamLibraries} from "../backends/online-files";
import { nextBranchId, nextScopedId } from "./branch-ids";
import { VersionHistory, versionDetails, type FileVersion } from "./file-versions";
import {documentColours} from "./document-colours";
import {swapLibrary} from "./library-swap";
import {importLibraryComponents} from "./library-components";
import {publishedComponent} from "./library-component-source";
import {guardLibraryStore,countLibraryInstances} from "./library-store";
import {applyLibraryStyle} from "./library-styles";
import {editLibraryVariable,guardLibraryVariables} from "./library-variables";
import {acceptLibraryUpdates,findLibrary,libraryUpdates,linkedPublication} from "./library-updates";
import {MAX_CACHED_LIBRARIES,describeLibrary,enableLibrary,removeLibrary} from "./library-links";
import type {LibraryLink,PublishedLibrary} from "./published-library";
import {publishLibrary,listLibraries} from "./library-publish";
import { importVariables } from "./variable-import";
import { exportVariables } from "./variable-export";
import { bindLayerVariable, forgetLayerVariables, refreshLayerBindings } from "./layer-variable-bindings";
import { refreshBoundStyles } from "./style-application";
import { removeLayerMode, setVariableMode } from "./variable-modes";
import { editVariableMetadata, metadataSpecs } from "./variable-metadata";
import { editVariableValue, valueSpecs } from "./variable-values";
import { collectionSpecs, editCollection } from "./variable-collections";
import { emptyVariables, type Variables } from "./variables";
import { editExportSettings, exportSpecs } from "./export-settings";
import { editLayoutGuides, gridSpecs } from "./layout-guides";
import { editStyleLinks } from "./style-application";
import { editStylePaint, editStyleDefinition, orderStyles, styleEditSpecs, styleOrderSpecs } from "./style-commands";
import { listStyles } from "./shared-styles";
import { restoreLibraryOverrides, finishComponentEdit, markLoadedModeOverrides } from "./component-edits";
import { listComponents } from "./component-assets";
import { executeInstanceCommand, instanceCommandSpecs } from "./instance-commands";
import { createInstance } from "./component-instances";
import { fieldValue, type FieldEdit } from "./field-math";
import { shownGeometry, type GeometryField } from "./geometry-fields";
import { setGridTrack } from "./grid-track-command";
import { editTextSpecs, executeTextEdit, isTextEditCommand, type EditSelection } from "./text-edit-commands";
import { executeTextFormat, isTextFormatCommand, textFormatSpecs } from "./text-format-commands";
import { sameTextData, scalarCount } from "./text-ranges";
import { subscribeFonts } from "./font-generation";
import { missingFonts, refitText, type MissingFont } from "./text-refit";
import { createTextOnPath, putTextOnPath } from "./text-path-commands";
import { textLinkAt } from "./text-link";
import { listKey } from "./text-list-edit";
import { copyEffect, editEffects, effectSpecs } from "./effect-commands";
import { wireEffect, type Effect } from "./effects";
import type { BlendMode } from "./blend";
import { characterFills } from "./text-layer-fills";
import { isLeaf, isFrameLike, isGroupLike } from "./document";
import { editImagePaints, editImagePreset, imageEditSpecs, startImageCrop, type CropTarget } from "./image-commands";
import { listImagePresets } from "./image-filters";
import { getNode } from "./inspect";
import { centrePastedImage, fileImportParams, fileVariablesParam, placeImage, prepareImage, rasterFilename, replaceImage, withImageResource } from "./image-import";
import { createCanvasText, editTextRange, publishTextNode, typedListMarker, type TextTarget } from "./text-edit";
import { fitEditedText, importFontBytes, prepareText, prepareDocumentText, queryFonts } from "./text-node-layout";
import { creationCharacters, createLayer } from "./creation";
import { pastePaint, type CopiedPaint } from "./paint-clipboard";
import { copyPaint, fillSpecs, selectedRegionFills, writeFill } from "./fill-commands";
import { readPaint, type Paint } from "./solid-paint";
import { executeStrokeList, strokeSpecs } from "./stroke-commands";
import { newDocument, sameContent, withLayerTransform, type Document, type DrawShapeKind, type TextNode, type NodeId } from "./document";
import { MAX_IMAGE_BYTES } from "./image-resource";
import { fileData } from "./file-bytes";
import { readFontInput } from "./font-source";
import { base64Bytes } from "./recovery";
import { type FileBranch, readVersionDocument, encodePublishedLibrary, decodePublishedLibrary, decodeFigcraft, encodeFigcraft, encodeFigcraftBlob, prepareArchive, MAX_UNPACKED_BYTES } from "./file-format";
import { executePage, listPages, pageSpecs } from "./pages";
import { executeSelection, layersAt, selectionSpecs } from "./selection";
import { setRectangleProperties, setPageGeometryFields } from "./properties";
import { HierarchyDraft, pageForNode, worldTransform, zSorted } from "./hierarchy";
import { applyBuilder } from "./shape-builder-commands";
import { builderArrangement, builderTargets, readBuilderRegions } from "./shape-builder";
import { copyLayerProperties, pasteLayerProperties } from "./property-clipboard";
import { requiredTargets } from "./arrange";
import { captureLayers, pasteLayers, layerClipboardSpecs, type CopiedLayers } from "./layer-clipboard";
import { executeStructure, structureSpecs } from "./structure";
import { executeVector, isVectorJoin, vectorSpecs } from "./vector-commands";
import { executeVectorEdit, vectorEditSpecs, type VectorEditCommand } from "./vector-edit-commands";
import { clampVectorEdit, vectorNetwork, type VectorEditState } from "./vector-edit";
import { boundsOf, defaultViewport, executeView, fitPage, fitView, maximumZoom, minimumZoom, viewOrigin, viewSpecs, type Viewport } from "./viewport";
import { framePresets } from "./frame-presets";
import { parseColourProfile } from "./colour-spaces";
import { setDocumentProfile } from "./document-profile";
import { inspectedId, parseBoolean, parseNodeId, parseNumber, parseString } from "./parameters";
import { arrangeSpecs, executeArrange } from "./arrange";
import { anchors, sizingSpecs, executeSizing } from "./sizing";
import { executeRotation, localOrigin, movedOrigin, originBoxPoints, originSpecs, rotationSpecs, sameIds, snappedOrigin, validateChangedGeometry, type OriginSnapshot, type RotationOrigin } from "./rotation";
import type { Point } from "./geometry";
import { executeSmartSelection, smartSpecs } from "./smart-selection";
import { placeMove, type MoveDrop, type MoveSlotCache } from "./layout-drop";
import { copyLayers, duplicateSelection, executeDuplicate, type Duplicated } from "./duplicate";
import { ancestorIds } from "./canvas-selection";
import { previewResize, type ResizeStart } from "./transform-preview";
import type { ScaleAnchor } from "./transform-handles";
import { PenInteraction } from "./pen-interaction";
import { buildPenPath, type PenAnchor } from "./pen-path";
import { PencilInteraction } from "./pencil-interaction";
import { parseBrush, wireBrush, type Brush } from "./brush";

interface FileSource {file:Blob;folder?:import("./interchange/rest/companions").RestFolder; picker?:PaintPicker; paste?:boolean; centre?:boolean}
type OpenResult = { warnings?: readonly string[]; repairs: readonly string[]; summary: {name:string; pages:number; layers:number; images:number} }

export const commandSpecs = Object.freeze({
  ...peopleCommands,
  ...commentActions,
  ...commentQueries,
  "comment.prompt": {label:"Copy comments for AI",undo:false},
  "pref.userName": {label:"Your name",undo:false},
  "tool.comment": {label:"Comment",undo:false},
  "view.comments": {label:"Comments",undo:false},
  "comment.open": {label:"Open comment",undo:false},
  "comment.next": {label:"Next comment",undo:false},
  "comment.zoom": {label:"Zoom to comments",undo:false},
  "edit.copyProperties": { label: "Copy properties", undo: false },
  "edit.pasteProperties": { label: "Paste properties", undo: true },
  ...layerClipboardSpecs,
  "edit.pasteDesignLayers": {label:"Paste design layers",undo:true},
  ...effectSpecs,
  ...strokeSpecs,
  ...textFormatSpecs,
  ...editTextSpecs,
  "text.fonts": {label:"List fonts",undo:false},
  "text.loadFont": {label:"Load font file",undo:true},
  "text.rescanFonts": {label:"Rescan installed fonts",undo:true},
  "text.missingFonts": {label:"Missing fonts",undo:false},
  "text.preview": {label:"Preview a change",undo:false},
  "text.endPreview": {label:"End text preview",undo:false},
  "text.refit": {label:"Fit text to fonts",undo:true},
  "text.onPath": {label:"Text on path",undo:true},
  "text.openLink": {label:"Open link",undo:false},
  ...fillSpecs,
  "paint.documentColors": {label:"Document colours",undo:false},
  ...arrangeSpecs,
  ...sizingSpecs,
  "layout.setTrack": {label: "Set grid track size", undo: true},
  ...rotationSpecs,
  ...originSpecs,
  ...smartSpecs,
  ...pageSpecs,
  ...viewSpecs,
  "frame.presets": { label: "List frame presets", undo: false },
  ...selectionSpecs,
  ...structureSpecs,
  ...instanceCommandSpecs,
  ...styleOrderSpecs,
  ...styleEditSpecs,
  ...collectionSpecs,
  ...valueSpecs,
  ...metadataSpecs,
  "variable.bind": {label:"Bind variable",undo:true},
  "variable.setMode": {label:"Set variable mode",undo:true},
  ...gridSpecs,
  ...exportSpecs,
  "library.import": {label:"Import library component",undo:true},
  "library.place": {label:"Place library component",undo:true},
  "libraries.open": {label:"Open libraries",undo:false},
  "libraries.publish": {label:"Publish library…",undo:false},
  "library.swap": {label:"Swap library",undo:true},
  "library.swapAt": {label:"Swap instance to library component",undo:true},
  "library.applyStyle": {label:"Apply library style",undo:true},
  "style.apply": {label:"Apply style",undo:true},
  "style.detach": {label:"Detach style",undo:true},
  "library.importVariable": {label:"Import library variable",undo:true},
  "library.bindVariable": {label:"Bind library variable",undo:true},
  "library.aliasVariable": {label:"Alias library variable",undo:true},
  "library.setVariableMode": {label:"Set library variable mode",undo:true},
  "library.extendCollection": {label:"Extend library collection",undo:true},
  "library.updates": {label:"Library updates",undo:false},
  "library.acceptUpdates": {label:"Accept library updates",undo:true},
  "library.add": {label:"Add library",undo:true},
  "library.remove": {label:"Remove library",undo:true},
  "library.publish": {label:"Publish library",undo:true},
  "library.list": {label:"List libraries",undo:false},
  "variable.import": {label:"Import variables",undo:true},
  "variable.export": {label:"Export variables",undo:false},
  "variable.list": {label:"List variables",undo:false},
  "style.list": {label:"List styles",undo:false},
  "component.list": {label:"List components",undo:false},
  "instance.create": { label:"Create instance", undo:true },
  "tool.shapeBuilder": { label: "Shape builder", undo: false },
  "shapeBuilder.mode": { label: "Shape builder mode", undo: false },
  "shapeBuilder.regions": { label: "Shape builder regions", undo: false },
  "shapeBuilder.merge": { label: "Merge regions", undo: true },
  "shapeBuilder.remove": { label: "Remove regions", undo: true },
  ...vectorSpecs,
  ...vectorEditSpecs,
  ...imageEditSpecs,
  "image.crop": { label:"Crop image", undo:true },
  "image.replace": { label: "Replace image", undo: true },
  "image.presets": { label: "Image presets", undo: false },
  "select.layersAt": { label: "Layers at a point", undo: false },
  "node.get": { label: "Get layer", undo: false },
  "node.set": { label: "Set properties", undo: true },
  "frame.create": { label: "Frame", undo: true },
  "shape.polygon": { label: "Polygon", undo: true },
  "shape.star": { label: "Star", undo: true },
  "shape.line": { label: "Line", undo: true },
  "shape.arrow": { label: "Arrow", undo: true },
  "tool.line": { label: "Line", undo: false },
  "tool.arrow": { label: "Arrow", undo: false },
  "tool.polygon": { label: "Polygon", undo: false },
  "tool.star": { label: "Star", undo: false },
  "shape.ellipse": { label: "Ellipse", undo: true },
  "shape.rectangle": { label: "Rectangle", undo: true },
  "text.style": { label: "Style text range", undo: true },
  "text.set": { label: "Set text", undo: true },
  "text.create": { label: "Text", undo: true },
  "node.create": { label: "Create layer", undo: true },
  "vector.create": { label: "Vector", undo: true },
  "tool.ellipse": { label: "Ellipse", undo: false },
  "tool.section": { label:"Section", undo:false },
  "tool.slice": { label: "Slice", undo: false },
  "tool.rectangle": { label: "Rectangle", undo: false },
  "tool.move": { label: "Move", undo: false },
  "tool.scale": { label: "Scale", undo: false },
  "tool.text": { label: "Text", undo: false },
  "tool.textOnPath": { label: "Text on a path", undo: false },
  "tool.pen": { label: "Pen", undo: false },
  "tool.pencil": { label: "Pencil", undo: false },
  "tool.pencilBrush": { label: "Pencil brush", undo: false },
  "tool.scaleAnchor": { label: "Scale anchor", undo: false },
  "edit.undo": { label: "Undo", undo: false },
  "edit.redo": { label: "Redo", undo: false },
  "edit.duplicate": { label: "Duplicate", undo: true },
  "image.place": { label: "Place image", undo: true },
  "file.exportFramesPdf": { label: "Export frames to PDF…", undo: false },
  "file.exportSvg": { label: "Export selection as SVG", undo: false },
  "file.exportLayers": { label: "Export layers", undo: false },
  "file.export": { label: "Export", undo: false },
  "file.import": { label: "Import", undo: true },
  "file.placeImage": { label: "Place image", undo: true },
  "file.saveVersion": { label: "Save to version history", undo: false },
  "object.setThumbnail": { label: "Set as thumbnail", undo: true },
  "file.versionHistory": { label: "Show version history", undo: false },
  "version.list": { label: "List versions", undo: false },
  "version.autosave": { label: "Autosave version", undo: false },
  "version.rename": { label: "Rename version", undo: false },
  "version.preview": { label: "View version", undo: false },
  "version.restore": { label: "Restore version", undo: true },
  "version.exitPreview": { label: "Return to current version", undo: false },
  "version.delete": { label: "Delete version", undo: false },
  "file.rename": { label: "Rename file", undo: true },
  "file.colorProfile": { label: "Color profile", undo: true },
  "file.open": { label: "Open", undo: false },
  "file.recover": { label: "Recover file", undo: false },
  "file.saveAs": { label: "Save as", undo: false },
  "file.markSaved": { label: "Mark saved", undo: false },
});
export type CommandId = keyof typeof commandSpecs;
export interface PaintPicker {
  readonly styleId?: string;
  readonly list: "fill" | "stroke";
  readonly index: number;
  readonly stop: number;
}
export interface EditorSnapshot {
  readonly profileDialog?: boolean;
  readonly libraryPanel?: {readonly publish:boolean};
  readonly missingFonts?: readonly MissingFont[];
  readonly paintPicker?: PaintPicker;
  readonly openEffects?: readonly number[];
  readonly crop?: CropTarget;
  readonly document: Document;
  readonly selection: readonly NodeId[];
  readonly openComment?: string;
  readonly showComments?: boolean;
  readonly tool: "comment" | "move" | DrawShapeKind | "scale" | "text" | "textOnPath" | "pen" | "pencil" | "shapeBuilder";
  readonly builderMode: "merge" | "remove";
  readonly scaleAnchor: ScaleAnchor;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly editable: boolean;
  readonly dirty: boolean;
  readonly hasSaved: boolean;
  readonly versionPanel?: boolean;
  readonly previewVersionId?: string;
}
interface HistoryEntry { document: Document; selection: readonly NodeId[] }
function parameters(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("Command parameters must be an object");
  return input as Record<string, unknown>;
}
const fontOptions={
  "text.fonts":["family","style","axes","features"],
  "text.loadFont":["data","path"],
  "text.rescanFonts":[],
} as const;
function namedParameters(input:unknown):Record<string,unknown> {
  // Native registry queries treat a non-object payload as having no named parameters.
  return input && typeof input==="object" && !Array.isArray(input) ? input as Record<string,unknown> : {};
}
function fontParams(command:keyof typeof fontOptions,input:unknown) {
  const p=namedParameters(input);
  const allowed:readonly string[]=fontOptions[command];
  for (const key of Object.keys(p)) if (key!=="ids" && key!=="id" && !allowed.includes(key))
    throw new Error("Unknown "+command+" option: "+key);
  return p;
}
/** React-free command transactions. Snapshots share immutable nodes and document references. */
export interface EditorClipboard { properties?: Record<string, unknown>; layers?: CopiedLayers; paint?: CopiedPaint; effect?: Effect }

export class EditorEngine {
  readonly pen = new PenInteraction(this);
  readonly pencil = new PencilInteraction(this);
  #pencilBrush?: Brush;
  getPencilBrush(): Brush | undefined { return this.#pencilBrush; }
  #snapshot: EditorSnapshot;
  #undo: HistoryEntry[] = [];
  #redo: HistoryEntry[] = [];
  #nextId = 2n;
  #lastDuplicate?: Duplicated;
  #listeners = new Set<() => void>();
  #view: Viewport = fitPage(defaultViewport, newDocument());
  #viewListeners = new Set<() => void>();
  #origin?: RotationOrigin;
  #originSnapshot: OriginSnapshot = Object.freeze({ editing: false, moved: false });
  #originListeners = new Set<() => void>();
  #interaction?: {
    base: EditorSnapshot; document: Document; selection: readonly NodeId[]; nextId: bigint; duplicated?: Duplicated;
    moveSlot?: MoveSlotCache;
    preparedCopy?: { ids: readonly NodeId[]; draft: HierarchyDraft; result: ReturnType<typeof copyLayers> };
    baseVectorEdit?: VectorEditState; vectorEdit?: VectorEditState;
  };
  #textPreview?:Document;
  #textOwner?:symbol;
  #textCreated=false;
  #editing?:ReturnType<EditorEngine["beginTextEdit"]>;
  currentTextEdit=()=>this.#editing?.active() ? this.#editing : undefined;
  readonly #textCommandListeners=new Set<()=>void>();
  subscribeTextCommands(listener:()=>void) {
    this.#textCommandListeners.add(listener);
    return ()=>{this.#textCommandListeners.delete(listener);};
  }
  #textRange?: {node:TextNode; start:number; end:number; anchor:number; caret:number; active:() => boolean; update:(doc:Document,start:number,end:number)=>void};
  getTextRange = () => this.#textRange?.active() ? this.#textRange : undefined;
  #canvasListeners = new Set<() => void>();
  #vectorEdit?: VectorEditState;
  #documentIdentity = Symbol();
  #libraryFiles=new Map<string,PublishedLibrary>();
  #libraryPick=0;
  #teamChecking=new Set<string>();
  #importedTeamInvites: ReadonlyMap<string,string> = new Map();
  #teamSubmission?: {path:string; document:Document; options:string; id:string; archive:Blob; library:PublishedLibrary};
  #libraryRevision=0;
  get libraryRevision() {return this.#libraryRevision;}
  #clipboard: EditorClipboard = {};
  ownsLayerClipboardText(text:string) { return this.#clipboard.layers?.mirror===text; }
  trackLayerClipboardMirror(fallback:string) {
    const clip=this.#clipboard.layers;
    if (clip) clip.mirror=fallback;
    return (text:string)=>{ if (clip===this.#clipboard.layers && clip) clip.mirror=text; };
  }
  async prepareLayerClipboardMirror(fallback:string) {
    const clip=this.#clipboard.layers, opening=this.#openSequence;
    if (!clip || !this.#hostEditable) throw new Error("No copied layers");
    let text=fallback;
    try {
      const {renderSvgExport}=await import("./export-svg");
      text=await (await renderSvgExport(clip.source,clip.roots,{})).text();
    } catch { /* Unsupported or over-depth art keeps the native layer marker. */ }
    this.#assertExportAccess(opening);
    if (clip!==this.#clipboard.layers) throw new Error("A newer selection was copied");
    return text;
  }
  hasCopiedProperties = (): boolean => !!this.#clipboard.properties;
  hasCopiedLayers = (): boolean => !!this.#clipboard.layers;
  hasCopiedEffect = (): boolean => !!this.#clipboard.effect;
  hasCopiedFill = (): boolean => this.#clipboard.paint?.list === "fill";
  hasCopiedStroke = (): boolean => this.#clipboard.paint?.list === "stroke";
  #vectorListeners = new Set<() => void>();
  #viewportAttached = false;
  #viewConfigured = false;
  #hostEditable = true;
  #commentRead = true;
  #commentAccess = true;
  #commentName = "You";
  readonly #unrecordedLiveEdits = new WeakSet<Document>();
  recordsLiveEdit(document: Document) { return !this.#unrecordedLiveEdits.has(document); }
  setCommentAccess(writable: boolean, name = "You", readable = writable) {
    this.#commentRead = readable;
    this.#commentAccess = writable;
    this.#commentName = cleanDisplayName(name);
    this.#people?.refreshName();
  }
  get commentName() { return this.#commentName; }
  #preview?: { id: string; document: Document; selection: readonly NodeId[] };
  #versionRead = 0;
  #history = new VersionHistory();
  get versions() { return this.#history.records; }
  #fileDocument() { return this.#preview?.document ?? this.#snapshot.document; }
  exitVersionPreview() {
    this.#versionRead++;
    const previous = this.#preview;
    if (!previous) return false;
    this.#preview = undefined;
    this.#vectorEdit = undefined;
    this.#publish({ document: previous.document, selection: previous.selection, editable: this.#hostEditable, previewVersionId: undefined });
    return true;
  }
  async #readVersion(params: Record<string, unknown>) {
    if (!this.#hostEditable) throw new Error("Sign in to open a version");
    const index = this.#history.index(params), version = this.versions[index], sequence = ++this.#versionRead;
    const before = this.#fileDocument(), opening = this.#openSequence;
    const loaded = await readVersionDocument(version);
    await prepareDocumentText(loaded.document);
    if (!this.#hostEditable || sequence !== this.#versionRead || opening !== this.#openSequence || before !== this.#fileDocument() || this.versions[index] !== version || this.interacting) {
      throw new Error("The document or selected version changed during loading");
    }
    return { ...loaded, version, index };
  }
  async duplicateVersion(params: Record<string, unknown>) {
    const { document, nextId, version } = await this.#readVersion(params);
    return this.#copyTab(document, BigInt(nextId), this.#snapshot.document.name + " (" + version.name + ")");
  }
  async #showVersion(command: "version.restore" | "version.preview", params: Record<string, unknown>) {
    this.pencil.cancel(); this.pen.cancel(); this.cancelInteraction();
    const { document, nextId, version, index } = await this.#readVersion(params);
    this.exitVersionPreview();
    const current = this.#snapshot;
    const currentPage = document.pages.includes(current.document.currentPage) ? current.document.currentPage : document.currentPage;
    const shown = currentPage === document.currentPage ? document : Object.freeze({ ...document, currentPage });
    this.#vectorEdit = undefined;
    if (command === "version.preview") {
      this.#preview = { id: version.id, document: current.document, selection: current.selection };
      this.#publish({ document: shown, selection: Object.freeze([]), editable: false, previewVersionId: version.id });
      return versionDetails(version, index);
    }
    if (!this.#branchTab && this.#history.changed(current.document)) this.#history.add(current.document, String(this.#nextId), {}, true);
    const restored = followCommentAnchors(Object.freeze({ ...shown, name: current.document.name, published: current.document.published, comments:current.document.comments }),current.document);
    this.#undo.push({ document: current.document, selection: current.selection }); this.#redo = [];
    const snapshotNext = BigInt(nextId);
    if ((!this.#idClient || snapshotNext >> 32n === BigInt(this.#idClient)) && snapshotNext > this.#nextId) this.#nextId = snapshotNext;
    if (this.#idClient) this.#nextId = nextScopedId(restored, this.#idClient, this.#nextId);
    this.#history.mark(restored);
    this.#publish({ document: restored, selection: Object.freeze([]) });
    const restoredIndex = this.versions.findIndex(v => v.id === version.id);
    return restoredIndex < 0 ? null : versionDetails(version, restoredIndex);
  }

  #branches: readonly FileBranch[] = Object.freeze([]);
  get branches() { return this.#branches; }
  #savedBranches = this.#branches;
  #idClient = 0;
  #liveCounters = new Map<number, bigint>();
  #branchTab = false;
  #liveHistory?: {canUndo:boolean; canRedo:boolean; travel(undo:boolean):boolean};
  setLiveHistory(history?: typeof this.liveHistory) {
    const previous = this.#liveHistory;
    this.#liveHistory = history;
    if (!history) {this.#livePage=undefined;this.#sharedDrawing=undefined;}
    if (!!history !== !!previous) { this.#undo = []; this.#redo = []; }
    if (!!history !== !!previous || previous?.canUndo !== history?.canUndo || previous?.canRedo !== history?.canRedo) this.#publish({});
  }
  get liveHistory() { return this.#liveHistory; }
  #livePage?: {local:string;shared:string};
  #sharedDrawing?: {source:Document;value:Document};
  #people?:LivePeople;
  #followingView=false;
  get people() {return this.#people;}
  setPeople(room?:LivePeople) {
    if(this.#people===room)return;
    this.#people=room;
    this.#publish({});
  }
  capturePresence(cursor:Point|null):LivePresence {
    const document=this.#snapshot.document,selection=this.getRenderSelection(),view=this.#view, origin=viewOrigin(view), range=this.getTextRange();
    return {
      cursor:cursor?[document.currentPage,cursor.x,cursor.y]:null,
      selection:[...selection].slice(0,10000),
      viewport:[document.currentPage,origin.x,origin.y,view.vw/view.zoom,view.vh/view.zoom],
      editingText:range?{node:range.node.id,caret:range.caret,selection:range.start!==range.end?[range.start,range.end]:null}:null,
    };
  }
  followViewport(viewport:LivePresence["viewport"]) {
    if(!viewport)return;
    const [page,x,y,width,height]=viewport,view=this.#view;
    this.#followingView=true;
    try {
      if(this.#liveHistory && this.#snapshot.document.currentPage!==page && this.#snapshot.document.pages.includes(page)){
        this.cancelInteraction();
        const doc=this.#snapshot.document;
        this.#livePage={local:page,shared:this.liveDrawing().currentPage};
        this.#sharedDrawing=undefined;
        this.#publish({document:Object.freeze({...doc,currentPage:page}),selection:[]});
      }
      this.updateView({...view,cx:x+width/2,cy:y+height/2,
        zoom:Math.max(minimumZoom,Math.min(maximumZoom,view.vw/width,view.vh/height))});
    } finally {this.#followingView=false;}
  }
  liveDrawing() {
    const source=this.#fileDocument(), page=this.#livePage;
    if (!page || source.currentPage!==page.local || !source.pages.includes(page.shared)) return source;
    if (this.#sharedDrawing?.source!==source) {
      const value=Object.freeze({...source,currentPage:page.shared});
      if (!this.recordsLiveEdit(source)) this.#unrecordedLiveEdits.add(value);
      this.#sharedDrawing={source,value};
    }
    return this.#sharedDrawing.value;
  }

  repairLiveDocument(before: Document, after: Document, touched: ReadonlySet<string>) {
    const result = normaliseLive(before,after,touched,this.#idClient,this.#nextId);
    if (this.#idClient && result.nextId > ((BigInt(this.#idClient)+1n)<<32n)) throw new Error("Live client identifiers are exhausted");
    this.#nextId = result.nextId;
    return result.document;
  }

  receiveLiveDocument(incoming: Document, restartedClient?:number) {
    if(restartedClient!==undefined){
      this.pencil.cancel();this.pen.cancel();this.cancelInteraction();
      this.#idClient=restartedClient;
      this.#liveCounters.clear();
      this.#nextId=nextScopedId(incoming,restartedClient,1n);
      this.#undo=[];this.#redo=[];this.#livePage=undefined;this.#sharedDrawing=undefined;
      this.#archiveRevision=undefined;
    }
    const current = this.#fileDocument();
    if (this.#livePage) {
      const local=this.#livePage.local;
      this.#sharedDrawing=undefined;
      if (incoming.pages.includes(local)) {
        this.#livePage={local,shared:incoming.currentPage};
        incoming={...incoming,currentPage:local};
      } else this.#livePage=undefined;
    }
    const document = current.published ? Object.freeze({...incoming,published:current.published}) : incoming;
    if (this.#idClient) this.#nextId = nextScopedId(document,this.#idClient,this.#nextId);
    const surviving = (ids: readonly NodeId[]) => ids.filter(id => document.nodes[id]);
    if (this.#preview) {
      this.#preview = {...this.#preview,document,selection:surviving(this.#preview.selection)};
      this.#publish({});
    } else this.#publish({document,selection:surviving(this.#snapshot.selection)});
  }

  setLiveClient(client: number) {
    if (this.#branchTab || client === this.#idClient) return;
    if (!Number.isInteger(client) || client < 0 || client >= 0xffffffff) throw new Error("Invalid live client number");
    this.cancelInteraction();
    if (this.#idClient) this.#liveCounters.set(this.#idClient, this.#nextId);
    const stored = client ? this.#liveCounters.get(client) ?? this.#nextId : 1n;
    this.#nextId = nextScopedId(this.#snapshot.document, client, stored);
    this.#idClient = client;
    this.#archiveRevision = undefined;
  }
  #assetIds() {
    let next = this.#interaction?.nextId ?? this.#nextId;
    const allocate = this.#idClient ? () => {
      if (next >> 32n !== BigInt(this.#idClient)) throw new Error(this.#branchTab ? "Branch identifiers are exhausted" : "Live client identifiers are exhausted");
      return next++;
    } : undefined;
    return { allocate, next: () => next };
  }
  replaceBranches(records: readonly FileBranch[]) {
    if (!this.#hostEditable) throw new Error("Sign in to edit this document");
    this.#branches = Object.freeze([...records]);
    this.#publish({});
  }

  openBranch(branch: FileBranch, nextId = nextBranchId(branch)) {
    const tab = EditorEngine.newTab(undefined, this.#clipboard);
    const { document } = branch.head;
    tab.#idClient = branch.client;
    tab.#branchTab = true;
    tab.#nextId = nextId;
    tab.#saved = document;
    tab.#history = new VersionHistory(branch.versions);
    tab.#savedVersions = tab.#history.records;
    tab.#publish({ document });
    tab.updateView(fitPage(defaultViewport, document));
    return tab;
  }
  applyBranchDocument(document: Document, name: string, update: boolean) {
    if (!this.#hostEditable) throw new Error("Sign in to edit this document");
    this.exitVersionPreview();
    this.cancelInteraction();
    const previous = this.#snapshot.document, beforeId = this.#nextId;
    let nextId = beforeId;
    for (const key of Object.keys(document.nodes)) {
      const id = BigInt(key);
      if ((!this.#idClient || id >> 32n === BigInt(this.#idClient)) && id >= nextId) nextId = id + 1n;
    }
    this.#commitEdit({ document }, { nextId, record: !update, libraryEdit: true });
    if (update) { this.#undo = []; this.#redo = []; }
    else if (this.#history.changed(previous)) this.#history.add(previous, String(beforeId), {}, true);
    this.#history.add(this.#snapshot.document, String(this.#nextId), { name }, false, true);
    this.#publish({});
  }

  #savedVersions = this.#history.records;
  #archiveRevision?: { document: Document; branches: readonly FileBranch[]; versions: readonly FileVersion[]; nextId: bigint };
  get archiveRevision() {
    const document = this.#fileDocument(), versions = this.#history.records;
    if (this.#archiveRevision?.document !== document || this.#archiveRevision.versions !== versions || this.#archiveRevision.branches !== this.#branches || this.#archiveRevision.nextId !== this.#nextId) {
      this.#archiveRevision = { document, versions, branches: this.#branches, nextId: this.#nextId };
    }
    return this.#archiveRevision;
  }
  closeComment() { if (this.#snapshot.openComment) this.#publish({openComment:undefined}); }
  closeVersionPanel() { if (this.#snapshot.versionPanel) this.#publish({ versionPanel: false }); }

  #saved: Document | null = null;
  #downloaded = false;
  #saveSequence = 0;
  #pendingSaves = new Map<number, { document: Document; branches: readonly FileBranch[]; versions: readonly FileVersion[] }>();
  #openSequence = 0;
  constructor(name?: string) {
    this.#snapshot = Object.freeze({ document: newDocument(name), selection: Object.freeze([]), tool: "move", builderMode: "merge", scaleAnchor: "tl", canUndo: false, canRedo: false, editable: true, dirty: true, hasSaved: false });
  }
  static newTab(name?: string, clipboard: EditorClipboard = {}): EditorEngine {
    const engine = new EditorEngine(name);
    engine.#clipboard = clipboard;
    engine.#saved = engine.#snapshot.document;
    engine.#publish({});
    return engine;
  }
  closeTab() { this.#clipboard = {}; this.setEditable(false); }
  duplicateTab(): EditorEngine {
    this.exitVersionPreview();
    return this.#copyTab(this.#snapshot.document, this.#nextId, this.#snapshot.document.name + " (Copy)");
  }
  #copyTab(source: Document, nextId: bigint, name: string) {
    const document = Object.freeze({ ...source, name });
    const copy = EditorEngine.newTab(undefined, this.#clipboard);
    copy.#saved = document;
    copy.#nextId = nextId;
    copy.#publish({ document });
    copy.updateView(fitPage(defaultViewport, document));
    return copy;
  }
  getSnapshot = (): EditorSnapshot => this.#snapshot;
  getUndoDepth = (): number => this.#undo.length;
  getVectorEdit = (): VectorEditState | undefined => this.#vectorEdit;
  getRenderVectorEdit = (): VectorEditState | undefined => this.#interaction ? this.#interaction.vectorEdit : this.#vectorEdit;
  subscribeVectorEdit = (listener: () => void): (() => void) => { this.#vectorListeners.add(listener); return () => { this.#vectorListeners.delete(listener); }; };
  getRenderDocument = (): Document => {
    const live=this.#interaction;
    const proposed=this.#textPreview ?? live?.document;
    if (!proposed || proposed===this.#snapshot.document) return this.#snapshot.document;
    if (!proposed.variables?.variables.length) return proposed;
    return this.#prepareEdit(proposed,live?.nextId ?? this.#nextId).document;
  };
  getRenderSelection = (): readonly NodeId[] => this.#interaction?.selection ?? this.#snapshot.selection;
  getInteractionBase = (): Document => this.#interaction?.base.document ?? this.#snapshot.document;
  subscribeCanvas = (listener: () => void): (() => void) => { this.#canvasListeners.add(listener); return () => { this.#canvasListeners.delete(listener); }; };
  get interacting(): boolean { return this.#interaction !== undefined; }
  beginInteraction(): void {
    this.endTextPreview();
    if (!this.#snapshot.editable) throw new Error("Sign in to edit this document");
    if (this.#interaction) throw new Error("An interaction is already active");
    this.#interaction = { base: this.#snapshot, document: this.#snapshot.document, selection: this.#snapshot.selection, nextId: this.#nextId, baseVectorEdit: this.#vectorEdit, vectorEdit: this.#vectorEdit };
  }
  beginTextEdit(target: TextTarget | {pathId:string;startFraction:number}) {
    const existing=this.currentTextEdit();
    const before = existing ? this.#interaction!.document : this.#snapshot.document;
    const creating = !("id" in target);
    const created = creating || (this.getTextRange()?.node.id===target.id && this.#textCreated);
    if (creating && (this.#nextId > 18446744073709551615n || before.nodes[String(this.#nextId)])) throw new Error("Document identifiers are exhausted");
    const pathDocument="pathId" in target ? createTextOnPath(before,String(this.#nextId),target) : undefined;
    const initial = "id" in target ? before.nodes[target.id] : "pathId" in target ? pathDocument!.nodes[String(this.#nextId)]
      : createCanvasText(before,String(this.#nextId),target);
    if (initial?.kind !== "text") throw new Error("Expected a text layer");
    if (!existing) this.beginInteraction();
    const owner = this.#interaction!;
    let node = initial;
    owner.selection = Object.freeze([node.id]);
    if (creating) {
      owner.document = pathDocument ?? publishTextNode(before,node);
      node = owner.document.nodes[node.id] as TextNode;
      owner.nextId = this.#nextId < 18446744073709551615n ? this.#nextId + 1n : this.#nextId;
    }
    const token=Symbol();
    this.#textOwner=token;
    this.#textCreated=created;
    const active = () => this.#interaction === owner && this.#textOwner===token;
    let preedit:{text:string;cursor:number}|null=null;
    let composed:{node:TextNode;document:Document;start:number;end:number;cursor:number}|undefined;
    let measured = node.text.characters, length = scalarCount(measured);
    const select = (anchor:number, caret:number, clearComposition=true) => {
      if (!active()) return;
      if (measured !== node.text.characters) { measured = node.text.characters; length = scalarCount(measured); }
      anchor=Math.max(0,Math.min(length,Math.trunc(anchor)));
      caret=Math.max(0,Math.min(length,Math.trunc(caret)));
      const previous=this.#textRange, changed=clearComposition && preedit!==null;
      if (clearComposition) {preedit=null;composed=undefined;}
      if (!changed && previous?.node===node && previous.anchor===anchor && previous.caret===caret && previous.active===active) return;
      this.#textRange={node,start:Math.min(anchor,caret),end:Math.max(anchor,caret),anchor,caret,active,update};
      this.#notifyCanvas();
    };
    const update = (next:Document, start:number, end:number) => {
      if (!active()) return;
      this.endTextPreview();
      const edited = next.nodes[node.id];
      if (edited?.kind !== "text") throw new Error("Expected a text layer");
      // A catalogue edit can leave the selected characters and their layer unchanged.
      if (owner.document.styles !== next.styles) this.#textRange = undefined;
      owner.document = next;
      node = edited;
      select(start,end);
    };
    select(0, 0);
    const session={
      select,
      composition:()=>preedit && {...preedit},
      compositionPreview:()=>composed,
      compose:(raw:string,cursor?:number)=>{
        if (!active()) return;
        let text="", count=0;
        for (const ch of raw) {
          if (/\p{Cc}/u.test(ch)) continue;
          if (count===1000) break;
          text+=ch;count++;
        }
        const range=this.#textRange!;
        if (!text && !preedit) return;
        const localCursor=Math.max(0,Math.min(count,cursor ?? count));
        if (composed && preedit?.text===text) {
          if (preedit.cursor!==localCursor) {
            preedit={text,cursor:localCursor};composed={...composed,cursor:composed.start+localCursor};this.#notifyCanvas();
          }
          return;
        }
        if (text && !preedit && range.start!==range.end) {
          const edited=editTextRange(node,range.start,range.end,"");
          update(publishTextNode(owner.document,edited),range.start,range.start);
        }
        const at=this.#textRange!.caret;
        if (text) {
          const rendered=editTextRange(node,at,at,text);
          const preview = publishTextNode(owner.document, rendered);
          composed={node:preview.nodes[node.id] as TextNode,document:preview,start:at,end:at+count,cursor:at+localCursor};
          preedit={text,cursor:localCursor};
        } else {composed=undefined;preedit=null;}
        this.#notifyCanvas();
      },
      format: (props: Record<string,unknown>, start:number, end:number) => {
        if (!active()) return;
        const range = start === end ? {} : {start, end};
        const next = setRectangleProperties(owner.document, [node.id], {id:node.id, props:{...props, ...range}});
        const rangeBefore=this.#textRange!;
        const backwards=rangeBefore.caret<rangeBefore.anchor && start===rangeBefore.start && end===rangeBefore.end;
        update(next,backwards ? end : start,backwards ? start : end);
      },
      listKey: (key:string, shift:boolean, start:number, end:number) => {
        if (!active()) return false;
        const text = listKey(node.text,start,end,key,shift);
        if (!text) return false;
        if (!sameTextData(node.text,text)) update(publishTextNode(owner.document,fitEditedText({...node,text},node)),start,end);
        return true;
      },
      marker: (start:number, end:number, value:string) => {
        if (!active()) return;
        const transformed = typedListMarker(node,start,end,value);
        if (!transformed) return;
        update(publishTextNode(owner.document,transformed.node),transformed.caret,transformed.caret);
        return transformed.caret;
      },
      active,
      node: () => node,
      replace: (from: number, to: number, insertion: string) => {
        if (!active()) return;
        const edited = editTextRange(node, from, to, insertion);
        if (edited === node) return;
        owner.document = publishTextNode(owner.document, edited);
        node = owner.document.nodes[edited.id] as TextNode;
        select(this.#textRange?.anchor ?? 0, this.#textRange?.caret ?? 0);
      },
      finish: () => {
        if (!active()) return;
        this.#textRange = undefined;this.#editing=undefined;
        if (!node.text.characters.trim()) {
          if (created) { this.cancelInteraction(); return; }
          const draft = new HierarchyDraft(owner.document);
          draft.remove(node.id); draft.normaliseGroups();
          owner.document = draft.finish(); owner.selection = [];
        }
        this.commitInteraction();
      },
      cancel: () => { if (active()) { this.#textRange = undefined; this.#editing=undefined; this.cancelInteraction(); } },
    };
    this.#editing=session;
    return session;
  }
  setVectorRegionHover(regionHover: number | undefined): void {
    const state = this.#vectorEdit;
    if (!state || this.#interaction || state.regionHover === regionHover) return;
    const regionTopology = regionHover !== undefined || state.regions.length ? vectorNetwork(this.#snapshot.document, state.id) : undefined;
    this.#vectorEdit = Object.freeze({ ...state, regionHover, regionTopology });
    this.#notifyCanvas();
  }
  /** Pointer selection updates stable chrome once; frame-frequency previews use the method below. */
  updateVectorSelection(update: (state: VectorEditState) => VectorEditState): void {
    if (!this.#snapshot.editable) throw new Error("Sign in to edit this document");
    if (!this.#vectorEdit || this.#interaction) throw new Error("No idle vector edit session");
    const next = clampVectorEdit(this.#snapshot.document, update(this.#vectorEdit));
    if (!next) throw new Error("Not a vector");
    this.#vectorEdit = next; this.#vectorListeners.forEach(listener => listener()); this.#notifyCanvas();
  }
  /** Every preview derives from the captured document and selection; failures leave it unchanged. */
  previewVectorEdit(update: (document: Document, state: VectorEditState) => { document: Document; state: VectorEditState }): void {
    const interaction = this.#interaction;
    if (!interaction?.baseVectorEdit) throw new Error("No active vector interaction");
    const next = update(interaction.base.document, interaction.baseVectorEdit);
    const state = clampVectorEdit(next.document, next.state); if (!state) throw new Error("Not a vector");
    interaction.document = next.document; interaction.vectorEdit = state; this.#notifyCanvas();
  }
  previewSelection(ids: readonly NodeId[]): void {
    const interaction = this.#interaction;
    if (!interaction) throw new Error("No active interaction");
    interaction.selection = executeSelection("select.set", interaction.base.document, interaction.base.selection, { ids }).selection;
    this.#notifyCanvas();
  }
  /** Absolute move preview always derives from the captured source and allocator. */
  previewMove(ids: readonly NodeId[], delta: Point, duplicate: boolean, point: Point): MoveDrop {
    const interaction = this.#interaction;
    if (!interaction) throw new Error("No active interaction");
    if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) throw new Error("Move delta must be finite");
    let draft: HierarchyDraft, nextId = this.#nextId;
    let duplicated: Duplicated | undefined;
    if (duplicate) {
      if (!interaction.preparedCopy || !sameIds(interaction.preparedCopy.ids, ids)) {
        const source = new HierarchyDraft(interaction.base.document);
        interaction.preparedCopy = { ids: Object.freeze([...ids]), draft: source, result: copyLayers(source, ids, nextId) };
      }
      const copy = interaction.preparedCopy;
      draft = copy.draft.fork();
      duplicated = copy.result.duplicated;
      nextId = copy.result.nextId;
    } else draft = new HierarchyDraft(interaction.base.document);
    const cache = duplicate ? undefined : (interaction.moveSlot ??= {});
    const {document, drop} = placeMove(draft, duplicated?.copies ?? ids, delta, point, cache);
    interaction.document = document;
    interaction.selection = duplicated?.copies ?? interaction.base.selection;
    interaction.nextId = nextId;
    interaction.duplicated = duplicated;
    this.#notifyCanvas();
    return drop;
  }
  previewDraw(kind: DrawShapeKind, box: import("./geometry").Rectangle & { angle?: number }, parent: NodeId): void {
    const interaction = this.#interaction; if (!interaction) throw new Error("No active interaction");
    const { angle = 0, ...dimensions } = box, c = Math.cos(angle), s = Math.sin(angle);
    const next = createLayer(interaction.base, this.#nextId, `shape.${kind}`, { ...dimensions, parent }, this.#view, [c, s, -s, c, box.x, box.y]);
    interaction.document = next.document; interaction.selection = next.selection; interaction.nextId = next.nextId; this.#notifyCanvas();
  }
  finishDraw():void {
    const gesture=this.#interaction;
    if (gesture?.base.tool==="section" && gesture.selection.length===1) {
      const {document}=gesture, id=gesture.selection[0], section=document.nodes[id];
      if (section.kind==="section") {
        const parent=document.nodes[section.parent], area=boundsOf(document,[id]);
        if (area && "children" in parent) {
          const draft=new HierarchyDraft(document);
          for (const sibling of parent.children) {
            const node=document.nodes[sibling];
            if (sibling===id || node.kind==="page" || node.visible===false || node.locked) continue;
            const box=boundsOf(document,[sibling]);
            if (box && box.x>=area.x && box.y>=area.y && box.x+box.width<area.x+area.width && box.y+box.height<area.y+area.height)
              draft.reparent(sibling,id);
          }
          gesture.document=draft.finish();
        }
      }
    }
    this.commitInteraction();
  }
  previewPenPath(points: readonly PenAnchor[], parent: NodeId, closed: boolean, join?: number): NodeId {
    const interaction = this.#interaction; if (!interaction) throw new Error("No active Pen interaction");
    const shape = buildPenPath(points, worldTransform(interaction.base.document, parent), closed, join); if (!shape) throw new Error("Pen needs two anchors");
    const created = createLayer(interaction.base, this.#nextId, "vector.create", { parent, props: { fills: closed ? ["#d9d9d9"] : [], strokes: ["#000000"], strokeAlign: "center" } }, this.#view);
    const node = created.document.nodes[created.id]; if (node.kind !== "vector") throw new Error("Not a vector");
    const draft = new HierarchyDraft(created.document); draft.set(withLayerTransform({ ...node, network: shape.network, width: shape.width, height: shape.height }, shape.transform));
    interaction.document = validateChangedGeometry(draft); interaction.selection = created.selection; interaction.nextId = created.nextId; this.#notifyCanvas(); return created.id;
  }
  invalidateCanvas(): void { this.#notifyCanvas(); }
  previewProperties(id: NodeId, props: Record<string, unknown>): void {
    const interaction = this.#interaction; if (!interaction) throw new Error("No active interaction");
    interaction.document = setRectangleProperties(interaction.base.document, [id], { id, props }); this.#notifyCanvas();
  }
  editMixedGeometry(key: GeometryField, edit: FieldEdit): string[] {
    this.beginInteraction();
    const owner = this.#interaction!, {document,selection} = owner.base;
    const errors: string[] = [];
    const edits = new Map<NodeId,number>();
    try {
      let independent = true;
      for (const id of selection) {
        const layer = document.nodes[id];
        if (!layer || layer.kind === "page") continue;
        const next = fieldValue(edit,shownGeometry(document,layer,key));
        if (next === undefined) continue;
        edits.set(id,next);
        independent &&= document.nodes[layer.parent]?.kind === "page";
      }
      const origin = movedOrigin(document,selection,this.#origin);
      if (independent && edits.size) {
        try {
          owner.document = setPageGeometryFields(document,selection,key,edits,origin);
          edits.clear();
        } catch { /* Retry individually to retain the native successes and per-layer errors. */ }
      }
      // An earlier edit can reflow a selected descendant. Read old values from the original
      // selection, then apply them in selection order to each successive document.
      for (const [id,next] of edits) {
        try {
          owner.document = setRectangleProperties(owner.document,selection,{id,props:{[key]:next}},origin);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : "Could not edit the geometry");
        }
      }
      this.commitInteraction();
    } catch (error) {
      if (this.#interaction === owner) this.cancelInteraction();
      throw error;
    }
    return errors;
  }
  beginLayoutField(command: "node.set" | "layout.setTrack") {
    this.beginInteraction();
    const owner = this.#interaction!;
    const {document,selection} = owner.base;
    return {
      preview: (params: Record<string,unknown>) => {
        if (this.#interaction !== owner) return;
        owner.document = command === "node.set"
          ? setRectangleProperties(document,selection,params,movedOrigin(document,selection,this.#origin))
          : setGridTrack(document,selection,params);
        this.#notifyCanvas();
      },
      commit: () => { if (this.#interaction === owner) this.commitInteraction(); },
      cancel: () => { if (this.#interaction === owner) this.cancelInteraction(); },
    };
  }
  setPaintPicker(paintPicker?: PaintPicker): void {
    if (paintPicker && !this.#snapshot.editable) return;
    this.#publish(paintPicker ? {paintPicker,crop:undefined} : {paintPicker});
  }
  /** The native canvas handles edit one open picker. Mixed region paints have no target. */
  #pickedPaint(picker: PaintPicker | undefined) {
    const ids=this.getRenderSelection();
    if (!picker || picker.styleId !== undefined || ids.length !== 1) return;
    const node=this.getRenderDocument().nodes[ids[0]];
    if (!node || node.kind === "page") return;
    const regions=picker.list==="fill" ? selectedRegionFills(node,this.getRenderVectorEdit()) : undefined;
    const stack=picker.list==="stroke" ? node.strokes : regions===undefined ? characterFills(node) : regions;
    const paint=stack?.[picker.index];
    if (paint) return {node,paint,picker};
  }
  pickedGradient() {
    const hit=this.#pickedPaint(this.#snapshot.paintPicker);
    if (hit?.paint.type==="gradient") return {...hit,paint:hit.paint};
  }
  pickedCrop() {
    const {paintPicker,crop}=this.#snapshot;
    const picker=paintPicker ?? (crop && crop.id===this.getRenderSelection()[0] ? {list:"fill" as const,index:crop.index,stop:0} : undefined);
    const hit=this.#pickedPaint(picker);
    if (hit?.paint.type!=="image" || hit.paint.scale_mode!=="crop") return;
    const resource=this.getRenderDocument().images?.[hit.paint.image];
    if (resource) return {...hit,paint:hit.paint,resource};
  }
  /** Keep a mounted editor in step with asynchronous page-local font reads. */
  observeLocalFonts() {
    let needFit=false, queued=false, disposed=false;
    const schedule=()=>{
      if (!needFit || queued || this.interacting || !this.#snapshot.editable) return;
      queued=true;
      queueMicrotask(()=>{
        queued=false;
        if (disposed || this.interacting || !this.#snapshot.editable) return;
        needFit=false;
        // Font arrival can land while a menu is hovering a family. Remeasure both views.
        if (this.#textPreview) this.#textPreview=refitText(this.#textPreview,{}).document;
        this.#refitOpenText({});
        this.invalidateCanvas();
      });
    };
    const detachCanvas=this.subscribeCanvas(schedule);
    const detachFonts=subscribeFonts(loaded=>{
      needFit ||= loaded;
      if (this.#snapshot.missingFonts) this.#publish({missingFonts:missingFonts(this.#snapshot.document)});
      else this.invalidateCanvas();
      schedule();
    });
    return ()=>{disposed=true;detachFonts();detachCanvas();};
  }
  #refitOpenText(params:Record<string,unknown>, families?:readonly string[]) {
    const before=this.#snapshot, {document,refitted}=refitText(before.document,params,families);
    if (document!==before.document) {
      this.#commitEdit({document});
    }
    return {refitted};
  }

  endTextPreview() {
    if (!this.#textPreview) return false;
    this.#textPreview=undefined;
    this.#notifyCanvas();
    return true;
  }

  #previewChange(params:Record<string,unknown>) {
    for (const key of Object.keys(params)) if (!["id","ids","command","params"].includes(key)) throw new Error("Unknown text.preview option");
    this.endTextPreview();
    const command=parseString(params.command), nested=parameters(params.params ?? {});
    const base=this.getRenderDocument(), selection=this.getRenderSelection();
    let shown:Document;
    if (command==="text.style" || command==="node.set") {
      shown=setRectangleProperties(base,selection,nested,movedOrigin(base,selection,this.#origin),[],command==="text.style" ? command : undefined);
    } else if (command==="text.setVariations") {
      shown=executeTextFormat(command,base,selection,nested,this.getTextRange()).document;
    } else if (command==="fill.set") {
      shown=writeFill(command,base,selection,nested,this.#vectorEdit);
    } else if (command==="stroke.set") {
      shown=executeStrokeList(command,base,selection,nested);
    } else throw new Error("Unsupported preview command: "+command);
    // A successful native property write owns the preview even for an equal value.
    this.#textPreview=shown;
    this.#notifyCanvas();
    return {previewing:true};
  }
  closeMissingFonts() { if (this.#snapshot.missingFonts) this.#publish({missingFonts:undefined}); }
  closeLibraryPanel() { if (this.#snapshot.libraryPanel) this.#publish({libraryPanel:undefined}); }
  closeProfileDialog() { if (this.#snapshot.profileDialog) this.#publish({ profileDialog: false }); }
  finishCrop() { if (this.#snapshot.crop) this.#publish({crop:undefined}); }
  /** A menu may outlive its gesture after selection changes or edit access is revoked. */
  beginBlendPreview(picker?: PaintPicker) {
    if (this.interacting || !this.#snapshot.editable || (picker?.styleId === undefined && !this.#snapshot.selection.length)) return;
    this.beginInteraction();
    const owner = this.#interaction!;
    const {document,selection} = owner.base;
    return {
      show: (blend:BlendMode) => {
        if (this.#interaction !== owner) return;
        if (picker?.styleId !== undefined) {
          owner.document = editStylePaint(document,picker.styleId,picker.index,paint=>({...paint,blend}));
        } else if (picker) {
          const params = {ids:selection,index:picker.index,blend};
          owner.document = picker.list === "stroke" ? executeStrokeList("stroke.set",document,selection,params)
            : writeFill("fill.set",document,selection,params,owner.baseVectorEdit);
        } else owner.document = setRectangleProperties(document,selection,{ids:selection,props:{blend}});
        this.#notifyCanvas();
      },
      cancel: () => { if (this.#interaction === owner) this.cancelInteraction(); },
    };
  }
  toggleEffectSettings(index: number) {
    if (!this.#snapshot.editable) return;
    const open = this.#snapshot.openEffects ?? [];
    this.#publish({openEffects: Object.freeze(open.includes(index) ? open.filter(i => i !== index) : [...open,index])});
  }
  beginEffectPreview(index: number) {
    const {editable, document, selection} = this.#snapshot;
    if (!editable || this.interacting || !selection.length || !selection.every(id => document.nodes[id]?.effects?.[index])) return;
    this.beginInteraction();
    const owner = this.#interaction!;
    return {
      preview: (effect: Effect) => {
        if (this.#interaction !== owner) return;
        owner.document = editEffects("effect.set",document,selection,{ids:selection,index,effect:wireEffect(effect)});
        this.#notifyCanvas();
      },
      commit: () => { if (this.#interaction === owner) this.commitInteraction(); },
      cancel: () => { if (this.#interaction === owner) this.cancelInteraction(); },
    };
  }
  previewPaint(picker: PaintPicker, paint: Paint): void {
    const interaction = this.#interaction;
    if (!interaction) throw new Error("No active paint interaction");
    const { document, selection } = interaction.base;
    if (picker.styleId !== undefined) {
      interaction.document = editStylePaint(document,picker.styleId,picker.index,()=>paint);
      this.#notifyCanvas();
      return;
    }
    const params = { ids: selection, index: picker.index, paint };
    interaction.document = picker.list === "fill"
      ? writeFill("fill.set", document, selection, params, interaction.baseVectorEdit)
      : executeStrokeList("stroke.set", document, selection, params);
    this.#notifyCanvas();
  }
  previewResize(start: ResizeStart, point: Point, keep: boolean, centre: boolean, keepChildren: boolean, scale?: ScaleAnchor): ReturnType<typeof previewResize>["hint"] {
    const interaction = this.#interaction; if (!interaction) throw new Error("No active interaction");
    const next = previewResize(interaction.base.document, start, point, keep, centre, keepChildren, scale);
    interaction.document = next.document; this.#notifyCanvas(); return next.hint;
  }
  previewRotate(ids: readonly NodeId[], degrees: number, pivot: Point): void {
    const interaction = this.#interaction; if (!interaction) throw new Error("No active interaction");
    interaction.document = executeRotation("transform.rotate", interaction.base.document, ids, { ids, degrees, cx: pivot.x, cy: pivot.y }); this.#notifyCanvas();
  }
  previewScale(factor: number, pivot: Point): void {
    const interaction = this.#interaction; if (!interaction) throw new Error("No active interaction");
    interaction.document = executeSizing("transform.scale", interaction.base.document, interaction.base.selection, { factor, cx: pivot.x, cy: pivot.y }); this.#notifyCanvas();
  }
  finishMove(ids: readonly NodeId[], target: NodeId): void {
    const interaction = this.#interaction;
    if (!interaction) return;
    const moving = interaction.duplicated?.copies ?? ids, draft = new HierarchyDraft(interaction.document);
    const inLayout = moving.some(id => {
      const parent = draft.nodes[draft.nodes[id].parent!];
      return isFrameLike(parent) && parent.layout;
    });
    if (inLayout) interaction.duplicated = undefined;
    if (!inLayout && draft.nodes[moving[0]]?.parent !== target) for (const id of moving) {
      const node = draft.nodes[id];
      if (!node || node.kind === "page" || isGroupLike(draft.nodes[node.parent]) || id === target || ancestorIds(draft.document, target).includes(id)) continue;
      draft.reparent(id, target);
    }
    draft.normaliseGroups(); interaction.document = validateChangedGeometry(draft);
    this.commitInteraction();
  }
  #notifyCanvas(): void { if (this.#textRange && !this.#textRange.active()) this.#textRange = undefined; this.#refreshOrigin(); this.#canvasListeners.forEach(listener => listener()); }
  cancelInteraction(): boolean {
    if (!this.#interaction) return false;
    this.#interaction = undefined; this.#editing=undefined;this.#textRange=undefined; this.#notifyCanvas(); return true;
  }
  commitInteraction(): boolean {
    const interaction = this.#interaction;
    if (!interaction) return false;
    this.#interaction = undefined; this.#editing=undefined;this.#textRange=undefined;
    const { base, document, selection } = interaction;
    const vectorChanged = interaction.vectorEdit !== interaction.baseVectorEdit;

    // Moving back to the source adds no history; copies and parenting are content changes.
    const changed = document !== base.document && (Object.keys(document.nodes).length !== Object.keys(base.document.nodes).length || Object.keys(document.nodes).some(id => {
      const node = document.nodes[id], old = base.document.nodes[id];
      return node !== old && JSON.stringify(node) !== JSON.stringify(old);
    }));
    if (changed) {
      try {
        this.#commitEdit({ document, selection }, {nextId:interaction.nextId, duplicated:interaction.duplicated, vectorEdit:interaction.vectorEdit});
      } catch (error) {
        this.#notifyCanvas();
        throw error;
      }
    } else {
      if (vectorChanged) this.#vectorEdit = interaction.vectorEdit;
      if (!sameIds(base.selection, selection)) this.#publish({ selection });
      else { if (vectorChanged) this.#vectorListeners.forEach(listener => listener()); this.#notifyCanvas(); }
    }
    return changed;
  }
  getView = (): Viewport => this.#view;
  getRotationOrigin = (): OriginSnapshot => this.#originSnapshot;
  subscribeOrigin = (listener: () => void): (() => void) => { this.#originListeners.add(listener); return () => { this.#originListeners.delete(listener); }; };
  #refreshOrigin(): void {
    const { selection: committedSelection, editable } = this.#snapshot, document = this.getRenderDocument(), selection = this.getRenderSelection();
    if (this.#origin && (!editable || !sameIds(committedSelection, this.#origin.ids))) this.#origin = undefined;
    const moved = movedOrigin(document, selection, this.#origin);
    let point = moved;
    // Derived overlays must not interrupt publication of an already validated transaction.
    if (!point) try { point = originBoxPoints(document, selection)?.[8]; } catch { point = undefined; }
    const next = { editing: Boolean(this.#origin?.editing && sameIds(selection, this.#origin.ids)), moved: Boolean(moved), ...(point ? { point: Object.freeze(point) } : {}) };
    const old = this.#originSnapshot;
    if (old.editing === next.editing && old.moved === next.moved && old.point?.x === point?.x && old.point?.y === point?.y) return;
    this.#originSnapshot = Object.freeze(next); this.#originListeners.forEach(listener => listener());
  }
  dragRotationOrigin(point: Point, zoom: number): void {
    const { document, selection, editable } = this.#snapshot;
    if (!editable || !this.#originSnapshot.editing) return;
    const snapped = snappedOrigin(document, selection, point, zoom);
    this.execute("transform.setRotationOrigin", snapped ?? { reset: true });
  }
  endOriginEdit(): boolean {
    if (!this.#originSnapshot.editing) return false;
    this.execute("transform.rotationOrigin", { on: false }); return true;
  }
  subscribeView = (listener: () => void): (() => void) => { this.#viewListeners.add(listener); return () => { this.#viewListeners.delete(listener); }; };
  updateView(view: Viewport): void {
    if ([view.cx, view.cy, view.zoom, view.vw, view.vh].some(value => !Number.isFinite(value)) || [view.snapObjects, view.snapPixel, view.proofSrgb, view.slices, view.layoutGrids].some(value => value !== undefined && typeof value !== "boolean") || view.zoom < 0.02 || view.zoom > 256 || view.vw <= 0 || view.vh <= 0) throw new Error("Invalid viewport");
    if ((Object.keys(view) as (keyof Viewport)[]).every(key => view[key] === this.#view[key])) return;
    if(!this.#followingView && this.#people?.following!==undefined && (view.cx!==this.#view.cx || view.cy!==this.#view.cy || view.zoom!==this.#view.zoom))this.#people.setFollow();
    this.#view = Object.freeze({ ...view }); this.#viewListeners.forEach(listener => listener());
  }
  resizeViewport(width: number, height: number): void {
    const next = { ...this.#view, vw: Math.max(1, width), vh: Math.max(1, height) };
    this.updateView(!this.#viewportAttached && !this.#viewConfigured ? fitPage(next, this.#snapshot.document) : next);
    this.#viewportAttached = true;
  }
  subscribe = (listener: () => void): (() => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; };
  captureNativeSnapshot() {
    const { document, nextId, versions, branches } = this.archiveRevision;
    return () => encodeFigcraftBlob(document, String(nextId), versions, undefined, branches);
  }
  nativeSnapshot = (): Promise<Uint8Array> => encodeFigcraft(this.#fileDocument(), String(this.#nextId), this.#history.records, this.#branches);
  #cacheLibrary(path:string,source:PublishedLibrary) {
    if (this.#libraryFiles.size>=MAX_CACHED_LIBRARIES && !this.#libraryFiles.has(path)) this.#libraryFiles.clear();
    this.#libraryFiles.set(path,source);this.#libraryRevision++;
  }
  get fileGeneration() {return this.#openSequence;}
  librarySource(path:string) { return this.#libraryFiles.get(path); }
  get importedTeamInvites() { return this.#importedTeamInvites; }
  pickLibrary(file:File,remember?:(path:string,publication:Blob)=>Promise<void>) {
    return this.loadLibrary(async () => {
      if (file.size>1024 ** 3) throw Error("The library file exceeds 1 GiB");
      const source=await decodePublishedLibrary(file);
      if (!source) throw Error("This file has no published library");
      return {source,path:"library-file:"+source.manifest.id+"/"+encodeURIComponent(file.name)};
    },remember);
  }

  loadTeamLibrary(path:string, host:OnlineTeamLibraries, remember?:(path:string,publication:Blob)=>Promise<void>) {
    return this.loadLibrary(async () => {
      const cached=this.librarySource(path);
      const doc=this.#snapshot.document;
      const link=doc.libraryLinks?.find(l=>l.path===path);
      const reply=await host.fetch(path,cached?.manifest.version ?? null,libraryUsageReport(doc,link?.id ?? ""));
      if (reply.state==="empty") throw new Error("That file has no library on the server yet");
      if (reply.state==="unchanged" && cached?.manifest.version===reply.version) return {source:cached,path};
      if (reply.state!=="available") throw new Error("Invalid library receipt");
      const source=await decodePublishedLibrary(reply.archive);
      if (!source || source.manifest.version!==reply.version) throw new Error("The archive does not match the advertised library version");
      const linked=this.#snapshot.document.libraryLinks?.find(link=>link.path===path);
      if (linked && source.manifest.id!==linked.id) throw new Error("This file now holds another library");
      return {source,path};
    },remember);
  }

  async readTeamLibraryUsage(path:string,host:OnlineTeamLibraries,days:number) {
    if (!host.usage) throw new Error("The host cannot report library usage");
    let library=this.librarySource(path);
    if (!library) {
      const reply=await host.fetch(path,null);
      if (reply.state==="empty") throw new Error("That file has no library on the server yet");
      if (reply.state!=="available") throw new Error("Invalid library receipt");
      library=await decodePublishedLibrary(reply.archive) ?? undefined;
      if (!library || library.manifest.version!==reply.version) throw new Error("Invalid server library archive");
    }
    return {data:await host.usage(path,days),library};
  }

  async refreshTeamLibrary(path:string,host:OnlineTeamLibraries,remember?:(path:string,archive:Blob)=>Promise<void>) {
    const doc=this.#snapshot.document,enabled=doc.libraryLinks?.find(l=>l.path===path);
    if (!enabled || this.#teamChecking.has(path)) return;
    const identity=this.#documentIdentity,opening=this.#openSequence,initial=this.librarySource(path);
    const active=()=>identity===this.#documentIdentity && opening===this.#openSequence && this.#snapshot.editable &&
      this.#snapshot.document.libraryLinks?.some(l=>l.id===enabled.id && l.path===path) && initial===this.librarySource(path);
    this.#teamChecking.add(path);
    try {
      const report=libraryUsageReport(doc,enabled.id);
      const reply=await host.fetch(path,initial?.manifest.version ?? null,report);
      if (reply.state!=="available" || !active()) return;
      const source=await decodePublishedLibrary(reply.archive);
      if (!source || source.manifest.id!==enabled.id || source.manifest.version!==reply.version || !active()) return;
      await prepareDocumentText(source.document);
      if (!active()) return;
      if (remember) {
        const archive=await encodePublishedLibrary(source);
        if (!active()) return;
        await remember(path,archive);
      }
      if (active()) {this.#cacheLibrary(path,source);this.#publish({});}
    } finally {this.#teamChecking.delete(path);}
  }

  private async loadLibrary(load:()=>Promise<{source:PublishedLibrary;path:string}>,
    remember?: (path:string,publication:Blob)=>Promise<void>) {
    const identity=this.#documentIdentity,opening=this.#openSequence,pick=++this.#libraryPick;
    const current=()=>{
      if (!this.#snapshot.editable || identity!==this.#documentIdentity || opening!==this.#openSequence || pick!==this.#libraryPick) {
        throw Error("The destination or library selection changed");
      }
    };
    current();
    const {source,path}=await load();
    current();
    if (source===this.librarySource(path) && this.#snapshot.document.libraryLinks?.some(link=>link.id===source.manifest.id && link.path===path)) {
      return {id:source.manifest.id,path,version:source.manifest.version};
    }
    if (this.#snapshot.document.published?.manifest.id===source.manifest.id) throw Error('this file is the library "'+source.manifest.name+'"');
    await prepareDocumentText(source.document);current();
    if (remember) {
      const archive=await encodePublishedLibrary(source);
      current();await remember(path,archive);current();
    }
    this.#cacheLibrary(path,source);
    return this.execute("library.add",{path});
  }
  async publishTeamLibrary(path:string,host:OnlineTeamLibraries,params:Record<string,unknown>) {
    const base=this.#snapshot.document, identity=this.#documentIdentity, opening=this.#openSequence;
    const check=()=>{
      if (!this.#snapshot.editable || this.#documentIdentity!==identity || opening!==this.#openSequence) throw new Error("The source document changed");
    };
    check();
    const options=JSON.stringify(params);
    let pending=this.#teamSubmission;
    if (!pending || pending.path!==path || pending.document!==base || pending.options!==options) {
      const reply=await host.fetch(path,null);
      if (reply.state==="unchanged") throw new Error("Unexpected library receipt");
      const remote=reply.state==="available" ? await decodePublishedLibrary(reply.archive) : undefined;
      if (reply.state==="available" && (!remote || remote.manifest.version!==reply.version)) throw new Error("Invalid server library archive");
      const doc=remote ? {...base,published:remote} : base;
      let library: PublishedLibrary;
      try { library=publishLibrary(doc,params).document.published; }
      catch (error) {
        if (remote || !base.published || !(error instanceof Error) || !error.message.startsWith("no changes to publish")) throw error;
        library=base.published;
      }
      const archive=await encodePublishedLibrary(library);
      check();
      pending={path,document:base,options,id:crypto.randomUUID(),archive,library};
      this.#teamSubmission=pending;
    }
    let version:string;
    try { version=await host.publish(path,pending.archive,pending.id); }
    catch (error) {
      if (this.#teamSubmission===pending && error && typeof error==="object" && "status" in error &&
        [400,403,409,413,422].includes(Number(error.status))) this.#teamSubmission=undefined;
      throw error;
    }
    if (pending.library.manifest.version!==version) throw new Error("Invalid server library receipt");
    check();
    if (this.#teamSubmission===pending) this.#teamSubmission=undefined;
    this.#cacheLibrary(path,pending.library);
    this.#publish({});
    return version;
  }

  async restoreLibrary(link:LibraryLink,read:(path:string)=>Promise<Blob|null>) {
    const identity=this.#documentIdentity,opening=this.#openSequence;
    const current=()=>this.#snapshot.editable && identity===this.#documentIdentity && opening===this.#openSequence &&
      !this.#libraryFiles.has(link.path) && this.#snapshot.document.libraryLinks?.some(l=>l.id===link.id && l.path===link.path);
    if (!current()) return;
    const file=await read(link.path);
    if (!file || !current()) return;
    const source=await decodePublishedLibrary(file);
    if (!source || !current()) return;
    await prepareDocumentText(source.document);
    if (current()) { this.#cacheLibrary(link.path,source);this.#publish({}); }
  }
  async importVariableFile(file:Blob) {
    if (!this.#snapshot.editable) throw new Error("Sign in to edit this document");
    if (file.size>256*1024*1024) throw new Error("Variable files must be at most 256 MiB");
    const document=this.#documentIdentity,opening=this.#openSequence;
    const text=await file.text();
    if (document!==this.#documentIdentity || opening!==this.#openSequence) throw new Error("The open document changed during import");
    return this.execute("variable.import",{variables:text});
  }
  cancelPendingFiles(): void { this.#openSequence++; this.#pendingSaves.clear(); }
  #preparedEdit?: {base: Document; proposed: Document; allocator: bigint; result: ReturnType<typeof finishComponentEdit>};

  #prepareEdit(proposed: Document, allocator: bigint) {
    const base = this.#snapshot.document, previous = this.#preparedEdit;
    if (previous?.base === base && previous.proposed === proposed && previous.allocator === allocator) return previous.result;
    const projected=refreshBoundStyles(refreshLayerBindings(proposed,base,false,true),base);
    const components=finishComponentEdit(base,projected,allocator);
    const result=components.document===projected ? components : {...components,document:refreshBoundStyles(refreshLayerBindings(components.document,base),base)};
    this.#preparedEdit = {base,proposed,allocator,result};
    return result;
  }

  #commitEdit(patch: Partial<EditorSnapshot> & { document: Document }, options: {
    record?: boolean;
    libraryEdit?:boolean;
    nextId?: bigint;
    duplicated?: Duplicated;
    vectorEdit?: VectorEditState;
  } = {}) {
    const before = this.#snapshot;
    const proposed=options.duplicated ? countLibraryInstances(patch.document,options.duplicated.copies,"inserted") : patch.document;
    const prepared = this.#prepareEdit(proposed, options.nextId ?? this.#nextId);
    const nextId=prepared.nextId,document=followCommentAnchors(prepared.document,before.document);
    if (this.#idClient && nextId > ((BigInt(this.#idClient) + 1n) << 32n)) throw new Error(this.#branchTab ? "Branch identifiers are exhausted" : "Live client identifiers are exhausted");
    guardLibraryVariables(before.document,document);
    if (!options.libraryEdit) guardLibraryStore(before.document,document);
    if (options.record !== false && !this.#liveHistory) {
      this.#undo.push({ document: before.document, selection: before.selection });
      this.#redo = [];
    }
    this.#nextId = nextId;
    if (options.duplicated) this.#lastDuplicate = options.duplicated;
    if ("vectorEdit" in options) this.#vectorEdit = options.vectorEdit;
    const selection = patch.selection ?? before.selection;
    const surviving = selection.every(id=>document.nodes[id]) ? selection : Object.freeze(selection.filter(id=>document.nodes[id]));
    if (options.record === false) this.#unrecordedLiveEdits.add(document);
    this.#publish({...patch, document, selection:surviving});
  }
  #publish(patch: Partial<EditorSnapshot>): void {
    const document = patch.document ?? this.#snapshot.document;
    if(!this.#followingView && this.#people?.following!==undefined && document.currentPage!==this.#snapshot.document.currentPage)this.#people.setFollow();
    if (document !== this.#snapshot.document) this.#preparedEdit = undefined;
    if (patch.editable === false || patch.selection && !sameIds(patch.selection, this.#snapshot.selection)) patch = { ...patch, paintPicker: undefined, openEffects: undefined };
    this.#snapshot = Object.freeze({ ...this.#snapshot, ...patch, canUndo: this.#liveHistory?.canUndo ?? this.#undo.length > 0, canRedo: this.#liveHistory?.canRedo ?? this.#redo.length > 0, dirty: !sameContent(this.#preview?.document ?? document, this.#saved) || this.#history.records !== this.#savedVersions || this.#branches !== this.#savedBranches, hasSaved: this.#downloaded });
    if (this.#lastDuplicate && !duplicateSelection(this.#lastDuplicate, this.#snapshot.selection)) this.#lastDuplicate = undefined;
    if (this.#vectorEdit) this.#vectorEdit = pageForNode(document, this.#vectorEdit.id) === document.currentPage ? clampVectorEdit(document, this.#vectorEdit) : undefined;
    if (this.#snapshot.crop && (!this.#snapshot.editable || !this.pickedCrop())) {
      this.#snapshot = Object.freeze({...this.#snapshot,crop:undefined});
    }
    if (this.#textRange && !this.#textRange.active()) this.#textRange = undefined;
    this.#vectorListeners.forEach(listener => listener());
    this.#refreshOrigin();
    this.#canvasListeners.forEach(listener => listener());
    this.#listeners.forEach(listener => listener());
  }
  setEditable(editable: boolean): void {
    this.#hostEditable = editable;
    this.setCommentAccess(editable,this.#commentName);
    if (!editable) this.exitVersionPreview();
    if (editable && this.#preview) return;
    if (!editable) this.endTextPreview();
    if (!editable) this.pencil.cancel();
    if (!editable) this.pen.cancel();
    if (!editable) this.cancelInteraction();
    if (!editable) {this.#importedTeamInvites=new Map();this.#teamSubmission=undefined;this.cancelPendingFiles();this.#libraryFiles.clear();this.#libraryRevision++;}
    if (!editable) { this.#vectorEdit = undefined; this.#clipboard.properties = undefined; this.#clipboard.layers = undefined; this.#clipboard.paint = undefined; this.#clipboard.effect = undefined; }
    if (editable !== this.#snapshot.editable) this.#publish({ editable, tool: "move", profileDialog: false, libraryPanel:undefined, missingFonts: undefined });
  }
  #navigateComment(command:string,p:Record<string,unknown>):Record<string,unknown> {
    const doc=this.#snapshot.document;
    if (command==="comment.zoom") {
      const ids=new Set(Array.isArray(p.ids)?p.ids.map(parseNodeId):[]);
      const points=(doc.comments??[]).filter(c=>c.page===doc.currentPage && ids.has(c.id)).map(c=>commentPosition(doc,c));
      if (!points.length) throw new Error("No comments on this page");
      let left=points[0].x,right=left,top=points[0].y,bottom=top;
      for(const point of points) {
        left=Math.min(left,point.x);right=Math.max(right,point.x);top=Math.min(top,point.y);bottom=Math.max(bottom,point.y);
      }
      const fit=fitView(this.#view,{x:left,y:top,width:right-left,height:bottom-top});
      this.updateView({...fit,zoom:Math.min(256,Math.max(this.#view.zoom*2,fit.zoom))});
      return {zoom:this.#view.zoom};
    }
    const who=typeof p.author==="string" && p.author.trim() || this.#commentName;
    let id=commentId(p);
    if (command==="comment.next") {
      const list=queryComments(doc,p,who),at=list.findIndex(c=>String(c.id)===id),dir=Number(p.dir)<0?-1:1;
      if (!list.length) throw new Error("No comments in the list");
      id=String(list[at<0?(dir<0?list.length-1:0):Math.max(0,Math.min(list.length-1,at+dir))].id);
    }
    const how=command==="comment.next"?"center":p.view??"fit";
    if (!["fit","keep","center"].some(v=>v===how)) throw new Error("Unknown comment view");
    const c=doc.comments?.find(t=>t.id===id);
    if (!c || !doc.pages.includes(c.page)) throw new Error("No such comment on an existing page");
    const switched=doc.currentPage!==c.page;
    if (switched && this.#liveHistory) {
      this.#livePage={local:c.page,shared:this.liveDrawing().currentPage};
      this.#sharedDrawing=undefined;
    }
    let current=switched?Object.freeze({...doc,currentPage:c.page}):doc;
    if (this.#commentAccess && !this.#preview) current=editComment(current,"comment.markRead",{id},who).document;
    if(current!==doc) this.#unrecordedLiveEdits.add(current);
    this.#publish({document:current,...(switched && {selection:[]}),openComment:c.id});
    const row=queryComments(current,{page:c.page,author:who},who).find(t=>String(t.id)===c.id)!;
    const view=switched?fitPage(this.#view,current):this.#view;
    const box=row.frame!==null?boundsOf(current,[String(row.frame)]):undefined;
    if (how==="fit" && box) {
      const x=Math.min(row.x,box.x),y=Math.min(row.y,box.y);
      this.updateView(fitView(view,{x,y,width:Math.max(row.x,box.x+box.width)-x,height:Math.max(row.y,box.y+box.height)-y},1));
    } else if(how!=="keep" || switched) this.updateView({...view,cx:row.x,cy:row.y,zoom:how==="fit"?Math.max(1,view.zoom):view.zoom});
    return row;
  }
  execute(command: "file.versionHistory" | "version.list", input?: unknown): ReturnType<typeof versionDetails>[];
  execute(command:"text.edit.selection",input?:unknown):EditSelection|null;
  execute(command:"text.fonts",input?:unknown):ReturnType<typeof queryFonts>;
  execute(command: "select.layersAt", input: unknown): ReturnType<typeof layersAt>;
  execute(command: "node.get", input: unknown): ReturnType<typeof getNode>;
  execute(command: "shapeBuilder.regions", input?: unknown): ReturnType<typeof readBuilderRegions>;
  execute(command: "frame.presets", input?: unknown): typeof framePresets;
  execute(command: "image.presets", input?: unknown): ReturnType<typeof listImagePresets>;
  execute(command: "variable.list", input?: unknown): Variables;
  execute(command: "style.list", input?: unknown): ReturnType<typeof listStyles>;
  execute(command: "component.list", input?: unknown): ReturnType<typeof listComponents>;
  execute(command: "page.list", input?: unknown): ReturnType<typeof listPages>;
  execute(command: string, input?: unknown): Record<string, unknown>;
  execute(command: string, input: unknown = {}): Record<string, unknown> | Variables | ReturnType<typeof listStyles> | ReturnType<typeof listComponents> | ReturnType<typeof listPages> | typeof framePresets | ReturnType<typeof versionDetails>[] | ReturnType<typeof queryFonts> | null {
    if (!Object.hasOwn(commandSpecs, command)) throw new Error(`Unsupported command: ${command}`);
    if(Object.hasOwn(peopleCommands,command))return executePeople(this.#people,command,parameters(input));
    if (command==="pref.userName") {
      const {name}=parameters(input);
      if (typeof name!=="string") throw new Error("Your name must be text");
      this.#commentName=cleanDisplayName(name);
      this.#publish({});
      return {name:this.#commentName};
    }
    if (command==="view.comments" || command==="tool.comment") {
      if (!this.#commentRead || command==="tool.comment" && (!this.#commentAccess || this.#preview)) throw new Error("Comments are read-only");
      if (command==="view.comments") {
        const on=parseBoolean(parameters(input).on)??(this.#snapshot.showComments===false);
        this.#publish({showComments:on});
        return {on};
      }
      this.cancelInteraction();
      this.#publish({tool:"comment"});
      return {tool:"comment"};
    }
    if (command==="tool.move" && this.#snapshot.tool==="comment" && this.#commentRead) {
      this.#publish({tool:"move",openComment:undefined}); return {tool:"move"};
    }
    if (command==="comment.open" || command==="comment.next" || command==="comment.zoom") {
      if (!this.#commentRead) throw new Error("Sign in to read comments");
      return this.#navigateComment(command,parameters(input));
    }
    if (command==="comment.prompt") {
      if (!this.#commentRead) throw new Error("Sign in to read comments");
      return commentBrief(this.#snapshot.document,parameters(input),this.#commentName);
    }
    if (Object.hasOwn(commentQueries,command)) {
      if (!this.#commentRead) throw new Error("Sign in to read comments");
      return readCommentsCommand(this.#snapshot.document,command,parameters(input),this.#commentName);
    }
    if (Object.hasOwn(commentActions,command)) {
      if (!this.#commentAccess || this.#preview) throw new Error("This document is read-only");
      this.cancelInteraction();
      const before=this.#snapshot.document, ids=this.#assetIds();
      const next=editComment(before,command,parameters(input),this.#commentName,ids.allocate);
      if (next.document!==before) this.#commitEdit({document:next.document},{nextId:ids.next(),record:command!=="comment.markRead"});
      return next.result;
    }
    if (!this.#hostEditable && this.#commentAccess && this.#liveHistory && (command==="edit.undo" || command==="edit.redo")) {
      const undo=command==="edit.undo";
      return {[undo?"undone":"redone"]:this.#liveHistory.travel(undo)};
    }
    if (!this.#hostEditable) throw new Error("Sign in to edit this document");
    if (command === "file.export" || command === "file.exportSvg" || command === "file.exportFramesPdf" || command === "file.exportLayers") throw new Error("Use executeAsync to export a file");
    if (command === "version.exitPreview") return { ended: this.exitVersionPreview() };
    if (this.#preview) {
      if (command === "file.markSaved" || command === "file.saveVersion") this.exitVersionPreview();
      else if (command === "version.autosave") return { saved: false };
      else if (!command.startsWith("version.") && command !== "file.versionHistory" && !Object.hasOwn(viewSpecs, command)
        && !Object.hasOwn(selectionSpecs, command) && command !== "node.get" && command !== "edit.copy" && command !== "edit.copyProperties") {
        throw new Error("command `" + command + "` is not available right now: you're viewing an earlier version: restore it or go back to the current version to edit");
      }
    }
    const p = command==="text.fonts" || command==="text.rescanFonts" || command==="text.loadFont"
      ? fontParams(command,input) : isTextEditCommand(command) ? namedParameters(input) : parameters(input);
    if (command==="libraries.open" || command==="libraries.publish") {
      const [unexpected]=Object.keys(p);
      if (unexpected!==undefined) throw Error("invalid parameters for `"+command+"`: unknown parameter `"+unexpected+"` (it takes none)");
      this.#publish({libraryPanel:{publish:command==="libraries.publish"}});
      return {ok:true};
    }
    if (command==="paint.documentColors") return documentColours(this.#snapshot.document,p);
    if (command==="text.preview") return this.#previewChange(p);
    if (command==="text.endPreview") {
      if (Object.keys(p).some(k=>k!=="id" && k!=="ids")) throw new Error("Unknown text.endPreview option");
      return {ended:this.endTextPreview()};
    }
    this.endTextPreview();
    if (isTextEditCommand(command)) {
      const result=executeTextEdit(this,command,p);
      if (command!=="text.edit.selection") for (const listener of this.#textCommandListeners) listener();
      return result;
    }
    if (command === "text.fonts") return queryFonts(p);
    if (command==="edit.pasteDesignLayers") throw new Error(command+" requires executeAsync");
    if (command === "text.loadFont") throw new Error("text.loadFont requires executeAsync");
    if (command === "text.rescanFonts") return {added:[],refitted:[]};
    if (command === "text.openLink") {
      if (Object.keys(p).some(key=>key!=="id" && key!=="ids")) throw new Error("text.openLink takes no options");
      const active = this.getTextRange();
      if (!active) throw new Error("No text is being edited");
      return {url:textLinkAt(active.node.text,active.start)};
    }
    if (isTextFormatCommand(command)) {
      const live = this.getTextRange();
      if (!live) this.cancelInteraction();
      const before = this.#snapshot;
      const {document,result} = executeTextFormat(command,this.getRenderDocument(),before.selection,p,live);
      if (live) live.update(document,live.anchor,live.caret);
      else if (document!==before.document) {
        this.#commitEdit({document});
      }
      return result;
    }
    if (command === "shapeBuilder.mode") {
      if (p.mode !== "merge" && p.mode !== "remove") throw new Error("shapeBuilder.mode: mode must be merge or remove");
      this.#publish({builderMode:p.mode});
      return {mode:p.mode};
    }
    if (command === "shapeBuilder.regions") return readBuilderRegions(builderArrangement(this.#snapshot.document, builderTargets(p, this.#snapshot.selection)));
    if (command === "image.presets") return listImagePresets(this.#snapshot.document.imagePresets);
    if (command === "select.layersAt") return layersAt(this.getRenderDocument(), {x:parseNumber(p.x,"x"),y:parseNumber(p.y,"y")}, 2/Math.max(this.getView().zoom,1e-6), this.getRenderSelection());
    if (command === "node.get") return getNode(this.getRenderDocument(), p);
    if (this.pen.open && (command === "edit.undo" || command === "edit.redo")) {
      if (Object.keys(p).length) throw new Error(`${command} takes no parameters`);
      const undo = command === "edit.undo";
      if (this.pen.travel(undo)) return { [undo ? "undone" : "redone"]: true };
      // A path with no removed anchor declines Redo. An earlier document redo may still exist.
      const entry = this.#redo.pop(); if (!entry) return { redone: false };
      this.#undo.push({ document: this.getRenderDocument(), selection: this.getRenderSelection() });
      if (this.#interaction) { this.#nextId = this.#interaction.nextId; this.cancelInteraction(); }
      this.#lastDuplicate = undefined; this.#publish(entry); return { redone: true };
    }
    if (command === "tool.pencilBrush") {
      if (Object.hasOwn(p, "preset")) this.#pencilBrush = parseBrush(p.preset === null ? null : p);
      return { brush: this.#pencilBrush ? wireBrush(this.#pencilBrush) : null };
    }
    if (command.startsWith("tool.") && command !== "tool.scaleAnchor" && Object.keys(p).length) throw new Error(`${command} takes no parameters`);
    if (this.pen.open && command.startsWith("tool.") && command !== "tool.pen" && command !== "tool.scaleAnchor") this.pen.finish();
    const preservePen = this.pen.open && command === "tool.pen" || (this.pen.open || this.pencil.active) && (command === "tool.scaleAnchor" || Object.hasOwn(viewSpecs, command));
    if (preservePen && command === "tool.pen") { if (Object.keys(p).length) throw new Error("tool.pen takes no parameters"); return {}; }
    const gesture = Object.hasOwn(smartSpecs, command) && command !== "arrange.roundToPixels" && parseBoolean(p.fromGesture) === true;
    const preserveText = (command === "file.markSaved" || command === "library.applyStyle" || command.startsWith("style.")) && this.currentTextEdit();
    if (!gesture && !preservePen && !preserveText) { const interacting = this.interacting; this.pencil.cancel(); if (this.pen.open) this.pen.cancel(); else this.cancelInteraction(); if (interacting && command === "edit.undo") return { undone: true }; }
    if (command === "text.missingFonts") {
      if (Object.keys(p).some(key=>key!=="ids" && key!=="id")) throw new Error("Unknown text.missingFonts option");
      const families=Object.freeze(missingFonts(this.#snapshot.document));
      this.#publish({missingFonts:families});
      return {families};
    }
    if (command === "text.refit") return this.#refitOpenText(p);
    if (command === "text.onPath") {
      const before = this.#snapshot;
      const {document,selection,result} = putTextOnPath(before.document,before.selection,p);
      this.#commitEdit({document,selection});
      return result;
    }
    if (Object.hasOwn(vectorEditSpecs, command) || (this.#vectorEdit && isVectorJoin(command))) {
      const before = this.#snapshot, oldState = this.#vectorEdit, next = executeVectorEdit(isVectorJoin(command) ? command : command as VectorEditCommand, before.document, before.selection, oldState, p, this.#nextId);
      if (next.document !== before.document || !sameIds(next.selection, before.selection) || next.recordHistory || next.nextId !== undefined) {
        this.#commitEdit({document:next.document, selection:next.selection}, {record:!!next.recordHistory, nextId:next.nextId, vectorEdit:next.state});
      } else if (next.state !== oldState) {
        this.#vectorEdit = next.state;
        this.#vectorListeners.forEach(listener => listener());
        this.#notifyCanvas();
      }
      return next.result;
    }
    if (command === "tool.scaleAnchor") {
      for (const key of Object.keys(p)) if (key !== "anchor") throw new Error(`Unsupported scale anchor parameter: ${key}`);
      if (p.anchor !== undefined) {
        const anchor = typeof p.anchor === "string" ? p.anchor.trim().toLowerCase() : "";
        if (!anchors.includes(anchor as ScaleAnchor)) throw new Error("Unknown scale anchor");
        this.#publish({ scaleAnchor: anchor as ScaleAnchor });
      }
      return { anchor: this.#snapshot.scaleAnchor };
    }
    if (command === "version.list" || command === "file.versionHistory") {
      if (command === "file.versionHistory") this.#publish({ versionPanel: true });
      return this.versions.map((v, i) => ({ ...versionDetails(v, i), ...(this.#preview?.id === v.id && { previewing: true }) }));
    }
    if (command === "file.saveVersion" || command === "version.autosave") {
      const auto = command === "version.autosave", { document, dirty } = this.#snapshot;
      if (auto && (!dirty || !this.#history.changed(document))) return { saved: false };
      const version = this.#history.add(document, String(this.#nextId), p, auto);
      if (!version) return { saved: false };
      this.#publish({});
      return auto ? { saved: true, version } : version;
    }
    if (command === "version.rename" || command === "version.delete") {
      const removed = command === "version.delete" ? this.versions[this.#history.index(p)].id : undefined;
      const result = command === "version.rename" ? this.#history.rename(p) : this.#history.remove(p);
      if (removed && this.#preview?.id === removed) this.exitVersionPreview();
      this.#publish({});
      return result;
    }
    if (command === "object.setThumbnail") {
      const before = this.#snapshot, id = Array.isArray(p.ids) ? parseNodeId(p.ids[0]) : parseNodeId(p.id) ?? before.selection[0];
      if (id === undefined || !before.document.nodes[id]) throw new Error("Select a frame");
      const nodes = { ...before.document.nodes };
      for (const node of Object.values(nodes)) if (node.thumbnailFlag !== undefined) {
        const { thumbnailFlag, ...rest } = node;
        nodes[node.id] = Object.freeze(rest);
      }
      nodes[id] = Object.freeze({ ...nodes[id], thumbnailFlag: "true" });
      this.#commitEdit({ document: Object.freeze({ ...before.document, nodes: Object.freeze(nodes) }) });
      return { ok: true };
    }
    if (command === "file.rename") {
      const name = parseString(p.name);
      if (name === undefined) throw new Error("file.rename requires a name");
      this.#commitEdit({ document: Object.freeze({ ...this.#snapshot.document, name }) });
      return { ok: true };
    }
    if (command === "file.colorProfile") {
      const before = this.#snapshot, name = parseString(p.profile);
      if (name === undefined) {
        this.#publish({ profileDialog: true });
        return { profile: before.document.colourProfile ?? "srgb", changed: false };
      }
      const profile = parseColourProfile(name);
      if (!profile) throw new Error("file.colorProfile: profile must be srgb or displayP3");
      const document = setDocumentProfile(before.document, profile, parseBoolean(p.convert) ?? true);
      if (document !== before.document) {
        this.#commitEdit({ document, profileDialog: false });
      } else this.closeProfileDialog();
      return { profile, changed: document !== before.document };
    }
    if (command==="image.crop") {
      const before=this.#snapshot, {document,target}=startImageCrop(before.document,before.selection,p);
      this.#commitEdit({document,crop:target,paintPicker:undefined}, {record:document !== before.document});
      return {...target};
    }
    if (Object.hasOwn(imageEditSpecs, command)) {
      const before = this.#snapshot;
      const next = command === "image.adjust" ? editImagePaints(before.document, before.selection, p)
        : editImagePreset(command, before.document, before.selection, p);
      this.#commitEdit({ document: next.document });
      return next.result;
    }
    if (command === "frame.presets") return framePresets;
    if (command === "edit.duplicate") {
      const before = this.#snapshot;
      const next = executeDuplicate(before.document, before.selection, this.#nextId, p, this.#lastDuplicate);
      this.#commitEdit({document:next.document, selection:next.duplicated.copies}, {nextId:next.nextId, duplicated:next.duplicated});
      return next.result;
    }
    if (Object.hasOwn(smartSpecs, command)) {
      const before = this.#snapshot, current = this.#interaction?.document ?? before.document;
      const document = executeSmartSelection(command, current, before.selection, p, this.#interaction?.base.document ?? current);
      if (this.#interaction) { this.#interaction.document = document; this.#notifyCanvas(); }
      else if (document !== before.document) {
        this.#commitEdit({ document });
      }
      return { ok: true };
    }
    if (Object.hasOwn(originSpecs, command)) {
      const allowed = command === "transform.rotationOrigin" ? ["on"] : ["x", "y", "reset"];
      for (const key of Object.keys(p)) if (!allowed.includes(key)) throw new Error(`Unsupported ${command} parameter: ${key}`);
      const { selection, document } = this.#snapshot;
      if (!selection.length) throw new Error("Nothing selected");
      const previous = this.#origin ?? { ids: selection, editing: false };
      if (command === "transform.rotationOrigin") this.#origin = { ...previous, editing: parseBoolean(p.on) ?? !previous.editing };
      else {
        const point = parseBoolean(p.reset) === true ? undefined : { x: parseNumber(p.x, "x"), y: parseNumber(p.y, "y") };
        this.#origin = { ...previous, at: localOrigin(document, selection[0], point) };
      }
      this.#refreshOrigin();
      const { editing, moved, point } = this.#originSnapshot;
      return { editing, moved, x: point?.x ?? 0, y: point?.y ?? 0 };
    }
    if (command === "layout.setTrack" || Object.hasOwn(arrangeSpecs, command) || Object.hasOwn(sizingSpecs, command) || Object.hasOwn(rotationSpecs, command)) {
      const before = this.#snapshot;
      const document = command === "layout.setTrack" ? setGridTrack(before.document, before.selection, p) : Object.hasOwn(rotationSpecs, command)
        ? executeRotation(command, before.document, before.selection, p, movedOrigin(before.document, before.selection, this.#origin), this.#vectorEdit)
        : (Object.hasOwn(sizingSpecs, command) ? executeSizing : executeArrange)(command, before.document, before.selection, p);
      if (document !== before.document) {
        this.#commitEdit({ document });
      }
      return { ok: true };
    }
    if (Object.hasOwn(viewSpecs, command)) {
      const before = this.#snapshot, next = executeView(command, this.#view, before.document, before.selection, p);
      this.#viewConfigured = true; this.updateView(next.view);
      if (next.document !== before.document || next.selection !== before.selection) this.#publish({ document: next.document, selection: next.selection });
      return next.result;
    }
    if (command === "edit.copyProperties") {
      const { document, selection } = this.#snapshot;
      const [id] = requiredTargets(document, selection, p);
      const props = copyLayerProperties(document.nodes[id]);
      this.#clipboard.properties = structuredClone(props);
      this.#publish({});
      return props;
    }
    if (command === "edit.pasteProperties") {
      const before = this.#snapshot;
      const document = pasteLayerProperties(before.document, before.selection, p, this.#clipboard.properties);
      if (document !== before.document) this.#commitEdit({ document });
      return { ok: true };
    }
    if (command === "edit.copy" || command === "edit.cut") {
      const before = this.#snapshot;
      const clip = captureLayers(before.document, before.selection, p, this.#documentIdentity, command === "edit.cut");
      if (command === "edit.cut") {
        const next = executeStructure("edit.delete", before.document, before.selection, this.#nextId, { ids: clip.roots });
        this.#commitEdit({ document: next.document, selection: next.selection }, { nextId: next.nextId });
        this.#clipboard.layers = clip;
        return Object.fromEntries(Object.entries(next.result).map(([key, ids]) => [key, (ids as string[]).map(inspectedId)]));
      }
      this.#clipboard.layers = clip;
      this.#publish({});
      return { copied: clip.roots.length };
    }
    if (command === "edit.paste" || command === "edit.pasteOver" || command === "edit.pasteReplace") {
      const before = this.#snapshot;
      const next = pasteLayers(command, before.document, before.selection, this.#nextId, p, this.#clipboard.layers, this.#documentIdentity, this.#view);
      this.#commitEdit({ document: next.document, selection: next.selection }, { nextId: next.nextId, libraryEdit: true });
      return next.result;
    }
    const builderEdit = command === "shapeBuilder.merge" || command === "shapeBuilder.remove";
    const instanceCommand = Object.hasOwn(instanceCommandSpecs,command);
    if (instanceCommand || command === "instance.create" || builderEdit || Object.hasOwn(structureSpecs, command) || Object.hasOwn(vectorSpecs, command)) {
      const before = this.#snapshot;
      const execute = builderEdit ? applyBuilder : Object.hasOwn(vectorSpecs, command) ? executeVector : executeStructure;
      const next = instanceCommand ? executeInstanceCommand(command as keyof typeof instanceCommandSpecs,before.document,before.selection,this.#nextId,p)
        : command === "instance.create" ? createInstance(before.document, this.#nextId, p)
        : execute(command, before.document, before.selection, this.#nextId, p);
      if (command === "component.properties" || command === "instance.exposed") return next.result;
      const document=command==="instance.create" || command==="instance.place" ? countLibraryInstances(next.document,next.selection,"inserted") :
        command==="component.detach" ? countLibraryInstances(next.document,next.selection,"detached",before.document) : next.document;
      this.#commitEdit({document, selection:next.selection}, {record:command==="section.toggleContents" || command==="component.resetInstance" || !sameContent(before.document,next.document), nextId:next.nextId});
      if (command === "component.goToMain") {
        const bounds = boundsOf(next.document,next.selection);
        if (bounds) this.updateView(fitView(this.#view,bounds,2));
      }
      return next.result;
    }
    if (Object.hasOwn(selectionSpecs, command)) {
      const next = executeSelection(command, this.#snapshot.document, this.#snapshot.selection, p);
      if (command === "select.none") this.#vectorEdit = undefined;
      this.#publish({ document: next.document, selection: next.selection });
      return next.result;
    }
    if (command === "effect.copy") {
      const previous = this.#clipboard.effect;
      this.#clipboard.effect = copyEffect(this.#snapshot.document, this.#snapshot.selection, p);
      if (!previous) this.#publish({});
      return wireEffect(this.#clipboard.effect);
    }
    if (Object.hasOwn(effectSpecs, command)) {
      const before = this.#snapshot;
      const document = editEffects(command, before.document, before.selection, p, this.#clipboard.effect);
      if (document !== before.document) {
        let openEffects = before.openEffects;
        const first = before.selection[0];
        if (first && openEffects?.length && before.document.nodes[first]?.effects !== document.nodes[first]?.effects) {
          if (command === "effect.remove") {
            const index = Number(p.index);
            openEffects = Object.freeze(openEffects.filter(i => i !== index).map(i => i > index ? i - 1 : i));
          } else if (command === "effect.move") {
            const from = Number(p.from), to = Number(p.to);
            openEffects = Object.freeze(openEffects.map(i => i === from ? to : i > from && i <= to ? i - 1 : i >= to && i < from ? i + 1 : i));
          }
        }
        this.#commitEdit({ document, openEffects });
      }
      return { ok: true };
    }
    if (command === "fill.copy" || command === "stroke.copy") {
      const list = command === "fill.copy" ? "fill" : "stroke";
      const previous = this.#clipboard.paint?.list;
      this.#clipboard.paint = copyPaint(list, this.#snapshot.document, this.#snapshot.selection, p, this.#vectorEdit);
      if (this.#clipboard.paint.paint.type === "pattern") this.#clipboard.paint.documentIdentity = this.#documentIdentity;
      if (previous !== list) this.#publish({});
      const {colorAlpha,...paint}=this.#clipboard.paint.paint;
      return {...paint,...(paint.type==="pattern" && {source:inspectedId(paint.source)}),...(colorAlpha!==1 && {colorAlpha})};
    }
    if (Object.hasOwn(fillSpecs, command) || command === "stroke.paste") {
      const before = this.#snapshot;
      const document = command === "fill.paste" || command === "stroke.paste"
        ? pastePaint(command === "fill.paste" ? "fill" : "stroke", before.document, before.selection, p, this.#clipboard.paint, this.#vectorEdit, this.#documentIdentity)
        : writeFill(command as Exclude<keyof typeof fillSpecs, "fill.copy" | "fill.paste">, before.document, before.selection, p, this.#vectorEdit);
      if (document !== before.document) {
        this.#commitEdit({ document });
      }
      return { ok: true };
    }
    if (command === "node.set" || command === "text.style" || command === "text.set" || Object.hasOwn(strokeSpecs, command)) {
      const before = this.#snapshot;
      const warnings: string[] = [];
      const document = command === "node.set" || command === "text.style" || command === "text.set"
        ? setRectangleProperties(before.document, before.selection, p, movedOrigin(before.document, before.selection, this.#origin), warnings,
          command === "node.set" ? undefined : command)
        : executeStrokeList(command, before.document, before.selection, p);
      if (document !== before.document) {
        this.#commitEdit({ document, selection: Object.freeze(before.selection.filter(id => document.nodes[id] && pageForNode(document, id) === document.currentPage)) });
      }
      return { ok: true, ...(warnings.length ? { warnings } : {}) };
    }
    if (Object.hasOwn(gridSpecs, command) || Object.hasOwn(exportSpecs, command)) {
      const before = this.#snapshot.document;
      const edit = Object.hasOwn(exportSpecs, command) ? editExportSettings : editLayoutGuides;
      const document = edit(before, this.#snapshot.selection, command, p);
      if (document !== before) this.#commitEdit({document});
      return {ok:true};
    }
    if (Object.hasOwn(styleEditSpecs, command) || command === "library.applyStyle" || command === "style.apply" || command === "style.detach") {
      const live = this.getTextRange();
      if (!live) this.cancelInteraction();
      const before = this.getRenderDocument();
      const selection = this.getRenderSelection();
      const ids = this.#assetIds();
      const libraryStyle=()=>{
        const link=findLibrary(before,p.library);
        if (!link) throw Error("no enabled library `"+p.library+"`");
        return applyLibraryStyle(before,selection,linkedPublication(link,path=>this.librarySource(path)),p,live);
      };
      const {document, result} = command==="library.applyStyle" ? libraryStyle() : Object.hasOwn(styleEditSpecs, command) ? editStyleDefinition(before, selection, command, p, live, ids.allocate) :
        {document:editStyleLinks(before, selection, p, command === "style.detach", live), result:{ok:true}};
      if (live) {
        if (this.#interaction) this.#interaction.nextId = ids.next();
        live.update(document, live.anchor, live.caret);
      } else if (document !== before) this.#commitEdit({document}, { nextId: ids.next() });
      return result;
    }
    if (Object.hasOwn(styleOrderSpecs, command)) {
      const live = this.getTextRange();
      const before = this.getRenderDocument();
      const ids = this.#assetIds();
      const {document, result} = orderStyles(before, command, p, ids.allocate);
      if (live) {
        if (this.#interaction) this.#interaction.nextId = ids.next();
        live.update(document, live.anchor, live.caret);
      } else if (document !== before) this.#commitEdit({document}, { nextId: ids.next() });
      return result;
    }
    if (command==="variable.setMode" || command==="variable.bind") {
      const before=this.#snapshot;
      const edit=command==="variable.bind" ? bindLayerVariable : setVariableMode;
      const document=edit(before.document,before.selection,p);
      this.#commitEdit({document});
      return {ok:true};
    }
    if (command==="variable.import" || Object.hasOwn(collectionSpecs,command) || Object.hasOwn(valueSpecs,command) || Object.hasOwn(metadataSpecs,command)) {
      const before=this.#snapshot.document, data=before.variables ?? emptyVariables;
      const ids = this.#assetIds();
      const next=command==="variable.import" ? importVariables(data,p,new Set(before.libraryRecords?.collections.map(r=>r.local)), ids.allocate) : Object.hasOwn(collectionSpecs,command) ? editCollection(data,command,p,ids.allocate) :
        Object.hasOwn(metadataSpecs,command) ? editVariableMetadata(data,command,p,ids.allocate) : editVariableValue(data,command,p,ids.allocate);
      if (next.data!==data) {
        let kept=command==="variable.deleteCollection" || command==="variable.removeMode"
          ? removeLayerMode(before,data,p,command==="variable.deleteCollection") : before;
        if (command==="variable.delete" || command==="variable.deleteCollection") kept=forgetLayerVariables(kept,data,next.data);
        const {variables:old,...rest}=kept;
        this.#commitEdit({document:Object.freeze({...rest,...(next.data!==emptyVariables && {variables:next.data})})}, { nextId: ids.next() });
      }
      return next.result;
    }
    if (command==="library.swap") {
      const doc=this.#snapshot.document,from=findLibrary(doc,p.from),to=findLibrary(doc,p.to);
      if (!from || !to) throw Error("no enabled library `"+(!from ? p.from : p.to)+"`");
      const next=swapLibrary(doc,from.id,linkedPublication(to,path=>this.librarySource(path)),this.#nextId);
      if (next.document!==doc) this.#commitEdit({document:next.document},{nextId:next.nextId,libraryEdit:true});
      return next.result;
    }
    if (command==="library.updates") return libraryUpdates(this.#snapshot.document,path=>this.librarySource(path));
    if (command==="library.acceptUpdates") {
      const before=this.#snapshot.document,next=acceptLibraryUpdates(before,path=>this.librarySource(path),p.ids,this.#nextId);
      if (next.document!==before) this.#commitEdit({document:next.document},{nextId:next.nextId,libraryEdit:true});
      return next.result;
    }
    if (command==="library.import" || command==="library.place" || command==="library.swapAt") {
      const before=this.#snapshot,link=findLibrary(before.document,p.library);
      if (!link) throw Error("no enabled library `"+p.library+"`");
      const lib=linkedPublication(link,path=>this.librarySource(path)),key=publishedComponent(lib,p.component);
      const imported=importLibraryComponents(before.document,lib,[key],this.#nextId),id=imported.ids.get(key);
      if (!id) throw Error("the component didn't import");
      if (command==="library.import") {
        if (imported.document!==before.document) this.#commitEdit({document:imported.document},{nextId:imported.nextId,libraryEdit:true});
        return {component:inspectedId(id)};
      }
      const place=command==="library.place",params={component:id,x:p.x ?? (place ? this.#view.cx : undefined),y:p.y ?? (place ? this.#view.cy : undefined)};
      const next=executeInstanceCommand(place ? "instance.place" : "instance.swapAt",imported.document,before.selection,imported.nextId,params);
      const document=place ? countLibraryInstances(next.document,next.selection,"inserted") : next.document;
      this.#commitEdit({document,selection:next.selection},{nextId:next.nextId,libraryEdit:true});
      const result:Record<string,unknown>={...next.result};
      for (const key of ["id","parent","component"]) if (typeof result[key]==="string") result[key]=inspectedId(result[key]);
      if (place) result.component=inspectedId(id);
      return result;
    }
    if (["library.importVariable","library.bindVariable","library.aliasVariable","library.setVariableMode","library.extendCollection"].includes(command)) {
      const before=this.#snapshot.document,link=findLibrary(before,parseString(p.library));
      if (!link) throw Error("no enabled library `"+p.library+"`");
      const lib=linkedPublication(link,path=>this.librarySource(path));
      const ids = this.#assetIds();
      const next=editLibraryVariable(before,this.#snapshot.selection,lib,command,p,ids.allocate);
      if (next.document!==before) this.#commitEdit({document:next.document}, { nextId: ids.next() });
      return next.result;
    }
    if (command==="library.list") {
      const doc=this.#snapshot.document,assets=!!parseBoolean(p.assets);
      return {...listLibraries(doc,assets),libraries:(doc.libraryLinks ?? []).map(l=>describeLibrary(doc,l,this.librarySource(l.path),assets))};
    }
    if (command==="library.add" || command==="library.remove") {
      const doc=this.#snapshot.document;
      const key=parseString(command==="library.add" ? p.path : p.id)?.trim();
      if (!key) throw Error(command==="library.add" ? "Choose a published library file" : "An enabled library id is required");
      const source=this.librarySource(key);
      if (command==="library.add" && !source) throw Error("Choose the published library file first");
      const next=command==="library.add" ? enableLibrary(doc,key,source!) : removeLibrary(doc,key);
      if (next.document!==doc) this.#commitEdit({document:next.document},{libraryEdit:true});
      else this.#publish({});
      return next.result;
    }
    if (command==="library.publish") {
      const next=publishLibrary(this.#snapshot.document,p);
      this.#commitEdit({document:next.document});
      return next.result;
    }
    if (command === "variable.export") return exportVariables(this.getRenderDocument(),p);
    if (command === "variable.list") {
      if (Object.keys(p).length) throw new Error("variable.list takes no parameters");
      return structuredClone(this.getRenderDocument().variables ?? emptyVariables);
    }
    if (command === "style.list") return listStyles(this.getRenderDocument(), p.type);
    if (command === "component.list") return listComponents(this.#snapshot.document);
    if (command === "page.list") return listPages(this.#snapshot.document);
    if (Object.hasOwn(pageSpecs, command)) {
      const before = this.#snapshot;
      const changed = executePage(command, before.document, before.selection, this.#nextId, p);
      if (changed.document !== before.document || changed.selection !== before.selection) {
        this.#commitEdit({document:changed.document, selection:changed.selection}, {record:command !== "page.select" && !sameContent(before.document,changed.document), nextId:changed.nextId});
      }
      if (command === "page.select" || command !== "page.duplicate" && changed.document.currentPage !== before.document.currentPage) this.updateView(fitPage(this.#view, changed.document));
      return changed.result;
    }
    if (command === "file.markSaved") {
      if (Object.keys(p).some(key => key !== "revision")) throw new Error("Unsupported save acknowledgement parameter");
      const saved = p.revision === undefined ? { document: this.#interaction?.document ?? this.#snapshot.document, versions: this.#history.records, branches: this.#branches }
        : typeof p.revision === "number" ? this.#pendingSaves.get(p.revision) : undefined;
      if (!saved) return { saved: false };
      this.#saved = saved.document;
      this.#savedVersions = saved.versions;
      this.#savedBranches = saved.branches;
      this.#downloaded = true;
      this.#pendingSaves.clear();
      this.#publish({});
      return { saved: true };
    }
    if (command.startsWith("file.") || command === "image.place" || command === "image.replace") throw new Error(`${command} requires executeAsync`);
    if (command === "text.create" || command === "vector.create" || command === "shape.line" || command === "shape.arrow" || command === "shape.polygon" || command === "shape.star" || command === "shape.ellipse" || command === "shape.rectangle" || command === "frame.create" || command === "node.create") return this.#create(command, p);
    if (Object.keys(p).length) throw new Error(`${command} takes no parameters`);
    if (command === "tool.text" || command==="tool.textOnPath" || command === "tool.shapeBuilder" || command === "tool.pencil" || command === "tool.pen" || command === "tool.line" || command === "tool.arrow" || command === "tool.polygon" || command === "tool.star" || command === "tool.ellipse" || command === "tool.section" || command === "tool.slice" || command === "tool.rectangle" || command === "tool.move" || command === "tool.scale") {
      const end = this.#vectorEdit && command !== "tool.move" && command !== "tool.scale" ? executeVectorEdit("vector.edit.end", this.#snapshot.document, this.#snapshot.selection, this.#vectorEdit, {}) : undefined;
      if (end) this.#vectorEdit = undefined;
      this.#publish({ ...(end ? { document: end.document, selection: end.selection } : {}), tool: command.slice(5) as EditorSnapshot["tool"] });
      return {};
    }
    const undo = command === "edit.undo";
    if (this.#liveHistory) return { [undo ? "undone" : "redone"]:this.#liveHistory.travel(undo) };
    const source = undo ? this.#undo : this.#redo;
    const target = undo ? this.#redo : this.#undo;
    const entry = source.pop();
    if (entry) {
      this.#lastDuplicate = undefined;
      target.push({ document: this.#snapshot.document, selection: this.#snapshot.selection });
      this.#publish({...entry,document:restoreLibraryOverrides(this.#snapshot.document,entry.document)});
    }
    return { [undo ? "undone" : "redone"]: Boolean(entry) };
  }
  /** Native file commands run outside pointer rendering and retain atomic document replacement. */
  async executeAsync(command:"text.edit.selection",input?:unknown):Promise<EditSelection|null>;
  async executeAsync(command:"variable.list",input?:unknown):Promise<Variables>;
  async executeAsync(command:"style.list",input?:unknown):Promise<ReturnType<typeof listStyles>>;
  async executeAsync(command:"component.list",input?:unknown):Promise<ReturnType<typeof listComponents>>;
  async executeAsync(command:"text.fonts",input?:unknown):Promise<ReturnType<typeof queryFonts>>;
  async executeAsync(command: "file.open" | "file.recover", input: unknown): Promise<OpenResult>;
  async executeAsync(command: "node.get", input: unknown): Promise<ReturnType<typeof getNode>>;
  async executeAsync(command: string, input?: unknown): Promise<Record<string, unknown>>;
  async executeAsync(command: string, input: unknown = {}): Promise<Record<string, unknown> | Variables | ReturnType<typeof listStyles> | ReturnType<typeof listComponents> | ReturnType<typeof queryFonts> | null> {
    if (command==="edit.pasteDesignLayers") {
      const p=parameters(input);
      const result=await this.pasteDesignLayers(p);
      if (!result) throw new Error("edit.pasteDesignLayers: "+(typeof p.html==="string" ? "the HTML holds no copied design layers" : "the data is not copied design layers"));
      return result;
    }
    if (command === "file.exportLayers") {
      const opening = this.#openSequence;
      const { output, files, skipped } = await this.prepareLayerExports(parameters(input), false);
      const data = output ? base64Bytes(new Uint8Array(await output.arrayBuffer())) : undefined;
      this.#assertExportAccess(opening);
      return { files, skipped, ...(data !== undefined && { data }) };
    }
    if (command === "file.export" || command === "file.exportSvg" || command === "file.exportFramesPdf") {
      const opening = this.#openSequence, params = parameters(input);
      const frames = command === "file.exportFramesPdf";
      const graphic = await this.exportGraphic(frames ? {...params,format:"pdf"} : command === "file.exportSvg" ? {...params,format:"svg"} : params, frames);
      const bytes = await graphic.blob.arrayBuffer();
      this.#assertExportAccess(opening);
      return { format:graphic.format, ...(frames && {pages:graphic.pages}), data:base64Bytes(new Uint8Array(bytes)), ...(graphic.warnings && {warnings:graphic.warnings}) };
    }
    if (command === "version.restore" || command === "version.preview") return this.#showVersion(command, parameters(input));
    if (command.startsWith("version.") || command === "file.saveVersion" || command === "file.versionHistory") return this.execute(command, input);
    if (command!=="text.preview" && command!=="text.endPreview") this.endTextPreview();
    if (command==="text.edit.insert" || command==="text.edit.preedit") {
      const p=namedParameters(input), session=this.currentTextEdit(), revision=this.#openSequence;
      if (!this.#snapshot.editable) throw new Error("Sign in to edit this document");
      const value=parseString(p.text) ?? "";
      await prepareText(value);
      if (session!==this.currentTextEdit() || revision!==this.#openSequence) throw new Error("The active text edit changed");
      return this.execute(command,p);
    }
    if (command==="text.fonts" || command==="text.loadFont") {
      if (!this.#snapshot.editable) throw new Error("Sign in to edit this document");
      const revision=this.#openSequence, identity=this.#documentIdentity;
      const checkCurrent=()=>{
        if (!this.#snapshot.editable || revision!==this.#openSequence || identity!==this.#documentIdentity ||
            command==="text.loadFont" && this.interacting)
          throw new Error("The document or identity changed during the font command");
      };
      const p=fontParams(command,input);
      await prepareText();
      checkCurrent();
      if (command==="text.fonts") return this.execute("text.fonts",p);
      const bytes=await readFontInput(p);
      checkCurrent();
      const families=await importFontBytes(bytes,checkCurrent);
      checkCurrent();
      return {families:[...families],...this.#refitOpenText({},families)};
    }
    if (command === "text.create" || command === "node.create" || command === "node.set" || command === "text.set") {
      const p = parameters(input);
      const props = command === "text.set" ? p : p.props && typeof p.props === "object" && !Array.isArray(p.props) ? p.props as Record<string, unknown> : command === "node.set" ? p : {};
      const creating = command === "text.create" || command === "node.create" && parseString(p.type)?.toLowerCase() === "text";
      const content = [props.characters, props.text].filter(value => value !== undefined).map(value => parseString(value) ?? "");
      if (creating || content.length) {
        if (!this.#snapshot.editable) throw new Error("Sign in to edit this document");
        const identity = this.#documentIdentity, opening = this.#openSequence;
        if (creating) content.push(creationCharacters(p));
        await Promise.all(content.map(value => prepareText(value)));
        if (identity !== this.#documentIdentity || opening !== this.#openSequence) throw new Error("The document changed during the text edit");
        return this.execute(command, p);
      }
    }
    return this.#executeFileCommand(command, input);
  }
  #assertExportAccess(opening: number) {
    if (opening !== this.#openSequence || !this.#hostEditable) throw new Error("Export was cancelled because the document or identity changed");
  }
  async prepareLayerExports(params: Record<string, unknown>, download = true) {
    if (!this.#hostEditable) throw new Error("Sign in to export this document");
    const opening = this.#openSequence, {document,selection} = this.#snapshot;
    const { renderLayerExports } = await import("./export-layers");
    return renderLayerExports(document, selection, params, download, () => this.#assertExportAccess(opening));
  }
  async pasteDesignLayers(params:{html?:unknown;data?:unknown} & Record<string,unknown>) {
    const before=this.#snapshot,opening=this.#openSequence;
    const check=()=>{
      if (!before.editable || !this.#snapshot.editable || before.document!==this.#snapshot.document || opening!==this.#openSequence)
        throw new Error("Paste was cancelled because the drawing or editing access changed");
    };
    check();
    const {readDesignClipboard,missingClipboardImages}=await import("./interchange/fig/clipboard");
    const decoded=await readDesignClipboard(params,check);
    check();
    if (!decoded) return;
    const source=decoded.document,roots=source.pages.flatMap(id=>{
      const page=source.nodes[id];
      return page?.kind==="page" ? page.children : [];
    });
    if (!roots.length) throw new Error("command `edit.pasteDesignLayers` is not available right now: the copied layers came in empty");
    await prepareDocumentText(source);
    check();
    const clip=captureLayers(source,roots,{},Symbol(),false);
    const next=pasteLayers("edit.paste",before.document,before.selection,this.#nextId,params,clip,this.#documentIdentity,this.#view);
    const missing=await missingClipboardImages(next.document,next.selection.filter(id=>next.document.nodes[id]));
    check();
    const previous=this.#clipboard.layers;
    this.#clipboard.layers=clip;
    try {
      this.#commitEdit({document:next.document,selection:next.selection},{nextId:next.nextId,libraryEdit:true});
    } catch (error) {
      this.#clipboard.layers=previous;
      throw error;
    }
    return {...next.result,...(missing.length && {missingImages:missing}),...(decoded.issues.length && {warnings:decoded.issues})};
  }
  async exportGraphic(params: Record<string,unknown> = {}, frames = false): Promise<{format:string; blob:Blob; warnings?:string[]; pages?:number}> {
    const format=parseString(params.format)?.toLowerCase().replace(/^\.+/,"");
    const drawable=format==="xml" || format==="vd" || format==="vectordrawable";
    if (!drawable && format!=="fig" && format!=="penpot" && format!=="svg" && format!=="pdf") return this.exportRaster(params);
    if (!this.#hostEditable) throw new Error("Sign in to export this document");
    if (params.path != null) throw new Error("Use a browser download to choose the export destination");
    const opening = this.#openSequence, {document,selection} = this.#snapshot;
    if (format==="penpot") {
      const {writePenpotDocument}=await import("./interchange/penpot/write-document");
      return writePenpotDocument(document,()=>this.#assertExportAccess(opening));
    }
    if (format==="fig") {
      const checkCurrent=()=>this.#assertExportAccess(opening);
      const {writeFigDocument}=await import("./interchange/fig/write-document");
      checkCurrent();
      const thumbnail=typeof globalThis.document==="undefined" ? undefined : await (await import("./canvas")).renderFileThumbnail(document);
      checkCurrent();
      return writeFigDocument(document,checkCurrent,thumbnail);
    }
    if (format==="pdf") {
      const {renderPdf}=await import("./pdf/export");
      const file=await renderPdf(document,selection,params,frames,()=>this.#assertExportAccess(opening));
      this.#assertExportAccess(opening);
      return file;
    }
    if (drawable) {
      const {renderDrawable}=await import("./vector-drawable/export");
      const file=await renderDrawable(document,selection,params);
      this.#assertExportAccess(opening);
      return file;
    }
    const { renderSvgExport } = await import("./export-svg");
    const blob = await renderSvgExport(document,selection,params);
    this.#assertExportAccess(opening);
    return { format:"svg" as const, blob };
  }
  async exportRaster(params: Record<string, unknown> = {}, clipboard = false) {
    if (!this.#hostEditable) throw new Error("Sign in to export this document");
    if (params.path != null) throw new Error("Use a browser download to choose the export destination");
    const requested = parseString(params.format)?.toLowerCase() ?? "png";
    const format = requested === "jpeg" ? "jpg" : requested;
    if (format !== "png" && format !== "jpg" && format !== "webp") throw new Error("Choose PNG, JPG or WebP for raster export");
    const opening = this.#openSequence, { document, selection } = this.#snapshot;
    const { renderRasterExport } = await import("./canvas");
    const blob = await renderRasterExport(document, selection, params, format, undefined, clipboard ? zSorted(document, selection) : undefined);
    this.#assertExportAccess(opening);
    return { format, blob };
  }
  async #prepareSave<T>(output: (archive: Blob) => Promise<T>) {
    this.exitVersionPreview();
    if (!this.#snapshot.editable) throw new Error("Sign in to edit this document");
    this.pen.finish(); this.pencil.cancel();
    const live=this.currentTextEdit() && this.#interaction;
    if (!live) this.cancelInteraction();
    const {document,nextId} = live ? this.#prepareEdit(live.document,live.nextId) : {document:this.#snapshot.document,nextId:this.#nextId};
    const revision = ++this.#saveSequence, opening = this.#openSequence;
    const versions = this.#history.records;
    const branches = this.#branches;
    const thumbnail = typeof globalThis.document === "undefined" ? undefined :
      await (await import("./canvas")).renderFileThumbnail(document);
    const archive = await encodeFigcraftBlob(document, String(nextId), versions, thumbnail, branches);
    const data = await output(archive);
    if (!this.#snapshot.editable || opening !== this.#openSequence) throw new Error("Save was cancelled because the document or identity changed");
    this.#pendingSaves.set(revision, { document, versions, branches });
    while (this.#pendingSaves.size > 16) this.#pendingSaves.delete(this.#pendingSaves.keys().next().value!);
    return {name: `${document.name}.figcraft`, bytes: archive.size, data, revision};
  }
  saveFile() {
    return this.#prepareSave(async archive => archive);
  }
  recoverFile(file: Blob) {
    return this.#executeFileCommand("file.recover", {}, {file});
  }
  async openTabFile(file: File) {
    const result = await this.openFile(file);
    this.#saved = this.#snapshot.document;
    this.#publish({});
    return result;
  }
  async openFile(file:File) {
    return this.#executeFileCommand("file.open",{name:file.name},{file});
  }
  async placeFile(file:File) {
    return this.#executeFileCommand("file.placeImage",{x:this.#view.cx,y:this.#view.cy,name:file.name.replace(/\.[^.]+$/,"")},{file});
  }
  async uploadPaintImage(picker: PaintPicker, file: File) {
    if (this.#snapshot.paintPicker !== picker) throw new Error("Image picker was closed");
    if (picker.styleId !== undefined) {
      const before = this.getRenderDocument(), identity = this.#documentIdentity, live = this.getTextRange();
      const check = () => {
        if (!this.#snapshot.editable || this.#documentIdentity !== identity || this.#snapshot.paintPicker !== picker ||
            this.getRenderDocument() !== before || this.getTextRange() !== live || (this.interacting && !live))
          throw new Error("Style image target changed");
      };
      check();
      if (file.size > MAX_IMAGE_BYTES) throw new Error("Image exceeds the 256 MiB external input limit");
      const image = await prepareImage(new Uint8Array(await file.arrayBuffer()),before.images,undefined,file);
      check();
      const document = editStylePaint(withImageResource(before,image),picker.styleId,picker.index,previous=>{
        const {opacity,visible,colorAlpha,blend} = previous;
        return readPaint({type:"image",image:image.hash,opacity,visible,colorAlpha,blend});
      });
      await prepareArchive(document,String(this.#interaction?.nextId ?? this.#nextId));
      check();
      if (live) live.update(document,live.anchor,live.caret);
      else this.#commitEdit({document});
      return {image:image.hash,width:image.resource.width,height:image.resource.height,changed:1};
    }
    return this.#executeFileCommand("image.replace", {ids:this.#snapshot.selection, target:picker.list, index:picker.index}, {picker, file});
  }
  async pasteImage(file: File, at?: Point) {
    if (file.type === "image/svg+xml" || /\.svgz?$/i.test(file.name)) {
      return this.#executeFileCommand("file.import",{name:"Pasted SVG.svg",...at,center:!at},{file,paste:true});
    }
    const {document, selection} = this.#snapshot;
    const selected = selection.length === 1 ? document.nodes[selection[0]] : undefined;
    if (!at && selected && selected.kind !== "page" && selected.kind !== "group") {
      return this.#executeFileCommand("image.place",{target:selected.id},{file,paste:true});
    }
    return this.#executeFileCommand("file.import",{name:"Pasted image.png",...at},{file,paste:true,centre:!at});
  }
  async dropImages(files: readonly File[], at?: Point, picker?: PaintPicker, folders?:ReadonlyMap<File,import("./interchange/rest/companions").RestFolder>,
    imported?: (file: File, result: Record<string, unknown>) => string) {
    const errors: string[] = [];
    for (const [index,file] of files.entries()) {
      const before = this.#snapshot.document;
      const sequence = this.#openSequence;
      try {
        if (index === 0 && picker) await this.uploadPaintImage(picker,file);
        else {
          const result=await this.#executeFileCommand("file.import",{name:file.name || "dropped.png",...at},{file,folder:folders?.get(file)});
          if (result && imported) {
            const notice = imported(file, result);
            if (notice) errors.push(notice);
          } else if (Array.isArray(result?.warnings)) {
            for (const note of result.warnings) errors.push(file.name + ": " + note);
          }
        }
      } catch (error) {
        errors.push(file.name + ": " + (error instanceof Error ? error.message : "Image import failed"));
        if (!this.#snapshot.editable || before !== this.#snapshot.document || this.#openSequence > sequence+1) break;
      }
    }
    return errors;
  }
  async #executeFileCommand(command:"file.open" | "file.recover", input:unknown, source?:FileSource): Promise<OpenResult>;
  async #executeFileCommand(command:string, input:unknown, source?:FileSource): Promise<Record<string, unknown> | null>;
  async #executeFileCommand(command:string, input:unknown, source?:FileSource): Promise<Record<string,unknown> | OpenResult | null> {
    const importing = command === "file.import";
    const placing = importing || command === "image.place" || command === "file.placeImage";
    const replacing = command === "image.replace";
    if (!placing && !replacing && !["file.open", "file.recover", "file.saveAs"].includes(command)) return this.execute(command, input);
    if (!this.#snapshot.editable) throw new Error("Sign in to edit this document");
    const p = parameters(input);
    if (command === "file.saveAs") {
      if (Object.keys(p).some(key => key !== "data") || (p.data !== undefined && p.data !== true)) throw new Error("Browser save requires data: true");
      return this.#prepareSave(async archive => base64Bytes(new Uint8Array(await archive.arrayBuffer())));
    }
    const raster = command === "file.open" && typeof p.name === "string" && rasterFilename.test(p.name);
    const svg = (importing || command === "file.open") && typeof p.name === "string" && /\.svgz?$/i.test(p.name);
    const variables=importing || command==="file.open" ? fileVariablesParam(p.variables) : undefined;
    const pages=importing && typeof p.name==="string" && /\.(?:figcraft|json|fig|jam|sketch|penpot)$/i.test(p.name);
    if (source && !pages && (placing || replacing || raster || svg) && source.file.size > MAX_IMAGE_BYTES) throw new Error("Image exceeds the 256 MiB external input limit");
    const allowed = importing ? ["name","data","x","y","center","variables"] : replacing ? ["data", "ids", "id", "target", "index"] : placing ? ["data", "name", "target", "mode", "width", "height", "parent", "x", "y"] : command==="file.open" ? ["data","name","variables"] : ["data", "name"];
    if (Object.keys(p).some(key => !allowed.includes(key)) || !source && typeof p.data !== "string" || (!importing && p.name !== undefined && typeof p.name !== "string")) throw new Error("File import requires base64 data and supported parameters");
    this.pen.cancel(); this.pencil.cancel(); this.cancelInteraction();
    const before = this.#snapshot;
    const opening = ++this.#openSequence;
    const regionState = this.#vectorEdit;
    const centre = this.#view;
    const inputBytes = () => source ? source.file.arrayBuffer().then(buffer => new Uint8Array(buffer)) : fileData(p.data, MAX_IMAGE_BYTES);
    const checkCurrent = () => {
      if (source?.picker && (this.#snapshot.paintPicker !== source.picker || this.#vectorEdit !== regionState)) throw new Error("Image picker target changed");
      if ((replacing || source?.paste) && !sameIds(before.selection, this.#snapshot.selection)) throw new Error("Image edit was cancelled because the selection changed");
      if (opening !== this.#openSequence || before.document !== this.#snapshot.document || !this.#snapshot.editable || this.interacting) throw new Error("Open was cancelled because the document or identity changed");
    };
    let decoded: Awaited<ReturnType<typeof decodeFigcraft>>;
    let external=false;
    const readDesign=async()=>{
      const {loadDesignDocument}=await import("./interchange/load");
      const loaded=await loadDesignDocument(source?.file ?? fileData(p.data,MAX_UNPACKED_BYTES),variables,checkCurrent,source?.folder,String(p.name ?? ""));
      external=loaded.external;
      return loaded.decoded;
    };
    if (pages) {
      const {appendPages}=await import("./interchange/append-pages");
      const loaded=await readDesign();
      const incoming=loaded.document;
      await prepareDocumentText(incoming);
      checkCurrent();
      const next=appendPages(before.document,incoming,this.#nextId,this.#idClient);
      const prepared=this.#prepareEdit(next.document,next.nextId);
      await prepareArchive(prepared.document,String(prepared.nextId));
      checkCurrent();
      this.#commitEdit({document:next.document},{nextId:next.nextId,libraryEdit:true});
      const fallback=String(p.name).split(/[\\/]/).at(-1)!.replace(/\.[^.]+$/,"");
      return {pages:next.pages.map(inspectedId),summary:{name:incoming.name && incoming.name!=="Untitled" ? incoming.name : fallback,
        pages:incoming.pages.length,layers:Object.keys(incoming.nodes).length-incoming.pages.length-(incoming.libraryStore?.root ? 1 : 0),
        images:Object.keys(incoming.images ?? {}).length},...((external || loaded.issues?.length) && {warnings:loaded.issues ?? []})};
    }
    if (svg) {
      const placement = fileImportParams(p,centre);
      const {importSvg} = await import("./svg-import/document");
      const bytes = await inputBytes();
      checkCurrent();
      const opened = await importSvg(importing ? before.document : newDocument(placement.name), importing ? this.#nextId : 2n,
        bytes, placement.name, importing ? placement.x : 0, importing ? placement.y : 0, importing && parseBoolean(p.center) === true,checkCurrent);
      const prepared = importing ? this.#prepareEdit(opened.document,opened.nextId) : opened;
      await prepareArchive(prepared.document,String(prepared.nextId));
      checkCurrent();
      if (importing) {
        this.#commitEdit({document:opened.document,selection:[opened.id]}, {nextId:opened.nextId});
        return {id:inspectedId(opened.id),...(opened.warnings.length && {warnings:opened.warnings})};
      }
      decoded = {document:opened.document,nextId:String(opened.nextId),issues:opened.warnings};
    } else if (placing || replacing) {
      const bytes = await inputBytes();
      if (source) checkCurrent();
      const placement = importing ? fileImportParams(p,centre) : p;
      const image = await prepareImage(bytes, before.document.images, source?.paste ? 100_000_000 : undefined, source?.file);
      checkCurrent();
      const next = replacing ? replaceImage(before, this.#nextId, image, p, source ? regionState : undefined) : placeImage(before, this.#nextId, image, source?.centre ? {...placement,...centrePastedImage(image,centre)} : placement);
      // Recovery uses this same bounded native archive. A placement that cannot be stored
      // must leave history, selection and the previous document intact.
      const prepared = this.#prepareEdit(next.document,next.nextId);
      await prepareArchive(prepared.document,String(prepared.nextId));
      checkCurrent();
      this.#commitEdit({document:next.document, selection:next.selection}, {nextId:next.nextId});
      return next.result;
    } else if (raster) {
      const image = await prepareImage(await inputBytes(), undefined, undefined, source?.file);
      const name = String(p.name).split(/[\\/]/).pop()!.replace(rasterFilename, "");
      const initial = { document: newDocument(name), selection: [] };
      const opened = placeImage(initial, 2n, image, { name, width: image.resource.width, height: image.resource.height });
      await prepareArchive(opened.document, String(opened.nextId));
      decoded = { document: opened.document, nextId: String(opened.nextId) };
    } else decoded = command==="file.open" ? await readDesign() : await decodeFigcraft(source?.file ?? fileData(p.data, MAX_UNPACKED_BYTES));
    if (!raster) {
      decoded={...decoded,document:refreshBoundStyles(markLoadedModeOverrides(refreshLayerBindings(decoded.document,undefined,true)))};
      await prepareDocumentText(decoded.document);
    }
    checkCurrent();
    this.#documentIdentity = Symbol();
    this.#importedTeamInvites=decoded.teamLibraryInvites ?? new Map();
    this.#teamSubmission=undefined;
    this.#nextId = BigInt(decoded.nextId);
    this.#branches = decoded.branches ?? Object.freeze([]);
    this.#savedBranches = this.#branches;
    this.#idClient = 0;
    this.#liveCounters.clear();
    this.#branchTab = false;
    this.#history = new VersionHistory(decoded.versions);
    this.#savedVersions = this.#history.records;
    this.#undo = []; this.#redo = []; this.#saved = null; this.#downloaded = false; this.#pendingSaves.clear();
    this.#vectorEdit = undefined;
    this.#publish({ document: decoded.document, profileDialog: false, libraryPanel:undefined, missingFonts: undefined, selection: Object.freeze([]), tool: "move" });
    this.updateView(fitPage({ ...this.#view, proofSrgb: false }, decoded.document));
    return { repairs: decoded.issues ?? [], ...((svg || external) && {warnings:decoded.issues ?? []}), summary: { name: decoded.document.name, pages: decoded.document.pages.length, layers: Object.keys(decoded.document.nodes).length - decoded.document.pages.length - (decoded.document.libraryStore?.root ? 1 : 0), images: Object.keys(decoded.document.images ?? {}).length } };
  }
  #create(command: string, p: Record<string, unknown>): Record<string, unknown> {
    const before = this.#snapshot, next = createLayer(before, this.#nextId, command, p, this.#view);
    this.#commitEdit({document:next.document, selection:next.selection}, {nextId:next.nextId}); return { id: next.id };
  }
}
