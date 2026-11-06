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
export { solidPaint, type SolidPaint } from "./engine/solid-paint";
export { rectanglePaints, withRectanglePaints, pageColour, withPageColour } from "./engine/document";
export type { RecoveryStore } from "./backends/recovery";
export { IndexedDbRecoveryStore } from "./backends/browser/recovery";
export { defaultViewport, viewOrigin, pageToScreen, screenToPage, zoomAt, fitView, scrollView, type Viewport } from "./engine/viewport";
export { framePresets, type FramePreset } from "./engine/frame-presets";
