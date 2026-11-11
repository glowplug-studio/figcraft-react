import { nextScopedId } from "../branch-ids";
import { finishComponentEdit } from "../component-edits";
import type { Document } from "../document";
import { HierarchyDraft } from "../hierarchy";
import { refreshLayerBindings } from "../layer-variable-bindings";
import { refreshBoundStyles } from "../style-application";
import { autoSizeText, fitEditedText } from "../text-node-layout";
import { syncExtensions } from "../variable-collections";

/** Run the editor's derived-property rules on the authoritative result of a rebased local edit. */
export function normaliseLive(before: Document, after: Document, touched: ReadonlySet<string>, client: number, reserved: bigint) {
  let next = nextScopedId(after,client,reserved), document = after;
  if (after.variables && before.variables !== after.variables) {
    const variables = syncExtensions(after.variables,() => next++);
    if (variables !== after.variables) document = {...document,variables};
  }
  document = refreshBoundStyles(refreshLayerBindings(document,before,false,true),before);
  const draft = new HierarchyDraft(document,before);
  draft.markChanged(touched);
  for (const id of touched) {
    const node = draft.nodes[id], old = before.nodes[id];
    if (!node && old?.parent) draft.markChanged([old.parent]);
    if (node?.kind === "text") draft.set(old?.kind === "text" ? fitEditedText(node,old) : autoSizeText(node));
  }
  draft.normaliseGroups();
  const result = finishComponentEdit(before,draft.finish(),next);
  return {document:refreshBoundStyles(refreshLayerBindings(result.document,before),before),nextId:result.nextId};
}
