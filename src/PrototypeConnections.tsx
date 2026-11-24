import { useMemo, useState, useSyncExternalStore } from "react";
import type { EditorEngine, EditorSnapshot } from "./engine/editor";
import type { NodeId } from "./engine/document";
import type { Point } from "./engine/geometry";
import { bezierAt, bezierDistance, connections, curveBetween, dragCurve, handleRadius, targetAt, type Curve, type ScreenRect } from "./engine/prototype-connections";
import { boundsOf, pageToScreen, screenToPage } from "./engine/viewport";

type Dispatch = (command: string, params?: Record<string, unknown>) => Record<string, unknown> | undefined;
export interface OpenInteraction { readonly node: NodeId; readonly index: number }
interface Props { engine: EditorEngine; snapshot: EditorSnapshot; editable: boolean; dispatch: Dispatch; open: OpenInteraction | null; setOpen: (o: OpenInteraction | null) => void }

const path = (c: Curve) => `M${c[0].x} ${c[0].y}C${c[1].x} ${c[1].y} ${c[2].x} ${c[2].y} ${c[3].x} ${c[3].y}`;
/** Native `arrow`: a head at the curve's end, along its last tenth. */
function arrowHead(c: Curve) {
  const tip = c[3], back = bezierAt(c, 0.9);
  let dx = tip.x - back.x, dy = tip.y - back.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 0.5)) { dx = 1; dy = 0; } else { dx /= len; dy /= len; }
  const nx = -dy, ny = dx;
  return `${tip.x},${tip.y} ${tip.x - dx * 8 + nx * 4.5},${tip.y - dy * 8 + ny * 4.5} ${tip.x - dx * 8 - nx * 4.5},${tip.y - dy * 8 - ny * 4.5}`;
}

/** Source: upstream ui-egui/src/canvas/proto_canvas.rs: connections, handles and a connection dragged out of a layer, while the Prototype tab is open. */
export function PrototypeConnections({ engine, snapshot, editable, dispatch, open, setOpen }: Props) {
  const view = useSyncExternalStore(engine.subscribeView, engine.getView, engine.getView);
  const doc = snapshot.document, page = doc.currentPage, selection = snapshot.selection;
  const [drag, setDrag] = useState<{ source: NodeId; from: Point; at: Point } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const screen = (id: NodeId): ScreenRect | undefined => {
    const b = boundsOf(doc, [id]);
    if (!b) return undefined;
    const a = pageToScreen(view, { x: b.x, y: b.y }), z = pageToScreen(view, { x: b.x + b.width, y: b.y + b.height });
    return { x0: a.x, y0: a.y, x1: z.x, y1: z.y };
  };
  const noodles = useMemo(() => connections(doc, page), [doc, page]);
  const drawn = noodles.flatMap(n => { const a = screen(n.source), b = screen(n.dest); return a && b ? [{ ...n, curve: curveBetween(a, b) }] : []; });
  // Native `handles`: the selected layers' handles, at their right edge.
  const handles = selection.slice(0, 32).flatMap(id => { const r = doc.nodes[id]?.kind !== "page" ? screen(id) : undefined; return r ? [{ id, at: { x: r.x1 + handleRadius + 4, y: (r.y0 + r.y1) / 2 } }] : []; });
  const target = drag ? targetAt(doc, page, drag.source, screenToPage(view, drag.at)) : undefined;
  const targetRect = target ? screen(target.node) : undefined;
  const local = (e: React.PointerEvent) => { const box = (e.currentTarget as Element).closest("svg")!.getBoundingClientRect(); return { x: e.clientX - box.left, y: e.clientY - box.top }; };
  return <svg className="figcraft-prototype-connections" aria-label="Prototype connections" role="group"
    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: drag ? "all" : "none", overflow: "visible" }}
    onPointerMove={e => { if (drag) setDrag({ ...drag, at: local(e) }); }}
    onPointerUp={e => {
      if (!drag) return;
      const at = local(e), t = targetAt(doc, page, drag.source, screenToPage(view, at));
      setDrag(null);
      if (!t) return;
      const r = dispatch("proto.interaction.add", t.kind === "navigate" ? { ids: [Number(drag.source)], dest: Number(t.node) } : { ids: [Number(drag.source)], action: { type: "changeTo", dest: Number(t.node) } });
      if (r && typeof r.index === "number") setOpen({ node: drag.source, index: r.index });
    }}>
    {drawn.map(n => {
      const key = n.source + "/" + n.index, selected = selection.includes(n.source), isOpen = open?.node === n.source && open.index === n.index;
      const strong = selected || isOpen || hover === key, width = isOpen || hover === key ? 2.5 : selected ? 2 : 1.5;
      const dest = (selected || isOpen) ? screen(n.dest) : undefined;
      return <g key={key} className="figcraft-connection" opacity={strong ? 1 : 0.55}>
        {dest && <rect x={dest.x0} y={dest.y0} width={dest.x1 - dest.x0} height={dest.y1 - dest.y0} fill="none" stroke="var(--figcraft-accent, #0d99ff)" strokeOpacity={0.7} />}
        <path d={path(n.curve)} fill="none" stroke="var(--figcraft-accent, #0d99ff)" strokeWidth={width} />
        {/* A wider invisible stroke takes clicks within five points, as native's hit test does. */}
        <path d={path(n.curve)} fill="none" stroke="transparent" strokeWidth={10} style={{ pointerEvents: "stroke", cursor: "pointer" }}
          role="button" aria-label={`Connection from ${doc.nodes[n.source]?.name} to ${doc.nodes[n.dest]?.name}`}
          onPointerEnter={() => setHover(key)} onPointerLeave={() => setHover(h => h === key ? null : h)}
          onPointerDown={e => {
            if (bezierDistance(n.curve, local(e)) >= 5 && e.pointerType === "mouse") return;
            e.stopPropagation();
            engine.execute("select.set", { ids: [Number(n.source)] });
            setOpen({ node: n.source, index: n.index });
          }} />
        <circle cx={n.curve[0].x} cy={n.curve[0].y} r={3.5} fill="var(--figcraft-accent, #0d99ff)" stroke="white" />
        <polygon points={arrowHead(n.curve)} fill="var(--figcraft-accent, #0d99ff)" />
      </g>;
    })}
    {drag && <>
      {targetRect && <rect x={targetRect.x0} y={targetRect.y0} width={targetRect.x1 - targetRect.x0} height={targetRect.y1 - targetRect.y0} fill="none" stroke="var(--figcraft-accent, #0d99ff)" strokeWidth={2} />}
      <path d={path(dragCurve(drag.from, drag.at))} fill="none" stroke="var(--figcraft-accent, #0d99ff)" strokeWidth={2} />
      <polygon points={arrowHead(dragCurve(drag.from, drag.at))} fill="var(--figcraft-accent, #0d99ff)" />
    </>}
    {editable && !drag && handles.map(h => <g key={h.id} role="button" aria-label={`Connect ${doc.nodes[h.id]?.name}`} style={{ pointerEvents: "all", cursor: "crosshair" }}
      onPointerDown={e => { e.stopPropagation(); e.preventDefault(); setDrag({ source: h.id, from: h.at, at: local(e) }); }}>
      <circle cx={h.at.x} cy={h.at.y} r={handleRadius} fill="var(--figcraft-accent, #0d99ff)" stroke="white" strokeWidth={1.5} />
      <path d={`M${h.at.x - 3.5} ${h.at.y}H${h.at.x + 3.5}M${h.at.x} ${h.at.y - 3.5}V${h.at.y + 3.5}`} stroke="white" strokeWidth={1.5} />
    </g>)}
  </svg>;
}
