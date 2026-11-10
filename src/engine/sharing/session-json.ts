import { isLosslessNumber } from "lossless-json";
import { compareScalarKeys, nativeFloat } from "../text-breaks";

// Json::of converts each typed Rust value to a serde_json::Value before postcard
// encodes it. Struct keys therefore sort like BTreeMap keys, even numeric-looking
// ones. Ordinary geometry uses f64. Mark integer fields at their owning struct.
type Schema = "integer" | "f32" | "json" | "action" | { readonly [field: string]: Schema };
const integer = "integer";
const paint: Schema = { rotation: integer, opacity: "f32", colorAlpha: "f32" };
const textStyle: Schema = { fills: paint };
const grid: Schema = { count: integer };
const effect: Schema = { opacity: "f32" };
const network: Schema = { segments: { a: integer, b: integer }, regions: { loops: integer, fills: paint } };

const propertySchemas: Record<string, Schema> = {
  opacity: "f32", fills: paint, strokes: paint, stroke: { brush: { seed: integer } }, grids: grid, effects: effect,
  layout: { grid_columns: integer, grid_rows: integer },
  childLayout: { grid_column: integer, grid_row: integer, grid_column_span: integer, grid_row_span: integer },
  exports: { quality: integer }, interactions: { trigger: { ms: integer }, actions: "action", duration_ms: integer, delay_ms: integer },
};
const kindSchema: Schema = { count: integer, props: "json", network, style: textStyle,
  runs: { start: integer, end: integer, style: textStyle }, paragraphs: { indent: integer, start_offset: integer },
  max_lines: integer, saved_breaks: { starts: integer } };
const actionFields: Schema = { value: "json", blocks: { actions: "action" } };
const styleSchema: Schema = { paints: paint, style: textStyle, grids: grid, effects: effect };

function compact(value: unknown, schema?: Schema): string {
  if (isLosslessNumber(value)) return value.value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RangeError("Session property must be finite");
    if (schema === "f32") return nativeFloat(Math.fround(value));
    return schema === integer || schema === "json" && Number.isInteger(value) ? String(value) : nativeFloat(value);
  }
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(item => compact(item, schema)).join(",") + "]";
  const members = value as Record<string, unknown>;
  if (schema === "action") schema = actionFields;
  const fields: string[] = [];
  for (const key of Object.keys(members).sort(compareScalarKeys)) {
    const item = members[key];
    if (item === undefined || schema === paint && key === "colorAlpha" && item === 1) continue;
    const child = typeof schema === "object" && Object.hasOwn(schema, key) ? schema[key] : schema === "json" ? "json" : undefined;
    fields.push(JSON.stringify(key) + ":" + compact(item, child));
  }
  return "{" + fields.join(",") + "}";
}

export const sessionProperty = (key: string, value: unknown) => compact(value, propertySchemas[key]);
export const sessionKind = (value: unknown) => compact(value, kindSchema);
export const sessionStyle = (value: unknown) => compact(value, styleSchema);
export const sessionJson = (value: unknown) => compact(value);
