import type { EditorEngine } from "./editor";
import type { Point } from "./geometry";
import type { NodeId } from "./document";
import type { BoardItem } from "./board-data";
import { labelOf, shapeSide, stickySide, textOf } from "./board-commands";
import { hitRectangle, targetForLeaf } from "./selection";
import { pageToScreen } from "./viewport";

/** Source: upstream engine/src/boards/board/tools.rs (#2226): presses with the board tools. Native `ERASER_PX`: the eraser's reach on screen. */
export const eraserPx = 8;
const placing = new Set(["sticky", "shape", "stamp", "eraser", "connector"]);

/** Native `board_down`, `board_placed`, `erase_at` and `erase_up`. Marker and highlighter strokes are the pencil's. */
export class BoardToolInteraction {
  #erase?: { gone: NodeId[] };
  #brush?: { x: number; y: number; r: number };
  constructor(private engine: EditorEngine) {}
  get active(): boolean { return this.#erase !== undefined; }
  /** Whether the current tool is one of the board tools this handles. */
  handles(): boolean { return placing.has(this.engine.getSnapshot().tool); }
  /** A press with a board tool. `undefined`: not one (or a board tool left on in a design file, now Move: the press is Move's);
   * otherwise whether the pointer stays captured, and the text a placed sticky starts typing in. */
  down(point: Point): { capture: boolean; edit?: NodeId } | undefined {
    const snapshot = this.engine.getSnapshot(), tool = snapshot.tool;
    if (!snapshot.editable || !placing.has(tool)) return undefined;
    if (snapshot.document.kind !== "board") { this.engine.execute("tool.move"); return undefined; }
    switch (tool) {
      case "sticky": {
        const half = stickySide / 2, r = this.engine.execute("board.sticky", { x: point.x - half, y: point.y - half }) as { id?: number };
        this.#placed();
        const id = r.id === undefined ? undefined : textOf(this.engine.getSnapshot().document, String(r.id));
        return { capture: false, ...(id && { edit: id }) };
      }
      case "shape": {
        const half = shapeSide / 2;
        this.engine.execute("board.shape", { x: point.x - half, y: point.y - half });
        this.#placed();
        return { capture: false };
      }
      // Stamps go on one after another: the tool stays.
      case "stamp": this.engine.execute("board.stamp", { x: point.x, y: point.y }); return { capture: false };
      case "eraser": {
        this.engine.beginInteraction();
        this.#erase = { gone: [] };
        this.move(point);
        return { capture: true };
      }
      // Dragging connectors out comes with the connect drag.
      default: return { capture: false };
    }
  }
  /** Native `erase_at`: the marker and highlighter strokes the eraser touches go, until it is let go (one undo step). */
  move(point: Point): void {
    const erase = this.#erase;
    if (!erase) return;
    const r = eraserPx / Math.max(this.engine.getView().zoom, 1e-6);
    this.#brush = { x: point.x, y: point.y, r };
    const doc = this.engine.getRenderDocument();
    const hit = hitRectangle(doc, point, true, [], r);
    if (hit && (doc.nodes[hit] as { board?: BoardItem } | undefined)?.board?.type === "ink" && !erase.gone.includes(hit)) {
      erase.gone.push(hit);
      this.engine.previewRemove(erase.gone);
    }
    this.engine.invalidateCanvas();
  }
  up(point: Point): void {
    if (!this.#erase) return;
    this.move(point);
    this.#erase = undefined; this.#brush = undefined;
    this.engine.commitInteraction();
  }
  cancel(): void {
    if (!this.#erase) return;
    this.#erase = undefined; this.#brush = undefined;
    this.engine.cancelInteraction(); this.engine.invalidateCanvas();
  }
  /** Native `board_double_click`: a double-click with the Move tool on a board object types in its text (a connector gets a label,
   * "Label", to type in). The text to type in, or `undefined` when it wasn't one. Tables' cells come with table editing. */
  doubleClick(point: Point): NodeId | undefined {
    const snapshot = this.engine.getSnapshot(), doc = this.engine.getRenderDocument();
    if (!snapshot.editable || snapshot.tool !== "move" || doc.kind !== "board") return undefined;
    const leaf = hitRectangle(doc, point, true, [], 2 / Math.max(this.engine.getView().zoom, 1e-6));
    if (!leaf) return undefined;
    const whole = targetForLeaf(doc, leaf, this.engine.getRenderSelection()), item = (doc.nodes[whole] as { board?: BoardItem } | undefined)?.board;
    if (!item || item.type === "table") return undefined;
    if (item.type === "connector") {
      const label = labelOf(doc, whole) ?? (() => { const r = this.engine.execute("board.label", { id: Number(whole), text: "Label" }) as { label?: number }; return r.label === undefined ? undefined : String(r.label); })();
      return label === undefined ? undefined : textOf(this.engine.getSnapshot().document, label);
    }
    return textOf(doc, whole);
  }
  /** After placing an object: back to the Move tool. */
  #placed(): void { this.engine.execute("tool.move"); }
  /** The eraser's reach while erasing. */
  draw(context: CanvasRenderingContext2D): void {
    const b = this.#brush;
    if (!b) return;
    const view = this.engine.getView(), c = pageToScreen(view, b);
    context.save(); context.strokeStyle = "rgba(0,0,0,0.5)"; context.lineWidth = 1;
    context.beginPath(); context.arc(c.x, c.y, b.r * view.zoom, 0, Math.PI * 2); context.stroke(); context.restore();
  }
}
