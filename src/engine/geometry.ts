export interface Point { x: number; y: number }
export interface Rectangle { x: number; y: number; width: number; height: number }
/** Rust f64::round rounds ties away from zero, unlike Math.round. */
export const pixelRound = (value: number): number => Math.sign(value) * Math.floor(Math.abs(value) + 0.5);
/** Native Line/Arrow frame; endpoint editing can disable drawing's pixel rounding. */
export function drawnLine(start: Point, end: Point, shift = false, alt = false, round = true): Rectangle & { angle: number } {
  let x = round ? pixelRound(start.x) : start.x, y = round ? pixelRound(start.y) : start.y;
  let dx = (round ? pixelRound(end.x) : end.x) - x, dy = (round ? pixelRound(end.y) : end.y) - y;
  if (shift) {
    const angle = pixelRound(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4, length = Math.hypot(dx, dy);
    dx = Math.cos(angle) * length; dy = Math.sin(angle) * length;
  }
  if (alt) { x -= dx; y -= dy; dx *= 2; dy *= 2; }
  return { x, y, width: Math.hypot(dx, dy), height: 0, angle: Math.atan2(dy, dx) };
}
/** tools/draw.rs: rounded endpoints, square constraint, centre expansion, normalised bounds. */
export function drawnRectangle(start: Point, end: Point, shift = false, alt = false): Rectangle {
  const ax = pixelRound(start.x), ay = pixelRound(start.y);
  let dx = pixelRound(end.x) - ax, dy = pixelRound(end.y) - ay;
  if (shift) {
    const extent = Math.max(Math.abs(dx), Math.abs(dy));
    dx = extent * (dx < 0 || Object.is(dx, -0) ? -1 : 1);
    dy = extent * (dy < 0 || Object.is(dy, -0) ? -1 : 1);
  }
  const x0 = alt ? ax - dx : ax, y0 = alt ? ay - dy : ay;
  const x1 = ax + dx, y1 = ay + dy;
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
}
