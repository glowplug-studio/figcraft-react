/** Source: upstream engine/src/boards/board_grid.rs: the board canvas's background grid, kept with the preferences. */
export type GridStyle = "dots" | "lines" | "graph" | "none";
export interface BoardGrid { readonly style: GridStyle; readonly spacing: number; readonly major: number; readonly size: number; readonly contrast: number }
export const defaultBoardGrid: BoardGrid = Object.freeze({ style: "dots", spacing: 24, major: 5, size: 1, contrast: 1 });
const within = (v: number, lo: number, hi: number, d: number) => Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : d;
/** Native `sanitized`. */
export function sanitiseGrid(g: BoardGrid): BoardGrid {
  const d = defaultBoardGrid;
  return Object.freeze({ style: g.style, spacing: within(g.spacing, 4, 512, d.spacing), major: Math.min(Math.max(g.major, 2), 12), size: within(g.size, 0.5, 4, d.size), contrast: within(g.contrast, 0.25, 4, d.contrast) });
}
const bad = (m: string) => new Error("invalid parameters for `board.grid`: " + m);
/** Native `grid_cmd`: `{style?, spacing?, major?, size?, contrast?, reset?}` (omit all: just read it). */
export function boardGridCommand(current: BoardGrid, p: Record<string, unknown>): BoardGrid {
  const unknown = Object.keys(p).filter(k => !["style", "spacing", "major", "size", "contrast", "reset"].includes(k));
  if (unknown.length) throw bad("unknown parameter `" + unknown[0] + "` (it takes style, spacing, major, size, contrast, reset)");
  let g: { -readonly [K in keyof BoardGrid]: BoardGrid[K] } = { ...(p.reset === true ? defaultBoardGrid : current) };
  if (p.style !== undefined && p.style !== null) {
    const id = typeof p.style === "string" ? p.style.trim().toLowerCase() : "";
    if (!["dots", "lines", "graph", "none"].includes(id)) throw bad("`style` is dots, lines, graph or none");
    g.style = id as GridStyle;
  }
  const number = (k: string) => { const v = p[k]; if (v === undefined || v === null) return undefined; if (typeof v !== "number" || !Number.isFinite(v)) throw bad("`" + k + "` must be a number"); return v; };
  const spacing = number("spacing"), major = number("major"), size = number("size"), contrast = number("contrast");
  if (spacing !== undefined) g.spacing = spacing;
  if (major !== undefined) g.major = Math.min(Math.max(Math.round(major), 2), 12);
  if (size !== undefined) g.size = size;
  if (contrast !== undefined) g.contrast = contrast;
  g = { ...sanitiseGrid(g) };
  return Object.freeze(g);
}
