import { pageColour, pageOf, type Document } from "./document";
import { toRgba8 } from "./colour";

/** Native theme::set_canvas_page chooses the green with the greater page contrast. */
export function canvasAccent(document: Document): "#02da96" | "#00875f" {
  const luminance = (rgb: readonly number[]) => rgb.slice(0, 3).reduce((sum, c, i) => {
    c /= 255; const linear = c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
    return sum + linear * [.2126, .7152, .0722][i];
  }, 0);
  const page = luminance(toRgba8(pageColour(pageOf(document)))) + .05;
  const contrast = (rgb: readonly number[]) => { const value = luminance(rgb) + .05; return Math.max(page, value) / Math.min(page, value); };
  return contrast([2, 218, 150]) > contrast([0, 135, 95]) ? "#02da96" : "#00875f";
}
