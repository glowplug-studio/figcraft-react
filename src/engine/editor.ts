import { isGroupLike, rectanglePaints } from "./document";
import { getNode } from "./inspect";
import { createLayer } from "./creation";
import { copyFill, fillSpecs, selectedRegionFills, writeFill } from "./fill-commands";
import type { Paint } from "./solid-paint";
import { executeStrokeList, strokeSpecs } from "./stroke-commands";
import { isLeaf } from "./document";
import { newDocument, sameContent, withLayerTransform, type Document, type DrawShapeKind, type NodeId } from "./document";
import { decodeFigcraft, encodeFigcraft, MAX_FILE_BYTES } from "./file-format";
import { executePage, listPages, pageSpecs } from "./pages";
import { executeSelection, selectionSpecs } from "./selection";
import { setRectangleProperties } from "./properties";
import { HierarchyDraft, pageForNode, worldTransform } from "./hierarchy";
import { applyBuilder } from "./shape-builder-commands";
import { builderArrangement, builderTargets, readBuilderRegions } from "./shape-builder";
import { executeStructure, structureSpecs } from "./structure";
import { executeVector, isVectorJoin, vectorSpecs } from "./vector-commands";
import { executeVectorEdit, vectorEditSpecs, type VectorEditCommand } from "./vector-edit-commands";
import { clampVectorEdit, vectorNetwork, type VectorEditState } from "./vector-edit";
import { defaultViewport, executeView, fitPage, viewSpecs, type Viewport } from "./viewport";
import { framePresets } from "./frame-presets";
import { parseBoolean, parseNumber } from "./parameters";
import { arrangeSpecs, executeArrange } from "./arrange";
import { anchors, sizingSpecs, executeSizing } from "./sizing";
import { executeRotation, localOrigin, movedOrigin, originBoxPoints, originSpecs, rotationSpecs, sameIds, snappedOrigin, validateChangedGeometry, type OriginSnapshot, type RotationOrigin } from "./rotation";
import type { Point } from "./geometry";
import { executeSmartSelection, smartSpecs } from "./smart-selection";
import { duplicateSelection, executeDuplicate, type Duplicated } from "./duplicate";
import { ancestorIds } from "./canvas-selection";
import { previewResize, type ResizeStart } from "./transform-preview";
import type { ScaleAnchor } from "./transform-handles";
import { PenInteraction } from "./pen-interaction";
import { buildPenPath, type PenAnchor } from "./pen-path";
import { PencilInteraction } from "./pencil-interaction";
import { parseBrush, wireBrush, type Brush } from "./brush";

export const commandSpecs = Object.freeze({
  ...strokeSpecs,
  ...fillSpecs,
  ...arrangeSpecs,
  ...sizingSpecs,
  ...rotationSpecs,
  ...originSpecs,
  ...smartSpecs,
  ...pageSpecs,
  ...viewSpecs,
  "frame.presets": { label: "List frame presets", undo: false },
  ...selectionSpecs,
  ...structureSpecs,
  "tool.shapeBuilder": { label: "Shape builder", undo: false },
  "shapeBuilder.mode": { label: "Shape builder mode", undo: false },
  "shapeBuilder.regions": { label: "Shape builder regions", undo: false },
  "shapeBuilder.merge": { label: "Merge regions", undo: true },
  "shapeBuilder.remove": { label: "Remove regions", undo: true },
  ...vectorSpecs,
  ...vectorEditSpecs,
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
  "node.create": { label: "Create layer", undo: true },
  "vector.create": { label: "Vector", undo: true },
  "tool.ellipse": { label: "Ellipse", undo: false },
  "tool.rectangle": { label: "Rectangle", undo: false },
  "tool.move": { label: "Move", undo: false },
  "tool.scale": { label: "Scale", undo: false },
  "tool.pen": { label: "Pen", undo: false },
  "tool.pencil": { label: "Pencil", undo: false },
  "tool.pencilBrush": { label: "Pencil brush", undo: false },
  "tool.scaleAnchor": { label: "Scale anchor", undo: false },
  "edit.undo": { label: "Undo", undo: false },
  "edit.redo": { label: "Redo", undo: false },
  "edit.duplicate": { label: "Duplicate", undo: true },
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
  readonly paintPicker?: PaintPicker;
  readonly document: Document;
  readonly selection: readonly NodeId[];
  readonly tool: "move" | DrawShapeKind | "scale" | "pen" | "pencil" | "shapeBuilder";
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
    preparedCopy?: { ids: readonly NodeId[]; result: ReturnType<typeof executeDuplicate> };
    baseVectorEdit?: VectorEditState; vectorEdit?: VectorEditState;
  };
  #canvasListeners = new Set<() => void>();
  #vectorEdit?: VectorEditState;
  #copiedFill?: Paint;
  hasCopiedFill = (): boolean => this.#copiedFill !== undefined;
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
  getRenderDocument = (): Document => this.#interaction?.document ?? this.#snapshot.document;
  getRenderSelection = (): readonly NodeId[] => this.#interaction?.selection ?? this.#snapshot.selection;
  getInteractionBase = (): Document => this.#interaction?.base.document ?? this.#snapshot.document;
  subscribeCanvas = (listener: () => void): (() => void) => { this.#canvasListeners.add(listener); return () => { this.#canvasListeners.delete(listener); }; };
  get interacting(): boolean { return this.#interaction !== undefined; }
  beginInteraction(): void {
    if (!this.#snapshot.editable) throw new Error("Sign in to edit this document");
    if (this.#interaction) throw new Error("An interaction is already active");
    this.#interaction = { base: this.#snapshot, document: this.#snapshot.document, selection: this.#snapshot.selection, nextId: this.#nextId, baseVectorEdit: this.#vectorEdit, vectorEdit: this.#vectorEdit };
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
  previewMove(ids: readonly NodeId[], delta: Point, duplicate: boolean): void {
    const interaction = this.#interaction;
    if (!interaction) throw new Error("No active interaction");
    if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) throw new Error("Move delta must be finite");
    let document = interaction.base.document, selection = interaction.base.selection, nextId = this.#nextId;
    let duplicated: Duplicated | undefined;
    if (duplicate) {
      if (!interaction.preparedCopy || !sameIds(interaction.preparedCopy.ids, ids)) {
        interaction.preparedCopy = { ids: Object.freeze([...ids]), result: executeDuplicate(document, ids, nextId, { ids, dx: 0, dy: 0 }) };
      }
      const copy = interaction.preparedCopy.result;
      document = copy.document; duplicated = copy.duplicated; selection = duplicated.copies; nextId = copy.nextId;
    }
    document = executeArrange("transform.move", document, selection, { ids: duplicated?.copies ?? ids, dx: delta.x, dy: delta.y });
    interaction.document = document; interaction.selection = selection; interaction.nextId = nextId; interaction.duplicated = duplicated;
    this.#notifyCanvas();
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
  setPaintPicker(paintPicker?: PaintPicker): void {
    if (paintPicker && !this.#snapshot.editable) return;
    this.#publish({ paintPicker });
  }
  /** The native canvas handles edit one open picker. Mixed region paints have no target. */
  pickedGradient() {
    const picker = this.#snapshot.paintPicker, ids = this.getRenderSelection();
    if (!picker || ids.length !== 1) return;
    const node = this.getRenderDocument().nodes[ids[0]];
    if (!node || node.kind === "page") return;
    const regions = picker.list === "fill" ? selectedRegionFills(node, this.getRenderVectorEdit()) : undefined;
    const stack = picker.list === "stroke" ? node.strokes : regions === undefined ? rectanglePaints(node) : regions;
    const paint = stack?.[picker.index];
    if (paint?.type === "gradient") return { node, paint, picker };
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
    if (draft.nodes[moving[0]]?.parent !== target) for (const id of moving) {
      const node = draft.nodes[id];
      if (!node || node.kind === "page" || isGroupLike(draft.nodes[node.parent]) || id === target || ancestorIds(draft.document, target).includes(id)) continue;
      draft.reparent(id, target);
    }
    draft.normaliseGroups(); interaction.document = validateChangedGeometry(draft);
    this.commitInteraction();
  }
  #notifyCanvas(): void { this.#refreshOrigin(); this.#canvasListeners.forEach(listener => listener()); }
  cancelInteraction(): boolean {
    if (!this.#interaction) return false;
    this.#interaction = undefined; this.#notifyCanvas(); return true;
  }
  commitInteraction(): boolean {
    const interaction = this.#interaction;
    if (!interaction) return false;
    this.#interaction = undefined;
    const { base, document, selection } = interaction;
    const vectorChanged = interaction.vectorEdit !== interaction.baseVectorEdit;
    if (vectorChanged) this.#vectorEdit = interaction.vectorEdit;
    // Moving back to the source adds no history; copies and parenting are content changes.
    const changed = document !== base.document && (Object.keys(document.nodes).length !== Object.keys(base.document.nodes).length || Object.keys(document.nodes).some(id => {
      const node = document.nodes[id], old = base.document.nodes[id];
      return node !== old && JSON.stringify(node) !== JSON.stringify(old);
    }));
    if (changed) {
      this.#undo.push({ document: base.document, selection: base.selection }); this.#redo = [];
      this.#nextId = interaction.nextId;
      if (interaction.duplicated) this.#lastDuplicate = interaction.duplicated;
      this.#publish({ document, selection });
    } else if (!sameIds(base.selection, selection)) this.#publish({ selection });
    else { if (vectorChanged) this.#vectorListeners.forEach(listener => listener()); this.#notifyCanvas(); }
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
    if ([view.cx, view.cy, view.zoom, view.vw, view.vh].some(value => !Number.isFinite(value)) || [view.snapObjects, view.snapPixel].some(value => value !== undefined && typeof value !== "boolean") || view.zoom < 0.02 || view.zoom > 256 || view.vw <= 0 || view.vh <= 0) throw new Error("Invalid viewport");
    if ((Object.keys(view) as (keyof Viewport)[]).every(key => view[key] === this.#view[key])) return;
    this.#view = Object.freeze({ ...view }); this.#viewListeners.forEach(listener => listener());
  }
  resizeViewport(width: number, height: number): void {
    const next = { ...this.#view, vw: Math.max(1, width), vh: Math.max(1, height) };
    this.updateView(!this.#viewportAttached && !this.#viewConfigured ? fitPage(next, this.#snapshot.document) : next);
    this.#viewportAttached = true;
  }
  subscribe = (listener: () => void): (() => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; };
  nativeSnapshot = (): Promise<Uint8Array> => encodeFigcraft(this.#snapshot.document, String(this.#nextId));
  cancelPendingFiles(): void { this.#openSequence++; this.#pendingSaves.clear(); }
  #publish(patch: Partial<EditorSnapshot>): void {
    const document = patch.document ?? this.#snapshot.document;
    if (patch.editable === false || patch.selection && !sameIds(patch.selection, this.#snapshot.selection)) patch = { ...patch, paintPicker: undefined };
    this.#snapshot = Object.freeze({ ...this.#snapshot, ...patch, canUndo: this.#undo.length > 0, canRedo: this.#redo.length > 0, dirty: !sameContent(document, this.#saved), hasSaved: this.#saved !== null });
    if (this.#lastDuplicate && !duplicateSelection(this.#lastDuplicate, this.#snapshot.selection)) this.#lastDuplicate = undefined;
    if (this.#vectorEdit) this.#vectorEdit = pageForNode(document, this.#vectorEdit.id) === document.currentPage ? clampVectorEdit(document, this.#vectorEdit) : undefined;
    this.#vectorListeners.forEach(listener => listener());
    this.#refreshOrigin();
    this.#canvasListeners.forEach(listener => listener());
    this.#listeners.forEach(listener => listener());
  }
  setEditable(editable: boolean): void {
    if (!editable) this.pencil.cancel();
    if (!editable) this.pen.cancel();
    if (!editable) this.cancelInteraction();
    if (!editable) this.cancelPendingFiles();
    if (!editable) { this.#vectorEdit = undefined; this.#copiedFill = undefined; }
    if (editable !== this.#snapshot.editable) this.#publish({ editable, tool: "move" });
  }
  execute(command: "node.get", input: unknown): ReturnType<typeof getNode>;
  execute(command: "shapeBuilder.regions", input?: unknown): ReturnType<typeof readBuilderRegions>;
  execute(command: "frame.presets", input?: unknown): typeof framePresets;
  execute(command: "page.list", input?: unknown): ReturnType<typeof listPages>;
  execute(command: string, input?: unknown): Record<string, unknown>;
  execute(command: string, input: unknown = {}): Record<string, unknown> | ReturnType<typeof listPages> | typeof framePresets | null {
    if (!Object.hasOwn(commandSpecs, command)) throw new Error(`Unsupported command: ${command}`);
    if (!this.#snapshot.editable) throw new Error("Sign in to edit this document");
    const p = parameters(input);
    if (command === "shapeBuilder.mode") {
      if (p.mode !== "merge" && p.mode !== "remove") throw new Error("shapeBuilder.mode: mode must be merge or remove");
      this.#publish({builderMode:p.mode});
      return {mode:p.mode};
    }
    if (command === "shapeBuilder.regions") return readBuilderRegions(builderArrangement(this.#snapshot.document, builderTargets(p, this.#snapshot.selection)));
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
    if (!gesture && !preservePen) { const interacting = this.interacting; this.pencil.cancel(); if (this.pen.open) this.pen.cancel(); else this.cancelInteraction(); if (interacting && command === "edit.undo") return { undone: true }; }
    if (Object.hasOwn(vectorEditSpecs, command) || (this.#vectorEdit && isVectorJoin(command))) {
      const before = this.#snapshot, oldState = this.#vectorEdit, next = executeVectorEdit(isVectorJoin(command) ? command : command as VectorEditCommand, before.document, before.selection, oldState, p, this.#nextId);
      if (next.nextId !== undefined) this.#nextId = next.nextId;
      if (next.recordHistory) { this.#undo.push({ document: before.document, selection: before.selection }); this.#redo = []; }
      this.#vectorEdit = next.state;
      if (next.document !== before.document || !sameIds(next.selection, before.selection)) this.#publish({ document: next.document, selection: next.selection });
      else if (next.state !== oldState) { this.#vectorListeners.forEach(listener => listener()); this.#notifyCanvas(); }
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
    if (command === "frame.presets") return framePresets;
    if (command === "edit.duplicate") {
      const before = this.#snapshot;
      const next = executeDuplicate(before.document, before.selection, this.#nextId, p, this.#lastDuplicate);
      this.#undo.push({ document: before.document, selection: before.selection }); this.#redo = [];
      this.#nextId = next.nextId;
      this.#lastDuplicate = next.duplicated;
      this.#publish({ document: next.document, selection: next.duplicated.copies });
      return next.result;
    }
    if (Object.hasOwn(smartSpecs, command)) {
      const before = this.#snapshot, current = this.#interaction?.document ?? before.document;
      const document = executeSmartSelection(command, current, before.selection, p, this.#interaction?.base.document ?? current);
      if (this.#interaction) { this.#interaction.document = document; this.#notifyCanvas(); }
      else if (document !== before.document) {
        this.#undo.push({ document: before.document, selection: before.selection }); this.#redo = [];
        this.#publish({ document });
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
    if (Object.hasOwn(arrangeSpecs, command) || Object.hasOwn(sizingSpecs, command) || Object.hasOwn(rotationSpecs, command)) {
      const before = this.#snapshot;
      const document = Object.hasOwn(rotationSpecs, command)
        ? executeRotation(command, before.document, before.selection, p, movedOrigin(before.document, before.selection, this.#origin), this.#vectorEdit)
        : (Object.hasOwn(sizingSpecs, command) ? executeSizing : executeArrange)(command, before.document, before.selection, p);
      if (document !== before.document) {
        this.#undo.push({ document: before.document, selection: before.selection }); this.#redo = [];
        this.#publish({ document });
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
    if (builderEdit || Object.hasOwn(structureSpecs, command) || Object.hasOwn(vectorSpecs, command)) {
      const before = this.#snapshot;
      const execute = builderEdit ? applyBuilder : Object.hasOwn(vectorSpecs, command) ? executeVector : executeStructure;
      const next = execute(command, before.document, before.selection, this.#nextId, p);
      if (!sameContent(before.document, next.document)) {
        this.#undo.push({ document: before.document, selection: before.selection }); this.#redo = [];
      }
      this.#nextId = next.nextId;
      this.#publish({ document: next.document, selection: next.selection });
      return next.result;
    }
    if (Object.hasOwn(selectionSpecs, command)) {
      const next = executeSelection(command, this.#snapshot.document, this.#snapshot.selection, p);
      if (command === "select.none") this.#vectorEdit = undefined;
      this.#publish({ document: next.document, selection: next.selection });
      return next.result;
    }
    if (command === "fill.copy") {
      const wasEmpty = !this.#copiedFill;
      this.#copiedFill = copyFill(this.#snapshot.document, this.#snapshot.selection, p, this.#vectorEdit);
      if (wasEmpty) this.#publish({});
      return { ...this.#copiedFill };
    }
    if (Object.hasOwn(fillSpecs, command)) {
      const before = this.#snapshot;
      const document = writeFill(command as Exclude<keyof typeof fillSpecs, "fill.copy">, before.document, before.selection, p, this.#vectorEdit, this.#copiedFill);
      if (document !== before.document) {
        this.#undo.push({ document: before.document, selection: before.selection }); this.#redo = [];
        this.#publish({ document });
      }
      return { ok: true };
    }
    if (command === "node.set" || Object.hasOwn(strokeSpecs, command)) {
      const before = this.#snapshot;
      const warnings: string[] = [];
      const document = command === "node.set" ? setRectangleProperties(before.document, before.selection, p, movedOrigin(before.document, before.selection, this.#origin), warnings) : executeStrokeList(command, before.document, before.selection, p);
      if (document !== before.document) {
        this.#undo.push({ document: before.document, selection: before.selection });
        this.#redo = [];
        this.#publish({ document, selection: Object.freeze(before.selection.filter(id => document.nodes[id] && pageForNode(document, id) === document.currentPage)) });
      }
      return { ok: true, ...(warnings.length ? { warnings } : {}) };
    }
    if (command === "page.list") return listPages(this.#snapshot.document);
    if (Object.hasOwn(pageSpecs, command)) {
      const before = this.#snapshot;
      const changed = executePage(command, before.document, before.selection, this.#nextId, p);
      if (command !== "page.select" && !sameContent(before.document, changed.document)) {
        this.#undo.push({ document: before.document, selection: before.selection });
        this.#redo = [];
      }
      this.#nextId = changed.nextId;
      if (changed.document !== before.document || changed.selection !== before.selection) this.#publish({ document: changed.document, selection: changed.selection });
      if (command === "page.select" || command !== "page.duplicate" && changed.document.currentPage !== before.document.currentPage) this.updateView(fitPage(this.#view, changed.document));
      return changed.result;
    }
    if (command === "file.markSaved") {
      if (Object.keys(p).some(key => key !== "revision")) throw new Error("Unsupported save acknowledgement parameter");
      const document = p.revision === undefined ? this.#snapshot.document : typeof p.revision === "number" ? this.#pendingSaves.get(p.revision) : undefined;
      if (!document) return { saved: false };
      this.#saved = document;
      this.#pendingSaves.clear();
      this.#publish({});
      return { saved: true };
    }
    if (command.startsWith("file.")) throw new Error(`${command} requires executeAsync`);
    if (command === "vector.create" || command === "shape.line" || command === "shape.arrow" || command === "shape.polygon" || command === "shape.star" || command === "shape.ellipse" || command === "shape.rectangle" || command === "frame.create" || command === "node.create") return this.#create(command, p);
    if (Object.keys(p).length) throw new Error(`${command} takes no parameters`);
    if (command === "tool.shapeBuilder" || command === "tool.pencil" || command === "tool.pen" || command === "tool.line" || command === "tool.arrow" || command === "tool.polygon" || command === "tool.star" || command === "tool.ellipse" || command === "tool.rectangle" || command === "tool.move" || command === "tool.scale") {
      const end = this.#vectorEdit && command !== "tool.move" && command !== "tool.scale" ? executeVectorEdit("vector.edit.end", this.#snapshot.document, this.#snapshot.selection, this.#vectorEdit, {}) : undefined;
      if (end) this.#vectorEdit = undefined;
      this.#publish({ ...(end ? { document: end.document, selection: end.selection } : {}), tool: command === "tool.shapeBuilder" ? "shapeBuilder" : command === "tool.pencil" ? "pencil" : command === "tool.pen" ? "pen" : command === "tool.line" ? "line" : command === "tool.arrow" ? "arrow" : command === "tool.polygon" ? "polygon" : command === "tool.star" ? "star" : command === "tool.ellipse" ? "ellipse" : command === "tool.rectangle" ? "rectangle" : command === "tool.scale" ? "scale" : "move" });
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
  async executeAsync(command: "file.open" | "file.recover", input: unknown): Promise<{ repairs: readonly string[]; summary: { name: string; pages: number; layers: number; images: number } }>;
  async executeAsync(command: "node.get", input: unknown): Promise<ReturnType<typeof getNode>>;
  async executeAsync(command: string, input?: unknown): Promise<Record<string, unknown>>;
  async executeAsync(command: string, input: unknown = {}): Promise<Record<string, unknown> | null> {
    if (!["file.open", "file.recover", "file.saveAs"].includes(command)) return this.execute(command, input);
    if (!this.#snapshot.editable) throw new Error("Sign in to edit this document");
    const p = parameters(input);
    if (command === "file.saveAs") {
      if (Object.keys(p).some(key => key !== "data") || (p.data !== undefined && p.data !== true)) throw new Error("Browser save requires data: true");
      this.pen.finish(); this.pencil.cancel(); this.cancelInteraction();
      const document = this.#snapshot.document;
      const revision = ++this.#saveSequence;
      const opening = this.#openSequence;
      const bytes = await encodeFigcraft(document, String(this.#nextId));
      if (!this.#snapshot.editable || opening !== this.#openSequence) throw new Error("Save was cancelled because the document or identity changed");
      this.#pendingSaves.set(revision, document);
      while (this.#pendingSaves.size > 16) this.#pendingSaves.delete(this.#pendingSaves.keys().next().value!);
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      return { name: `${document.name}.figcraft`, bytes: bytes.length, data: btoa(binary), revision };
    }
    if (Object.keys(p).some(key => !["data", "name"].includes(key)) || typeof p.data !== "string" || (p.name !== undefined && typeof p.name !== "string")) throw new Error("File open requires base64 data and optional name");
    this.pen.cancel(); this.pencil.cancel(); this.cancelInteraction();
    if (p.data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4) throw new Error("File exceeds the browser import limit");
    const before = this.#snapshot.document;
    const opening = ++this.#openSequence;
    const bytes = Uint8Array.from(atob(p.data), character => character.charCodeAt(0));
    const decoded = await decodeFigcraft(bytes);
    if (opening !== this.#openSequence || before !== this.#snapshot.document || !this.#snapshot.editable) throw new Error("Open was cancelled because the document or identity changed");
    this.#nextId = BigInt(decoded.nextId);
    this.#undo = []; this.#redo = []; this.#saved = null; this.#pendingSaves.clear();
    this.#vectorEdit = undefined;
    this.#publish({ document: decoded.document, selection: Object.freeze([]), tool: "move" });
    this.updateView(fitPage(this.#view, decoded.document));
    return { repairs: decoded.issues ?? [], summary: { name: decoded.document.name, pages: decoded.document.pages.length, layers: Object.keys(decoded.document.nodes).length - decoded.document.pages.length, images: Object.keys(decoded.document.images ?? {}).length } };
  }
  #create(command: string, p: Record<string, unknown>): Record<string, unknown> {
    const before = this.#snapshot, next = createLayer(before, this.#nextId, command, p, this.#view);
    this.#undo.push({ document: before.document, selection: before.selection }); this.#redo = []; this.#nextId = next.nextId;
    this.#publish({ document: next.document, selection: next.selection }); return { id: next.id };
  }
}
