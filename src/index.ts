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
