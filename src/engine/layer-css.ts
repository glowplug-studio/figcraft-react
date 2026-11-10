import { rotationDegrees } from "./affine";
import type { AutoLayout } from "./auto-layout";
import { cssColour, withAlpha } from "./colour";
import { isFrameLike, rectanglePaints, type Document, type DocumentNode } from "./document";
import type { Effect } from "./effects";
import { sortedStops, type Gradient } from "./gradient";
import { trimNumber } from "./inspect-text";
import { defaultStroke } from "./stroke";
import type { TextData } from "./text-data";
import { textItalic, textWeight, type TextStyle } from "./text-style";
import { variableCssNames } from "./variable-css-names";
import type { Variables } from "./variables";

type Put = (key: string, value: string) => void;
type Token = (fields: readonly string[], value: string) => string;
const px = (value: number) => trimNumber(value) + "px";
const percent = (value: number) => trimNumber(value) + "%";
const sides = ["Top", "Right", "Bottom", "Left"] as const;
const corners = ["topLeftRadius", "topRightRadius", "bottomRightRadius", "bottomLeftRadius"] as const;
const nameCache = new WeakMap<Variables, Map<string,string>>();

function gradientCss(g: Gradient, width: number, height: number, opacity: number) {
  const stops = sortedStops(g.stops).map(stop => {
    const color = cssColour(withAlpha(stop.color, stop.color.a * opacity));
    return color + " " + Math.round(Math.fround(stop.position * 100)) + "%";
  }).join(", ");
  const dx = (g.to[0] - g.from[0]) * width, dy = (g.to[1] - g.from[1]) * height;
  const angle = dx === 0 && dy === 0 ? 180 : (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  const at = "at " + percent(g.from[0] * 100) + " " + percent(g.from[1] * 100);
  if (g.kind === "linear") return "linear-gradient(" + trimNumber(angle) + "deg, " + stops + ")";
  if (g.kind === "angular") return "conic-gradient(from " + trimNumber(angle) + "deg " + at + ", " + stops + ")";
  const rx = Math.hypot((g.width[0] - g.from[0]) * width, (g.width[1] - g.from[1]) * height);
  return "radial-gradient(" + (width > 0 ? percent(rx / width * 100) : "50%") + " " +
    (height > 0 ? percent(Math.hypot(dx, dy) / height * 100) : "50%") + " " + at + ", " + stops + ")";
}

function layoutCss(layout: AutoLayout, put: Put, tok: Token) {
  put("display", "flex");
  put("flex-direction", layout.mode === "vertical" ? "column" : "row");
  if (layout.wrap) put("flex-wrap", "wrap");
  put("gap", tok(["gap"], px(layout.gap)));
  put("padding", sides.map((side, i) => tok(["padding" + side, i % 2 ? "paddingHorizontal" : "paddingVertical", "padding"], px(layout.padding[i]))).join(" "));
  const aligns = { min: "flex-start", max: "flex-end", center: "center", baseline: "baseline",
    spaceBetween: "space-between", spaceAround: "space-around", spaceEvenly: "space-evenly" };
  put("justify-content", aligns[layout.mainAlign]);
  put("align-items", aligns[layout.crossAlign]);
  if (layout.wrap) put("align-content", layout.contentAlign === "spaceBetween" ? "space-between" :
    layout.crossAlign === "baseline" ? "flex-start" : aligns[layout.crossAlign]);
}

function effectCss(effects: readonly Effect[], put: Put) {
  const shadows: string[] = [], blurs: [string, string][] = [];
  for (const effect of effects) {
    if (!effect.visible) continue;
    if (effect.type === "dropShadow" || effect.type === "innerShadow") {
      shadows.push((effect.type === "innerShadow" ? "inset " : "") +
        [...effect.offset, effect.radius, effect.spread].map(px).join(" ") + " " + cssColour(effect.color));
    } else if ((effect.type === "layerBlur" || effect.type === "backgroundBlur") && effect.blurType !== "progressive") {
      blurs.push([effect.type === "layerBlur" ? "filter" : "backdrop-filter", "blur(" + px(effect.radius / 2) + ")"]);
    } else if (effect.type === "glass") {
      blurs.push(["backdrop-filter", "blur(" + px(Math.min(100, Math.max(0, effect.frost)) / 2) + ")"]);
    }
  }
  if (shadows.length) put("box-shadow", shadows.join(", "));
  for (const [key, value] of blurs) put(key, value);
}

function textCss(text: TextData, put: Put, tok: Token) {
  const style = text.style;
  const family = style.fontFamily.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("<", "\\3C ").replace(/\r\n|[\r\n]/g, "\\A ");
  put("font-family", tok(["fontFamily"], '"' + family + '"'));
  put("font-size", tok(["fontSize"], px(style.fontSize)));
  put("font-weight", String(textWeight(style)));
  if (textItalic(style)) put("font-style", "italic");
  function length(key: string, value?: TextStyle["lineHeight"], fields?: string[]) {
    if (!value || value.unit === "auto") return;
    if (value.unit === "percent") put(key, percent(value.value));
    else put(key, fields ? tok(fields, px(value.value)) : px(value.value));
  }
  length("line-height", style.lineHeight, ["lineHeight"]);
  const spacing = style.letterSpacing;
  if (spacing.value) put("letter-spacing", spacing.unit === "percent" ? trimNumber(spacing.value / 100) + "em" : tok(["letterSpacing"], px(spacing.value)));
  if (text.alignH !== "left") put("text-align", text.alignH === "justified" ? "justify" : text.alignH);
  if (text.wrapStyle !== "auto") put("text-wrap", text.wrapStyle);
  const direction = text.paragraphs[0]?.direction;
  if (direction && direction !== "auto" && text.paragraphs.every(p => p.direction === direction)) {
    put("direction", direction);
    if (direction === "rtl" && text.alignH === "left") put("text-align", "left");
  }
  if (style.case === "smallCaps") put("font-variant", "small-caps");
  else if (style.case !== "original") put("text-transform", {upper:"uppercase", lower:"lowercase", title:"capitalize"}[style.case]);
  if (style.decoration !== "none") {
    const look = style.decorationLook;
    put("text-decoration", style.decoration === "underline" ? "underline" : "line-through");
    if (look && look.style !== "solid") put("text-decoration-style", look.style);
    length("text-decoration-thickness", look?.thickness);
    if (look?.color) put("text-decoration-color", cssColour(look.color));
    if (style.decoration === "underline") {
      length("text-underline-offset", look?.offset);
      if (!look?.skipInk) put("text-decoration-skip-ink", "none");
    }
  }
  if (text.leadingTrim === "capHeight") put("text-box", "trim-both cap alphabetic");
}

/** Native code_for(Css) emits a layer comment followed by bare declarations in source order. */
export function layerCss(doc: Document, node: DocumentNode) {
  const width = node.kind === "page" ? 0 : node.width, height = node.kind === "page" ? 0 : node.height;
  const lines = ["/* " + node.name.replaceAll("*/", "* /") + " */"];
  const put: Put = (key, value) => { lines.push(key + ": " + value + ";"); };
  const tok: Token = (fields, value) => {
    if (!node.boundVariables || !doc.variables) return value;
    for (const field of fields) {
      const forms = field === "fill" ? ["fill", "fills", "fills/0", "fills/0/color"] : field === "stroke" ? ["stroke", "strokes/0/color"] : [field];
      const key = forms.find(form => Object.hasOwn(node.boundVariables!, form));
      if (!key) continue;
      let names = nameCache.get(doc.variables);
      if (!names) { names = variableCssNames(doc.variables, new Map(), false); nameCache.set(doc.variables, names); }
      const name = names.get(node.boundVariables[key]);
      if (name) return "var(" + name + ", " + value + ")";
    }
    return value;
  };
  put("width", tok(["width"], px(width)));
  put("height", tok(["height"], px(height)));
  if (isFrameLike(node) && node.layout) layoutCss(node.layout, put, tok);
  const radii = node.kind !== "page" && node.corners?.radii;
  if (node.kind === "ellipse") put("border-radius", "50%");
  else if (radii && radii.some(r => r > 0)) {
    put("border-radius", radii.every(r => r === radii[0]) ? tok(["cornerRadius"], px(radii[0])) :
      radii.map((r, i) => tok([corners[i], "cornerRadius"], px(r))).join(" "));
  }
  if (node.opacity !== undefined && node.opacity < 1) put("opacity", tok(["opacity"], trimNumber(node.opacity)));
  if (node.blend && node.blend !== "normal" && node.blend !== "passThrough") put("mix-blend-mode", node.blend.replace(/[A-Z]/g, c => "-" + c.toLowerCase()));
  const rotation = node.kind !== "page" && node.transform ? rotationDegrees(node.transform) : 0;
  if (Math.abs(rotation) > 0.01) { put("transform", "rotate(" + trimNumber(-rotation) + "deg)"); put("transform-origin", "top left"); }
  for (const [i, paint] of (node.kind === "page" ? node.fills ?? [] : rectanglePaints(node)).entries()) {
    if (!paint.visible) continue;
    if (paint.type === "solid") {
      const color = cssColour(withAlpha(paint.color, paint.color.a * paint.opacity));
      put(node.kind === "text" ? "color" : "background", i === 0 ? tok(["fill"], color) : color);
    } else if (paint.type === "gradient") put("background", gradientCss(paint, width, height, paint.opacity));
    else put("background", paint.type === "image" ? "url(image.png) center / cover" : "url(pattern.png) repeat");
  }
  const stroke = node.stroke ?? defaultStroke, paint = node.strokes?.find(p => p.visible && p.type === "solid");
  if (stroke.weight > 0 && paint?.type === "solid") {
    const color = tok(["stroke"], cssColour(withAlpha(paint.color, paint.color.a * paint.opacity)));
    if (stroke.sides) stroke.sides.forEach((weight, i) => {
      if (weight > 0) put("border-" + sides[i].toLowerCase(), tok(["stroke" + sides[i] + "Weight"], px(weight)) + " solid " + color);
    });
    else put("border", tok(["strokeWeight"], px(stroke.weight)) + " solid " + color);
  }
  effectCss(node.effects ?? [], put);
  if (node.kind === "text") textCss(node.text, put, tok);
  return lines.join("\n") + "\n";
}
