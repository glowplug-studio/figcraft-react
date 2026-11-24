import type { Document, NodeId } from "./document";
import { toCssHex } from "./colour";
import { owningMainComponent } from "./component-tree";
import { subtreeIds } from "./hierarchy";
import type { PrototypeAction, PrototypeInteraction, PrototypeTrigger } from "./prototype-data";
import { defaultCondition, startValue, topFrames, topLevelFrame } from "./prototype-commands";
import { displayExpression, collectionById, variableById } from "./prototype-expressions";
import { isGamepadButton } from "./prototype-model";
import { emptyVariables, type VariableValue } from "./variables";

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

/** The action kinds as native's menus list them (a separator before indexes 2, 4, 5, 8 and 10). */
export const actionKinds = ["Navigate to", "Change to", "Back", "Scroll to", "Open link", "Open overlay", "Swap overlay", "Close overlay", "Set variable", "Set variable mode", "Conditional"] as const;
export type ActionKind = typeof actionKinds[number];
/** Native `unavailable`: why an action of a kind cannot be made here. */
export function unavailableAction(kind: ActionKind): string {
  return kind === "Change to" ? "Change to needs a layer inside a variant" : kind === "Set variable" ? "Create a variable first"
    : kind === "Set variable mode" ? "Create a variable collection first" : "There's no destination for that action";
}
/** Native `variants_for`: what a Change to can pick, the variants next to the layer's component. */
export function variantsFor(doc: Document, id: NodeId): NodeId[] {
  const node = doc.nodes[id];
  const comp = owningMainComponent(doc, id)?.id ?? (node?.kind === "instance" ? node.component : undefined);
  const parent = comp !== undefined ? doc.nodes[comp]?.parent : undefined;
  const set = parent != null && doc.nodes[parent]?.kind === "componentSet" ? doc.nodes[parent] as { children: readonly NodeId[] } : undefined;
  return set ? [...set.children] : comp !== undefined ? [comp] : [];
}
/** Native `value_json`: a plain variable value as commands take it. */
export function valueJson(v: VariableValue): unknown {
  if (v.type === "color") return toCssHex(v.value);
  if (v.type === "number" || v.type === "boolean" || v.type === "string") return v.value;
  return null;
}
/** Native `action_of`: a default action of the kind `kind` (undefined when it needs a destination and there is none). */
export function actionOf(kind: ActionKind, doc: Document, page: NodeId, node: NodeId, cur?: PrototypeAction): PrototypeAction | undefined {
  const own = topLevelFrame(doc, node), frames = topFrames(doc, page);
  const curDest = cur && "dest" in cur && frames.includes(cur.dest) ? cur.dest : undefined;
  const frameDest = curDest ?? frames.find(f => f !== own) ?? frames[0];
  const vars = doc.variables ?? emptyVariables;
  switch (kind) {
    case "Navigate to": return frameDest !== undefined ? { type: "navigate", dest: frameDest, ...(cur?.type === "navigate" && cur.preserve_scroll && { preserve_scroll: true as const }) } : undefined;
    case "Change to": {
      const vs = variantsFor(doc, node), mine = owningMainComponent(doc, node)?.id;
      const dest = vs.find(v => v !== mine) ?? vs[0];
      return dest !== undefined ? { type: "changeTo", dest } : undefined;
    }
    case "Back": return { type: "back" };
    case "Scroll to": {
      if (own === undefined) return undefined;
      const dest = subtreeIds(doc, own).slice(1).find(i => i !== node);
      return dest !== undefined ? { type: "scrollTo", dest } : undefined;
    }
    case "Open link": return { type: "openUrl", url: "" };
    case "Open overlay": return frameDest !== undefined ? { type: "openOverlay", dest: frameDest, position: "center", close_on_outside: true, background: null } : undefined;
    case "Swap overlay": return frameDest !== undefined ? { type: "swapOverlay", dest: frameDest } : undefined;
    case "Close overlay": return { type: "closeOverlay" };
    case "Set variable": {
      const v = vars.variables[0];
      return v ? { type: "setVariable", variable: v.id, value: valueJson(startValue(vars, v)) } : undefined;
    }
    case "Set variable mode": {
      const c = vars.collections.find(x => x.modes.length);
      const m = c && (c.modes[1] ?? c.modes[0]);
      return c && m ? { type: "setVariableMode", collection: c.id, mode: m.id } : undefined;
    }
    case "Conditional": return { type: "conditional", blocks: [{ condition: defaultCondition(vars), actions: [] }] };
  }
}
/** An action as commands take it: destinations as numbers. */
export function wireAction(a: PrototypeAction): unknown {
  if ("dest" in a) return { ...a, dest: Number(a.dest) };
  if (a.type === "conditional") return { ...a, blocks: a.blocks.map(b => ({ ...b, actions: b.actions.map(wireAction) })) };
  return a;
}
/** Native `animates`: the actions the interaction's transition applies to. */
export const animates = (a: PrototypeAction) => !["openUrl", "setVariable", "setVariableMode", "closeOverlay", "conditional"].includes(a.type);
