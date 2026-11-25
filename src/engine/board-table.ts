import { colour } from "./colour";
import { withRectanglePaints, type Document, type DocumentNode, type FrameNode, type NodeId, type RectangleNode } from "./document";
import { HierarchyDraft, ancestors } from "./hierarchy";
import type { AutoLayout } from "./auto-layout";
import type { BoardItem } from "./board-data";
import { solidPaint } from "./solid-paint";
import { defaultStroke } from "./stroke";

/** Source: upstream engine/src/boards/board_table.rs: tables on boards, auto layout frames of rows of cells with text, column lines over them. */
export const maxRows = 50, maxColumns = 20;
const cellW = 160, cellH = 40, minCell = cellH, maxRowH = 100_000, cellPad: readonly [number, number, number, number] = [10, 12, 10, 12], textSize = 14, lineW = 1;
const rgb = (hex: string) => colour(Math.fround(parseInt(hex.slice(1, 3), 16) / 255), Math.fround(parseInt(hex.slice(3, 5), 16) / 255), Math.fround(parseInt(hex.slice(5, 7), 16) / 255), 1);
const grid = rgb("#CFCBC4"), header = rgb("#F1EFEB");
type Layer = DocumentNode & { board?: BoardItem; children?: readonly NodeId[]; childLayout?: { absolute?: true; minHeight?: number; minWidth?: number }; sizing?: { horizontal: string; vertical: string }; width: number; height: number; x: number; y: number };
const autoLayout = (over: Partial<AutoLayout>): AutoLayout => Object.freeze({ mode: "horizontal", wrap: false, gap: 10, crossGap: 10, padding: [10, 10, 10, 10], mainAlign: "min",
  crossAlign: "min", contentAlign: "auto", gridColumns: 2, gridRows: 2, columnTracks: Object.freeze([]), rowTracks: Object.freeze([]), strokesIncluded: true, reverseZ: false, ...over } as AutoLayout);

/** What the table code needs from the board commands: allocating ids and making a text layer as native's `add_text` does. */
export interface TableCtx { readonly draft: HierarchyDraft; alloc(): NodeId; addText(parent: NodeId, text: string, size: number, align: "left" | "center", width: number): NodeId }
function frame(ctx: TableCtx, parent: NodeId, index: number | undefined, name: string, [w, h]: readonly [number, number], extra: Record<string, unknown>): NodeId {
  const id = ctx.alloc();
  ctx.draft.insert({ id, kind: "frame", name, parent, x: 0, y: 0, width: w, height: h, fill: "transparent", children: Object.freeze([]), clip: false, ...extra } as unknown as FrameNode, parent, index);
  return id;
}
function makeCell(ctx: TableCtx, row: NodeId, index: number | undefined, width: number, text: string): NodeId {
  const cell = frame(ctx, row, index, "Cell", [width, cellH], { layout: autoLayout({ mode: "vertical", gap: 0, padding: cellPad }), sizing: Object.freeze({ horizontal: "fill", vertical: "hug" }),
    childLayout: Object.freeze({ minHeight: cellH, minWidth: minCell }) });
  ctx.addText(cell, text, textSize, "left", Math.max(width - cellPad[1] - cellPad[3], 1));
  return cell;
}
function makeRow(ctx: TableCtx, table: NodeId, index: number | undefined, width: number, texts: readonly string[]): NodeId {
  const row = frame(ctx, table, index, "Row", [width, cellH], { layout: autoLayout({ gap: 0, padding: [0, 0, 0, 0] }), sizing: Object.freeze({ horizontal: "fill", vertical: "hug" }),
    stroke: Object.freeze({ ...defaultStroke, weight: lineW, align: "inside", sides: Object.freeze([0, 0, lineW, 0]) }) });
  const cw = width / Math.max(texts.length, 1);
  for (const t of texts) makeCell(ctx, row, undefined, cw, t);
  return row;
}
/** Native `parts`: a table's rows (its laid-out children) and column lines (the others). */
export function tableParts(doc: Document, table: NodeId): [NodeId[], NodeId[]] {
  const kids = (doc.nodes[table] as Layer | undefined)?.children ?? [];
  const rows: NodeId[] = [], lines: NodeId[] = [];
  for (const c of kids) ((doc.nodes[c] as Layer | undefined)?.childLayout?.absolute ? lines : rows).push(c);
  return [rows, lines];
}
const cells = (doc: Document, row: NodeId) => (doc.nodes[row] as Layer | undefined)?.children ?? [];
/** Native `restyle`: the first row tinted, a line under every row but the last, the column lines over it all. */
function restyle(ctx: TableCtx, table: NodeId) {
  const doc = ctx.draft.document, [rows, lines] = tableParts(doc, table);
  for (const l of lines) ctx.draft.remove(l);
  const last = Math.max(rows.length - 1, 0);
  rows.forEach((r, i) => {
    const n = ctx.draft.nodes[r] as Layer;
    const painted = withRectanglePaints(n as never, i === 0 ? [solidPaint(header)] : []) as unknown as Layer;
    const { strokes: _s, ...rest } = painted as Layer & { strokes?: unknown };
    void _s;
    ctx.draft.set((i < last ? { ...rest, strokes: Object.freeze([solidPaint(grid)]) } : rest) as DocumentNode);
  });
  const columns = rows.length ? cells(ctx.draft.document, rows[0]).length : 0;
  const t = ctx.draft.nodes[table] as Layer;
  for (let i = 1; i < columns; i++) {
    const id = ctx.alloc();
    ctx.draft.insert(withRectanglePaints({ id, kind: "rectangle", name: "Column line", parent: table, x: t.width * i / columns - lineW / 2, y: 0, width: lineW, height: t.height, fill: "#000000",
      childLayout: Object.freeze({ absolute: true }), constraints: Object.freeze({ horizontal: "scale", vertical: "topBottom" }), locked: true } as unknown as RectangleNode, [solidPaint(grid)]), table);
  }
}
/** Native `make_table`: a table of `texts` (rows of cell texts, all as long) at `at` on `parent`. */
export function makeTable(ctx: TableCtx, parent: NodeId, at: readonly [number, number], texts: readonly (readonly string[])[]): NodeId {
  const columns = Math.max(texts[0]?.length ?? 1, 1), w = cellW * columns;
  const id = ctx.alloc();
  ctx.draft.insert(withRectanglePaints({ id, kind: "frame", name: "Table", parent, x: at[0], y: at[1], width: w, height: cellH * texts.length, fill: "#ffffff", children: Object.freeze([]),
    // Its stroke is the default (1, inside): left unset, as native writes it.
    strokes: Object.freeze([solidPaint(grid)]), corners: Object.freeze({ radii: Object.freeze([4, 4, 4, 4]), smoothing: 0 }),
    clip: true, layout: autoLayout({ mode: "vertical", gap: 0, padding: [0, 0, 0, 0], strokesIncluded: false }), sizing: Object.freeze({ horizontal: "fixed", vertical: "hug" }),
    board: Object.freeze({ type: "table" }) } as unknown as FrameNode, [solidPaint(colour(1, 1, 1, 1))]), parent);
  for (const row of texts) makeRow(ctx, id, undefined, w, row);
  restyle(ctx, id);
  return id;
}
/** Native `cell_texts` and `answer`. */
export function tableAnswer(doc: Document, table: NodeId) {
  const [rows] = tableParts(doc, table);
  const text = (cell: NodeId) => cells(doc, cell).find(c => doc.nodes[c]?.kind === "text");
  return { id: Number(table), rows: rows.length, columns: rows.length ? cells(doc, rows[0]).length : 0, cells: rows.map(r => cells(doc, r).map(c => { const t = text(c); return t === undefined ? null : Number(t); })) };
}
/** Native `table_of`: the table `id` is or is in. */
export function tableOf(doc: Document, id: NodeId): NodeId | undefined {
  return [id, ...ancestors(doc, id)].find(a => (doc.nodes[a] as Layer | undefined)?.board?.type === "table");
}
/** Native `edit_cmd`'s actions; an error message for a refusal. */
export function editTable(ctx: TableCtx, table: NodeId, action: string, index: number | undefined, bad: (m: string) => Error) {
  const doc = ctx.draft.document, [rows] = tableParts(doc, table), columns = Math.max(rows.length ? cells(doc, rows[0]).length : 0, 1), width = (doc.nodes[table] as Layer).width;
  const at = (end: number, last: number) => { if (index !== undefined && index > end) throw bad("`index` is from 0 to " + end); return index ?? last; };
  if (action === "addRow") {
    if (rows.length >= maxRows) throw bad("a table has at most " + maxRows + " rows");
    const i = at(rows.length, rows.length), kids = (doc.nodes[table] as Layer).children ?? [];
    const ref = rows[i] ?? rows[rows.length - 1], pos = ref !== undefined ? kids.indexOf(ref) : -1;
    makeRow(ctx, table, pos < 0 ? undefined : i >= rows.length ? pos + 1 : pos, width, Array(columns).fill(""));
  } else if (action === "removeRow") {
    if (rows.length <= 1) throw bad("a table keeps at least one row");
    ctx.draft.remove(rows[at(rows.length - 1, rows.length - 1)]);
  } else if (action === "addColumn") {
    if (columns >= maxColumns) throw bad("a table has at most " + maxColumns + " columns");
    const i = at(columns, columns), cw = width / columns;
    ctx.draft.set({ ...ctx.draft.nodes[table], width: width + cw } as DocumentNode);
    for (const r of rows) makeCell(ctx, r, i, cw, "");
  } else if (action === "removeColumn") {
    if (columns <= 1) throw bad("a table keeps at least one column");
    const i = at(columns - 1, columns - 1);
    ctx.draft.set({ ...ctx.draft.nodes[table], width: width - width / columns } as DocumentNode);
    for (const r of rows) { const c = cells(ctx.draft.document, r)[i]; if (c !== undefined) ctx.draft.remove(c); }
  } else throw bad("`action` is addRow, addColumn, removeRow or removeColumn, not `" + action + "`");
  restyle(ctx, table);
}
/** Native `spreadsheet_cells`: cells copied from a spreadsheet (a row per line, a tab between cells, quoted cells); whether there were more. */
export function spreadsheetCells(input: string): [string[][], boolean] | undefined {
  if (!input.includes("\t")) return undefined;
  const text = input.endsWith("\r\n") ? input.slice(0, -2) : input.endsWith("\n") ? input.slice(0, -1) : input;
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, cellStart = true;
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (quoted) {
      if (c === "\"" && chars[i + 1] === "\"") { i++; cell += "\""; }
      else if (c === "\"") quoted = false;
      else cell += c;
      continue;
    }
    if (c === "\"" && cellStart) quoted = true;
    else if (c === "\t") { row.push(cell); cell = ""; }
    else if (c === "\r" && chars[i + 1] === "\n") continue;
    else if (c === "\n" || c === "\r") { row.push(cell); cell = ""; rows.push(row); row = []; }
    else cell += c;
    cellStart = c === "\t" || c === "\n" || c === "\r";
  }
  row.push(cell); rows.push(row);
  if (!rows.some(r => r.length > 1)) return undefined;
  const more = rows.length > maxRows || rows.some(r => r.length > maxColumns);
  return [rows.slice(0, maxRows).map(r => r.slice(0, maxColumns)), more];
}
/** Native `settle_resize`: a table resized by its height or a corner puts the change into its rows and hugs them again. */
export function settleTables(doc: Document, before: Document): Document {
  if (doc.kind !== "board" || doc.nodes === before.nodes) return doc;
  const tables = new Set<NodeId>();
  for (const id of Object.keys(doc.nodes)) if (doc.nodes[id] !== before.nodes[id]) { const t = tableOf(doc, id); if (t !== undefined) tables.add(t); }
  let draft: HierarchyDraft | undefined;
  for (const table of tables) {
    const now = doc.nodes[table] as Layer, was = before.nodes[table] as Layer | undefined;
    if (!was || (now.sizing?.vertical ?? "fixed") !== "fixed") continue;
    draft ??= new HierarchyDraft(doc);
    const [rows] = tableParts(doc, table), columns = rows.length ? cells(doc, rows[0]).length : 0, dh = now.height - was.height;
    if (Number.isFinite(dh) && Math.abs(dh) > 1e-6 && rows.length) {
      const both = Number.isFinite(now.width) && Number.isFinite(was.width) && Math.abs(now.width - was.width) > 1e-6;
      const targets = both ? rows : [rows[rows.length - 1]], share = dh / targets.length;
      const content = (d: Document, row: NodeId) => { const hs = cells(d, row).map(c => (d.nodes[c] as Layer | undefined)?.height).filter((h): h is number => h !== undefined); return hs.length ? Math.max(...hs) : undefined; };
      for (const row of targets) {
        const base = content(before, row) ?? content(doc, row) ?? cellH, minH = Math.min(Math.max(base + share, minCell), maxRowH);
        for (const c of cells(doc, row)) { const cn = draft.nodes[c] as Layer; draft.set({ ...cn, childLayout: { ...(cn.childLayout ?? {}), minHeight: minH } } as DocumentNode); }
      }
    }
    const t = draft.nodes[table] as Layer, least = minCell * columns;
    draft.set({ ...t, ...((Number.isNaN(t.width) || t.width < least) && { width: least }), sizing: { horizontal: t.sizing?.horizontal ?? "fixed", vertical: "hug" } } as DocumentNode);
  }
  return draft ? draft.finish() : doc;
}
