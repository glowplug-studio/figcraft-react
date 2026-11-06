import { signedOutIdentity } from "../../src";
import {
  MemoryDocumentAccessAdapter,
  MemoryIdentityAdapter,
} from "../../src/backends/memory";
import { hostAdapterContract } from "./hostAdapterContract";

hostAdapterContract("memory", () => {
  const identity = new MemoryIdentityAdapter();
  const access = new MemoryDocumentAccessAdapter();

  return {
    identity,
    access,
    authenticate: (snapshot) => identity.setSnapshot(snapshot),
    signOut: (revision) => identity.setSnapshot(signedOutIdentity(revision)),
    grant: (snapshot) => access.setSnapshot(snapshot),
    revoke: (documentId, revision) => access.revoke(documentId, revision),
  };
});
