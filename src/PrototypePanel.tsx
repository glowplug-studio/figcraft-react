import { useState } from "react";
import { toCssHex } from "./engine/colour";
import { defaultPrototypeBackground, isFrameLike, type Document, type DocumentNode, type NodeId, type PageNode } from "./engine/document";
import { topFrames, topLevelFrame } from "./engine/prototype-commands";
import { customDevice, defaultPrototypeDevice, deviceColour, deviceModel, devices } from "./engine/prototype-settings";
import { interactionSummary, interactionTargets, newInteractionAction, triggerSummary } from "./engine/prototype-summaries";
import { InteractionEditor } from "./InteractionEditor";

export interface PrototypePanelProps {
  document: Document;
  selection: readonly NodeId[];
  editable: boolean;
  dispatch: (command: string, params?: unknown) => void;
}

const wire = (id: NodeId) => Number(id);
const hex = (c: { r: number; g: number; b: number; a: number }) => toCssHex({ ...c, a: 1 });

/** Source: upstream ui-egui/src/panels/proto_panel.rs: the Prototype tab (flows, settings, interactions, scroll behaviour). */
export function PrototypePanel({ document, selection, editable, dispatch }: PrototypePanelProps) {
  const page = document.nodes[document.currentPage] as PageNode;
  if (!selection.length) return <>
    <FlowsOverview document={document} page={page} editable={editable} dispatch={dispatch} />
    <Settings page={page} editable={editable} dispatch={dispatch} />
  </>;
  const first = selection[0], node = document.nodes[first];
  if (!node) return null;
  const mixed = selection.some(id => JSON.stringify(document.nodes[id]?.interactions ?? []) !== JSON.stringify(node.interactions ?? []));
  return <>
    {topLevelFrame(document, first) === first && <FlowSection key={first} document={document} page={page} frame={first} editable={editable} dispatch={dispatch} />}
    {mixed ? <MixedInteractions document={document} page={page} selection={selection} editable={editable} dispatch={dispatch} />
      : <Interactions key={first} document={document} page={page} selection={selection} node={node} editable={editable} dispatch={dispatch} />}
    <ScrollSection document={document} selection={selection} node={node} editable={editable} dispatch={dispatch} />
  </>;
}

type Common = { editable: boolean; dispatch: PrototypePanelProps["dispatch"] };

function FlowRow({ flow, editable, dispatch }: Common & { flow: { name: string; start: NodeId; description: string } }) {
  const [name, setName] = useState<string | null>(null);
  const commit = () => { if (name !== null && name.trim() && name !== flow.name) dispatch("proto.flow.rename", { start: wire(flow.start), name }); setName(null); };
  return <li className="figcraft-flow">
    <button type="button" disabled={!editable} aria-label={`Present ${flow.name}`} title="Present this flow" onClick={() => dispatch("proto.present", { start: wire(flow.start) })}>Present</button>
    <input aria-label="Flow name" value={name ?? flow.name} disabled={!editable} onChange={e => setName(e.currentTarget.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setName(null); }} />
    <button type="button" disabled={!editable} aria-label={`Preview ${flow.name}`} title="Preview this flow" onClick={() => dispatch("proto.preview", { start: wire(flow.start) })}>Preview</button>
    <button type="button" disabled={!editable} aria-label={`Remove starting point ${flow.name}`} title="Remove starting point" onClick={() => dispatch("proto.flow.remove", { start: wire(flow.start) })}>Remove</button>
  </li>;
}

function FlowsOverview({ document, page, editable, dispatch }: Common & { document: Document; page: PageNode }) {
  const [note, setNote] = useState("");
  const flows = page.flows ?? [];
  const add = () => {
    const free = topFrames(document, page.id).find(f => !flows.some(x => x.start === f));
    if (free === undefined) { setNote("Every top-level frame already starts a flow"); return; }
    setNote("");
    dispatch("proto.flow.add", { start: wire(free) });
  };
  return <section aria-label="Flow starting points">
    <h3>Flow starting points <button type="button" disabled={!editable} aria-label="Add starting point" onClick={add}>+</button></h3>
    {note && <p role="status">{note}</p>}
    {!flows.length && <p>Select a frame and add a starting point to present it as a flow.</p>}
    <ul>{flows.map(f => <FlowItem key={f.start} flow={f} editable={editable} dispatch={dispatch} />)}</ul>
  </section>;
}
function FlowItem(props: Common & { flow: { name: string; start: NodeId; description: string } }) {
  const d = props.flow.description.trim();
  return <><FlowRow {...props} />{d && <li className="figcraft-flow-description" title={d}>{d}</li>}</>;
}

function Settings({ page, editable, dispatch }: Common & { page: PageNode }) {
  const settings = page.prototypeDevice ?? defaultPrototypeDevice;
  const background = page.prototypeBackground ?? defaultPrototypeBackground;
  const model = deviceModel(settings), colour = deviceColour(settings);
  const landscape = settings.rotation === "landscape" && !!model?.rotates;
  const [bg, setBg] = useState<string | null>(null);
  return <section aria-label="Prototype settings">
    <h3>Prototype settings <button type="button" disabled={!editable} aria-label="Open prototype preview" onClick={() => dispatch("proto.preview", {})}>Preview</button></h3>
    <label>Device <select aria-label="Device" disabled={!editable} value={settings.device} onChange={e => dispatch("proto.settings", { device: e.currentTarget.value })}>
      <option value="None">None</option>
      {devices.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
      <option value={customDevice}>{customDevice}</option>
    </select></label>
    {model?.rotates && <button type="button" disabled={!editable} aria-pressed={landscape} aria-label={landscape ? "Rotate to portrait" : "Rotate to landscape"}
      onClick={() => dispatch("proto.settings", { rotation: landscape ? "portrait" : "landscape" })}>Rotate</button>}
    {model && model.colors.length > 0 && <label>Color <select aria-label="Device color" disabled={!editable} value={colour?.name ?? ""}
      onChange={e => dispatch("proto.settings", { color: e.currentTarget.value })}>
      {model.colors.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
    </select></label>}
    {settings.device === customDevice && model && <CustomSize width={model.width} height={model.height} editable={editable} dispatch={dispatch} />}
    <label title="Resize frames to the device's screen (or the window without a device): their constraints and auto layout respond">
      <input type="checkbox" disabled={!editable} checked={settings.responsive} onChange={() => dispatch("proto.settings", { responsive: !settings.responsive })} /> Responsive</label>
    <label>Background <input aria-label="Prototype background" disabled={!editable} value={bg ?? hex(background).slice(1)}
      onChange={e => setBg(e.currentTarget.value)}
      onBlur={() => { if (bg !== null) dispatch("proto.settings", { background: bg.startsWith("#") || !/^[0-9a-f]{3,8}$/i.test(bg) ? bg : "#" + bg }); setBg(null); }}
      onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} /></label>
  </section>;
}
function CustomSize({ width, height, editable, dispatch }: Common & { width: number; height: number }) {
  const field = (key: "width" | "height", lead: string, value: number) => <label key={key}>{lead} <input type="number" min={1} max={10000} aria-label={key === "width" ? "Custom width" : "Custom height"}
    disabled={!editable} defaultValue={value} onBlur={e => { const v = Number(e.currentTarget.value); if (Number.isFinite(v) && v >= 1 && v !== value) dispatch("proto.settings", { [key]: v }); }} /></label>;
  return <div key={`${width}x${height}`}>
    {field("width", "W", width)}{field("height", "H", height)}
    <button type="button" disabled={!editable || width === height} aria-label="Swap width and height" onClick={() => dispatch("proto.settings", { width: height, height: width })}>Swap</button>
  </div>;
}

function FlowSection({ document, page, frame, editable, dispatch }: Common & { document: Document; page: PageNode; frame: NodeId }) {
  const mine = page.flows?.find(f => f.start === frame);
  const [description, setDescription] = useState<string | null>(null);
  return <section aria-label="Flow starting point">
    <h3>Flow starting point {!mine && <>
      <button type="button" disabled={!editable} aria-label="Preview this frame" onClick={() => dispatch("proto.preview", { start: wire(frame) })}>Preview</button>
      <button type="button" disabled={!editable} aria-label="Add starting point" onClick={() => dispatch("proto.flow.add", { start: wire(frame) })}>+</button></>}</h3>
    {mine && <ul><FlowRow flow={mine} editable={editable} dispatch={dispatch} /></ul>}
    {mine && <input aria-label="Flow description" placeholder="Add a description" disabled={!editable} value={description ?? mine.description}
      onChange={e => setDescription(e.currentTarget.value)}
      onBlur={() => { if (description !== null && description !== mine.description) dispatch("proto.flow.rename", { start: wire(frame), description }); setDescription(null); }}
      onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} />}
    {!mine && document.nodes[frame] && null}
  </section>;
}

function MixedInteractions({ document, page, selection, editable, dispatch }: Common & { document: Document; page: PageNode; selection: readonly NodeId[] }) {
  const ids = selection.map(wire);
  return <section aria-label="Interactions">
    <h3>Interactions <button type="button" disabled={!editable} aria-label="Replace with a new interaction" onClick={() => {
      dispatch("proto.interaction.clear", { ids });
      dispatch("proto.interaction.add", { ids, trigger: { type: "onClick" }, action: wireAction(newInteractionAction(document, page.id, selection[0])) });
    }}>+</button></h3>
    <p>Mixed interactions: click + to replace them</p>
    <button type="button" disabled={!editable} onClick={() => dispatch("proto.interaction.clear", { ids })}>Remove all</button>
  </section>;
}
const wireAction = (a: ReturnType<typeof newInteractionAction>) => "dest" in a ? { ...a, dest: wire(a.dest) } : a;

function Interactions({ document, page, selection, node, editable, dispatch }: Common & { document: Document; page: PageNode; selection: readonly NodeId[]; node: DocumentNode }) {
  const list = node.interactions ?? [];
  const ids = interactionTargets(document, selection, node.id).map(wire);
  // Native `open_editor`: the interaction whose editor shows (a new one opens on Add).
  const [open, setOpen] = useState<number | null>(null);
  const shown = open !== null && open < list.length ? open : null;
  return <section aria-label="Interactions">
    <h3>Interactions <button type="button" disabled={!editable} aria-label="Add interaction"
      onClick={() => { dispatch("proto.interaction.add", { ids, trigger: { type: "onClick" }, action: wireAction(newInteractionAction(document, page.id, node.id)) }); setOpen(list.length); }}>+</button></h3>
    <ul>{list.map((it, i) => <li key={i} className="figcraft-interaction">
      <button type="button" aria-pressed={shown === i} aria-label={`Edit interaction ${i + 1}: ${triggerSummary(it.trigger)}, ${interactionSummary(document, it)}`} onClick={() => setOpen(shown === i ? null : i)}>
        <span className="figcraft-interaction-trigger">{triggerSummary(it.trigger)}</span>
        <span className="figcraft-interaction-actions">{interactionSummary(document, it)}</span>
      </button>
      <button type="button" disabled={!editable} aria-label={`Remove interaction ${i + 1}`} title="Remove interaction" onClick={() => { setOpen(null); dispatch("proto.interaction.remove", { ids, index: i }); }}>−</button>
    </li>)}</ul>
    {shown !== null && <InteractionEditor key={shown} document={document} node={node.id} index={shown} interaction={list[shown]} ids={ids} editable={editable} dispatch={dispatch} close={() => setOpen(null)} />}
  </section>;
}

function ScrollSection({ document, selection, node, editable, dispatch }: Common & { document: Document; selection: readonly NodeId[]; node: DocumentNode }) {
  const parent = node.parent != null ? document.nodes[node.parent] : undefined;
  const inFrame = !!parent && parent.kind !== "page" && isFrameLike(parent);
  const isFrame = node.kind !== "page" && isFrameLike(node);
  if (!inFrame && !isFrame) return null;
  const ids = selection.map(wire);
  return <section aria-label="Scroll behavior">
    <h3>Scroll behavior</h3>
    {inFrame && <label>Position <select aria-label="Scroll position" disabled={!editable} value={(node as { scrollPosition?: string }).scrollPosition ?? "scrolls"}
      onChange={e => dispatch("node.set", { ids, props: { scrollPosition: e.currentTarget.value } })}>
      <option value="scrolls">Scroll with parent</option><option value="fixed">Fixed</option><option value="sticky">Sticky</option>
    </select></label>}
    {isFrame && <label>Overflow <select aria-label="Overflow" disabled={!editable} value={(node as { overflow?: string }).overflow ?? "none"}
      onChange={e => dispatch("node.set", { ids, props: { overflow: e.currentTarget.value } })}>
      <option value="none">No scrolling</option><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option><option value="both">Both directions</option>
    </select></label>}
  </section>;
}
