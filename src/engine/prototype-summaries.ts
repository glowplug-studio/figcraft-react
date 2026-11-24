import type { Document, NodeId } from "./document";
import type { PrototypeAction, PrototypeInteraction, PrototypeTrigger } from "./prototype-data";
import { topFrames, topLevelFrame } from "./prototype-commands";
import { displayExpression, collectionById, variableById } from "./prototype-expressions";
import { isGamepadButton } from "./prototype-model";
import { emptyVariables } from "./variables";

/** Source: upstream ui-egui/src/panels/proto_panel.rs: how the prototype tab names triggers and actions, and what it adds. */
const triggerKinds: Record<PrototypeTrigger["type"], string> = {
  onClick: "On click", onDrag: "On drag", onHover: "While hovering", onPress: "While pressing", keyPress: "Key/Gamepad",
  mouseEnter: "Mouse enter", mouseLeave: "Mouse leave", mouseDown: "Mouse down", mouseUp: "Mouse up", afterDelay: "After delay",
};
/** Native `trigger_summary`: "Key/Gamepad Space", "After delay 800ms", a controller button by its name. */
export function triggerSummary(t: PrototypeTrigger): string {
  if (t.type === "keyPress") return !t.key ? "Key/Gamepad" : isGamepadButton(t.key) ? t.key : `Key/Gamepad ${t.key}`;
  if (t.type === "afterDelay") return `After delay ${t.ms}ms`;
  return triggerKinds[t.type];
}
const actionLabels: Record<PrototypeAction["type"], string> = {
  navigate: "Navigate to", back: "Back", scrollTo: "Scroll to", openOverlay: "Open overlay", swapOverlay: "Swap overlay",
  closeOverlay: "Close overlay", openUrl: "Open link", changeTo: "Change to", setVariable: "Set variable", setVariableMode: "Set variable mode", conditional: "Conditional",
};
/** Native `Action::label`. */
export const actionLabel = (a: PrototypeAction) => actionLabels[a.type];
const nameOf = (doc: Document, id: NodeId) => doc.nodes[id]?.name ?? "Missing layer";
/** Native `action_summary`: one line ("Navigate to Frame 2", "Set count to count + 1", "If count >= 3"). */
export function actionSummary(doc: Document, a: PrototypeAction): string {
  const vars = doc.variables ?? emptyVariables;
  switch (a.type) {
    case "openUrl": if (a.url) return `Open link ${a.url}`; break;
    case "setVariable": {
      const name = variableById(vars, a.variable)?.name ?? a.variable;
      return a.expr ? `Set ${name} to ${displayExpression(a.expr, vars)}` : `Set variable ${name}`;
    }
    case "setVariableMode": {
      const c = collectionById(vars, a.collection);
      return `Set ${c?.name ?? a.collection} to ${c?.modes.find(m => m.id === a.mode)?.name ?? a.mode}`;
    }
    case "conditional": {
      const c = a.blocks[0]?.condition;
      return c ? `If ${displayExpression(c, vars)}` : actionLabel(a);
    }
  }
  return "dest" in a ? `${actionLabel(a)} ${nameOf(doc, a.dest)}` : actionLabel(a);
}
export const interactionSummary = (doc: Document, it: PrototypeInteraction) => it.actions.map(a => actionSummary(doc, a)).join(", ");

/** Native `sections_in`: a page's sections, nested ones after their section, in layer order. */
export function sectionsIn(doc: Document, page: NodeId): NodeId[] {
  const out: NodeId[] = [];
  const walk = (id: NodeId, depth: number) => {
    for (const c of (doc.nodes[id] as { children?: readonly NodeId[] }).children ?? []) {
      if (doc.nodes[c]?.kind === "section" && depth < 64) { out.push(c); walk(c, depth + 1); }
    }
  };
  walk(page, 0);
  return out;
}
/** Native `nav_targets`: the top-level frames, then the sections. */
export const navigationTargets = (doc: Document, page: NodeId) => [...topFrames(doc, page), ...sectionsIn(doc, page)];
/** Native `action_of("Navigate to")` for a new interaction: to the first frame that is not the layer's own (else the first), or Back. */
export function newInteractionAction(doc: Document, page: NodeId, node: NodeId): PrototypeAction {
  const own = topLevelFrame(doc, node), frames = topFrames(doc, page);
  const dest = frames.find(f => f !== own) ?? frames[0];
  return dest !== undefined ? { type: "navigate", dest } : { type: "back" };
}
/** Native `targets_for`: the whole selection when it holds `node` and all of it has the same interactions, else `node`. */
export function interactionTargets(doc: Document, selection: readonly NodeId[], node: NodeId): NodeId[] {
  const same = (id: NodeId) => JSON.stringify(doc.nodes[id]?.interactions ?? []) === JSON.stringify(doc.nodes[node]?.interactions ?? []);
  return selection.length > 1 && selection.includes(node) && selection.every(same) ? [...selection] : [node];
}
