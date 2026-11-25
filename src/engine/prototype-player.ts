import type { Colour } from "./colour";
import { type Document, type InstanceNode, type NodeId } from "./document";
import { HierarchyDraft, subtreeIds } from "./hierarchy";
import { rebuildInstance } from "./component-sync";
import type { PrototypeAction, PrototypeEasing, PrototypeTransition, overlayPositions } from "./prototype-data";
import { easingSeconds, evalEasing, reversedTransition, usesGamepad } from "./prototype-model";
import { branch, changeToTarget, navigateTarget, playInteractions, rememberSections, setModeById, setVariable } from "./prototype-runtime";
import { applyScroll, clampScroll, fitViewport, flingAxis, raiseFixed, scrollRangeIn, scrollToLayer, viewport, type Scroller } from "./prototype-scroll";
import { isFrameLike } from "./document";
import { setRectangleProperties } from "./properties";
import type { PresentOptions } from "./prototype-commands";
import { openableDocumentUrl } from "./text-link";

/** Source: upstream ui-egui/src/present.rs, present/{navigate,actions}.rs: the player's state, without drawing. */
export const maxActionDepth = 16;
type Pair = readonly [number, number];
export interface PageRect { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }
/** A page in the player's history: what Back returns to, and how. */
export interface Visit { readonly frame: NodeId; readonly transition: PrototypeTransition; readonly dur: number; readonly easing: PrototypeEasing }
/** An open overlay (native `OverlayState`). */
export interface OverlayState {
  id: NodeId; readonly position: typeof overlayPositions[number]; readonly closeOnOutside: boolean; readonly background: Colour | null;
  /** The layer that opened it, in page units of the presented frame. */
  readonly anchor?: PageRect; readonly offset?: Pair; readonly anchorTo: "screen" | "triggerInside" | "triggerOutside";
  opened: number; transition: PrototypeTransition; dur: number; easing: PrototypeEasing;
}
/** A transition in progress from the frame shown before (the presenter draws it). */
export interface Animation { readonly fromDoc: Document; readonly fromFrame: NodeId; readonly transition: PrototypeTransition; readonly start: number; readonly dur: number; readonly easing: PrototypeEasing }
export interface ScrollAnimation { readonly frames: [NodeId, Pair, Pair][]; readonly start: number; readonly dur: number; readonly easing: PrototypeEasing }
interface Snapshot { readonly current: NodeId; readonly doc: Document; readonly overlays: OverlayState[]; readonly history: Visit[]; readonly scroll: Map<NodeId, Pair> }
/** A "while hovering / while pressing" state that reverts when the pointer leaves or lifts. */
interface Temp { readonly rect: PageRect; readonly press: boolean; readonly snap: Snapshot; readonly transition: PrototypeTransition; readonly dur: number; readonly easing: PrototypeEasing }
interface Waiting { readonly node: NodeId; readonly k: number; readonly rect?: PageRect; readonly root: NodeId; readonly due: number }
/** Native `Fling`: a scroller carrying on after a drag or the wheel let go (units/s), springing back from past its ends with `bounce`. */
export interface Fling { readonly target: Scroller; vel: Pair; readonly decay: number; readonly bounce: boolean; at: number }
/** Native `cmd::proto::respond`: a responsive prototype's frame resized to a screen of `(w, h)`, its constraints and auto layout responding. */
export function respond(doc: Document, frame: NodeId, [w, h]: Pair): Document {
  const n = doc.nodes[frame];
  if (!Number.isFinite(w) || !Number.isFinite(h) || !n || n.kind === "page" || !isFrameLike(n)) return doc;
  const width = Math.min(Math.max(w, 1), 100_000), height = Math.min(Math.max(h, 1), 100_000);
  if (Math.abs(n.width - width) < 1e-9 && Math.abs(n.height - height) < 1e-9) return doc;
  try { return setRectangleProperties(doc, [frame], { width, height }); } catch { return doc; }
}
/** A link an action opened: whether the viewer's own input fired it, and whether it opens in a new tab. */
export interface OpenedLink { readonly url: string; asked: boolean; readonly newTab: boolean }
const defaultView: PresentOptions = Object.freeze({ scale: "fit", deviceFrame: true, hotspotHints: true, inspect: false, hideUi: false });
const delaySeconds = (it: { trigger: { type: string }; delay_ms?: number }) =>
  ["mouseEnter", "mouseLeave", "mouseDown", "mouseUp"].includes(it.trigger.type) ? Math.min(it.delay_ms ?? 0, 600_000) / 1000 : 0;
/** Native `doc_urls::openable`: only a web or mail link is opened from a prototype. */
export const openableUrl = openableDocumentUrl;

export class PrototypePlayer {
  current: NodeId;
  history: Visit[] = [];
  overlays: OverlayState[] = [];
  /** Overlays playing their opening transition backwards after being closed (closed at, state). */
  closing: [number, OverlayState][] = [];
  /** Scroll offsets of frames with overflow (page units). */
  scroll = new Map<NodeId, Pair>();
  scrollAnim?: ScrollAnimation;
  anim?: Animation;
  view: PresentOptions = defaultView;
  /** Native `pan`: how far the whole view has panned (screen points), when what shows is bigger than the window. */
  pan?: Pair;
  /** Native `pan_range`, `zoom`: how far the view can pan, and the scale it shows at (both set by the layout). */
  panRange: Pair = [0, 0];
  zoom = 1;
  /** Native `fit`: the screen a responsive prototype's frame is resized to. */
  fit?: Pair;
  fling?: Fling;
  /** Native `wheel`: the wheel's smoothed speed while it scrolls `target`. */
  wheel?: [Scroller, Pair];
  /** Native `drag_scroll`: a drag scrolling `target` from its offset when the drag began. */
  dragScroll?: [Scroller, Pair];
  /** Links the last actions opened, for the presenter's link notice. */
  urls: OpenedLink[] = [];
  rev = 0;
  usesPads = false;
  #start: NodeId;
  #source?: Document;
  #original?: Document;
  /** The document as designed, with what the prototype changed; `doc` is it laid out for the screen. */
  #design?: Document;
  doc?: Document;
  #display?: [number, Document];
  #temp?: Temp;
  #arrived = -1;
  delaysFired = new Set<string>();
  waiting: Waiting[] = [];
  hovered: NodeId[] = [];
  #sections = new Map<NodeId, NodeId>();

  constructor(start: NodeId) { this.current = start; this.#start = start; }
  /** The frame the presentation started from (Restart goes back there). */
  get start() { return this.#start; }
  get arrived() { return this.#arrived; }
  get temp() { return this.#temp; }

  /** Native `sync`: copy the editor's document when it changed, keeping what still exists; runtime state starts over from the edit. */
  sync(doc: Document, now: number) {
    if (this.#source === doc) return;
    const first = !this.#source;
    this.#source = doc;
    this.#original = doc;
    this.#design = doc;
    this.relayout();
    if (first) { this.#arrived = now; return; }
    const has = (id: NodeId) => Object.hasOwn(doc.nodes, id);
    if (!has(this.current)) { if (has(this.#start)) this.restart(this.#start, now); return; }
    this.history = this.history.filter(v => has(v.frame));
    this.overlays = this.overlays.filter(o => has(o.id));
    this.closing = this.closing.filter(([, o]) => has(o.id));
    this.#temp = undefined; this.anim = undefined; this.scrollAnim = undefined;
    this.stopScrolling();
    for (const f of [...this.scroll.keys()]) if (!has(f)) this.scroll.delete(f);
    if (this.doc) for (const [f, s] of this.scroll) this.scroll.set(f, clampScroll(s, this.range(this.doc, f)));
    this.rev++;
  }
  /** Native `relayout`: instances play their variants' interactions and fixed layers draw on top. */
  relayout() {
    const d = this.#design && this.fit ? respond(this.#design, this.current, this.fit) : this.#design;
    this.doc = d ? raiseFixed(playInteractions(d)) : undefined;
    this.usesPads = !!this.doc && usesGamepad(this.doc);
    this.rev++;
  }
  /** Native `range`: how far `frame` scrolls; the presented frame on a device scrolls through its whole height. */
  range(doc: Document, frame: NodeId): Pair {
    return scrollRangeIn(doc, frame, frame === this.current ? viewport(doc, frame) : undefined);
  }
  /** Native `offset`: a frame's scroll, else the view's pan (centred across until panned). */
  offset(t: Scroller): Pair { return t === "view" ? this.pan ?? [this.panRange[0] / 2, 0] : this.scroll.get(t) ?? [0, 0]; }
  /** Native `limits`: how far `t` scrolls (`base`: the player's document without scroll offsets). */
  limits(base: Document, t: Scroller): Pair { return t === "view" ? this.panRange : this.range(base, t); }
  /** Native `set_offset`. */
  setOffset(t: Scroller, v: Pair) {
    if (!Number.isFinite(v[0]) || !Number.isFinite(v[1])) return;
    if (t === "view") { this.pan = v; return; }
    const cur = this.scroll.get(t);
    if (!cur || cur[0] !== v[0] || cur[1] !== v[1]) { this.scroll.set(t, v); this.rev++; }
  }
  /** Native `step_fling`: move a fling on to `now`; true while it still moves. */
  stepFling(now: number): boolean {
    const f = this.fling;
    this.fling = undefined;
    if (!f || !this.doc) return false;
    const r = this.limits(this.doc, f.target), x = this.offset(f.target);
    const dt = Math.min(Math.max(now - f.at, 0), 0.25);
    f.at = now;
    const [nx, vx, doneX] = flingAxis(x[0], f.vel[0], r[0], dt, f.decay, f.bounce);
    const [ny, vy, doneY] = flingAxis(x[1], f.vel[1], r[1], dt, f.decay, f.bounce);
    this.setOffset(f.target, [nx, ny]);
    f.vel = [vx, vy];
    if (doneX && doneY) return false;
    this.fling = f;
    return true;
  }
  /** Native `stop_scrolling`. */
  stopScrolling() { this.fling = undefined; this.wheel = undefined; this.dragScroll = undefined; }
  /** Native `set_scale`: size the prototype another way; the view starts over at its top. */
  setScale(scale: PresentOptions["scale"]) { this.view = { ...this.view, scale }; this.pan = undefined; this.stopScrolling(); }
  /** Native `reset_for_device`: a new device starts at its top, without the old screen's scroll or drag. */
  resetForDevice() { this.pan = undefined; this.scroll.clear(); this.scrollAnim = undefined; this.stopScrolling(); this.rev++; }
  /** Native `respond_to`: responsive prototypes resize the presented frame to a screen of `size` (undefined: frames keep their size). */
  respondTo(size: Pair | undefined) {
    if (this.fit?.[0] === size?.[0] && this.fit?.[1] === size?.[1]) return;
    this.fit = size;
    this.relayout();
  }
  /** Native `display`: the player's document with scroll offsets applied and the presented frame sized to the device's screen. */
  display(): Document | undefined {
    if (this.#display?.[0] === this.rev) return this.#display[1];
    if (!this.doc) return undefined;
    let d = applyScroll(this.doc, this.scroll);
    const vp = viewport(this.doc, this.current);
    if (vp) d = fitViewport(d, this.current, vp);
    this.#display = [this.rev, d];
    return d;
  }
  /** Native `player`'s Scroll to animation: each moving frame's offset at the eased progress; true while it moves. */
  stepScrollAnimation(now: number): boolean {
    const sa = this.scrollAnim;
    if (!sa) return false;
    const raw = Math.min(Math.max((now - sa.start) / Math.max(sa.dur, 1e-3), 0), 1), e = evalEasing(sa.easing, raw);
    for (const [f, from, to] of sa.frames) this.scroll.set(f, [from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e]);
    this.rev++;
    if (raw >= 1) this.scrollAnim = undefined;
    return true;
  }
  /** The eased progress of the transition playing (undefined when none plays or it has ended, which clears it). */
  transitionProgress(now: number): number | undefined {
    const a = this.anim;
    if (!a) return undefined;
    const raw = (now - a.start) / Math.max(a.dur, 1e-3);
    if (raw >= 1) { this.anim = undefined; return undefined; }
    return evalEasing(a.easing, Math.max(raw, 0));
  }
  /** Native `scroll_to`: scroll the presented frame, clamped to its range. */
  scrollTo(x: number, y: number) {
    if (!this.doc || !Number.isFinite(x) || !Number.isFinite(y)) return;
    this.scroll.set(this.current, clampScroll([x, y], this.range(this.doc, this.current)));
    this.scrollAnim = undefined;
    this.stopScrolling();
    this.rev++;
  }
  #snapshot(): Snapshot | undefined {
    return this.#design && { current: this.current, doc: this.#design, overlays: [...this.overlays], history: [...this.history], scroll: new Map(this.scroll) };
  }
  /** Native `begin`: start a transition from what shows now; call before changing the state. */
  begin(transition: PrototypeTransition, dur: number, easing: PrototypeEasing, now: number) {
    const fromDoc = this.display();
    if (!fromDoc) return;
    this.anim = transition.type === "instant" || dur <= 0 ? undefined : { fromDoc, fromFrame: this.current, transition, start: now, dur, easing };
  }
  #arrive(now: number) {
    if (this.doc) rememberSections(this.doc, this.current, this.#sections);
    this.#arrived = now;
    this.delaysFired.clear();
    this.waiting = [];
    this.hovered = [];
    this.rev++;
  }
  /** Native `go`: show `frame`, at its top unless `preserve` keeps the scroll of the frame being left. */
  go(frame: NodeId, transition: PrototypeTransition, dur: number, easing: PrototypeEasing, now: number, remember: boolean, preserve: boolean) {
    this.begin(transition, dur, easing, now);
    if (remember) this.history.push({ frame: this.current, transition, dur, easing });
    const kept = preserve ? this.scroll.get(this.current) : undefined;
    this.overlays = []; this.scroll.clear(); this.scrollAnim = undefined; this.#temp = undefined;
    this.current = frame;
    this.relayout();
    if (kept && this.doc) this.scroll.set(frame, clampScroll(kept, this.range(this.doc, frame)));
    this.#arrive(now);
  }
  /** Native `restart`: start over at `start` with the document as the editor has it. */
  restart(start: NodeId, now: number) {
    this.#start = start; this.current = start;
    this.#sections.clear(); this.history = []; this.overlays = []; this.scroll.clear();
    this.scrollAnim = undefined; this.anim = undefined; this.#temp = undefined;
    this.#design = this.#original;
    this.relayout();
    this.#arrive(now);
  }
  /** Native `revert`: a hover or press state goes back to what showed before it, the transition played the other way. */
  revert(now: number) {
    const t = this.#temp;
    if (!t) return;
    this.#temp = undefined;
    this.begin(reversedTransition(t.transition), t.dur, t.easing, now);
    this.current = t.snap.current; this.#design = t.snap.doc;
    this.relayout();
    this.overlays = t.snap.overlays; this.history = t.snap.history; this.scroll = t.snap.scroll;
    this.hovered = [];
    this.rev++;
  }
  /** Native draw.rs: finished closing animations go. */
  pruneClosing(now: number) { this.closing = this.closing.filter(([at, o]) => now - at < o.dur); }
  /** Native `close_overlay`: the top overlay closes, animating out with its opening transition reversed. */
  closeOverlay(now: number): boolean {
    const o = this.overlays.pop();
    if (!o) return false;
    if (o.transition.type !== "instant" && o.dur > 0) {
      // An overlay closed mid-opening reverses from where it got to.
      const shown = Math.min(Math.max((now - o.opened) / o.dur, 0), 1);
      this.closing.push([now - (1 - shown) * o.dur, o]);
    }
    this.hovered = [];
    return true;
  }
  /** Native `gesture`: a mouse enter, leave, down or up runs now, or after its delay while `root` still shows. */
  gesture(node: NodeId, k: number, rect: PageRect | undefined, now: number, root: NodeId): boolean {
    const it = this.doc?.nodes[node]?.interactions?.[k];
    const delay = it ? delaySeconds(it) : 0;
    if (delay <= 0) return this.fire(node, k, rect, now);
    if (!this.waiting.some(w => w.node === node && w.k === k)) this.waiting.push({ node, k, rect, root, due: now + delay });
    return false;
  }
  /** Native `fire_waiting`: the delayed mouse triggers that are due, while their screen or overlay still shows. */
  fireWaiting(root: NodeId, now: number): boolean {
    const due = this.waiting.filter(w => w.due <= now);
    this.waiting = this.waiting.filter(w => w.due > now && w.root === root);
    let did = false;
    for (const w of due.filter(x => x.root === root)) did = did || this.#fireFrom(w.node, w.k, w.rect, now, false);
    return did;
  }
  /** Native `fire`: run interaction `k` of `node`, the viewer's own doing. */
  fire(node: NodeId, k: number, rect: PageRect | undefined, now: number) { return this.#fireFrom(node, k, rect, now, true); }
  #fireFrom(node: NodeId, k: number, rect: PageRect | undefined, now: number, live: boolean): boolean {
    const it = this.doc?.nodes[node]?.interactions?.[k];
    if (!it) return false;
    const dur = easingSeconds(it.easing, it.duration_ms);
    const press = it.trigger.type === "onHover" ? false : it.trigger.type === "onPress" ? true : undefined;
    const snap = press !== undefined && !this.#temp ? this.#snapshot() : undefined;
    const first = this.urls.length;
    let did = false;
    for (const a of it.actions) did = this.perform(a, node, it.transition, dur, it.easing, rect, now) || did;
    // A link is the viewer's own only when their click, press, drag or key fired it just now (#1096).
    const asked = live && ["onClick", "onPress", "onDrag", "mouseDown", "mouseUp", "keyPress"].includes(it.trigger.type);
    for (const link of this.urls.slice(first)) link.asked = asked;
    if (did && press !== undefined && snap && rect) this.#temp = { rect, press, snap, transition: it.transition, dur, easing: it.easing };
    return did;
  }
  /** Native `perform`: one action. */
  perform(a: PrototypeAction, node: NodeId, transition: PrototypeTransition, dur: number, easing: PrototypeEasing, rect: PageRect | undefined, now: number, depth = 0): boolean {
    const doc = this.doc;
    if (!doc) return false;
    const has = (id: NodeId) => Object.hasOwn(doc.nodes, id);
    switch (a.type) {
      case "navigate": {
        const top = navigateTarget(doc, a.dest, this.#sections);
        if (top === undefined || !has(top) || top === this.current && !this.overlays.length) return false;
        this.go(top, transition, dur, easing, now, true, a.preserve_scroll === true);
        return true;
      }
      case "back": {
        if (this.closeOverlay(now)) return true;
        const v = this.history.pop();
        if (!v) return false;
        this.go(v.frame, reversedTransition(v.transition), v.dur, v.easing, now, false, false);
        return true;
      }
      case "scrollTo": {
        const frames = scrollToLayer(doc, a.dest, a.offset ?? [0, 0], f => this.range(doc, f), this.scroll) as [NodeId, Pair, Pair][];
        if (!frames.length) return false;
        if (transition.type === "instant" || dur <= 0) { for (const [f, , to] of frames) this.scroll.set(f, to); this.rev++; }
        else this.scrollAnim = { frames, start: now, dur, easing };
        return true;
      }
      case "openOverlay": case "swapOverlay": {
        if (!has(a.dest)) return false;
        for (const key of [...this.delaysFired]) if (subtreeIds(doc, a.dest).includes(key.split("/")[0])) this.delaysFired.delete(key);
        const top = this.overlays.at(-1);
        if (a.type === "swapOverlay" && top) Object.assign(top, { id: a.dest, opened: now, transition, dur, easing });
        else this.overlays.push(a.type === "openOverlay"
          ? { id: a.dest, position: a.position, closeOnOutside: a.close_on_outside, background: a.background, anchor: rect, offset: a.offset, anchorTo: a.anchor ?? "screen", opened: now, transition, dur, easing }
          : { id: a.dest, position: "center", closeOnOutside: true, background: null, anchor: rect, anchorTo: "screen", opened: now, transition, dur, easing });
        this.hovered = [];
        return true;
      }
      case "closeOverlay": return this.closeOverlay(now);
      case "openUrl":
        // Fired by whatever trigger the prototype sets, a delay included: only web and mail links, not the viewer's doing until `fire` says so.
        if (openableUrl(a.url)) this.urls.push({ url: a.url, asked: false, newTab: a.new_tab !== false });
        return true;
      case "changeTo": {
        const inst = changeToTarget(doc, node, a.dest);
        if (inst === undefined || !has(a.dest) || !this.#design) return false;
        this.begin(transition, dur, easing, now);
        const draft = new HierarchyDraft(this.#design);
        draft.set(Object.freeze({ ...(this.#design.nodes[inst] as InstanceNode), component: a.dest }));
        const next = Object.keys(this.#design.nodes).reduce((m, id) => { const n = BigInt(id); return n > m ? n : m; }, 0n) + 1n;
        rebuildInstance(draft, inst, next);
        this.#design = draft.finish();
        this.relayout();
        return true;
      }
      case "setVariable": {
        const d = this.#design && setVariable(this.#design, node, a.variable, a.value, a.expr);
        if (!d) return false;
        this.#design = d; this.relayout();
        return true;
      }
      case "setVariableMode": {
        const d = this.#design && setModeById(this.#design, this.current, a.collection, a.mode);
        if (!d) return false;
        this.#design = d; this.relayout();
        return true;
      }
      case "conditional": {
        if (depth >= maxActionDepth) return false;
        // Evaluated now: earlier actions of the interaction may have changed variables.
        let did = false;
        for (const inner of branch(doc, node, a.blocks)) did = this.perform(inner, node, transition, dur, easing, rect, now, depth + 1) || did;
        return did;
      }
    }
  }
  /** Native `next_delay`: the soonest after-delay interaction under `root` not yet fired, and the seconds until it is due. */
  nextDelay(doc: Document, root: NodeId, now: number): [[NodeId, number], number] | undefined {
    const top = this.overlays.at(-1);
    const since = top && top.id === root ? top.opened : this.#arrived;
    let next: [[NodeId, number], number] | undefined;
    for (const id of subtreeIds(doc, root)) {
      for (const [k, it] of (doc.nodes[id].interactions ?? []).entries()) {
        if (it.trigger.type !== "afterDelay" || this.delaysFired.has(id + "/" + k)) continue;
        const due = since + it.trigger.ms / 1000 - now;
        if (!next || due < next[1]) next = [[id, k], due];
      }
    }
    return next;
  }
}
