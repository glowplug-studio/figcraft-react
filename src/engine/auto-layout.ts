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
