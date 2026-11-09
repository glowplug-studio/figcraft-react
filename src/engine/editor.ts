import { finishComponentEdit } from "./component-edits";
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
import { isLeaf, isFrameLike, isGroupLike, rectanglePaints } from "./document";
import { editImagePaints, editImagePreset, imageEditSpecs, startImageCrop, type CropTarget } from "./image-commands";
import { listImagePresets } from "./image-filters";
import { getNode } from "./inspect";
import { centrePastedImage, rasterImportParams, placeImage, prepareImage, rasterFilename, replaceImage } from "./image-import";
import { createCanvasText, editTextRange, publishTextNode, typedListMarker, type TextTarget } from "./text-edit";
import { fitEditedText, importFontBytes, prepareText, prepareDocumentText, queryFonts } from "./text-node-layout";
import { creationCharacters, createLayer } from "./creation";
import { pastePaint, type CopiedPaint } from "./paint-clipboard";
import { copyPaint, fillSpecs, selectedRegionFills, writeFill } from "./fill-commands";
import type { Paint } from "./solid-paint";
import { executeStrokeList, strokeSpecs } from "./stroke-commands";
import { newDocument, sameContent, withLayerTransform, type Document, type DrawShapeKind, type TextNode, type NodeId } from "./document";
import { MAX_IMAGE_BYTES } from "./image-resource";
import { fileData } from "./file-bytes";
import { readFontInput } from "./font-source";
import { base64Bytes } from "./recovery";
import { decodeFigcraft, encodeFigcraft, encodeFigcraftBlob, prepareArchive, MAX_UNPACKED_BYTES } from "./file-format";
import { executePage, listPages, pageSpecs } from "./pages";
import { executeSelection, layersAt, selectionSpecs } from "./selection";
import { setRectangleProperties, setPageGeometryFields } from "./properties";
import { HierarchyDraft, pageForNode, worldTransform } from "./hierarchy";
import { applyBuilder } from "./shape-builder-commands";
import { builderArrangement, builderTargets, readBuilderRegions } from "./shape-builder";
import { executeStructure, structureSpecs } from "./structure";
import { executeVector, isVectorJoin, vectorSpecs } from "./vector-commands";
import { executeVectorEdit, vectorEditSpecs, type VectorEditCommand } from "./vector-edit-commands";
import { clampVectorEdit, vectorNetwork, type VectorEditState } from "./vector-edit";
import { defaultViewport, executeView, fitPage, viewSpecs, type Viewport } from "./viewport";
import { framePresets } from "./frame-presets";
import { parseColourProfile } from "./colour-spaces";
import { setDocumentProfile } from "./document-profile";
import { parseBoolean, parseNumber, parseString } from "./parameters";
import { arrangeSpecs, executeArrange } from "./arrange";
import { anchors, sizingSpecs, executeSizing } from "./sizing";
import { executeRotation, localOrigin, movedOrigin, originBoxPoints, originSpecs, rotationSpecs, sameIds, snappedOrigin, validateChangedGeometry, type OriginSnapshot, type RotationOrigin } from "./rotation";
import type { Point } from "./geometry";
import { executeSmartSelection, smartSpecs } from "./smart-selection";
import { placeMove, type MoveDrop } from "./layout-drop";
import { copyLayers, duplicateSelection, executeDuplicate, type Duplicated } from "./duplicate";
import { ancestorIds } from "./canvas-selection";
import { previewResize, type ResizeStart } from "./transform-preview";
import type { ScaleAnchor } from "./transform-handles";
import { PenInteraction } from "./pen-interaction";
import { buildPenPath, type PenAnchor } from "./pen-path";
import { PencilInteraction } from "./pencil-interaction";
import { parseBrush, wireBrush, type Brush } from "./brush";

interface FileSource {file:Blob; picker?:PaintPicker; paste?:boolean; centre?:boolean}
type OpenResult = { repairs: readonly string[]; summary: {name:string; pages:number; layers:number; images:number} }

export const commandSpecs = Object.freeze({
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
  "file.import": { label: "Import", undo: true },
  "file.placeImage": { label: "Place image", undo: true },
  "file.colorProfile": { label: "Color profile", undo: true },
  "file.open": { label: "Open", undo: false },
  "file.recover": { label: "Recover file", undo: false },
  "file.saveAs": { label: "Save as", undo: false },
  "file.markSaved": { label: "Mark saved", undo: false },
});
export type CommandId = keyof typeof commandSpecs;
export interface PaintPicker {
  readonly list: "fill" | "stroke";
  readonly index: number;
  readonly stop: number;
}
export interface EditorSnapshot {
  readonly profileDialog?: boolean;
  readonly missingFonts?: readonly MissingFont[];
  readonly paintPicker?: PaintPicker;
  readonly openEffects?: readonly number[];
  readonly crop?: CropTarget;
  readonly document: Document;
  readonly selection: readonly NodeId[];
  readonly tool: "move" | DrawShapeKind | "scale" | "text" | "textOnPath" | "pen" | "pencil" | "shapeBuilder";
  readonly builderMode: "merge" | "remove";
  readonly scaleAnchor: ScaleAnchor;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly editable: boolean;
  readonly dirty: boolean;
  readonly hasSaved: boolean;
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
  #copiedEffect?: Effect;
  #copiedPaint?: CopiedPaint;
  hasCopiedEffect = (): boolean => !!this.#copiedEffect;
  hasCopiedFill = (): boolean => this.#copiedPaint?.list === "fill";
  hasCopiedStroke = (): boolean => this.#copiedPaint?.list === "stroke";
  #vectorListeners = new Set<() => void>();
  #viewportAttached = false;
  #viewConfigured = false;
  #saved: Document | null = null;
  #saveSequence = 0;
  #pendingSaves = new Map<number, Document>();
  #openSequence = 0;
  constructor() {
    this.#snapshot = Object.freeze({ document: newDocument(), selection: Object.freeze([]), tool: "move", builderMode: "merge", scaleAnchor: "tl", canUndo: false, canRedo: false, editable: true, dirty: true, hasSaved: false });
  }
  getSnapshot = (): EditorSnapshot => this.#snapshot;
  getUndoDepth = (): number => this.#undo.length;
  getVectorEdit = (): VectorEditState | undefined => this.#vectorEdit;
  getRenderVectorEdit = (): VectorEditState | undefined => this.#interaction ? this.#interaction.vectorEdit : this.#vectorEdit;
  subscribeVectorEdit = (listener: () => void): (() => void) => { this.#vectorListeners.add(listener); return () => { this.#vectorListeners.delete(listener); }; };
  getRenderDocument = (): Document => this.#textPreview ?? this.#interaction?.document ?? this.#snapshot.document;
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
    const {document, drop} = placeMove(draft, duplicated?.copies ?? ids, delta, point);
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
    if (!picker || ids.length !== 1) return;
    const node=this.getRenderDocument().nodes[ids[0]];
    if (!node || node.kind === "page") return;
    const regions=picker.list==="fill" ? selectedRegionFills(node,this.getRenderVectorEdit()) : undefined;
    const stack=picker.list==="stroke" ? node.strokes : regions===undefined ? rectanglePaints(node) : regions;
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
  closeProfileDialog() { if (this.#snapshot.profileDialog) this.#publish({ profileDialog: false }); }
  finishCrop() { if (this.#snapshot.crop) this.#publish({crop:undefined}); }
  /** A menu may outlive its gesture after selection changes or edit access is revoked. */
  beginBlendPreview(picker?: PaintPicker) {
    if (this.interacting || !this.#snapshot.editable || !this.#snapshot.selection.length) return;
    this.beginInteraction();
    const owner = this.#interaction!;
    const {document,selection} = owner.base;
    return {
      show: (blend:BlendMode) => {
        if (this.#interaction !== owner) return;
        if (picker) {
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
    if ([view.cx, view.cy, view.zoom, view.vw, view.vh].some(value => !Number.isFinite(value)) || [view.snapObjects, view.snapPixel, view.proofSrgb].some(value => value !== undefined && typeof value !== "boolean") || view.zoom < 0.02 || view.zoom > 256 || view.vw <= 0 || view.vh <= 0) throw new Error("Invalid viewport");
    if ((Object.keys(view) as (keyof Viewport)[]).every(key => view[key] === this.#view[key])) return;
    this.#view = Object.freeze({ ...view }); this.#viewListeners.forEach(listener => listener());
  }
  resizeViewport(width: number, height: number): void {
    const next = { ...this.#view, vw: Math.max(1, width), vh: Math.max(1, height) };
    this.updateView(!this.#viewportAttached && !this.#viewConfigured ? fitPage(next, this.#snapshot.document) : next);
    this.#viewportAttached = true;
  }
  subscribe = (listener: () => void): (() => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; };
  captureNativeSnapshot() {
    const document = this.#snapshot.document, nextId = String(this.#nextId);
    return () => encodeFigcraftBlob(document, nextId);
  }
  nativeSnapshot = (): Promise<Uint8Array> => encodeFigcraft(this.#snapshot.document, String(this.#nextId));
  cancelPendingFiles(): void { this.#openSequence++; this.#pendingSaves.clear(); }
  #preparedEdit?: {base: Document; proposed: Document; allocator: bigint; result: ReturnType<typeof finishComponentEdit>};

  #prepareEdit(proposed: Document, allocator: bigint) {
    const base = this.#snapshot.document, previous = this.#preparedEdit;
    if (previous?.base === base && previous.proposed === proposed && previous.allocator === allocator) return previous.result;
    const result = finishComponentEdit(base,proposed,allocator);
    this.#preparedEdit = {base,proposed,allocator,result};
    return result;
  }

  #commitEdit(patch: Partial<EditorSnapshot> & { document: Document }, options: {
    record?: boolean;
    nextId?: bigint;
    duplicated?: Duplicated;
    vectorEdit?: VectorEditState;
  } = {}) {
    const before = this.#snapshot;
    const {document,nextId} = this.#prepareEdit(patch.document, options.nextId ?? this.#nextId);
    if (options.record !== false) {
      this.#undo.push({ document: before.document, selection: before.selection });
      this.#redo = [];
    }
    this.#nextId = nextId;
    if (options.duplicated) this.#lastDuplicate = options.duplicated;
    if ("vectorEdit" in options) this.#vectorEdit = options.vectorEdit;
    this.#publish({...patch, document});
  }
  #publish(patch: Partial<EditorSnapshot>): void {
    const document = patch.document ?? this.#snapshot.document;
    if (document !== this.#snapshot.document) this.#preparedEdit = undefined;
    if (patch.editable === false || patch.selection && !sameIds(patch.selection, this.#snapshot.selection)) patch = { ...patch, paintPicker: undefined, openEffects: undefined };
    this.#snapshot = Object.freeze({ ...this.#snapshot, ...patch, canUndo: this.#undo.length > 0, canRedo: this.#redo.length > 0, dirty: !sameContent(document, this.#saved), hasSaved: this.#saved !== null });
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
    if (!editable) this.endTextPreview();
    if (!editable) this.pencil.cancel();
    if (!editable) this.pen.cancel();
    if (!editable) this.cancelInteraction();
    if (!editable) this.cancelPendingFiles();
    if (!editable) { this.#vectorEdit = undefined; this.#copiedPaint = undefined; this.#copiedEffect = undefined; }
    if (editable !== this.#snapshot.editable) this.#publish({ editable, tool: "move", profileDialog: false, missingFonts: undefined });
  }
  execute(command:"text.edit.selection",input?:unknown):EditSelection|null;
  execute(command:"text.fonts",input?:unknown):ReturnType<typeof queryFonts>;
  execute(command: "select.layersAt", input: unknown): ReturnType<typeof layersAt>;
  execute(command: "node.get", input: unknown): ReturnType<typeof getNode>;
  execute(command: "shapeBuilder.regions", input?: unknown): ReturnType<typeof readBuilderRegions>;
  execute(command: "frame.presets", input?: unknown): typeof framePresets;
  execute(command: "image.presets", input?: unknown): ReturnType<typeof listImagePresets>;
  execute(command: "page.list", input?: unknown): ReturnType<typeof listPages>;
  execute(command: string, input?: unknown): Record<string, unknown>;
  execute(command: string, input: unknown = {}): Record<string, unknown> | ReturnType<typeof listPages> | typeof framePresets | ReturnType<typeof queryFonts> | null {
    if (!Object.hasOwn(commandSpecs, command)) throw new Error(`Unsupported command: ${command}`);
    if (!this.#snapshot.editable) throw new Error("Sign in to edit this document");
    const p = command==="text.fonts" || command==="text.rescanFonts" || command==="text.loadFont"
      ? fontParams(command,input) : isTextEditCommand(command) ? namedParameters(input) : parameters(input);
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
    if (!gesture && !preservePen && !(command==="file.markSaved" && this.currentTextEdit())) { const interacting = this.interacting; this.pencil.cancel(); if (this.pen.open) this.pen.cancel(); else this.cancelInteraction(); if (interacting && command === "edit.undo") return { undone: true }; }
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
    const builderEdit = command === "shapeBuilder.merge" || command === "shapeBuilder.remove";
    if (command === "instance.create" || builderEdit || Object.hasOwn(structureSpecs, command) || Object.hasOwn(vectorSpecs, command)) {
      const before = this.#snapshot;
      const execute = builderEdit ? applyBuilder : Object.hasOwn(vectorSpecs, command) ? executeVector : executeStructure;
      const next = command === "instance.create" ? createInstance(before.document, this.#nextId, p)
        : execute(command, before.document, before.selection, this.#nextId, p);
      this.#commitEdit({document:next.document, selection:next.selection}, {record:!sameContent(before.document,next.document), nextId:next.nextId});
      return next.result;
    }
    if (Object.hasOwn(selectionSpecs, command)) {
      const next = executeSelection(command, this.#snapshot.document, this.#snapshot.selection, p);
      if (command === "select.none") this.#vectorEdit = undefined;
      this.#publish({ document: next.document, selection: next.selection });
      return next.result;
    }
    if (command === "effect.copy") {
      const previous = this.#copiedEffect;
      this.#copiedEffect = copyEffect(this.#snapshot.document, this.#snapshot.selection, p);
      if (!previous) this.#publish({});
      return wireEffect(this.#copiedEffect);
    }
    if (Object.hasOwn(effectSpecs, command)) {
      const before = this.#snapshot;
      const document = editEffects(command, before.document, before.selection, p, this.#copiedEffect);
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
      const previous = this.#copiedPaint?.list;
      this.#copiedPaint = copyPaint(list, this.#snapshot.document, this.#snapshot.selection, p, this.#vectorEdit);
      if (this.#copiedPaint.paint.type === "pattern") this.#copiedPaint.documentIdentity = this.#documentIdentity;
      if (previous !== list) this.#publish({});
      return { ...this.#copiedPaint.paint };
    }
    if (Object.hasOwn(fillSpecs, command) || command === "stroke.paste") {
      const before = this.#snapshot;
      const document = command === "fill.paste" || command === "stroke.paste"
        ? pastePaint(command === "fill.paste" ? "fill" : "stroke", before.document, before.selection, p, this.#copiedPaint, this.#vectorEdit, this.#documentIdentity)
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
      const document = p.revision === undefined ? this.#interaction?.document ?? this.#snapshot.document : typeof p.revision === "number" ? this.#pendingSaves.get(p.revision) : undefined;
      if (!document) return { saved: false };
      this.#saved = document;
      this.#pendingSaves.clear();
      this.#publish({});
      return { saved: true };
    }
    if (command.startsWith("file.") || command === "image.place" || command === "image.replace") throw new Error(`${command} requires executeAsync`);
    if (command === "text.create" || command === "vector.create" || command === "shape.line" || command === "shape.arrow" || command === "shape.polygon" || command === "shape.star" || command === "shape.ellipse" || command === "shape.rectangle" || command === "frame.create" || command === "node.create") return this.#create(command, p);
    if (Object.keys(p).length) throw new Error(`${command} takes no parameters`);
    if (command === "tool.text" || command==="tool.textOnPath" || command === "tool.shapeBuilder" || command === "tool.pencil" || command === "tool.pen" || command === "tool.line" || command === "tool.arrow" || command === "tool.polygon" || command === "tool.star" || command === "tool.ellipse" || command === "tool.rectangle" || command === "tool.move" || command === "tool.scale") {
      const end = this.#vectorEdit && command !== "tool.move" && command !== "tool.scale" ? executeVectorEdit("vector.edit.end", this.#snapshot.document, this.#snapshot.selection, this.#vectorEdit, {}) : undefined;
      if (end) this.#vectorEdit = undefined;
      this.#publish({ ...(end ? { document: end.document, selection: end.selection } : {}), tool: command.slice(5) as EditorSnapshot["tool"] });
      return {};
    }
    const undo = command === "edit.undo";
    const source = undo ? this.#undo : this.#redo;
    const target = undo ? this.#redo : this.#undo;
    const entry = source.pop();
    if (entry) {
      this.#lastDuplicate = undefined;
      target.push({ document: this.#snapshot.document, selection: this.#snapshot.selection });
      this.#publish(entry);
    }
    return { [undo ? "undone" : "redone"]: Boolean(entry) };
  }
  /** Native file commands run outside pointer rendering and retain atomic document replacement. */
  async executeAsync(command:"text.edit.selection",input?:unknown):Promise<EditSelection|null>;
  async executeAsync(command:"text.fonts",input?:unknown):Promise<ReturnType<typeof queryFonts>>;
  async executeAsync(command: "file.open" | "file.recover", input: unknown): Promise<OpenResult>;
  async executeAsync(command: "node.get", input: unknown): Promise<ReturnType<typeof getNode>>;
  async executeAsync(command: string, input?: unknown): Promise<Record<string, unknown>>;
  async executeAsync(command: string, input: unknown = {}): Promise<Record<string, unknown> | ReturnType<typeof queryFonts> | null> {
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
  async #prepareSave<T>(output: (archive: Blob) => Promise<T>) {
    if (!this.#snapshot.editable) throw new Error("Sign in to edit this document");
    this.pen.finish(); this.pencil.cancel();
    const live=this.currentTextEdit() && this.#interaction;
    if (!live) this.cancelInteraction();
    const {document,nextId} = live ? this.#prepareEdit(live.document,live.nextId) : {document:this.#snapshot.document,nextId:this.#nextId};
    const revision = ++this.#saveSequence, opening = this.#openSequence;
    const archive = await encodeFigcraftBlob(document, String(nextId));
    const data = await output(archive);
    if (!this.#snapshot.editable || opening !== this.#openSequence) throw new Error("Save was cancelled because the document or identity changed");
    this.#pendingSaves.set(revision, document);
    while (this.#pendingSaves.size > 16) this.#pendingSaves.delete(this.#pendingSaves.keys().next().value!);
    return {name: `${document.name}.figcraft`, bytes: archive.size, data, revision};
  }
  saveFile() {
    return this.#prepareSave(async archive => archive);
  }
  recoverFile(file: Blob) {
    return this.#executeFileCommand("file.recover", {}, {file});
  }
  async openFile(file:File) {
    return this.#executeFileCommand("file.open",{name:file.name},{file});
  }
  async placeFile(file:File) {
    return this.#executeFileCommand("file.placeImage",{x:this.#view.cx,y:this.#view.cy,name:file.name.replace(/\.[^.]+$/,"")},{file});
  }
  async uploadPaintImage(picker: PaintPicker, file: File) {
    if (this.#snapshot.paintPicker !== picker) throw new Error("Image picker was closed");
    return this.#executeFileCommand("image.replace", {ids:this.#snapshot.selection, target:picker.list, index:picker.index}, {picker, file});
  }
  async pasteImage(file: File, at?: Point) {
    const {document, selection} = this.#snapshot;
    const selected = selection.length === 1 ? document.nodes[selection[0]] : undefined;
    if (!at && selected && selected.kind !== "page" && selected.kind !== "group") {
      return this.#executeFileCommand("image.place",{target:selected.id},{file,paste:true});
    }
    return this.#executeFileCommand("file.import",{name:"Pasted image.png",...at},{file,paste:true,centre:!at});
  }
  async dropImages(files: readonly File[], at: Point, picker?: PaintPicker) {
    const errors: string[] = [];
    for (const [index,file] of files.entries()) {
      const before = this.#snapshot.document;
      const sequence = this.#openSequence;
      try {
        if (index === 0 && picker) await this.uploadPaintImage(picker,file);
        else await this.#executeFileCommand("file.import",{name:file.name || "dropped.png",...at},{file});
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
    if (source && (placing || replacing || raster) && source.file.size > MAX_IMAGE_BYTES) throw new Error("Image exceeds the 256 MiB external input limit");
    const allowed = importing ? ["name","data","x","y","center","variables"] : replacing ? ["data", "ids", "id", "target", "index"] : placing ? ["data", "name", "target", "mode", "width", "height", "parent", "x", "y"] : ["data", "name"];
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
    if (placing || replacing) {
      const bytes = await inputBytes();
      if (source) checkCurrent();
      const placement = importing ? rasterImportParams(p,centre) : p;
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
    }

    let decoded: Awaited<ReturnType<typeof decodeFigcraft>>;
    if (raster) {
      const image = await prepareImage(await inputBytes(), undefined, undefined, source?.file);
      const name = String(p.name).split(/[\\/]/).pop()!.replace(rasterFilename, "");
      const initial = { document: newDocument(name), selection: [] };
      const opened = placeImage(initial, 2n, image, { name, width: image.resource.width, height: image.resource.height });
      await prepareArchive(opened.document, String(opened.nextId));
      decoded = { document: opened.document, nextId: String(opened.nextId) };
    } else decoded = await decodeFigcraft(source?.file ?? fileData(p.data, MAX_UNPACKED_BYTES));
    if (!raster) await prepareDocumentText(decoded.document);
    checkCurrent();
    this.#documentIdentity = Symbol();
    this.#nextId = BigInt(decoded.nextId);
    this.#undo = []; this.#redo = []; this.#saved = null; this.#pendingSaves.clear();
    this.#vectorEdit = undefined;
    this.#publish({ document: decoded.document, profileDialog: false, missingFonts: undefined, selection: Object.freeze([]), tool: "move" });
    this.updateView(fitPage({ ...this.#view, proofSrgb: false }, decoded.document));
    return { repairs: decoded.issues ?? [], summary: { name: decoded.document.name, pages: decoded.document.pages.length, layers: Object.keys(decoded.document.nodes).length - decoded.document.pages.length, images: Object.keys(decoded.document.images ?? {}).length } };
  }
  #create(command: string, p: Record<string, unknown>): Record<string, unknown> {
    const before = this.#snapshot, next = createLayer(before, this.#nextId, command, p, this.#view);
    this.#commitEdit({document:next.document, selection:next.selection}, {nextId:next.nextId}); return { id: next.id };
  }
}
