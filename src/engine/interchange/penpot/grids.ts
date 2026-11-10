import { colour, withAlpha } from "../../colour";
import { object } from "../rest/values";
import { hex, numberField as num, records } from "./values";

export function displayGrids(value: unknown, warn: (reason: string) => void) {
  const grids = [];
  for (const grid of records(value).slice(0, 64)) {
    const kind = grid.type === "square" ? "grid" : grid.type === "column" || grid.type === "columns" ? "columns" :
      grid.type === "row" || grid.type === "rows" ? "rows" : undefined;
    if (!kind) {warn("Unsupported Penpot display-grid type; original grid retained as metadata"); continue;}
    const params = Object.hasOwn(grid, "params") ? object(grid.params) : grid;
    const align = params.type ?? params.align, count = params.size ?? params.count;
    const raw = Object.hasOwn(params, "color") ? params.color : grid.color;
    const c = hex(raw) ?? hex(object(raw).color);
    const color = c ? withAlpha(c, c.a * num(object(raw), "opacity", 1, 0, 1)) :
      kind === "rows" ? colour(0, 0.4, 1, 0.1) : colour(1, 0, 0, 0.1);
    grids.push({kind, size: kind === "grid" ? num(params, "size", 10, 0, 1e5) : num(params, "itemLength", 0, 0, 1e5),
      visible: grid.display !== false, count: kind !== "grid" && typeof count === "number" && count >= 0 ? Math.min(10000, Math.trunc(count)) : 5,
      align: ["left","top","start"].includes(String(align)) ? "min" : ["right","bottom","end"].includes(String(align)) ? "max" : align === "center" ? "center" : "stretch",
      offset: num(params, "margin", 0), gutter: num(params, "gutter", 20, 0, 1e5), color});
  }
  return grids;
}
