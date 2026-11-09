import { slotName } from "./component-tree";
import { componentOverrides, inspectedPropertyValues, wireComponentProperties } from "./component-properties";
import { inspectedGridCell } from "./grid-placement";
import { layerSizing, sizeLimitKeys } from "./auto-layout";
import { inspectText } from "./inspect-text";
import { rotationDegrees } from "./affine";
import { toCssHex } from "./colour";
import { isFrameLike, defaultConstraints, isLeaf, nodeTypeName, layerTransform, pageColour, rectanglePaints, type Document, type DocumentNode } from "./document";
import { frameRelative } from "./hierarchy";
import { inspectedId, parseNodeId } from "./parameters";
import type { Paint } from "./solid-paint";
import { defaultStroke, miterAngle } from "./stroke";
import { boundsOf } from "./viewport";
import { widthProfilePoints, widthProfilePreset } from "./width-profile";

// Native InspectOptions::parse accepts the same vocabulary for every node kind.
const nodeKeys = new Set(`absolute absoluteBounds annotations arc background blend board booleanOperation boundVariables brush
characters childCount children clip codeLinks componentProperties componentPropertyDefinitions constraints
cornerRadius cornerSmoothing dashes description devChanged devNote devResources devStatus effects exports
fills flows fontFamily fontSize fontStyle fontVariations gridCell grids hangingList hangingPunctuation
height id innerRadius interactions isMask layout leadingTrim letterSpacing lineDirections lineHeight
lineIndentations lineTypes listSpacing listStartOffsets listStyle locked mainComponent mainComponentName
maskType maxHeight maxLines maxWidth measurements minHeight minWidth miterAngle name opacity
operandOperation overrides pluginData pointCount rotation sectionContentsHidden segments sizing slot
strokeAlign strokeJoin strokeSides strokeWeight strokes styledRuns styles textAlign textAutoResize
textDecoration textDecorationColor textDecorationOffset textDecorationSkipInk textDecorationStyle
textDecorationThickness textDirection textPath textStyleRanges type vertices visible width widthProfile
wrapStyle x y`.split(/\s+/));
const outlineKeys = ["name", "type", "characters", "mainComponentName", "visible"];

function requestedFields(params: Record<string, unknown>): Set<string> | undefined {
  if ("outline" in params && typeof params.outline !== "boolean") throw new Error("outline must be a boolean");
  if (params.outline && "fields" in params) throw new Error("outline: true cannot be combined with fields");
  if (params.outline) return new Set(outlineKeys);
  if (!("fields" in params)) return;
  if (!Array.isArray(params.fields)) throw new Error("fields must be an array of strings");
  for (const key of params.fields) {
    if (typeof key !== "string") throw new Error("fields must be an array of strings");
    if (!nodeKeys.has(key)) throw new Error(`Unknown field: ${key}`);
  }
  return new Set(params.fields);
}

const round = (v: number) => Math.sign(v) * Math.round(Math.abs(v) * 100) / 100;

function inspectPaint(paint: Paint) {
  if (paint.type !== "solid") {
    const { colorAlpha, ...record } = paint;
    return colorAlpha === 1 ? record : { ...record, colorAlpha };
  }
  return {
    type: paint.type, color: toCssHex(paint.color),
    ...(paint.opacity < 1 && { opacity: paint.opacity }),
    ...(paint.blend !== "normal" && { blend: paint.blend }),
    ...(!paint.visible && { visible: false }),
  };
}

function inspect(doc: Document, node: DocumentNode, depth: number, fields?: Set<string>, outline = false) {
  const out: Record<string, unknown> = { id: inspectedId(node.id) };
  const wants = (key: string) => !fields || fields.has(key);
  const put = (key: string, value: unknown) => { if (wants(key) && value !== undefined) out[key] = value; };
  if (node.boundVariables) put("boundVariables", {...node.boundVariables});
  if (node.isMask) {put("isMask",true); put("maskType",node.maskType ?? "alpha");}
  if (wants("overrides")) {
    const overrides = componentOverrides(node);
    if (overrides.length) put("overrides", overrides);
  }
  if (node.kind === "frame" && wants("slot")) put("slot", slotName(doc, node.id));
  put("name", node.name);
  put("type", nodeTypeName(node));
  if (fields?.has("visible")) put("visible", node.kind === "page" || node.visible !== false);
  if (node.kind === "page") {
    if (wants("background")) put("background", toCssHex(pageColour(node)));
  } else {
    if (node.styles) put("styles", node.styles);
    if (node.grids?.length) put("grids", node.grids);
    if (wants("x") || wants("y")) {
      const local = frameRelative(doc, node.id);
      put("x", round(local[4]));
      put("y", round(local[5]));
    }
    put("width", round(node.width));
    put("height", round(node.height));
    if (wants("rotation")) {
      const angle = rotationDegrees(layerTransform(node));
      if (Math.abs(angle) > 1e-6) put("rotation", round(angle));
    }
    if (wants("absoluteBounds")) {
      const b = boundsOf(doc, [node.id]);
      if (b) put("absoluteBounds", { x: round(b.x), y: round(b.y), width: round(b.width), height: round(b.height) });
    }
    if (node.visible === false) put("visible", false);
    if (node.locked) put("locked", true);
    if (node.blend && node.blend !== "normal" && node.blend !== "passThrough") put("blend", node.blend);
    if (node.opacity !== undefined && node.opacity < 1) put("opacity", node.opacity);
    if (node.effects?.length) put("effects", node.effects);
    if (wants("fills")) {
      const fills = rectanglePaints(node);
      if (fills.length) put("fills", fills.map(inspectPaint));
    }
    if (node.strokes?.length) {
      const s = node.stroke ?? defaultStroke;
      if (wants("strokes")) put("strokes", node.strokes.map(inspectPaint));
      put("strokeWeight", s.weight);
      put("strokeAlign", s.align);
      put("strokeSides", s.sides);
      if (s.dashes.length) put("dashes", s.dashes);
      if (s.dashCap) put("dashCap", s.dashCap);
      if (s.join !== "miter") put("strokeJoin", s.join);
      else if (s.miterLimit !== 4) put("miterAngle", round(miterAngle(s.miterLimit)));
      if (s.widthProfile && wants("widthProfile")) {
        put("widthProfile", { preset: widthProfilePreset(s.widthProfile) ?? null, points: widthProfilePoints(s.widthProfile) });
      }
      put("brush", s.brush);
    }
    if (node.corners?.radii.some(r => r > 0)) {
      const { radii, smoothing } = node.corners;
      put("cornerRadius", radii.every(r => r === radii[0]) ? radii[0] : radii);
      if (smoothing > 0) put("cornerSmoothing", smoothing);
    }
    const parent = doc.nodes[node.parent];
    if (node.kind === "text" || isFrameLike(node) && node.layout || isFrameLike(parent) && parent.layout) put("sizing", layerSizing(node));
    if (node.childLayout) {
      put("absolute", node.childLayout.absolute);
      for (const key of sizeLimitKeys) put(key, node.childLayout[key]);
    }
    if (isFrameLike(node) && node.layout) put("layout", node.layout);
    if (isFrameLike(parent)) {
      if (!parent.layout || node.childLayout?.absolute) put("constraints", node.constraints ?? defaultConstraints);
      if (wants("gridCell") && parent.layout?.mode === "grid") {
        const cell = inspectedGridCell(doc, parent, node.id);
        const cl = node.childLayout;
        if (cell) put("gridCell", {...cell, anchored: cl?.gridColumn !== undefined || cl?.gridRow !== undefined,
          alignH: cl?.gridAlignH ?? null, alignV: cl?.gridAlignV ?? null});
      }
    }
    if (parent?.kind === "booleanOp") put("operandOperation", node.boolOp);
    if (node.kind === "text") {
      inspectText(node.text,outline,wants,put);
    }
    if (isFrameLike(node)) put("clip", node.clip);
    if (node.kind === "component") {
      if (node.description) put("description", node.description);
      if (wants("componentPropertyDefinitions") && Object.keys(node.props).length)
        put("componentPropertyDefinitions", inspectedPropertyValues(wireComponentProperties(node.props)));
    }
    if (node.kind === "instance") {
      put("mainComponent", inspectedId(node.component));
      put("mainComponentName", doc.nodes[node.component]?.name ?? null);
      if (wants("componentProperties") && Object.keys(node.props).length)
        put("componentProperties", inspectedPropertyValues(node.props));
    }
    if (node.kind === "booleanOp") put("booleanOperation", node.op);
    if (node.kind === "polygon" || node.kind === "star") put("pointCount", node.count);
    if (node.kind === "star") put("innerRadius", node.innerRatio);
    if (node.kind === "ellipse" && (Math.abs(node.sweep) < Math.PI * 2 - 1e-9 || node.inner > 0)) {
      put("arc", { start: node.start * 180 / Math.PI, sweep: node.sweep * 180 / Math.PI, inner: node.inner });
    }
    if (node.kind === "vector") {
      put("vertices", node.network.vertices.length);
      put("segments", node.network.segments.length);
    }
  }
  if (!isLeaf(node) && node.children.length) {
    if (depth) out.children = node.children.map(id => inspect(doc, doc.nodes[id], depth - 1, fields, outline));
    else out.childCount = node.children.length;
  }
  return out;
}

export function getNode(doc: Document, params: Record<string, unknown>) {
  if (Object.keys(params).some(key => !["id","fields","outline"].includes(key))) throw new Error("Unknown node.get parameter");
  const id = parseNodeId(params.id);
  if (!id) throw new Error("node.get requires a node id");
  const fields = requestedFields(params);
  return doc.nodes[id] ? inspect(doc, doc.nodes[id], 1, fields, params.outline === true) : null;
}
