import { useRef, type RefObject } from "react";
import type { EditorSnapshot } from "./engine/editor";
import type { BoardTool } from "./engine/board-commands";
import { stampColour } from "./engine/board-commands";
import { boardColours, stamps, type Stamp } from "./engine/board-data";
import { shapeLabel, shapeOrder, shapePath } from "./engine/board-shapes";
import { templates } from "./engine/board-templates";
import { cssColour } from "./engine/colour";
import { parseColour } from "./engine/colour-css";

/** Source: upstream ui-egui/src/toolbar.rs `BOARD_GROUPS`, canvas/board_bar.rs `choices` and widgets/board_picker.rs (#2226):
 * a board's toolbar (moving, ink, stickies, shapes, connectors, text, sections, stamps, comments) and its templates picker. */
type Dispatch = (command: string, params?: Record<string, unknown>) => unknown;
type Props = { snapshot: EditorSnapshot; tool: BoardTool; editable: boolean; commenting: boolean; canvas: RefObject<HTMLCanvasElement | null>; dispatch: Dispatch };

/** Native `color_label`. */
const colourLabels: Record<string, string> = { yellow: "Yellow", orange: "Orange", red: "Red", pink: "Pink", violet: "Violet", blue: "Blue", green: "Green", gray: "Gray" };
/** Native `Stamp::label`. */
export const stampLabels: Record<Stamp, string> = { thumbsUp: "Thumbs up", heart: "Heart", plusOne: "Plus one", star: "Star", question: "Question", check: "Check" };
const same = (a: { r: number; g: number; b: number }, hex: string) => { const c = parseColour(hex); return !!c && Math.abs(c.r - a.r) < 1e-3 && Math.abs(c.g - a.g) < 1e-3 && Math.abs(c.b - a.b) < 1e-3; };
const pathData = (shape: Parameters<typeof shapePath>[0]) => shapePath(shape, 16, 16).map(c => c.join(" ")).join(" ");

function Flyout({ label, popover, children }: { label: string; popover: RefObject<HTMLDivElement | null>; children: React.ReactNode }) {
  return <div ref={popover} role="dialog" aria-label={label} popover="auto" className="figcraft-board-flyout"
    style={{ position: "fixed", top: "auto", right: "auto", margin: 0, padding: 4, border: "1px solid #ddd", borderRadius: 6, maxWidth: 8 * 34 + 8 }}>{children}</div>;
}
function open(popover: RefObject<HTMLDivElement | null>, anchor: HTMLElement, keyboard: boolean) {
  const menu = popover.current;
  if (!menu) return;
  const rect = anchor.getBoundingClientRect();
  menu.style.left = rect.left + "px"; menu.style.bottom = (window.innerHeight - rect.top + 6) + "px";
  if (menu.matches(":popover-open")) menu.hidePopover();
  else { menu.showPopover(); if (keyboard) menu.querySelector("button")?.focus(); }
}

export function BoardToolbar({ snapshot, tool, editable, commenting, canvas, dispatch }: Props) {
  const colours = useRef<HTMLDivElement>(null), shapes = useRef<HTMLDivElement>(null), stampMenu = useRef<HTMLDivElement>(null), picker = useRef<HTMLDivElement>(null);
  const run = (command: string, params?: Record<string, unknown>) => { dispatch(command, params); canvas.current?.focus(); };
  const button = (id: string, label: string, title = label) =>
    <button key={id} disabled={!editable} aria-pressed={snapshot.tool === id} title={title} onClick={() => run("tool." + id)}>{label}</button>;
  const choose = (menu: RefObject<HTMLDivElement | null>, command: string, params: Record<string, unknown>) => { menu.current?.hidePopover(); run(command, params); };
  return <div className="figcraft-toolbar" role="toolbar" aria-label="Board tools">
    {button("move", "Move")}
    <span role="group" aria-label="Drawing tools">{button("marker", "Marker")}{button("highlighter", "Highlighter")}{button("eraser", "Eraser")}</span>
    <button disabled={!editable} aria-pressed={snapshot.tool === "sticky"} title="Sticky note" onClick={() => run("tool.sticky")}>Sticky note</button>
    <button disabled={!editable} aria-label="Sticky note colors" aria-haspopup="dialog" onClick={e => open(colours, e.currentTarget, e.detail === 0)}>▾</button>
    <Flyout label="Sticky note colors" popover={colours}>
      {boardColours.map(([name, hex]) => <button key={name} aria-label={colourLabels[name]} aria-pressed={same(tool.sticky, hex)} title={colourLabels[name]}
        onClick={() => choose(colours, "tool.sticky", { color: name })}><span aria-hidden="true" style={{ display: "inline-block", width: 16, height: 16, borderRadius: 3, background: hex }} /></button>)}
    </Flyout>
    <button disabled={!editable} aria-pressed={snapshot.tool === "shape"} title="Shapes" onClick={() => run("tool.shape")}>Shape</button>
    <button disabled={!editable} aria-label="Shapes" aria-haspopup="dialog" onClick={e => open(shapes, e.currentTarget, e.detail === 0)}>▾</button>
    <Flyout label="Shapes" popover={shapes}>
      {shapeOrder.map(shape => <button key={shape} aria-label={shapeLabel(shape)} aria-pressed={tool.shape === shape} title={shapeLabel(shape)}
        onClick={() => choose(shapes, "tool.shape", { shape })}><svg aria-hidden="true" width="18" height="18" viewBox="-1 -1 18 18"><path d={pathData(shape)} fill="none" stroke="currentColor" strokeWidth="1.2" /></svg></button>)}
    </Flyout>
    {button("connector", "Connector")}
    <button disabled={!editable} aria-pressed={snapshot.tool === "text"} title="Text · T" onClick={() => run("tool.text")}>Text</button>
    <button disabled={!editable} aria-pressed={snapshot.tool === "section"} title="Section · Shift+S" onClick={() => run("tool.section")}>Section</button>
    <button disabled={!editable} aria-pressed={snapshot.tool === "stamp"} title="Stamp" onClick={() => run("tool.stamp")}>Stamp</button>
    <button disabled={!editable} aria-label="Stamps" aria-haspopup="dialog" onClick={e => open(stampMenu, e.currentTarget, e.detail === 0)}>▾</button>
    <Flyout label="Stamps" popover={stampMenu}>
      {stamps.map(stamp => <button key={stamp} aria-label={stampLabels[stamp]} aria-pressed={tool.stamp === stamp} title={stampLabels[stamp]}
        onClick={() => choose(stampMenu, "tool.stamp", { stamp })}><span aria-hidden="true" style={{ display: "inline-block", width: 16, height: 16, borderRadius: 8, background: cssColour(stampColour(stamp)) }} /></button>)}
    </Flyout>
    <button disabled={!commenting} className="figcraft-comment-tool" aria-label="Comment" aria-pressed={false} title="Comment · C" onClick={() => run("tool.comment")}>Comment</button>
    <button disabled={!editable} aria-label="Templates" aria-haspopup="dialog" title="Templates" onClick={e => open(picker, e.currentTarget, e.detail === 0)}>Templates</button>
    <Flyout label="Board templates" popover={picker}>
      {templates.map(t => <button key={t.id} title={t.description} onClick={() => choose(picker, "board.template", { name: t.id })}>{t.name}</button>)}
      <button onClick={() => choose(picker, "board.table", {})}>Table</button>
    </Flyout>
  </div>;
}
