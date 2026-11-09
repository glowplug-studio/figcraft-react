import type { LayerNode } from "./document";
import { isLosslessNumber } from "lossless-json";
import { fail, number } from "./native-values";
import { propertyEnum } from "./parameters";

export interface GridTrack {
  readonly sizing: "fixed" | "hug" | "fill";
  readonly value: number;
}
export interface AutoLayout {
  readonly mode: "horizontal" | "vertical" | "grid";
  readonly wrap: boolean;
  readonly gap: number;
  readonly crossGap: number;
  readonly padding: readonly [number, number, number, number];
  readonly mainAlign: "min" | "center" | "max" | "spaceBetween" | "spaceAround" | "spaceEvenly";
  readonly crossAlign: "min" | "center" | "max" | "baseline";
  readonly contentAlign: "auto" | "spaceBetween";
  readonly gridColumns: number;
  readonly gridRows: number;
  readonly columnTracks: readonly GridTrack[];
  readonly rowTracks: readonly GridTrack[];
  readonly strokesIncluded: boolean;
  readonly reverseZ: boolean;
}

function record(value: unknown, keys: readonly string[], name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isLosslessNumber(value)) fail(`${name} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${name}/${key} is not supported yet`);
  return value as Record<string, unknown>;
}

function flag(value: unknown, fallback: boolean, name: string): boolean {
  if (value === undefined) return fallback;
  return typeof value === "boolean" ? value : fail(`${name} must be boolean`);
}

function unsigned(value: unknown, name: string): number {
  if (isLosslessNumber(value) && !/^(0|[1-9]\d*)$/.test(value.value)) fail(`${name} must be a u32`);
  const n = number(value, name);
  return Number.isInteger(n) && n >= 0 && n <= 0xffffffff ? n : fail(`${name} must be a u32`);
}

function tracks(value: unknown): readonly GridTrack[] {
  if (!Array.isArray(value)) fail("layout tracks must be an array");
  return Object.freeze(value.map(entry => {
    const { sizing = "fill", value: size = 1 } = record(entry, ["sizing", "value"], "grid track");
    return Object.freeze({ sizing: propertyEnum(sizing, ["fixed", "hug", "fill"] as const, false), value: number(size, "track value") });
  }));
}

const containerFields = ["mode", "wrap", "gap", "cross_gap", "padding", "main_align", "cross_align", "content_align",
  "grid_columns", "grid_rows", "column_tracks", "row_tracks", "strokes_included", "reverse_z"];

/** Native serde defaults are distinct from those inferred by layout.add. */
export function readAutoLayout(raw: unknown): AutoLayout {
  const { mode = "horizontal", wrap, gap = 10, cross_gap = 10, padding = [10, 10, 10, 10], main_align = "min",
    cross_align = "min", content_align = "auto", grid_columns = 2, grid_rows = 2, column_tracks = [],
    row_tracks = [], strokes_included, reverse_z } = record(raw, containerFields, "layout");
  if (!Array.isArray(padding) || padding.length !== 4) fail("layout padding needs four numbers");
  const insets: AutoLayout["padding"] = [number(padding[0], "top padding"), number(padding[1], "right padding"),
    number(padding[2], "bottom padding"), number(padding[3], "left padding")];
  return Object.freeze({
    mode: propertyEnum(mode, ["horizontal", "vertical", "grid"] as const, false),
    wrap: flag(wrap, false, "wrap"), gap: number(gap, "gap"), crossGap: number(cross_gap, "cross gap"),
    padding: Object.freeze(insets),
    mainAlign: propertyEnum(main_align, ["min", "center", "max", "spaceBetween", "spaceAround", "spaceEvenly"] as const, false),
    crossAlign: propertyEnum(cross_align, ["min", "center", "max", "baseline"] as const, false),
    contentAlign: propertyEnum(content_align, ["auto", "spaceBetween"] as const, false),
    gridColumns: unsigned(grid_columns, "grid columns"), gridRows: unsigned(grid_rows, "grid rows"),
    columnTracks: tracks(column_tracks), rowTracks: tracks(row_tracks),
    strokesIncluded: flag(strokes_included, true, "strokes included"), reverseZ: flag(reverse_z, false, "reverse z"),
  });
}

export function wireAutoLayout(layout: AutoLayout) {
  return { mode: layout.mode, wrap: layout.wrap, gap: layout.gap, cross_gap: layout.crossGap, padding: layout.padding,
    main_align: layout.mainAlign, cross_align: layout.crossAlign, content_align: layout.contentAlign,
    grid_columns: layout.gridColumns, grid_rows: layout.gridRows, column_tracks: layout.columnTracks,
    row_tracks: layout.rowTracks, strokes_included: layout.strokesIncluded, reverse_z: layout.reverseZ };
}

export type Sizing = GridTrack["sizing"];
export interface LayerSizing {
  readonly horizontal: Sizing;
  readonly vertical: Sizing;
}
export type CellAlign = "min" | "center" | "max";
export interface ChildLayout {
  readonly absolute?: true;
  readonly minWidth?: number;
  readonly maxWidth?: number;
  readonly minHeight?: number;
  readonly maxHeight?: number;
  readonly gridColumn?: number;
  readonly gridRow?: number;
  readonly gridColumnSpan?: number;
  readonly gridRowSpan?: number;
  readonly gridAlignH?: CellAlign;
  readonly gridAlignV?: CellAlign;
}

export const sizeLimitKeys = ["minWidth", "maxWidth", "minHeight", "maxHeight"] as const;
const sizingModes = ["fixed", "hug", "fill"] as const;
const cellAlignments = ["min", "center", "max"] as const;
const childFields = ["sizing_h", "sizing_v", "absolute", "min_w", "max_w", "min_h", "max_h", "grid_column",
  "grid_row", "grid_column_span", "grid_row_span", "grid_align_h", "grid_align_v"];
export const fixedSizing: LayerSizing = Object.freeze({horizontal: "fixed", vertical: "fixed"});

/** Text snapshots already expose textSizing. Keep one pair of axes per layer. */
export function layerSizing(node: LayerNode) {
  return (node.kind === "text" ? node.textSizing : node.sizing) ?? fixedSizing;
}

export function readChildLayout(raw: unknown, textLayer: boolean) {
  const {sizing_h = "fixed", sizing_v = "fixed", absolute, min_w, max_w, min_h, max_h, grid_column, grid_row,
    grid_column_span = 0, grid_row_span = 0, grid_align_h, grid_align_v} = record(raw, childFields, "child_layout");
  const horizontal = propertyEnum(sizing_h, sizingModes, false);
  const vertical = propertyEnum(sizing_v, sizingModes, false);
  const sizing = Object.freeze({horizontal, vertical});
  const columnSpan = unsigned(grid_column_span, "grid column span");
  const rowSpan = unsigned(grid_row_span, "grid row span");
  const childLayout: ChildLayout = {
    ...(flag(absolute, false, "absolute") && {absolute: true}),
    ...(min_w != null && {minWidth: number(min_w, "min width")}),
    ...(max_w != null && {maxWidth: number(max_w, "max width")}),
    ...(min_h != null && {minHeight: number(min_h, "min height")}),
    ...(max_h != null && {maxHeight: number(max_h, "max height")}),
    ...(grid_column != null && {gridColumn: unsigned(grid_column, "grid column")}),
    ...(grid_row != null && {gridRow: unsigned(grid_row, "grid row")}),
    ...(columnSpan !== 0 && {gridColumnSpan: columnSpan}), ...(rowSpan !== 0 && {gridRowSpan: rowSpan}),
    ...(grid_align_h != null && {gridAlignH: propertyEnum(grid_align_h, cellAlignments, false)}),
    ...(grid_align_v != null && {gridAlignV: propertyEnum(grid_align_v, cellAlignments, false)}),
  };
  return {
    ...(Object.keys(childLayout).length && {childLayout: Object.freeze(childLayout)}),
    ...(horizontal !== "fixed" || vertical !== "fixed" ? textLayer ? {textSizing: sizing} : {sizing} : {}),
  };
}

export function wireChildLayout(child: ChildLayout | undefined, sizing: LayerSizing) {
  if (!child && sizing.horizontal === "fixed" && sizing.vertical === "fixed") return undefined;
  return {sizing_h: sizing.horizontal, sizing_v: sizing.vertical, absolute: child?.absolute ?? false,
    min_w: child?.minWidth ?? null, max_w: child?.maxWidth ?? null, min_h: child?.minHeight ?? null,
    max_h: child?.maxHeight ?? null, grid_column: child?.gridColumn ?? null, grid_row: child?.gridRow ?? null,
    grid_column_span: child?.gridColumnSpan ?? 0, grid_row_span: child?.gridRowSpan ?? 0,
    ...(child?.gridAlignH && {grid_align_h: child.gridAlignH}), ...(child?.gridAlignV && {grid_align_v: child.gridAlignV})};
}

export function scaleLayoutProperties(node: LayerNode, factor: number) {
  const result: {childLayout?: ChildLayout; layout?: AutoLayout} = {};
  const scale = (n: number) => {
    const scaled = n * factor;
    if (!Number.isFinite(scaled)) throw new Error("Scaled layout value must be finite");
    return scaled;
  };
  if (node.childLayout) {
    const limits: Partial<Record<typeof sizeLimitKeys[number], number>> = {};
    for (const key of sizeLimitKeys) {
      const value = node.childLayout[key];
      if (value !== undefined) limits[key] = scale(value);
    }
    if (Object.keys(limits).length) result.childLayout = Object.freeze({...node.childLayout, ...limits});
  }
  if (node.kind === "frame" && node.layout) {
    const layout = node.layout;
    const tracks = (items: readonly GridTrack[]) => Object.freeze(items.map(t =>
      t.sizing === "fixed" ? Object.freeze({...t, value: scale(t.value)}) : t));
    const [top, right, bottom, left] = layout.padding;
    result.layout = Object.freeze({...layout, gap: scale(layout.gap), crossGap: scale(layout.crossGap),
      padding: Object.freeze([scale(top), scale(right), scale(bottom), scale(left)] as const),
      columnTracks: tracks(layout.columnTracks), rowTracks: tracks(layout.rowTracks)});
  }
  return result;
}

export function sameAutoLayout(a: AutoLayout | undefined, b: AutoLayout | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.mode !== b.mode || a.wrap !== b.wrap || a.gap !== b.gap || a.crossGap !== b.crossGap ||
    a.gridColumns !== b.gridColumns || a.gridRows !== b.gridRows || a.strokesIncluded !== b.strokesIncluded ||
    a.reverseZ !== b.reverseZ || a.mainAlign !== b.mainAlign || a.crossAlign !== b.crossAlign || a.contentAlign !== b.contentAlign) return false;
  const equalTracks = (x: readonly GridTrack[], y: readonly GridTrack[]) => x === y ||
    x.length === y.length && x.every((t,i) => t.sizing === y[i].sizing && t.value === y[i].value);
  return a.padding.every((v,i) => v === b.padding[i]) && equalTracks(a.columnTracks,b.columnTracks) && equalTracks(a.rowTracks,b.rowTracks);
}
