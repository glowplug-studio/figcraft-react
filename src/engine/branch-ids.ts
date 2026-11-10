import type { Document } from "./document";
import type { FileBranch } from "./file-format";

function* numberedIds(document: Document) {
  yield* Object.keys(document.nodes);
  for (const style of document.styles ?? []) yield /^S:(\d+)$/.exec(style.id)?.[1];
  for (const variable of document.variables?.variables ?? []) yield /^VariableID:(\d+)$/.exec(variable.id)?.[1];
  for (const collection of document.variables?.collections ?? []) {
    yield /^VariableCollectionId:(\d+)$/.exec(collection.id)?.[1];
    for (const mode of collection.modes) yield /\/mode(\d+)$/.exec(mode.id)?.[1];
  }
}

export function nextBranchClient(document: Document, branches: readonly FileBranch[]) {
  let highest = 0;
  for (const value of numberedIds(document)) {
    if (!value || value.length > 20) continue;
    const client = Number(BigInt(value) >> 32n);
    if (client < 0xffffffff) highest = Math.max(highest, client);
  }
  for (const branch of branches) highest = Math.max(highest, branch.client);
  if (highest >= 0xffffffff) throw new Error("No id space left for a new branch");
  return highest + 1;
}

export function nextBranchId(branch: FileBranch) {
  const client = BigInt(branch.client);
  const stored = BigInt(branch.head.nextId);
  let next = !client || stored >> 32n === client ? stored : (client << 32n) + 1n;
  for (const value of numberedIds(branch.head.document)) {
    if (!value || value.length > 20) continue;
    const id = BigInt(value);
    if ((!client || id >> 32n === client) && id >= next) next = id + 1n;
  }
  return next;
}
