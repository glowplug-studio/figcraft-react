export { FigcraftRoot, type FigcraftRootProps } from "./FigcraftRoot";
export {
  can,
  noDocumentAccess,
  type AccessGrantSource,
  type DocumentAccessAdapter,
  type DocumentAccessLevel,
  type DocumentAccessListener,
  type DocumentAccessSnapshot,
  type DocumentCapability,
  type OwnerReference,
} from "./backends/access";
export {
  signedOutIdentity,
  type IdentityAdapter,
  type IdentityListener,
  type IdentitySnapshot,
  type Principal,
  type Unsubscribe,
} from "./backends/identity";
export { Editor, type EditorProps } from "./Editor";
export { EditorEngine, commandSpecs, type EditorSnapshot, type CommandId } from "./engine/editor";
export { newDocument, pageOf, type Document, type DocumentNode, type RectangleNode, type PageNode, type NodeId } from "./engine/document";
export { layerTransform, withLayerTransform, type LayerNode, type GroupNode, type FrameNode, type Constraints } from "./engine/document";
export { worldTransform, frameRelative, pageForNode, subtreeIds } from "./engine/hierarchy";
export { renderDocument, CanvasController } from "./engine/canvas";
export { colour, fromRgba8, toRgba8, toCssHex, renderColour, type Colour } from "./engine/colour";
export { parseColour, parseCssColour, parseHexColour } from "./engine/colour-css";
export { solidPaint, type SolidPaint, type Paint, type ImagePaint, type PatternPaint, type GradientPaint } from "./engine/solid-paint";
export { rectanglePaints, withRectanglePaints, pageColour, withPageColour } from "./engine/document";
export type { RecoveryStore } from "./backends/recovery";
export { IndexedDbRecoveryStore } from "./backends/browser/recovery";
export { defaultViewport, viewOrigin, pageToScreen, screenToPage, zoomAt, fitView, scrollView, type Viewport } from "./engine/viewport";
export { framePresets, type FramePreset } from "./engine/frame-presets";

export { roundedRect, type Corners, type Radii, type PathCommand } from "./engine/corners";

export { ellipsePath, type Arc } from "./engine/ellipse";
export type { EllipseNode } from "./engine/document";
export { polygonPoints, starPoints, roundedPolygon, smoothedPolygon } from "./engine/polygon";
export type { PolygonNode, StarNode, LineNode, LeafNode, DrawShapeKind } from "./engine/document";
export { defaultStroke, strokeCaps, miterAngle, miterLimitFor, type StrokeProps, type StrokeSides, type StrokeCap, type StrokeAlign, type StrokeJoin } from "./engine/stroke";
export { widthPresetIds, widthPresetLabels, widthPresetProfile, type WidthPoint, type WidthProfile, type WidthPreset } from "./engine/width-profile";
export { brushPresets, defaultBrush, type Brush } from "./engine/brush";
export type { VectorNode } from "./engine/document";
export type { VectorNetwork, VectorVertex, VectorSegment, VectorRegion, RegionPaintSpace, HandleMirroring } from "./engine/vector-network";

export { readFontFaces } from "./engine/font-source";
export type { ShapingFace, ShapingScalar, ShapedGlyph } from "./engine/shaping-face";
export { FontLibrary } from "./engine/font-library";
export { TextGraphemes } from "./engine/text-graphemes";
export { readTextData, type TextData } from "./engine/text-data";
export { styledGlyphs, type StyledGlyph } from "./engine/styled-glyphs";
export { glyphPath } from "./engine/text-glyph-path";
export { textCaret, textHit, textSelectionRects, textVisualStep } from "./engine/text-caret";
export { textWarpPoint, TextOnPath } from "./engine/text-on-path";
export { layoutText, layoutTextFlow, type FlowGlyph, type FlowLine } from "./engine/text-flow";
export { textWordStarts } from "./engine/text-word-starts";
