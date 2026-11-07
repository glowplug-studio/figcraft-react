import type { Point } from "./geometry";

/** Mouse PointerEvent.pressure is a synthetic button state, not device pressure. */
export function pencilPointerPressure(event: Pick<PointerEvent, "pointerType" | "pressure">): number | undefined {
  return event.pointerType === "pen" || event.pointerType === "touch" ? event.pressure : undefined;
}

/** Native Pencil accepts moves and release positions strictly beyond half a screen pixel. */
export function shouldSamplePencil(previous: Point | undefined, point: Point, zoom: number): boolean {
  if (![point.x, point.y, zoom, ...(previous ? [previous.x, previous.y] : [])].every(Number.isFinite)) throw new Error("Pencil samples must remain finite");
  return !previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 0.5 / Math.max(zoom, 1e-6);
}

/** Native pressure_profile: arc-length sampling, f32 pressure and at most32 symmetric widths. */
export function pencilPressureProfile(points: readonly Point[], pressure: readonly (number | undefined)[]): readonly (readonly [number, number])[] | undefined {
  if (pressure.every(p => p === undefined)) return;
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const total = lengths.at(-1)!;
  if (!Number.isFinite(total) || total <= 0) return;
  const at = (i: number) => {
    const value = pressure[i], p = value === undefined ? NaN : Math.fround(value);
    return Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0.5;
  };
  const count = Math.max(2, Math.min(32, points.length)), result: (readonly [number, number])[] = [];
  let index = 0;
  for (let k = 0; k < count; k++) {
    const t = k / (count - 1), distance = t * total;
    while (index < lengths.length - 1 && lengths[index] < distance) index++;
    const start = lengths[index - 1], end = lengths[index];
    const value = index > 0 && end > start ? at(index - 1) + (at(index) - at(index - 1)) * ((distance - start) / (end - start)) : at(index);
    result.push(Object.freeze([t, Math.max(0.1, Math.min(2, value / 0.5))] as const));
  }
  return Object.freeze(result);
}
