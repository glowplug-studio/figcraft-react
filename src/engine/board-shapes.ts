import type { PathCommand } from "./corners";
import { ellipsePath } from "./ellipse";
import type { BoardShape } from "./board-data";

/** Source: upstream doc/src/board.rs (`BoardShape::{label, path, text_insets}`): the outlines shapes with text come in, drawn in a box. */
const labels: Record<BoardShape, string> = {
  rectangle: "Rectangle", roundedRectangle: "Rounded rectangle", ellipse: "Ellipse", diamond: "Diamond", triangle: "Triangle", triangleDown: "Triangle down",
  parallelogramRight: "Parallelogram right", parallelogramLeft: "Parallelogram left", trapezoid: "Trapezoid", pentagon: "Pentagon", hexagon: "Hexagon",
  octagon: "Octagon", star: "Star", plus: "Plus", arrowLeft: "Arrow left", arrowRight: "Arrow right", chevron: "Chevron", speechBubble: "Speech bubble",
  database: "Database", document: "Document", predefinedProcess: "Predefined process", manualInput: "Manual input", internalStorage: "Internal storage",
};
/** Native `BoardShape::ALL`, in the order the picker shows them. */
export const shapeOrder: readonly BoardShape[] = Object.freeze(["rectangle", "roundedRectangle", "ellipse", "diamond", "triangle", "triangleDown",
  "parallelogramRight", "parallelogramLeft", "trapezoid", "pentagon", "hexagon", "octagon", "star", "plus", "arrowLeft", "arrowRight", "chevron",
  "speechBubble", "database", "document", "predefinedProcess", "manualInput", "internalStorage"]);
export const shapeLabel = (s: BoardShape) => labels[s];
/** Native `BoardShape::from_id`: any case. */
export const shapeFromId = (id: string): BoardShape | undefined => shapeOrder.find(s => s.toLowerCase() === id.toLowerCase());

const third = 1 / 3;
/** How far a cubic's handles reach to draw a quarter ellipse (native `QUARTER`). */
const quarter = 0.552_284_75;
/** kurbo's quarter-circle handle (`Arc` to cubics for a quarter turn). */
const arcHandle = 0.5522847498307934;

/** Native `star_points`: a five-pointed star in the unit box, stretched to fill it. */
function starPoints(): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) { const r = i % 2 === 0 ? 0.5 : 0.2, a = i * Math.PI / 5; pts.push([0.5 + r * Math.sin(a), 0.5 - r * Math.cos(a)]); }
  const bottom = pts.reduce((m, p) => Math.max(m, p[1]), 0);
  return pts.map(([x, y]) => [x, y / bottom]);
}
/** kurbo's `Rect::to_path`. */
const rectPath = (w: number, h: number): PathCommand[] => [["M", 0, 0], ["L", w, 0], ["L", w, h], ["L", 0, h], ["Z"]];
/** kurbo's `RoundedRect::to_path`: from the left edge's top end, a quarter arc at each corner, clockwise on screen. */
function roundedRectPath(w: number, h: number, radius: number): PathCommand[] {
  const r = Math.min(radius, w / 2, h / 2), k = r * arcHandle;
  return [["M", 0, r], ["C", 0, r - k, r - k, 0, r, 0], ["L", w - r, 0], ["C", w - r + k, 0, w, r - k, w, r], ["L", w, h - r],
    ["C", w, h - r + k, w - r + k, h, w - r, h], ["L", r, h], ["C", r - k, h, 0, h - r + k, 0, h - r], ["Z"]];
}
/** Native `database`: an elliptic top with its near rim drawn, and an elliptic bottom. */
function database(w: number, h: number): PathCommand[] {
  const rx = w / 2, ry = Math.min(h * 0.1, w * 0.25), k = ry * quarter, kx = rx * quarter;
  return [["M", 0, ry], ["C", 0, ry - k, rx - kx, 0, rx, 0], ["C", rx + kx, 0, w, ry - k, w, ry], ["L", w, h - ry],
    ["C", w, h - ry + k, rx + kx, h, rx, h], ["C", rx - kx, h, 0, h - ry + k, 0, h - ry], ["Z"],
    ["M", 0, ry], ["C", 0, ry + k, rx - kx, 2 * ry, rx, 2 * ry], ["C", rx + kx, 2 * ry, w, ry + k, w, ry]];
}
/** Native `document`: a page whose bottom edge waves. */
const documentPath = (w: number, h: number): PathCommand[] =>
  [["M", 0, 0], ["L", w, 0], ["L", w, h * 0.86], ["C", w * 0.7, h * 0.7, w * 0.3, h * 1.04, 0, h * 0.86], ["Z"]];
/** Native `with_lines`: a rectangle with straight lines across it, drawn as lines. */
function withLines(w: number, h: number, lines: readonly (readonly [number, number, number, number])[]): PathCommand[] {
  const p = rectPath(w, h);
  for (const [x0, y0, x1, y1] of lines) p.push(["M", x0 * w, y0 * h], ["L", x1 * w, y1 * h]);
  return p;
}
/** A quadratic as the cubic the vector network stores (kurbo's `QuadBez::raise`). */
function quad(from: readonly [number, number], c: readonly [number, number], to: readonly [number, number]): PathCommand {
  return ["C", from[0] + 2 / 3 * (c[0] - from[0]), from[1] + 2 / 3 * (c[1] - from[1]), to[0] + 2 / 3 * (c[0] - to[0]), to[1] + 2 / 3 * (c[1] - to[1]), to[0], to[1]];
}

/** Native `BoardShape::path`: the outline in a `w` × `h` box at the origin. */
export function shapePath(shape: BoardShape, w: number, h: number): readonly PathCommand[] {
  const poly = (pts: readonly (readonly [number, number])[]): PathCommand[] => [...pts.map(([x, y], i): PathCommand => [i === 0 ? "M" : "L", x * w, y * h]), ["Z"]];
  const r = Math.min(w, h);
  switch (shape) {
    case "rectangle": return rectPath(w, h);
    case "roundedRectangle": return roundedRectPath(w, h, r * 0.16);
    case "ellipse": return ellipsePath(w, h, { start: 0, sweep: 2 * Math.PI, inner: 0 });
    case "diamond": return poly([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]);
    case "triangle": return poly([[0.5, 0], [1, 1], [0, 1]]);
    case "triangleDown": return poly([[0, 0], [1, 0], [0.5, 1]]);
    case "parallelogramRight": return poly([[0.2, 0], [1, 0], [0.8, 1], [0, 1]]);
    case "parallelogramLeft": return poly([[0, 0], [0.8, 0], [1, 1], [0.2, 1]]);
    case "trapezoid": return poly([[0.2, 0], [0.8, 0], [1, 1], [0, 1]]);
    case "pentagon": return poly([[0.5, 0], [1, 0.38], [0.81, 1], [0.19, 1], [0, 0.38]]);
    case "hexagon": return poly([[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]]);
    case "octagon": return poly([[0.3, 0], [0.7, 0], [1, 0.3], [1, 0.7], [0.7, 1], [0.3, 1], [0, 0.7], [0, 0.3]]);
    case "star": return poly(starPoints());
    case "plus": return poly([[third, 0], [2 * third, 0], [2 * third, third], [1, third], [1, 2 * third], [2 * third, 2 * third], [2 * third, 1], [third, 1],
      [third, 2 * third], [0, 2 * third], [0, third], [third, third]]);
    case "arrowLeft": return poly([[1, 0.25], [0.4, 0.25], [0.4, 0], [0, 0.5], [0.4, 1], [0.4, 0.75], [1, 0.75]]);
    case "arrowRight": return poly([[0, 0.25], [0.6, 0.25], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.75], [0, 0.75]]);
    case "chevron": return poly([[0, 0], [0.72, 0], [1, 0.5], [0.72, 1], [0, 1], [0.28, 0.5]]);
    case "manualInput": return poly([[0, 0.25], [1, 0], [1, 1], [0, 1]]);
    case "database": return database(w, h);
    case "document": return documentPath(w, h);
    case "predefinedProcess": return withLines(w, h, [[0.1, 0, 0.1, 1], [0.9, 0, 0.9, 1]]);
    case "internalStorage": return withLines(w, h, [[0.12, 0, 0.12, 1], [0, 0.12, 1, 0.12]]);
    case "speechBubble": {
      // A rounded body over the bottom fifth, with a tail down to the left.
      const b = h * 0.8, c = r * 0.14;
      return [["M", c, 0], ["L", w - c, 0], quad([w - c, 0], [w, 0], [w, c]), ["L", w, b - c], quad([w, b - c], [w, b], [w - c, b]), ["L", w * 0.42, b],
        ["L", w * 0.18, h], ["L", w * 0.24, b], ["L", c, b], quad([c, b], [0, b], [0, b - c]), ["L", 0, c], quad([0, c], [0, 0], [c, 0]), ["Z"]];
    }
  }
}

/** Native `BoardShape::text_insets`: where the text goes, as insets of the box (top, right, bottom, left, fractions of its size). */
export function textInsets(shape: BoardShape): readonly [number, number, number, number] {
  switch (shape) {
    case "rectangle": case "roundedRectangle": return [0.08, 0.08, 0.08, 0.08];
    case "ellipse": return [0.16, 0.16, 0.16, 0.16];
    case "diamond": return [0.25, 0.25, 0.25, 0.25];
    case "triangle": return [0.45, 0.22, 0.06, 0.22];
    case "triangleDown": return [0.06, 0.22, 0.45, 0.22];
    case "parallelogramRight": case "parallelogramLeft": case "hexagon": return [0.08, 0.22, 0.08, 0.22];
    case "trapezoid": return [0.1, 0.22, 0.08, 0.22];
    case "pentagon": return [0.25, 0.18, 0.08, 0.18];
    case "octagon": return [0.12, 0.12, 0.12, 0.12];
    case "star": return [0.38, 0.32, 0.28, 0.32];
    case "plus": return [0.34, 0.1, 0.34, 0.1];
    case "arrowLeft": return [0.27, 0.04, 0.27, 0.3];
    case "arrowRight": return [0.27, 0.3, 0.27, 0.04];
    case "speechBubble": return [0.08, 0.08, 0.28, 0.08];
    case "chevron": return [0.12, 0.3, 0.12, 0.3];
    case "database": return [0.24, 0.06, 0.1, 0.06];
    case "document": return [0.08, 0.08, 0.2, 0.08];
    case "predefinedProcess": return [0.08, 0.14, 0.08, 0.14];
    case "manualInput": return [0.3, 0.08, 0.08, 0.08];
    case "internalStorage": return [0.18, 0.08, 0.08, 0.18];
  }
}
/** Native `shape_padding`: the insets in page units for a `w` × `h` shape (top, right, bottom, left). */
export function shapePadding(shape: BoardShape, w: number, h: number): [number, number, number, number] {
  const [t, r, b, l] = textInsets(shape);
  return [t * h, r * w, b * h, l * w];
}
