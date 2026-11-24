import { toCssHex, withAlpha, type Colour } from "./colour";
import { parseCssColour } from "./colour-css";

/** Native panels/right.rs page_section (a45d932a): the page colour as six HEX digits beside a fractional opacity field, as Fill shows. */
export const pageHex = (colour: Colour) => toCssHex(withAlpha(colour, 1)).slice(1);
export const pageOpacity = (colour: Colour) => Math.round(colour.a * 1000) / 10;

/** The page colour a typed value gives: it keeps the page's opacity unless it carries one, as 4 or 8 HEX digits do (FF000080;
 * FF0000FF asks for opaque). The port's field also takes CSS functions, such as rgba(), which state their own alpha. */
export function typedPageColour(typed: string, current: Colour): Colour | undefined {
  const value = parseCssColour(typed.trim());
  if (!value) return;
  return /^#?([0-9a-f]{4}|[0-9a-f]{8})$/i.test(typed.trim()) || typed.includes("(") ? value : withAlpha(value, current.a);
}

/** Native canvas/background.rs: below full opacity the page shows a checkerboard behind its rendered pixels, 8-point squares in the
 * theme's panel and canvas colours (the light theme's #FFFFFF and #F5F5F5; texels [panel, canvas, canvas, panel]) anchored at the
 * canvas's top left. It is interface, not render: the page's pixels keep its colour and alpha, applied once, over it. */
export const transparencyGrid = "repeating-conic-gradient(#f5f5f5 0 25%, #ffffff 0 50%) 0 0 / 16px 16px";
export const canvasBackdrop = (page: Colour) => page.a < 1 ? transparencyGrid : undefined;
