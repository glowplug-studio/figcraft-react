import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { renderDocument } from "./engine/canvas";
import type { EditorEngine, EditorSnapshot } from "./engine/editor";
import type { NodeId, PageNode } from "./engine/document";
import { pageForNode } from "./engine/hierarchy";
import { PrototypePlayer } from "./engine/prototype-player";
import { frameScreen, overlayLayers, presentedScreen, type Screen } from "./engine/prototype-screen";
import { fullChrome, nextScale, pageBox, paneChrome, placePage, presentLayout, scaleLabel, scaleOptions, type Layout, type PresentScale } from "./engine/prototype-layout";
import { goesToWebsite } from "./engine/prototype-links";
import { topFrames, type PresentOptions } from "./engine/prototype-commands";
import { customDevice, devices, presentedDevice } from "./engine/prototype-settings";
import { pageDevice } from "./engine/prototype-scroll";
import { drawDeviceBody, drawDeviceGlass } from "./presenter-device";
import type { Box } from "./engine/prototype-overlays";
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
  if (!input.current) input.current = new PresenterInput(p, () => p.view.hotspotHints);
  const now = () => performance.now() / 1000;
  // The player follows the editor's document; a new start restarts it.
  useEffect(() => { if (p.start !== start) { p.sync(snapshot.document, now()); p.restart(start, now()); redraw(); } }, [start]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { p.sync(snapshot.document, now()); redraw(); }, [snapshot.document, p]);
  // proto.presentOptions sets the full-window presenter's options (a new scale starts the view over).
  useEffect(() => {
    const o = snapshot.presentOptions;
    if (!o) return;
    const before = p.view.scale;
    p.view = { ...p.view, ...o };
    if (o.scale && o.scale !== before) p.setScale(o.scale);
    redraw();
  }, [snapshot.presentOptions, p]);
  // Native `layout`: laid out again for every frame drawn and every event, from the canvas's size.
  const chrome = mode === "present" ? fullChrome : paneChrome;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const layoutNow = (): [Layout | undefined, Box | undefined] => {
    const { w, h } = sizeRef.current;
    const l = w && h ? presentLayout(p, { x0: 0, y0: 0, x1: w, y1: h }, chrome) : undefined;
    if (l) input.current!.scale = l.scale;
    return [l, l && pageBox(l.place, l.screen)];
  };
  const screenNow = (withOverlays = true): Screen | undefined => presentedScreen(p, withOverlays, layoutNow()[1]);
  // Native `finish` and `open_link`: links wait behind the notice unless the viewer skipped it and fired them.
  const skippedRef = useRef(false);
  skippedRef.current = snapshot.linkNoticeSkipped === true;
  const openLink = (url: string, newTab: boolean) => { if (newTab) globalThis.open(url, "_blank", "noopener,noreferrer"); else globalThis.location.assign(url); };
  const finish = () => { const had = p.linkNotice; input.current!.finish(skippedRef.current, openLink); return p.linkNotice !== had; };
  /** The full-window presenter's options change here (Z, the menus); they carry over to the next presentation. */
  const setView = (next: Partial<PresentOptions>) => {
    if (next.scale && next.scale !== p.view.scale) p.setScale(next.scale);
    p.view = { ...p.view, ...next };
    engine.execute("proto.presentOptions", { ...p.view });
    redraw();
  };
  const [menu, setMenu] = useState<"options" | "flows" | "device" | "scale" | undefined>();
  const [barsNotice, setBarsNotice] = useState(false);
  // The note on how the bars come back goes after a few seconds.
  useEffect(() => { if (!barsNotice) return; const t = setTimeout(() => setBarsNotice(false), 3000); return () => clearTimeout(t); }, [barsNotice]);
  const [layout, screenBox] = layoutNow();
  const screen: Screen | undefined = presentedScreen(p, true, screenBox);
  // Native `next_delay` and `fire_waiting`: after-delay interactions and mouse triggers waiting out their delay.
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const s = screenNow();
      if (s) {
        let did = input.current!.tick(s, now());
        if (finish()) did = true;
        // A transition, a Scroll to, an overlay moving or hotspot hints fading draw every frame.
        if (p.stepScrollAnimation(now()) || p.anim) did = true;
        // One frame past the hints so their last trace is cleared.
        if (p.fling || input.current!.flashUntil > now() - 0.1 || p.closing.length || p.overlays.some(o => now() - o.opened < o.dur)) did = true;
        if (did) redraw();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [p, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  // Draw the screen, scaled down to fit (never above 100%), centred (native Fit). A transition composites the outgoing and incoming
  // screens, each rendered off screen, moved and faded as native's `transition_frames` places them and clipped to the screen; smart
  // animate draws the interpolated destination (native draw.rs).
  const fromImage = useRef<{ key: object; canvas: HTMLCanvasElement } | null>(null);
  const toImage = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);
  const overlayImage = useRef<{ key: string; canvases: HTMLCanvasElement[] } | null>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !screen || !layout || !size.w || !size.h) return;
    const dpr = globalThis.devicePixelRatio || 1, W = Math.round(size.w * dpr), H = Math.round(size.h * dpr);
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    const ctx = c.getContext("2d")!;
    // A frame of page box `b` drawn centred on the screen at the layout's scale (native `Place::centered`).
    const sc = [(layout.screen.x0 + layout.screen.x1) / 2, (layout.screen.y0 + layout.screen.y1) / 2];
    const fit = (b: { x: number; y: number; width: number; height: number }): Viewport => Object.freeze({
      cx: b.x + b.width / 2 + (size.w / 2 - sc[0]) / layout.scale, cy: b.y + b.height / 2 + (size.h / 2 - sc[1]) / layout.scale, zoom: layout.scale, vw: size.w, vh: size.h });
    const [vcx, vcy] = placePage(layout.place, [size.w / 2, size.h / 2]);
    const v: Viewport = Object.freeze({ cx: vcx, cy: vcy, zoom: layout.scale, vw: size.w, vh: size.h });
    view.current = v;
    const rectPx = (r: { x0: number; y0: number; x1: number; y1: number }) => ({ x: r.x0 * dpr, y: r.y0 * dpr, w: (r.x1 - r.x0) * dpr, h: (r.y1 - r.y0) * dpr });
    const t = p.transitionProgress(now()), anim = t !== undefined ? p.anim : undefined;
    // Overlays opening or closing are drawn apart, over the screen without them (native draw.rs).
    p.pruneClosing(now());
    const layers = overlayLayers(p, now(), screenBox), moving = layers.some(l => l.raw < 1);
    const base = moving ? presentedScreen(p, false, screenBox) ?? screen : screen;
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
    const screenRect = rectPx(layout.screen), clipRect = rectPx(layout.clip);
    // The device's body under the screen, and its glass over it (native draw.rs with device.rs), drawn in points.
    const device = layout.device, colour = layout.colour;
    const drawBody = () => { if (device && colour) { ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); drawDeviceBody(ctx, device.name, layout.screen, layout.landscape, colour); ctx.restore(); } };
    const drawGlass = () => { if (device && colour) { ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); drawDeviceGlass(ctx, device.name, layout.screen, layout.landscape); ctx.restore(); } };
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
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      drawBody();
      if (!placement || !from) {
        ctx.save(); ctx.beginPath(); ctx.rect(clipRect.x, clipRect.y, clipRect.w, clipRect.h); ctx.clip();
        ctx.drawImage(to, 0, 0);
        ctx.restore();
        drawGlass(); drawOverlays(); drawFlash();
        return;
      }
      const fs = from.frame, fz = layout.scale;
      const fromRect = { x: (sc[0] - fs.width * fz / 2) * dpr, y: (sc[1] - fs.height * fz / 2) * dpr, w: fs.width * fz * dpr, h: fs.height * fz * dpr };
      ctx.save();
      // Without a device a dissolve shows both frames whole; on one, the screen clips.
      if (device || anim!.transition.type !== "dissolve") { ctx.beginPath(); ctx.rect(screenRect.x, screenRect.y, screenRect.w, screenRect.h); ctx.clip(); }
      // Each image's frame only (native draws the frames' textures, not the screen around them).
      const drawFrom = () => { if (placement.fromAlpha > 0) { ctx.globalAlpha = placement.fromAlpha; ctx.drawImage(from!.canvas, fromRect.x, fromRect.y, fromRect.w, fromRect.h, fromRect.x + fromRect.w * placement.fromOff[0], fromRect.y + fromRect.h * placement.fromOff[1], fromRect.w, fromRect.h); } };
      const drawTo = () => { ctx.globalAlpha = placement.toAlpha; ctx.drawImage(to, screenRect.x, screenRect.y, screenRect.w, screenRect.h, screenRect.x + screenRect.w * placement.toOff[0], screenRect.y + screenRect.h * placement.toOff[1], screenRect.w, screenRect.h); };
      if (placement.fromOnTop) { drawTo(); drawFrom(); } else { drawFrom(); drawTo(); }
      ctx.restore();
      drawGlass(); drawOverlays(); drawFlash();
    };
    const placement = anim && anim.transition.type !== "smartAnimate" ? transitionFrames(anim.transition, t!) : undefined;
    let from: { canvas: HTMLCanvasElement; frame: { width: number; height: number } } | undefined;
    if (placement && anim) {
      const fs = frameScreen(anim.fromDoc, anim.fromFrame);
      // (drawn centred on the screen at the layout's scale)
      if (fs) {
        if (fromImage.current?.key !== anim) fromImage.current = { key: anim, canvas: offscreen(fs.doc, fit(fs.frame), compose) };
        from = { canvas: fromImage.current.canvas, frame: fs.frame };
      }
    } else fromImage.current = null;
    // Overlay images, kept while the overlays are unchanged.
    const okey = [p.rev, W, H, v.cx, v.cy, v.zoom, layers.map(l => l.doc.nodes[l.doc.currentPage] && (l.doc.nodes[l.doc.currentPage] as { children: readonly NodeId[] }).children[0] + "@" + l.box.x + "," + l.box.y).join(",")].join("|");
    if (moving && overlayImage.current?.key !== okey) overlayImage.current = { key: okey, canvases: layers.map(l => offscreen(l.doc, v, compose)) };
    const overlayImages = moving ? overlayImage.current!.canvases : [];
    // The destination's image is kept while what shows is unchanged (smart animate draws a new one each frame).
    const key = [p.rev, W, H, p.current, moving, v.cx, v.cy, v.zoom, p.overlays.map(o => o.id + "@" + o.opened).join(",")].join("|");
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
      // While a link notice shows the prototype and the presenter's keys wait; Escape cancels the notice.
      if (p.linkNotice) {
        if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); p.linkNotice = undefined; redraw(); }
        else if (mode === "present" && !e.metaKey && !e.ctrlKey) e.stopImmediatePropagation();
        return;
      }
      // Cmd/Ctrl+\ hides and shows the bars, as it hides and shows the editor's UI.
      if (mode === "present" && e.key === "\\" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault(); e.stopImmediatePropagation();
        setView({ hideUi: !p.view.hideUi }); setBarsNotice(p.view.hideUi);
        return;
      }
      const s = screenNow();
      if (s && e.key !== "Escape" && input.current!.key(s, keyName(e), { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, cmd: e.metaKey }, now(), () => {
        const l = layoutNow()[0];
        if (chrome.pane || (!l?.device && p.fit)) return false;
        setView({ scale: nextScale(p.view.scale, !!l?.device) });
        return true;
      })) {
        finish(); e.preventDefault(); e.stopImmediatePropagation(); redraw(); return;
      }
      if (e.key === "Escape" && mode === "present") { e.preventDefault(); e.stopImmediatePropagation(); engine.closePrototypePlayer(); return; }
      // The full-window presenter owns the keyboard: the editor's shortcuts wait until it closes.
      if (mode === "present" && !e.metaKey && !e.ctrlKey) e.stopImmediatePropagation();
    };
    globalThis.addEventListener("keydown", onKey, true);
    return () => globalThis.removeEventListener("keydown", onKey, true);
  }, [p, mode, engine]); // eslint-disable-line react-hooks/exhaustive-deps
  /** A pointer's place in the canvas (screen points) and the page point under it, through this moment's layout. */
  const pointOf = (e: { clientX: number; clientY: number; currentTarget: Element }): [readonly [number, number], { x: number; y: number }] | undefined => {
    const [l] = layoutNow();
    if (!l) return undefined;
    const box = e.currentTarget.getBoundingClientRect(), pt = [e.clientX - box.left, e.clientY - box.top] as const;
    const [x, y] = placePage(l.place, pt);
    return [pt, { x, y }];
  };
  // Native input.rs: pointer down, move and up drive press, hover, drag and click triggers, and drags scroll.
  const pointer = (e: React.PointerEvent<HTMLCanvasElement>, what: "down" | "move" | "up") => {
    const at = pointOf(e), s = screenNow();
    if (!s || !at) return;
    const [pt, q] = at, i = input.current!;
    if (what === "down") { e.currentTarget.setPointerCapture?.(e.pointerId); if (e.button !== 0) return; }
    const did = what === "down" ? i.down(s, q, now(), pt) : what === "up" ? i.up(s, q, now()) : i.move(s, q, (e.buttons & 1) === 1, now(), pt);
    if (finish() || did || what === "up") redraw();
  };
  // The wheel scrolls (native egui's wheel delta in points: content moves with it, the opposite of the DOM's delta).
  const lastWheel = useRef(0);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      const at = pointOf({ clientX: e.clientX, clientY: e.clientY, currentTarget: c }), s = screenNow();
      if (!at || !s) return;
      e.preventDefault();
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? sizeRef.current.h : 1, t = now();
      const dt = lastWheel.current ? t - lastWheel.current : 1 / 60;
      lastWheel.current = t;
      if (input.current!.wheel(s, at[1], [-e.deltaX * k, -e.deltaY * k], dt, t)) redraw();
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [p, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const doc = p.doc, name = doc?.nodes[p.current]?.name ?? "";
  const pageId = doc && doc.nodes[p.start] ? pageForNode(doc, p.start) : undefined;
  const flows = useMemo(() => pageId !== undefined ? (doc!.nodes[pageId] as PageNode).flows ?? [] : [], [doc, pageId]);
  const flow = flows.find(f => f.start === p.start);
  const label = mode === "present" ? "Prototype presentation" : "Prototype preview";
  const pane = mode === "preview", hidden = !pane && p.view.hideUi;
  const settings = doc && doc.nodes[p.current] ? pageDevice(doc, p.current) : undefined;
  const device = settings && presentedDevice(settings), onDevice = !!device, responsive = !!settings?.responsive;
  const currentPage = doc && doc.nodes[p.current] ? pageForNode(doc, p.current) : undefined;
  const frames = doc && currentPage !== undefined ? topFrames(doc, currentPage) : [];
  const index = frames.indexOf(p.current), prev = index > 0 ? frames[index - 1] : undefined, next = index >= 0 ? frames[index + 1] : undefined;
  const restart = () => { p.restart(p.start, now()); setMenu(undefined); redraw(); };
  const chooseDevice = (name: string) => { engine.execute("proto.settings", { device: name, responsive: name !== "None" }); p.resetForDevice(); setMenu(undefined); redraw(); };
  const setResponsive = (on: boolean) => { if (on !== responsive) engine.execute("proto.settings", { responsive: on }); setMenu(undefined); };
  const pick = (scale: PresentScale) => { setView({ scale }); if (!onDevice && responsive) engine.execute("proto.settings", { responsive: false }); setMenu(undefined); };
  const check = (on: boolean, text: string, act: () => void, shortcut?: string) =>
    <button type="button" role="menuitemcheckbox" aria-checked={on} key={text} onClick={act}
      style={{ display: "flex", gap: 8, width: "100%", textAlign: "left", background: "none", border: 0, color: "inherit", padding: "4px 8px", font: "inherit" }}>
      <span style={{ width: 12 }}>{on ? "✓" : ""}</span><span style={{ flex: 1 }}>{text}</span>{shortcut && <span style={{ opacity: 0.6 }}>{shortcut}</span>}</button>;
  const menuStyle: React.CSSProperties = { position: "absolute", zIndex: 60, background: "#2c2c2c", color: "white", border: "1px solid #444", borderRadius: 6, padding: 4, fontSize: 12 };
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const hideKey = mac ? "⌘\\" : "Ctrl+\\";
  const notice = p.linkNotice;
  return <section className={mode === "present" ? "figcraft-presenter" : "figcraft-preview-pane"} role="dialog" aria-label={label}
    style={mode === "present" ? { position: "fixed", inset: 0, zIndex: 50, display: "flex", flexDirection: "column", background: "#1e1e1e" }
      : { position: "absolute", right: 16, bottom: 48, width: 360, height: 480, zIndex: 20, display: "flex", flexDirection: "column", background: "#1e1e1e", border: "1px solid #444", borderRadius: 8 }}>
    {!hidden && <header style={{ position: "relative", display: "flex", gap: 8, alignItems: "center", padding: "6px 10px", background: "#2c2c2c", color: "white" }}>
      {flows.length > 0 && <button type="button" className="figcraft-presenter-flow" aria-haspopup="menu" aria-expanded={menu === "flows"} title={flow?.description.trim() || "Flows"}
        onClick={() => setMenu(menu === "flows" ? undefined : "flows")}>{flow ? flow.name : "Flows"}</button>}
      {flows.length > 0 && <span aria-hidden="true">/</span>}
      <h2 style={{ fontSize: 12, margin: 0, flex: 1 }} aria-label="Presented frame">{name}</h2>
      {menu === "flows" && <div role="menu" aria-label="Flows" style={{ ...menuStyle, left: 10, top: 36, width: 240 }}>
        {flows.map(f => <div key={f.start}>{check(f.start === p.start, f.name, () => { p.restart(f.start, now()); setMenu(undefined); redraw(); })}
          {f.description.trim() && <p style={{ margin: "0 8px 4px 28px", opacity: 0.7, fontSize: 10.5 }}>{f.description.trim()}</p>}</div>)}
      </div>}
      {!pane && <button type="button" aria-haspopup="menu" aria-expanded={menu === "options"} onClick={() => setMenu(menu === "options" ? undefined : "options")}>Options</button>}
      <button type="button" onClick={restart}>Restart</button>
      {pane && <button type="button" onClick={() => engine.execute("proto.present", { start: Number(p.start) })}>Present</button>}
      <button type="button" onClick={() => engine.closePrototypePlayer()}>{pane ? "Close preview" : "Close"}</button>
      {menu === "options" && <div role="menu" aria-label="Options" style={{ ...menuStyle, right: 10, top: 36, width: 240 }}>
        {!onDevice && check(responsive, "Responsive", () => setResponsive(true))}
        {scaleOptions(onDevice).map(sc => check(p.view.scale === sc && (onDevice || !responsive), scaleLabel(sc, onDevice), () => pick(sc)))}
        {(onDevice || !responsive) && check(false, "Next size option", () => { setView({ scale: nextScale(p.view.scale, onDevice) }); setMenu(undefined); }, "Z")}
        <hr />
        {onDevice && <>{check(responsive, "Responsive", () => setResponsive(true))}{check(!responsive, "Fixed size", () => setResponsive(false))}<hr /></>}
        {onDevice && device!.colors.length > 0 && check(p.view.deviceFrame, "Show device frame", () => { setView({ deviceFrame: !p.view.deviceFrame }); setMenu(undefined); })}
        {check(p.view.hotspotHints, "Show hotspot hints", () => { setView({ hotspotHints: !p.view.hotspotHints }); setMenu(undefined); })}
        {check(p.view.hideUi, "Hide UI", () => { setView({ hideUi: !p.view.hideUi }); setBarsNotice(p.view.hideUi); setMenu(undefined); }, hideKey)}
        {check(false, "Restart", restart, "R")}
      </div>}
    </header>}
    <canvas ref={canvas} aria-label="Prototype screen" data-overlays={p.overlays.length} data-scale={p.view.scale} data-zoom={p.zoom}
      data-device={layout?.device?.name ?? ""} data-screen={layout ? [layout.screen.x0, layout.screen.y0, layout.screen.x1, layout.screen.y1].join(",") : ""}
      data-scroll={(p.scroll.get(p.current) ?? [0, 0]).join(",")} style={{ flex: 1, width: "100%", minHeight: 0, touchAction: "none" }}
      onPointerDown={e => { setMenu(undefined); pointer(e, "down"); }} onPointerMove={e => pointer(e, "move")} onPointerUp={e => pointer(e, "up")}
      onPointerEnter={() => { over.current = true; }}
      onPointerLeave={() => { over.current = false; const s = screenNow(); if (s && input.current!.move(s, undefined, false, now())) redraw(); }} />
    {!screen && <p role="status" style={{ color: "#aaa" }}>Select a frame to preview it</p>}
    {!pane && !hidden && doc && <nav aria-label="Prototype navigation" style={{ position: "absolute", left: "50%", bottom: 18, transform: "translateX(-50%)", display: "flex", gap: 6, alignItems: "center",
      background: "#2c2c2c", color: "white", border: "1px solid #444", borderRadius: 9, padding: "5px 8px", fontSize: 12 }}>
      <button type="button" aria-label="Previous frame" title="Previous frame" disabled={prev === undefined} onClick={() => { if (prev !== undefined) { p.go(prev, { type: "instant" }, 0, "linear", now(), true, false); redraw(); } }}>‹</button>
      <span aria-label="Frame position">{index + 1} / {frames.length}</span>
      <button type="button" aria-label="Next frame" title="Next frame" disabled={next === undefined} onClick={() => { if (next !== undefined) { p.go(next, { type: "instant" }, 0, "linear", now(), true, false); redraw(); } }}>›</button>
      <span aria-hidden="true">|</span>
      <span style={{ position: "relative" }}>
        <button type="button" aria-haspopup="menu" aria-expanded={menu === "device"} aria-label="Device" onClick={() => setMenu(menu === "device" ? undefined : "device")}>{!settings || settings.device === "None" || !settings.device ? "No device" : settings.device}</button>
        {menu === "device" && <div role="menu" aria-label="Devices" style={{ ...menuStyle, bottom: 30, left: 0, width: 212, maxHeight: 410, overflowY: "auto" }}>
          {check(!settings || settings.device === "None" || !settings.device, "No device", () => chooseDevice("None"))}
          <hr />
          {devices.map(d => check(settings?.device === d.name, `${d.name}  ${d.width}×${d.height}`, () => chooseDevice(d.name)))}
          <hr />
          {check(settings?.device === customDevice, "Custom size", () => chooseDevice(customDevice))}
        </div>}
      </span>
      <span style={{ position: "relative" }}>
        <button type="button" aria-haspopup="menu" aria-expanded={menu === "scale"} aria-label="Size" onClick={() => setMenu(menu === "scale" ? undefined : "scale")}>{scaleLabel(p.view.scale, onDevice)}</button>
        {menu === "scale" && <div role="menu" aria-label="Sizes" style={{ ...menuStyle, bottom: 30, right: 0, width: 212 }}>
          {scaleOptions(onDevice).map(sc => check(p.view.scale === sc, scaleLabel(sc, onDevice), () => { setView({ scale: sc }); setMenu(undefined); }))}
        </div>}
      </span>
    </nav>}
    {barsNotice && p.view.hideUi && <p role="status"
      style={{ position: "absolute", left: "50%", bottom: 18, transform: "translateX(-50%)", background: "#2c2c2c", color: "white", padding: "6px 10px", borderRadius: 6, fontSize: 12 }}>
      The bars are hidden. {hideKey} shows them again</p>}
    {notice && <div role="alertdialog" aria-label="Leaving the prototype" style={{ position: "absolute", left: "50%", top: "40%", transform: "translate(-50%, -50%)", width: 340, zIndex: 70,
      background: "#2c2c2c", color: "white", border: "1px solid #444", borderRadius: 8, padding: 16, fontSize: 12 }}>
      <h3 style={{ margin: "0 0 8px", fontSize: 13 }}>Leaving the prototype</h3>
      <p style={{ margin: 0 }}>{goesToWebsite(notice.url) ? "This link opens a website outside the prototype:" : "This link opens your mail app to write a message:"}</p>
      <p style={{ margin: "4px 0 8px", opacity: 0.7, fontSize: 11, wordBreak: "break-all" }}>{notice.url}</p>
      {notice.skip !== undefined && <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input type="checkbox" checked={notice.skip} onChange={e => { p.linkNotice = { ...notice, skip: e.target.checked }; redraw(); }} />Don't show this again</label>}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button type="button" onClick={() => { if (input.current!.answerNotice(true, openLink)) engine.execute("proto.linkNotice", { show: false }); redraw(); }}>Open link</button>
        <button type="button" onClick={() => { input.current!.answerNotice(false, openLink); redraw(); }}>Cancel</button>
      </div>
    </div>}
  </section>;
}
