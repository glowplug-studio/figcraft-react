import { useState } from "react";
import { toCssHex } from "./engine/colour";
import { parseColour } from "./engine/colour-css";
import type { Document, NodeId, PageNode } from "./engine/document";
import { subtreeIds } from "./engine/hierarchy";
import { topFrames, topLevelFrame } from "./engine/prototype-commands";
import { easingNames, overlayPositions, type PrototypeAction, type PrototypeEasing, type PrototypeExpression, type PrototypeInteraction, type PrototypeTransition, type PrototypeTrigger } from "./engine/prototype-data";
import { checkCondition, checkValue, displayExpression, parseExpression, variableById } from "./engine/prototype-expressions";
import { customBezier, customSpring, easingSeconds, easingSpring, gamepadButtons, keyCombo } from "./engine/prototype-model";
import { literal } from "./engine/prototype-runtime";
import { actionKinds, actionLabel, actionOf, actionSummary, animates, navigationTargets, unavailableAction, valueJson, variantsFor, wireAction, type ActionKind } from "./engine/prototype-summaries";
import { emptyVariables, type VariableValue } from "./engine/variables";

/** Source: upstream ui-egui/src/panels/proto_panel.rs (editor_popover, trigger_rows, action_fields, animation_rows) and proto_editor.rs (actions, conditionals, set variable). */
export interface InteractionEditorProps {
  document: Document;
  node: NodeId;
  index: number;
  interaction: PrototypeInteraction;
  ids: readonly number[];
  editable: boolean;
  dispatch: (command: string, params?: unknown) => void;
  close: () => void;
}
type Ctx = InteractionEditorProps & { page: NodeId; open: string; setOpen: (path: string) => void; notice: (text: string) => void };

const triggerKinds: [PrototypeTrigger["type"], string][] = [["onClick", "On click"], ["onDrag", "On drag"], ["onHover", "While hovering"], ["onPress", "While pressing"],
  ["keyPress", "Key/Gamepad"], ["mouseEnter", "Mouse enter"], ["mouseLeave", "Mouse leave"], ["mouseDown", "Mouse down"], ["mouseUp", "Mouse up"], ["afterDelay", "After delay"]];
const transitions: [PrototypeTransition["type"], string][] = [["instant", "Instant"], ["dissolve", "Dissolve"], ["smartAnimate", "Smart animate"],
  ["moveIn", "Move in"], ["moveOut", "Move out"], ["push", "Push"], ["slideIn", "Slide in"], ["slideOut", "Slide out"]];
const easingLabels: Record<string, string> = { linear: "Linear", easeIn: "Ease in", easeOut: "Ease out", easeInOut: "Ease in and out", easeInBack: "Ease in back",
  easeOutBack: "Ease out back", easeInOutBack: "Ease in and out back", gentle: "Gentle", quick: "Quick", bouncy: "Bouncy", slow: "Slow", customBezier: "Custom bezier", customSpring: "Custom spring" };
const positionLabels: Record<string, string> = { center: "Center", topLeft: "Top left", topCenter: "Top center", topRight: "Top right", bottomLeft: "Bottom left",
  bottomCenter: "Bottom center", bottomRight: "Bottom right", manual: "Manual" };
const easingKey = (e: PrototypeEasing) => typeof e === "string" ? e : "customBezier" in e ? "customBezier" : "customSpring";
const pathOf = (s: string) => s.split("/").filter(Boolean).map(Number);
const keyOf = (p: readonly number[]) => p.join("/");
/** DOM key names as native's egui names them. */
function keyName(e: React.KeyboardEvent) {
  if (e.key === " ") return "Space";
  if (e.key.length === 1) return e.key.toUpperCase();
  return e.key === "Esc" ? "Escape" : e.key;
}

/** Native `trigger_of`: the trigger of a kind, keeping a key or a delay already set. */
function triggerOf(kind: PrototypeTrigger["type"], cur: PrototypeTrigger): PrototypeTrigger {
  if (kind === "keyPress") return { type: kind, key: cur.type === "keyPress" ? cur.key : "" };
  if (kind === "afterDelay") return { type: kind, ms: cur.type === "afterDelay" ? cur.ms : 800 };
  return { type: kind };
}
/** Native `transition_of`: the transition of a kind, keeping its direction. */
function transitionOf(kind: PrototypeTransition["type"], cur: PrototypeTransition): PrototypeTransition {
  const direction = "direction" in cur ? cur.direction : "left";
  return kind === "instant" || kind === "dissolve" || kind === "smartAnimate" ? { type: kind } : { type: kind, direction };
}

export function InteractionEditor(props: InteractionEditorProps) {
  const [open, setOpen] = useState("0");
  const [note, setNote] = useState("");
  const page = props.document.currentPage;
  const ctx: Ctx = { ...props, page, open, setOpen, notice: setNote };
  const it = props.interaction;
  const patch = (fields: Record<string, unknown>) => props.dispatch("proto.interaction.set", { ids: props.ids, index: props.index, ...fields });
  const anim = it.actions.some(function walk(a: PrototypeAction): boolean { return animates(a) || a.type === "conditional" && a.blocks.some(b => b.actions.some(walk)); });
  return <section className="figcraft-interaction-editor" aria-label="Interaction">
    <h3>Interaction <button type="button" aria-label="Close interaction" onClick={props.close}>×</button></h3>
    {note && <p role="status">{note}</p>}
    <fieldset disabled={!props.editable}>
      <TriggerRows trigger={it.trigger} delay={it.delay_ms ?? 0} patch={patch} />
      <h4>{it.actions.length > 1 ? "Actions" : "Action"}</h4>
      <ActionList ctx={ctx} list={it.actions} prefix={[]} />
      {anim && <AnimationRows it={it} patch={patch} />}
    </fieldset>
  </section>;
}

function TriggerRows({ trigger, delay, patch }: { trigger: PrototypeTrigger; delay: number; patch: (f: Record<string, unknown>) => void }) {
  const [capturing, setCapturing] = useState(false);
  return <div>
    <label>Trigger <select aria-label="Trigger" value={trigger.type} onChange={e => {
      const next = triggerOf(e.currentTarget.value as PrototypeTrigger["type"], trigger);
      patch({ trigger: next });
      if (next.type === "keyPress" && !next.key) setCapturing(true);
    }}>{triggerKinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
    {["mouseEnter", "mouseLeave", "mouseDown", "mouseUp"].includes(trigger.type) &&
      <NumberField label="Delay" unit="ms" value={delay} commit={v => patch({ delayMs: Math.round(Math.min(Math.max(v, 0), 600_000)) })} />}
    {trigger.type === "afterDelay" &&
      <NumberField label="Delay" unit="ms" value={trigger.ms} commit={v => patch({ trigger: { type: "afterDelay", ms: Math.round(Math.min(Math.max(v, 0), 600_000)) } })} />}
    {trigger.type === "keyPress" && <div>
      <button type="button" aria-label="Key" aria-pressed={capturing} onClick={() => setCapturing(true)}
        onKeyDown={e => {
          if (!capturing || ["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
          e.preventDefault();
          setCapturing(false);
          // Escape cancels when a key is already set; held modifiers make a combination (`Shift+K`).
          if (e.key === "Escape" && trigger.key) return;
          patch({ trigger: { type: "keyPress", key: keyCombo({ ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, cmd: e.metaKey }, keyName(e)) } });
        }}>{capturing ? "Press a key…" : trigger.key || "Click to record a key"}</button>
      <select aria-label="Controller" value={gamepadButtons.find(b => b.toLowerCase() === trigger.key.toLowerCase()) ?? ""}
        onChange={e => { setCapturing(false); patch({ trigger: { type: "keyPress", key: e.currentTarget.value } }); }}>
        <option value="" disabled>Controller</option>
        {gamepadButtons.map(b => <option key={b} value={b}>{b}</option>)}
      </select>
    </div>}
  </div>;
}

function NumberField({ label, unit, value, commit, min, max }: { label: string; unit?: string; value: number | undefined; commit: (v: number) => void; min?: number; max?: number }) {
  return <label>{label} <input type="number" aria-label={label} min={min} max={max} key={String(value)} defaultValue={value ?? ""} placeholder={value === undefined ? "Auto" : undefined}
    onBlur={e => { const raw = e.currentTarget.value; const v = Number(raw); if (raw !== "" && Number.isFinite(v) && v !== value) commit(v); }}
    onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} />{unit && <span> {unit}</span>}</label>;
}
function TextField({ label, value, commit, placeholder }: { label: string; value: string; commit: (v: string) => void; placeholder?: string }) {
  return <label>{label} <input aria-label={label} key={value} defaultValue={value} placeholder={placeholder}
    onBlur={e => { if (e.currentTarget.value !== value) commit(e.currentTarget.value); }}
    onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} /></label>;
}

function run(ctx: Ctx, path: readonly number[], command: string, extra: Record<string, unknown> = {}) {
  ctx.dispatch(command, { ids: ctx.ids, index: ctx.index, path, ...extra });
}
function setAction(ctx: Ctx, path: readonly number[], a: unknown) { run(ctx, path, "proto.action.set", { action: a }); }

/** Native `action_list`: the interaction's or a block's actions, then "Add action". */
function ActionList({ ctx, list, prefix }: { ctx: Ctx; list: readonly PrototypeAction[]; prefix: readonly number[] }) {
  const single = !prefix.length && list.length === 1;
  return <>
    <ol aria-label={prefix.length ? `Actions of block ${prefix.at(-1)! + 1}` : "Actions"}>{list.map((a, i) => {
      const path = [...prefix, i];
      const isOpen = single || (ctx.open + "/").startsWith(keyOf(path) + "/");
      return <ActionItem key={keyOf(path)} ctx={ctx} action={a} path={path} count={list.length} open={isOpen} single={single} />;
    })}</ol>
    <label>Add action <select aria-label={prefix.length ? `Add action to block ${prefix.at(-1)! + 1}` : "Add action"} value="" onChange={e => {
      const kind = e.currentTarget.value as ActionKind;
      const a = actionOf(kind, ctx.document, ctx.page, ctx.node);
      if (!a) { ctx.notice(unavailableAction(kind)); return; }
      const path = [...prefix, list.length];
      run(ctx, path, "proto.action.add", { action: wireAction(a) });
      ctx.setOpen(keyOf(path));
    }}><option value="" disabled>Add action</option>{actionKinds.map(k => <option key={k} value={k}>{k}</option>)}</select></label>
  </>;
}

function ActionItem({ ctx, action: a, path, count, open, single }: { ctx: Ctx; action: PrototypeAction; path: number[]; count: number; open: boolean; single: boolean }) {
  const i = path.at(-1)!, removable = path.length > 1 || count > 1, label = actionSummary(ctx.document, a);
  const parent = keyOf(path.slice(0, -2));
  return <li aria-label={label}>
    {!single && <button type="button" aria-expanded={open} aria-label={open ? `Close ${label}` : `Open ${label}`} onClick={() => ctx.setOpen(open ? parent : keyOf(path))}>{open ? "▾" : "▸"}</button>}
    {open ? <select aria-label="Action" value={actionLabel(a)} onChange={e => {
      const kind = e.currentTarget.value as ActionKind;
      const next = actionOf(kind, ctx.document, ctx.page, ctx.node, a);
      if (next) setAction(ctx, path, wireAction(next)); else ctx.notice(unavailableAction(kind));
    }}>{actionKinds.map(k => <option key={k} value={k}>{k}</option>)}</select>
      : <button type="button" onClick={() => ctx.setOpen(keyOf(path))}>{label}</button>}
    {!single && <>
      {i > 0 && <button type="button" aria-label={`Move ${label} up`} onClick={() => run(ctx, path, "proto.action.move", { to: i - 1 })}>↑</button>}
      {i + 1 < count && <button type="button" aria-label={`Move ${label} down`} onClick={() => run(ctx, path, "proto.action.move", { to: i + 1 })}>↓</button>}
      {removable && <button type="button" aria-label={`Remove ${label}`} onClick={() => { run(ctx, path, "proto.action.remove"); ctx.setOpen(parent); }}>Remove</button>}
    </>}
    {open && <div className="figcraft-action-fields">
      {a.type === "conditional" ? <ConditionalBlocks ctx={ctx} path={path} blocks={a.blocks} />
        : a.type === "setVariable" ? <SetVariableFields ctx={ctx} path={path} action={a} />
        : <ActionFields ctx={ctx} path={path} action={a} />}
    </div>}
  </li>;
}

function Destination({ ctx, label, options, current, make, path }: { ctx: Ctx; label: string; options: readonly NodeId[]; current: NodeId; make: (d: NodeId) => PrototypeAction; path: number[] }) {
  return <label>{label} <select aria-label={label} value={current} onChange={e => setAction(ctx, path, wireAction(make(e.currentTarget.value)))}>
    {!options.includes(current) && <option value={current}>{ctx.document.nodes[current]?.name ?? "Missing layer"}</option>}
    {options.map(d => <option key={d} value={d}>{ctx.document.nodes[d]?.name ?? "Missing layer"}</option>)}
  </select></label>;
}

/** Native `action_fields`. */
function ActionFields({ ctx, path, action: a }: { ctx: Ctx; path: number[]; action: PrototypeAction }) {
  const doc = ctx.document, frames = topFrames(doc, ctx.page);
  switch (a.type) {
    case "navigate": return <>
      <Destination ctx={ctx} label="Destination" options={navigationTargets(doc, ctx.page)} current={a.dest} make={d => ({ ...a, dest: d })} path={path} />
      <label><input type="checkbox" checked={a.preserve_scroll === true} onChange={() => setAction(ctx, path, wireAction({ type: "navigate", dest: a.dest, ...(!a.preserve_scroll && { preserve_scroll: true as const }) }))} /> Preserve scroll position</label>
    </>;
    case "swapOverlay": return <Destination ctx={ctx} label="Overlay" options={frames} current={a.dest} make={d => ({ type: "swapOverlay", dest: d })} path={path} />;
    case "changeTo": return <Destination ctx={ctx} label="Variant" options={variantsFor(doc, ctx.node)} current={a.dest} make={d => ({ type: "changeTo", dest: d })} path={path} />;
    case "scrollTo": {
      const top = topLevelFrame(doc, ctx.node), layers = top !== undefined ? subtreeIds(doc, top).slice(1, 401) : [];
      const offset = a.offset ?? [0, 0];
      const withOffset = (i: number, v: number) => wireAction({ ...a, offset: i ? [offset[0], v] : [v, offset[1]] });
      return <>
        <Destination ctx={ctx} label="Scroll to layer" options={layers} current={a.dest} make={d => ({ ...a, dest: d })} path={path} />
        <NumberField label="Offset X" value={offset[0]} commit={v => setAction(ctx, path, withOffset(0, Math.round(Math.min(Math.max(v, -1e5), 1e5))))} />
        <NumberField label="Offset Y" value={offset[1]} commit={v => setAction(ctx, path, withOffset(1, Math.round(Math.min(Math.max(v, -1e5), 1e5))))} />
      </>;
    }
    case "openUrl": return <>
      <TextField label="Link" value={a.url} placeholder="https://" commit={u => setAction(ctx, path, { ...a, url: u.trim() })} />
      <label><input type="checkbox" checked={a.new_tab !== false} onChange={() => setAction(ctx, path, { type: "openUrl", url: a.url, ...(a.new_tab !== false && { openInNewTab: false }) })} /> Open in new tab</label>
    </>;
    case "openOverlay": {
      const set = (changes: Partial<typeof a>) => setAction(ctx, path, wireAction({ ...a, ...changes } as PrototypeAction));
      const anchor = a.anchor ?? "screen";
      const bg = a.background;
      return <>
        <Destination ctx={ctx} label="Overlay" options={frames} current={a.dest} make={d => ({ ...a, dest: d })} path={path} />
        <label>Overlay position <select aria-label="Overlay position" value={a.position} onChange={e => set({ position: e.currentTarget.value as typeof a.position })}>
          {overlayPositions.map(p => <option key={p} value={p}>{positionLabels[p]}</option>)}</select></label>
        {a.position !== "manual" && <label>Relative to <select aria-label="Relative to" value={anchor} onChange={e => { const v = e.currentTarget.value; set({ anchor: v === "screen" ? undefined : v as "triggerInside" | "triggerOutside" }); }}>
          <option value="screen">Whole screen</option><option value="triggerInside">Trigger layer, inside</option><option value="triggerOutside">Trigger layer, outside</option></select></label>}
        {a.position === "manual" && <>
          <NumberField label="Overlay X" value={a.offset?.[0]} commit={v => set({ offset: [Math.round(Math.min(Math.max(v, -1e5), 1e5)), a.offset?.[1] ?? 0] })} />
          <NumberField label="Overlay Y" value={a.offset?.[1]} commit={v => set({ offset: [a.offset?.[0] ?? 0, Math.round(Math.min(Math.max(v, -1e5), 1e5))] })} />
        </>}
        <label><input type="checkbox" checked={a.close_on_outside} onChange={() => set({ close_on_outside: !a.close_on_outside })} /> Close when clicking outside</label>
        <label><input type="checkbox" checked={!!bg} onChange={() => set({ background: bg ? null : { r: 0, g: 0, b: 0, a: Math.fround(0.25) } })} /> Add background behind overlay</label>
        {bg && <>
          <TextField label="Overlay background" value={toCssHex({ ...bg, a: 1 }).slice(1)} commit={h => { const c = parseColour(/^[0-9a-f]{3,8}$/i.test(h) ? "#" + h : h); if (c) set({ background: { ...c, a: bg.a } }); }} />
          <NumberField label="Overlay background opacity" unit="%" value={Math.round(bg.a * 100)} commit={v => set({ background: { ...bg, a: Math.fround(Math.min(Math.max(v, 0), 100) / 100) } })} />
        </>}
      </>;
    }
    case "setVariableMode": {
      const vars = doc.variables ?? emptyVariables, current = vars.collections.find(c => c.id === a.collection);
      return <>
        <label>Collection <select aria-label="Collection" value={current?.id ?? ""} onChange={e => {
          const c = vars.collections.find(x => x.id === e.currentTarget.value), m = c?.modes[0];
          if (c && m) setAction(ctx, path, { type: "setVariableMode", collection: c.id, mode: m.id });
        }}>{!current && <option value="" disabled>Choose collection</option>}{vars.collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Mode <select aria-label="Mode" value={current?.modes.some(m => m.id === a.mode) ? a.mode : ""} onChange={e => setAction(ctx, path, { type: "setVariableMode", collection: a.collection, mode: e.currentTarget.value })}>
          <option value="" disabled>Choose mode</option>{(current?.modes ?? []).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      </>;
    }
    default: return null;
  }
}

/** Native `expr_field`: an expression typed as text, checked before it is used; the message under it. */
function ExpressionField({ ctx, label, current, placeholder, check, commit }: { ctx: Ctx; label: string; current?: PrototypeExpression; placeholder: string;
  check: (e: PrototypeExpression) => void; commit: (text: string) => void }) {
  const vars = ctx.document.variables ?? emptyVariables;
  const shown = current ? displayExpression(current, vars) : "";
  const [draft, setDraft] = useState<{ text: string; error: string } | null>(null);
  return <div>
    <label>{label} <input aria-label={label} key={shown} defaultValue={draft?.text ?? shown} placeholder={placeholder} aria-invalid={!!draft}
      onBlur={e => {
        const text = e.currentTarget.value;
        if (text === shown) { setDraft(null); return; }
        try { const parsed = parseExpression(text, vars); check(parsed); setDraft(null); commit(text); }
        catch (error) { setDraft({ text, error: (error as Error).message }); }
      }}
      onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} /></label>
    {draft && <p role="alert">{draft.error}</p>}
  </div>;
}

function ConditionalBlocks({ ctx, path, blocks }: { ctx: Ctx; path: number[]; blocks: readonly { condition?: PrototypeExpression; actions: readonly PrototypeAction[] }[] }) {
  const vars = ctx.document.variables ?? emptyVariables;
  const hasElse = blocks.length > 0 && !blocks[blocks.length - 1].condition;
  return <div>
    {blocks.map((b, i) => {
      const label = b.condition ? i === 0 ? "If" : "Else if" : "Else";
      return <div key={i} className="figcraft-conditional-block" aria-label={`${label}, block ${i + 1}`} role="group">
        <strong>{label}</strong>
        <button type="button" aria-label={b.condition ? `Remove condition ${i + 1} and its actions` : "Remove the else and its actions"}
          onClick={() => run(ctx, path, "proto.conditional.removeBlock", { block: i })}>−</button>
        {b.condition && <ExpressionField ctx={ctx} label={`Condition ${i + 1}`} current={b.condition} placeholder="e.g. count >= 3 and not done"
          check={e => checkCondition(e, vars)} commit={text => run(ctx, path, "proto.conditional.setCondition", { block: i, expression: text })} />}
        <ActionList ctx={ctx} list={b.actions} prefix={[...path, i]} />
      </div>;
    })}
    <button type="button" title="Add another condition" onClick={() => run(ctx, path, "proto.conditional.addBlock")}>Else if</button>
    {!hasElse && <button type="button" title="Add actions for when no condition holds" onClick={() => run(ctx, path, "proto.conditional.addBlock", { else: true })}>Else</button>}
  </div>;
}

function LiteralField({ label, value, commit }: { label: string; value: VariableValue; commit: (v: unknown) => void }) {
  switch (value.type) {
    case "number": return <NumberField label={label} value={value.value} commit={commit} />;
    case "boolean": return <label>{label} <select aria-label={label} value={String(value.value)} onChange={e => commit(e.currentTarget.value === "true")}>
      <option value="true">true</option><option value="false">false</option></select></label>;
    case "color": return <TextField label={label} value={toCssHex({ ...value.value, a: 1 }).slice(1)} commit={h => { const c = parseColour(/^[0-9a-f]{3,8}$/i.test(h) ? "#" + h : h); if (c) commit(toCssHex(c)); }} />;
    case "string": return <TextField label={label} value={value.value} placeholder="Text" commit={commit} />;
    default: return null;
  }
}

/** Native `set_variable_fields`: the variable, and a fixed value or an expression. */
function SetVariableFields({ ctx, path, action: a }: { ctx: Ctx; path: number[]; action: Extract<PrototypeAction, { type: "setVariable" }> }) {
  const vars = ctx.document.variables ?? emptyVariables, v = variableById(vars, a.variable);
  const set = (value: unknown, expression?: string) => setAction(ctx, path, { type: "setVariable", variable: a.variable, value, ...(expression !== undefined && { expression }) });
  return <>
    <label>Variable <select aria-label="Variable" value={v?.id ?? ""} onChange={e => {
      const picked = variableById(vars, e.currentTarget.value);
      if (!picked) return;
      const same = v?.resolvedType === picked.resolvedType;
      const start = startOf(ctx, picked.id);
      setAction(ctx, path, same ? { ...a, variable: picked.id, ...(a.expr && { expr: undefined, expression: displayExpression(a.expr, vars) }) } : { type: "setVariable", variable: picked.id, value: start });
    }}>{!v && <option value="" disabled>Choose variable</option>}{vars.variables.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
    {v && (a.expr ? <>
      <ExpressionField ctx={ctx} label="Expression" current={a.expr} placeholder="e.g. count + 1" check={e => checkValue(e, vars, v.resolvedType)} commit={text => set(a.value, text)} />
      <button type="button" aria-pressed={true} title="Use a fixed value" onClick={() => set(a.expr && "value" in a.expr && a.expr.value.type === v.resolvedType ? valueJson(a.expr.value) : a.value ?? startOf(ctx, v.id))}>Expression</button>
    </> : <>
      <LiteralField label="Value" value={literal(v.resolvedType, a.value) ?? { type: "string", value: "" }} commit={value => set(value)} />
      <button type="button" aria-pressed={false} title="Use an expression, e.g. count + 1" onClick={() => setAction(ctx, path, { ...a, expr: { value: { type: "alias", value: v.id } } })}>Expression</button>
    </>)}
  </>;
}
function startOf(ctx: Ctx, variable: string) {
  const vars = ctx.document.variables ?? emptyVariables, a = actionOf("Set variable", { ...ctx.document, variables: { ...vars, variables: vars.variables.filter(x => x.id === variable) } }, ctx.page, ctx.node);
  return a?.type === "setVariable" ? a.value : null;
}

/** Native `animation_rows`: transition, direction, easing, duration and a custom curve's or spring's settings. */
function AnimationRows({ it, patch }: { it: PrototypeInteraction; patch: (f: Record<string, unknown>) => void }) {
  const t = it.transition, e = it.easing, spring = easingSpring(e);
  return <div>
    <h4>Animation</h4>
    <label>Animation <select aria-label="Animation" value={t.type} onChange={ev => patch({ transition: transitionOf(ev.currentTarget.value as PrototypeTransition["type"], t) })}>
      {transitions.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
    {"direction" in t && <label>Direction <select aria-label="Direction" value={t.direction} onChange={ev => patch({ transition: { ...t, direction: ev.currentTarget.value } })}>
      <option value="left">Left</option><option value="right">Right</option><option value="top">Up</option><option value="bottom">Down</option></select></label>}
    {t.type !== "instant" && <>
      <label>Easing <select aria-label="Easing" value={easingKey(e)} onChange={ev => {
        const key = ev.currentTarget.value;
        // Keep the current custom values when re-picking the same custom kind.
        patch({ easing: key === easingKey(e) ? e : key === "customBezier" ? customBezier : key === "customSpring" ? customSpring : key });
      }}>{[...easingNames, "customBezier", "customSpring"].map(k => <option key={k} value={k}>{easingLabels[k]}</option>)}</select></label>
      {spring ? <span title="A spring plays until it settles: its mass, stiffness and damping set how long">{Math.round(easingSeconds(e, it.duration_ms) * 1000)} ms</span>
        : <NumberField label="Duration" unit="ms" value={it.duration_ms} commit={v => patch({ durationMs: Math.round(Math.min(Math.max(v, 1), 10_000)) })} />}
      {typeof e !== "string" && "customBezier" in e && (["x1", "y1", "x2", "y2"] as const).map(k => <NumberField key={k} label={k.toUpperCase()} value={Math.round(e.customBezier[k] * 100) / 100}
        commit={v => patch({ easing: { customBezier: { ...e.customBezier, [k]: k.startsWith("x") ? Math.min(Math.max(v, 0), 1) : Math.min(Math.max(v, -5), 5) } } })} />)}
      {typeof e !== "string" && "customSpring" in e && ([["mass", "Mass", 0.01, 100], ["stiffness", "Stiffness", 1, 10_000], ["damping", "Damping", 0, 1000]] as const).map(([k, l, lo, hi]) =>
        <NumberField key={k} label={l} value={Math.round(e.customSpring[k] * 100) / 100} commit={v => patch({ easing: { customSpring: { ...e.customSpring, [k]: Math.min(Math.max(v, lo), hi) } } })} />)}
    </>}
  </div>;
}

export type { PageNode };
