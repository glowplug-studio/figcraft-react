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
export { renderDocument, CanvasController } from "./engine/canvas";
export type { RecoveryStore } from "./backends/recovery";
export { IndexedDbRecoveryStore } from "./backends/browser/recovery";
