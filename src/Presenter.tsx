import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { renderDocument } from "./engine/canvas";
import type { EditorEngine, EditorSnapshot } from "./engine/editor";
import type { NodeId, PageNode } from "./engine/document";
import { pageForNode } from "./engine/hierarchy";
import { PrototypePlayer } from "./engine/prototype-player";
import { frameScreen, hotspotAt, keyTarget, outsideTopOverlay, presentedScreen, type Screen } from "./engine/prototype-screen";
import { smartInterpolate, transitionFrames } from "./engine/prototype-transitions";
import { defaultPrototypeBackground } from "./engine/document";
import { renderColour } from "./engine/colour";
import type { Viewport } from "./engine/viewport";

/** Source: upstream ui-egui/src/present.rs and present/{player,layout,input,draw}.rs: the full-window presenter and the preview pane. */
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
        // A transition or a Scroll to playing draws every frame.
        if (p.stepScrollAnimation(now()) || p.anim) did = true;
        const next = p.nextDelay(s.doc, s.root, now());
        if (next && next[1] <= 0) { p.delaysFired.add(next[0][0] + "/" + next[0][1]); did = p.fire(next[0][0], next[0][1], undefined, now()) || did; }
        if (did) redraw();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [p]);
  // Draw the screen, scaled down to fit (never above 100%), centred (native Fit). A transition composites the outgoing and incoming
  // screens, each rendered off screen, moved and faded as native's `transition_frames` places them and clipped to the screen; smart
  // animate draws the interpolated destination (native draw.rs).
  const fromImage = useRef<{ key: object; canvas: HTMLCanvasElement } | null>(null);
  const toImage = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !screen || !size.w || !size.h) return;
    const dpr = globalThis.devicePixelRatio || 1, W = Math.round(size.w * dpr), H = Math.round(size.h * dpr);
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    const ctx = c.getContext("2d")!;
    const fit = (b: { x: number; y: number; width: number; height: number }): Viewport => Object.freeze({
      cx: b.x + b.width / 2, cy: b.y + b.height / 2, zoom: Math.min(1, size.w / Math.max(1, b.width), size.h / Math.max(1, b.height)), vw: size.w, vh: size.h });
    const v = fit(screen.frame);
    view.current = v;
    const t = p.transitionProgress(now()), anim = t !== undefined ? p.anim : undefined;
    const target = anim?.transition.type === "smartAnimate" ? smartInterpolate(anim.fromDoc, anim.fromFrame, screen.doc, p.current, t!) : screen.doc;
    const offscreen = (doc: typeof target, view: Viewport, then: () => void) => {
      const o = globalThis.document.createElement("canvas");
      o.width = W; o.height = H;
      const octx = o.getContext("2d")!;
      const paint = () => { if (!live) return; octx.setTransform(dpr, 0, 0, dpr, 0, 0); void Promise.resolve(renderDocument(octx, doc, size.w, size.h, [], undefined, view, undefined, paint)).then(then); };
      paint();
      return o;
    };
    let live = true;
    const page = screen.doc.nodes[screen.doc.currentPage] as PageNode;
    const bg = renderColour(page.prototypeBackground ?? defaultPrototypeBackground);
    const compose = () => {
      if (!live) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (!placement || !from) { ctx.clearRect(0, 0, W, H); ctx.drawImage(to, 0, 0); return; }
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      const screenRect = { x: (size.w - screen.frame.width * v.zoom) / 2 * dpr, y: (size.h - screen.frame.height * v.zoom) / 2 * dpr, w: screen.frame.width * v.zoom * dpr, h: screen.frame.height * v.zoom * dpr };
      const fs = from.frame, fz = Math.min(1, size.w / Math.max(1, fs.width), size.h / Math.max(1, fs.height));
      const fromRect = { x: (size.w - fs.width * fz) / 2 * dpr, y: (size.h - fs.height * fz) / 2 * dpr, w: fs.width * fz * dpr, h: fs.height * fz * dpr };
      ctx.save();
      // Without a device a dissolve shows both frames whole; otherwise the screen clips.
      if (anim!.transition.type !== "dissolve") { ctx.beginPath(); ctx.rect(screenRect.x, screenRect.y, screenRect.w, screenRect.h); ctx.clip(); }
      // Each image's frame only (native draws the frames' textures, not the screen around them).
      const drawFrom = () => { if (placement.fromAlpha > 0) { ctx.globalAlpha = placement.fromAlpha; ctx.drawImage(from!.canvas, fromRect.x, fromRect.y, fromRect.w, fromRect.h, fromRect.x + fromRect.w * placement.fromOff[0], fromRect.y + fromRect.h * placement.fromOff[1], fromRect.w, fromRect.h); } };
      const drawTo = () => { ctx.globalAlpha = placement.toAlpha; ctx.drawImage(to, screenRect.x, screenRect.y, screenRect.w, screenRect.h, screenRect.x + screenRect.w * placement.toOff[0], screenRect.y + screenRect.h * placement.toOff[1], screenRect.w, screenRect.h); };
      if (placement.fromOnTop) { drawTo(); drawFrom(); } else { drawFrom(); drawTo(); }
      ctx.restore();
    };
    const placement = anim && anim.transition.type !== "smartAnimate" ? transitionFrames(anim.transition, t!) : undefined;
    let from: { canvas: HTMLCanvasElement; frame: { width: number; height: number } } | undefined;
    if (placement && anim) {
      const fs = frameScreen(anim.fromDoc, anim.fromFrame);
      if (fs) {
        if (fromImage.current?.key !== anim) fromImage.current = { key: anim, canvas: offscreen(fs.doc, fit(fs.frame), compose) };
        from = { canvas: fromImage.current.canvas, frame: fs.frame };
      }
    } else fromImage.current = null;
    // The destination's image is kept while what shows is unchanged (smart animate draws a new one each frame).
    const key = [p.rev, W, H, p.current, p.overlays.map(o => o.id + "@" + o.opened).join(",")].join("|");
    const reuse = target === screen.doc && toImage.current?.key === key;
    const to = reuse ? toImage.current!.canvas : offscreen(target, v, compose);
    if (target === screen.doc && !reuse) toImage.current = { key, canvas: to };
    if (reuse) compose();
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
