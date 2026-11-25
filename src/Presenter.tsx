import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { renderDocument } from "./engine/canvas";
import type { EditorEngine, EditorSnapshot } from "./engine/editor";
import type { NodeId, PageNode } from "./engine/document";
import { pageForNode } from "./engine/hierarchy";
import { PrototypePlayer } from "./engine/prototype-player";
import { frameScreen, overlayLayers, presentedScreen, type Screen } from "./engine/prototype-screen";
import { PresenterInput } from "./engine/prototype-input";
import { hotspots } from "./engine/prototype-runtime";
import { evalEasing } from "./engine/prototype-model";
import { smartInterpolate, transitionFrames } from "./engine/prototype-transitions";
import { defaultPrototypeBackground } from "./engine/document";
import { renderColour } from "./engine/colour";
import type { Viewport } from "./engine/viewport";

/** Source: upstream ui-egui/src/present.rs and present/{player,layout,input,draw}.rs: the full-window presenter and the preview pane. */
interface Props { engine: EditorEngine; snapshot: EditorSnapshot; mode: "present" | "preview"; start: NodeId }

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
  const input = useRef<PresenterInput | null>(null);
  if (!input.current) input.current = new PresenterInput(p);
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
        let did = input.current!.tick(s, now());
        // A transition, a Scroll to, an overlay moving or hotspot hints fading draw every frame.
        if (p.stepScrollAnimation(now()) || p.anim) did = true;
        // One frame past the hints so their last trace is cleared.
        if (input.current!.flashUntil > now() - 0.1 || p.closing.length || p.overlays.some(o => now() - o.opened < o.dur)) did = true;
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
  const overlayImage = useRef<{ key: string; canvases: HTMLCanvasElement[] } | null>(null);
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
    // Overlays opening or closing are drawn apart, over the screen without them (native draw.rs).
    p.pruneClosing(now());
    const layers = overlayLayers(p, now()), moving = layers.some(l => l.raw < 1);
    const base = moving ? presentedScreen(p, false) ?? screen : screen;
    const target = anim?.transition.type === "smartAnimate" ? smartInterpolate(anim.fromDoc, anim.fromFrame, base.doc, p.current, t!) : base.doc;
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
    const screenRect = { x: (size.w - screen.frame.width * v.zoom) / 2 * dpr, y: (size.h - screen.frame.height * v.zoom) / 2 * dpr, w: screen.frame.width * v.zoom * dpr, h: screen.frame.height * v.zoom * dpr };
    const toCanvas = (b: { x: number; y: number; width: number; height: number }) => ({ x: ((b.x - v.cx) * v.zoom + size.w / 2) * dpr, y: ((b.y - v.cy) * v.zoom + size.h / 2) * dpr, w: b.width * v.zoom * dpr, h: b.height * v.zoom * dpr });
    // Overlays in motion, each over its background, moved and faded as its opening transition places it (instant: shown whole).
    const drawOverlays = () => {
      if (!moving) return;
      ctx.save(); ctx.beginPath(); ctx.rect(screenRect.x, screenRect.y, screenRect.w, screenRect.h); ctx.clip();
      for (const [i, l] of layers.entries()) {
        const f = l.transition.type === "instant" ? transitionFrames({ type: "dissolve" }, 1) : transitionFrames(l.transition, evalEasing(l.easing, l.raw));
        if (l.background) { ctx.globalAlpha = l.raw; ctx.fillStyle = renderColour(l.background); ctx.fillRect(screenRect.x, screenRect.y, screenRect.w, screenRect.h); }
        const r = toCanvas(l.box), img = overlayImages[i];
        if (img) { ctx.globalAlpha = f.toAlpha; ctx.drawImage(img, r.x, r.y, r.w, r.h, r.x + r.w * f.toOff[0], r.y + r.h * f.toOff[1], r.w, r.h); }
      }
      ctx.restore();
    };
    // Native hotspot hints: a click where nothing reacts flashes the layers that do, fading out.
    const drawFlash = () => {
      const left = input.current!.flashUntil - now();
      if (left <= 0) return;
      const a = left / 0.5;
      for (const [, r] of hotspots(screen.doc, screen.root)) {
        const b = toCanvas({ x: r.x0, y: r.y0, width: r.x1 - r.x0, height: r.y1 - r.y0 });
        ctx.globalAlpha = 0.25 * a; ctx.fillStyle = "#0d99ff"; ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.globalAlpha = a; ctx.strokeStyle = "#0d99ff"; ctx.lineWidth = 1.5 * dpr; ctx.strokeRect(b.x, b.y, b.w, b.h);
      }
      ctx.globalAlpha = 1;
    };
    const compose = () => {
      if (!live) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (!placement || !from) { ctx.clearRect(0, 0, W, H); ctx.drawImage(to, 0, 0); drawOverlays(); drawFlash(); return; }
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
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
      drawOverlays(); drawFlash();
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
    // Overlay images, kept while the overlays are unchanged.
    const okey = [p.rev, W, H, layers.map(l => l.doc.nodes[l.doc.currentPage] && (l.doc.nodes[l.doc.currentPage] as { children: readonly NodeId[] }).children[0] + "@" + l.box.x + "," + l.box.y).join(",")].join("|");
    if (moving && overlayImage.current?.key !== okey) overlayImage.current = { key: okey, canvases: layers.map(l => offscreen(l.doc, v, compose)) };
    const overlayImages = moving ? overlayImage.current!.canvases : [];
    // The destination's image is kept while what shows is unchanged (smart animate draws a new one each frame).
    const key = [p.rev, W, H, p.current, moving, p.overlays.map(o => o.id + "@" + o.opened).join(",")].join("|");
    const reuse = target === base.doc && toImage.current?.key === key;
    const to = reuse ? toImage.current!.canvas : offscreen(target, v, compose);
    if (target === base.doc && !reuse) toImage.current = { key, canvas: to };
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
      if (s && e.key !== "Escape" && input.current!.key(s, keyName(e), { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, cmd: e.metaKey }, now())) {
        e.preventDefault(); e.stopImmediatePropagation(); redraw(); return;
      }
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
  // Native input.rs: pointer down, move and up drive press, hover, drag and click triggers.
  const pointer = (e: React.PointerEvent<HTMLCanvasElement>, what: "down" | "move" | "up") => {
    const s = presentedScreen(p);
    if (!s || !view.current) return;
    const q = pagePoint(e), i = input.current!;
    i.scale = view.current.zoom;
    if (what === "down") { e.currentTarget.setPointerCapture?.(e.pointerId); if (e.button !== 0) return; }
    const did = what === "down" ? i.down(s, q, now()) : what === "up" ? i.up(s, q, now()) : i.move(s, q, (e.buttons & 1) === 1, now());
    if (did || what === "up") redraw();
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
    <canvas ref={canvas} aria-label="Prototype screen" data-overlays={p.overlays.length} style={{ flex: 1, width: "100%", minHeight: 0, touchAction: "none" }} 
      onPointerDown={e => pointer(e, "down")} onPointerMove={e => pointer(e, "move")} onPointerUp={e => pointer(e, "up")}
      onPointerEnter={() => { over.current = true; }}
      onPointerLeave={() => { over.current = false; const s = presentedScreen(p); if (s && input.current!.move(s, undefined, false, now())) redraw(); }} />
    {!screen && <p role="status" style={{ color: "#aaa" }}>Select a frame to preview it</p>}
  </section>;
}
