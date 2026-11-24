import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { renderDocument } from "./engine/canvas";
import type { EditorEngine, EditorSnapshot } from "./engine/editor";
import type { NodeId, PageNode } from "./engine/document";
import { pageForNode } from "./engine/hierarchy";
import { PrototypePlayer } from "./engine/prototype-player";
import { hotspotAt, keyTarget, outsideTopOverlay, presentedScreen, type Screen } from "./engine/prototype-screen";
import type { Viewport } from "./engine/viewport";

/** Source: upstream ui-egui/src/present.rs and present/{player,layout,input,draw}.rs: the full-window presenter and the preview pane, without transitions. */
interface Props { engine: EditorEngine; snapshot: EditorSnapshot; mode: "present" | "preview"; start: NodeId }

const clickTriggers = new Set(["onClick", "mouseDown", "mouseUp", "onPress"]);
/** Native key names from DOM key values. */
const keyName = (e: KeyboardEvent) => e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key === "Esc" ? "Escape" : e.key;

export function Presenter({ engine, snapshot, mode, start }: Props) {
  const player = useRef<PrototypePlayer | null>(null);
  if (!player.current) player.current = new PrototypePlayer(start);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const canvas = useRef<HTMLCanvasElement>(null), view = useRef<Viewport | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // The preview pane takes keys only while the pointer is over it (native `keys_on`).
  const over = useRef(false);
  const p = player.current;
  const now = () => performance.now() / 1000;
  // The player follows the editor's document; a new start restarts it.
  useEffect(() => { if (p.start !== start) { p.sync(snapshot.document, now()); p.restart(start, now()); redraw(); } }, [start]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { p.sync(snapshot.document, now()); redraw(); }, [snapshot.document, p]);
  const screen: Screen | undefined = presentedScreen(p);
  // Native `next_delay` and `fire_waiting`: after-delay interactions and mouse triggers waiting out their delay.
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const s = presentedScreen(p);
      if (s) {
        let did = p.fireWaiting(s.root, now());
        const next = p.nextDelay(s.doc, s.root, now());
        if (next && next[1] <= 0) { p.delaysFired.add(next[0][0] + "/" + next[0][1]); did = p.fire(next[0][0], next[0][1], undefined, now()) || did; }
        if (did) redraw();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [p]);
  // Draw the screen, scaled down to fit (never above 100%), centred: native Fit.
  useEffect(() => {
    const c = canvas.current;
    if (!c || !screen || !size.w || !size.h) return;
    const dpr = globalThis.devicePixelRatio || 1;
    c.width = Math.round(size.w * dpr); c.height = Math.round(size.h * dpr);
    const ctx = c.getContext("2d")!;
    const zoom = Math.min(1, size.w / Math.max(1, screen.frame.width), size.h / Math.max(1, screen.frame.height));
    const v: Viewport = Object.freeze({ cx: screen.frame.x + screen.frame.width / 2, cy: screen.frame.y + screen.frame.height / 2, zoom, vw: size.w, vh: size.h });
    view.current = v;
    let live = true;
    const paint = () => { if (!live) return; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); void renderDocument(ctx, screen.doc, size.w, size.h, [], undefined, v, undefined, paint); };
    paint();
    return () => { live = false; };
  });
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const observe = new ResizeObserver(() => setSize({ w: c.clientWidth, h: c.clientHeight }));
    observe.observe(c);
    return () => observe.disconnect();
  }, []);
  // Keys: key triggers of what shows; Escape closes the full-window presenter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode === "preview" && !over.current) return;
      if (e.target instanceof HTMLElement && e.target.closest("input,select,textarea,[contenteditable=true]")) return;
      const s = presentedScreen(p);
      const hit = s && keyTarget(s, keyName(e), { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, cmd: e.metaKey });
      if (hit) { e.preventDefault(); e.stopImmediatePropagation(); if (p.fire(hit.node, hit.index, undefined, now())) redraw(); return; }
      if (e.key === "Escape" && mode === "present") { e.preventDefault(); e.stopImmediatePropagation(); engine.closePrototypePlayer(); return; }
      // The full-window presenter owns the keyboard: the editor's shortcuts wait until it closes.
      if (mode === "present" && !e.metaKey && !e.ctrlKey) e.stopImmediatePropagation();
    };
    globalThis.addEventListener("keydown", onKey, true);
    return () => globalThis.removeEventListener("keydown", onKey, true);
  }, [p, mode, engine]);
  const pagePoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const v = view.current!, box = e.currentTarget.getBoundingClientRect();
    return { x: v.cx + (e.clientX - box.left - v.vw / 2) / v.zoom, y: v.cy + (e.clientY - box.top - v.vh / 2) / v.zoom };
  };
  const click = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = presentedScreen(p);
    if (!s || !view.current) return;
    const q = pagePoint(e);
    const outside = outsideTopOverlay(s, q);
    if (outside) { if (outside.closeOnOutside && p.closeOverlay(now())) redraw(); return; }
    const hit = hotspotAt(s, q, it => clickTriggers.has(it.trigger.type));
    if (!hit) return;
    const it = s.doc.nodes[hit.node].interactions![hit.index];
    const fired = it.trigger.type === "mouseDown" || it.trigger.type === "mouseUp" ? p.gesture(hit.node, hit.index, hit.rect, now(), s.root) : p.fire(hit.node, hit.index, hit.rect, now());
    if (fired) redraw();
  };
  const doc = p.doc, name = doc?.nodes[p.current]?.name ?? "";
  const pageId = doc && doc.nodes[p.start] ? pageForNode(doc, p.start) : undefined;
  const flow = useMemo(() => pageId !== undefined ? (doc!.nodes[pageId] as PageNode).flows?.find(f => f.start === p.start) : undefined, [doc, pageId, p.start]);
  const label = mode === "present" ? "Prototype presentation" : "Prototype preview";
  return <section className={mode === "present" ? "figcraft-presenter" : "figcraft-preview-pane"} role="dialog" aria-label={label}
    style={mode === "present" ? { position: "fixed", inset: 0, zIndex: 50, display: "flex", flexDirection: "column", background: "#1e1e1e" }
      : { position: "absolute", right: 16, bottom: 48, width: 360, height: 480, zIndex: 20, display: "flex", flexDirection: "column", background: "#1e1e1e", border: "1px solid #444", borderRadius: 8 }}>
    <header style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 10px", background: "#2c2c2c", color: "white" }}>
      {flow && <span className="figcraft-presenter-flow">{flow.name} /</span>}
      <h2 style={{ fontSize: 12, margin: 0, flex: 1 }} aria-label="Presented frame">{name}</h2>
      <button type="button" onClick={() => { p.restart(p.start, now()); redraw(); }}>Restart</button>
      {mode === "preview" && <button type="button" onClick={() => engine.execute("proto.present", { start: Number(p.start) })}>Present</button>}
      <button type="button" onClick={() => engine.closePrototypePlayer()}>{mode === "present" ? "Close" : "Close preview"}</button>
    </header>
    <canvas ref={canvas} aria-label="Prototype screen" data-overlays={p.overlays.length} style={{ flex: 1, width: "100%", minHeight: 0, touchAction: "none" }} onPointerUp={click}
      onPointerEnter={() => { over.current = true; }} onPointerLeave={() => { over.current = false; }} />
    {!screen && <p role="status" style={{ color: "#aaa" }}>Select a frame to preview it</p>}
  </section>;
}
