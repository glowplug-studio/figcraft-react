import type { Document } from "./document";
import type { BranchPlan } from "./branch-merge";
import type { FileBranch } from "./file-format";

function* numberedIds(document: Document) {
  yield* Object.keys(document.nodes);
  for (const comment of document.comments ?? []) yield comment.id;
  for (const style of document.styles ?? []) yield /^S:(\d+)$/.exec(style.id)?.[1];
  for (const variable of document.variables?.variables ?? []) yield /^VariableID:(\d+)$/.exec(variable.id)?.[1];
  for (const collection of document.variables?.collections ?? []) {
    yield /^VariableCollectionId:(\d+)$/.exec(collection.id)?.[1];
    for (const mode of collection.modes) yield /\/mode(\d+)$/.exec(mode.id)?.[1];
  }
}

/** Rust accepts leading zeroes in numeric style, variable and mode suffixes. */
function* documentNumbers(document: Document) {
  for (const value of numberedIds(document)) {
    if (!value) continue;
    const digits = value.replace(/^0+/, "") || "0";
    if (digits.length > 20) continue;
    const number = BigInt(digits);
    if (number <= 0xffffffffffffffffn) yield number;
  }
}

export function highestIdSpace(document: Document) {
  let highest = 0;
  for (const number of documentNumbers(document)) {
    const client = Number(number >> 32n);
    if (client < 0xffffffff) highest = Math.max(highest, client);
  }
  return highest;
}

export function nextBranchClient(document: Document, branches: readonly FileBranch[]) {
  let highest = highestIdSpace(document);
  for (const branch of branches) highest = Math.max(highest, branch.client);
  if (highest >= 0xffffffff) throw new Error("No id space left for a new branch");
  return highest + 1;
}

export function nextScopedId(document: Document, namespace: number, stored: bigint) {
  const client = BigInt(namespace);
  let next = !client || stored >> 32n === client ? stored : (client << 32n) + 1n;
  for (const id of documentNumbers(document)) {
    if ((!client || id >> 32n === client) && id >= next) next = id + 1n;
  }
  return next;
}


export function nextBranchId(branch: FileBranch) {
  return nextScopedId(branch.head.document, branch.client, BigInt(branch.head.nextId));
}


const branchWindow = 1n << 24n;

export function liveBranchStart(client: number, counters: readonly bigint[]) {
  const space = BigInt(client);
  const highest = counters.reduce((top, n) => n >> 32n === space && n > top ? n : top, (space << 32n) + 1n);
  const start = highest + branchWindow;
  if (start >> 32n !== space) throw new Error("No id space left for a new branch");
  return start;
}

export function openedBranchStart(record: FileBranch, client: number, main: bigint, counters: readonly bigint[]) {
  const next = nextBranchId(record);
  const distance = next >= main ? next - main : main - next;
  return record.client === client && distance < branchWindow ? liveBranchStart(client, counters) : next;
}

export function foreignBranchAddition(plan: BranchPlan, merged: Document, client: number, liveBase: boolean) {
  const current = plan.main.document;
  for (const node of Object.values(merged.nodes)) {
    if (!current.nodes[node.id] && Number(BigInt(node.id) >> 32n) !== client && !(liveBase && plan.base.nodes[node.id])) {
      return "layer “" + node.name + "”";
    }
  }
  const prefixes: Record<string, string> = { style: "S:", variable: "VariableID:", collection: "VariableCollectionId:", comment: "" };
  for (const change of plan.branch.files.values()) {
    if (change.operation !== "added") continue;
    const slash = change.key.indexOf("/"), family = change.key.slice(0, slash), id = change.key.slice(slash + 1);
    const prefix = prefixes[family];
    if (prefix === undefined || !id.startsWith(prefix)) continue;
    const digits = id.slice(prefix.length).replace(/^0+/, "") || "0";
    if (!/^\d{1,20}$/.test(digits)) continue;
    const numeric = BigInt(digits), space = Number(numeric >> 32n);
    if (numeric <= 0xffffffffffffffffn && space && space !== client) return family + " " + id;
  }
}
