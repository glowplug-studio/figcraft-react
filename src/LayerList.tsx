import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { BooleanIcon } from "./BooleanMenu";
import { booleanLabel } from "./engine/structure";
import { isLeaf, type NodeId, type PageNode } from "./engine/document";
import type { LayerPanelProps } from "./LayerPanel";

const ROW_HEIGHT = 32;
const WINDOW_THRESHOLD = 128;
// Stay within browser layout height limits even for very large native archives.
const MAX_SCROLL_HEIGHT = 8_000_000;

interface LayerRow {
  id: NodeId;
  depth: number;
  position: number;
  siblings: number;
}

function selectButton(host: HTMLElement | null, id: NodeId) {
  return host?.querySelector<HTMLButtonElement>(`[data-layer-id="${CSS.escape(id)}"] [data-select-layer]`);
}

export function LayerList({ document, selection, editable, dispatch }: LayerPanelProps) {
  const page = document.nodes[document.currentPage] as PageNode;
  const [collapsed, setCollapsed] = useState<ReadonlySet<NodeId>>(() => new Set());
  const viewport = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(320);
  const previousSelection = useRef<readonly NodeId[]>([]);
  const pendingReveal = useRef<NodeId | undefined>(undefined);
  const pendingFocus = useRef<NodeId | undefined>(undefined);
  const selected = useMemo(() => new Set(selection), [selection]);
  const visible = useMemo(() => {
    const rows: LayerRow[] = [];
    function visit(ids: readonly NodeId[], depth: number) {
      for (let i = ids.length - 1; i >= 0; i--) {
        const id = ids[i], node = document.nodes[id];
        if (!node || node.kind === "page") continue;
        rows.push({id, depth, position: ids.length - i, siblings: ids.length});
        if (!isLeaf(node) && !collapsed.has(id)) visit(node.children, depth + 1);
      }
    }
    visit(page.children, 0);
    return rows;
  }, [page, document.nodes, collapsed]);
  const windowed = visible.length > WINDOW_THRESHOLD;
  const contentHeight = Math.min(MAX_SCROLL_HEIGHT, visible.length * ROW_HEIGHT);
  const extent = Math.max(0, contentHeight - height);
  const rowExtent = Math.max(0, visible.length * ROW_HEIGHT - height);
  const scale = extent > 0 ? rowExtent / extent : 1;
  const offset = Math.min(scroll, extent) * scale;
  const first = Math.max(0, Math.floor(offset / ROW_HEIGHT) - 1);
  const end = Math.min(visible.length, Math.ceil((offset + height) / ROW_HEIGHT) + 1);

  useLayoutEffect(() => {
    const host = viewport.current;
    if (!host) return;
    const resize = () => {
      setHeight(host.clientHeight);
      setScroll(host.scrollTop);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    return () => observer.disconnect();
  }, [windowed]);

  useLayoutEffect(() => {
    const changed = selection.length !== previousSelection.current.length ||
      selection.some((id, i) => id !== previousSelection.current[i]);
    if (changed) {
      previousSelection.current = selection;
      pendingReveal.current = selection[0];
      const expanded = new Set(collapsed);
      for (const id of selection) {
        let node = document.nodes[id];
        while (node && node.kind !== "page") {
          expanded.delete(node.parent);
          node = document.nodes[node.parent];
        }
      }
      if (expanded.size !== collapsed.size) { setCollapsed(expanded); return; }
    }
    const id = pendingReveal.current;
    if (id === undefined) return;
    pendingReveal.current = undefined;
    const host = viewport.current;
    const index = visible.findIndex(row => row.id === id);
    if (!host || index < 0) return;
    const top = index * ROW_HEIGHT, current = host.scrollTop * scale;
    if (top < current) host.scrollTop = top / scale;
    else if (top + ROW_HEIGHT > current + host.clientHeight) host.scrollTop = (top + ROW_HEIGHT - host.clientHeight) / scale;
    setScroll(host.scrollTop);
  }, [selection, collapsed, document.nodes, visible, scale]);

  useLayoutEffect(() => {
    if (pendingFocus.current === undefined) return;
    const button = selectButton(viewport.current, pendingFocus.current);
    if (button) { button.focus({preventScroll: true}); pendingFocus.current = undefined; }
  });

  function navigate(event: KeyboardEvent, index: number) {
    const direction = event.key;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
      !["Home", "End", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(direction)) return;
    event.preventDefault();
    event.stopPropagation();
    const node = document.nodes[visible[index].id];
    let next = index;
    if (direction === "Home") next = 0;
    if (direction === "End") next = visible.length - 1;
    if (direction === "ArrowUp") next = Math.max(0, index - 1);
    if (direction === "ArrowDown") next = Math.min(visible.length - 1, index + 1);
    if (direction === "ArrowRight" && !isLeaf(node) && node.children.length) {
      if (collapsed.has(node.id)) { toggle(node.id); return; }
      next = index + 1;
    }
    if (direction === "ArrowLeft") {
      if (!isLeaf(node) && node.children.length && !collapsed.has(node.id)) { toggle(node.id); return; }
      const parentIndex = visible.findIndex(item => item.id === node.parent);
      if (parentIndex >= 0) next = parentIndex;
    }
    const host = viewport.current!;
    const top = next * ROW_HEIGHT, current = host.scrollTop * scale;
    const target = Math.max(top + ROW_HEIGHT - host.clientHeight, Math.min(current, top));
    host.scrollTop = target / scale;
    const id = visible[next].id;
    const button = selectButton(host, id);
    if (button) button.focus({preventScroll:true}); else pendingFocus.current = id;
    setScroll(host.scrollTop);
  }

  function toggle(id: NodeId) {
    setCollapsed(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function row(id: NodeId, depth: number, index?: number): ReactNode {
    const node = document.nodes[id];
    if (!node || node.kind === "page") return null;
    const parent = document.nodes[node.parent];
    const own = parent?.kind === "booleanOp" && parent.children[0] !== id && node.boolOp !== parent.op ? node.boolOp : undefined;
    const group = !isLeaf(node) ? node : undefined;
    const expanded = !!group && !collapsed.has(id);
    return <li key={id} aria-current={selected.has(id) ? "true" : undefined} data-layer-id={id}
      role={index === undefined ? undefined : "treeitem"}
      aria-level={index === undefined ? undefined : depth + 1} aria-selected={index === undefined ? undefined : selected.has(id)}
      aria-expanded={index !== undefined && group ? expanded : undefined}
      aria-setsize={index === undefined ? undefined : visible[index].siblings}
      aria-posinset={index === undefined ? undefined : visible[index].position}
      style={{ paddingInlineStart: `${depth * 1.1}rem`, ...(index !== undefined && {height:ROW_HEIGHT, paddingBlock:0, whiteSpace:"nowrap", boxSizing:"border-box"}) }}
      onKeyDown={index === undefined ? undefined : event => navigate(event,index)}>
      {group && <button type="button" aria-label={`${expanded ? "Collapse" : "Expand"} ${group.kind} ${group.name}`} aria-expanded={expanded}
        onClick={() => toggle(id)}>{expanded ? "▾" : "▸"}</button>}
      <button type="button" data-select-layer="" disabled={!editable} onClick={event => dispatch("select.set", {
        ids: event.shiftKey ? selected.has(id) ? selection.filter(current => current !== id) : [...selection, id] : [id],
      })}>{node.kind === "booleanOp" && <BooleanIcon op={node.op}/>} {node.name}</button>
      {own && <span aria-label={booleanLabel(own) + " operand"} title={booleanLabel(own)}><BooleanIcon op={own} /></span>}
      {index === undefined && group && expanded && <ul aria-label={`Children of ${group.name}`}>{nested(group.children,depth+1)}</ul>}
    </li>;
  }
  function nested(ids: readonly NodeId[], depth: number) {
    return [...ids].reverse().map(id => row(id,depth));
  }
  if (!windowed) return <ul aria-label="Page layers">{nested(page.children,0)}</ul>;
  return <div ref={viewport} aria-label="Scroll layers" role="region" tabIndex={0}
    style={{overflow:"auto",height:"min(40vh, 384px)",overflowAnchor:"none"}} onScroll={event => setScroll(event.currentTarget.scrollTop)}>
    <div style={{height:contentHeight,position:"relative"}}>
      <ul role="tree" aria-multiselectable="true" aria-label="Page layers" style={{position:"absolute",top:first * ROW_HEIGHT - offset + Math.min(scroll,extent),margin:0,padding:0,listStyle:"none"}}>
        {visible.slice(first,end).map(({id,depth}, i) => row(id,depth, first+i))}
      </ul>
    </div>
  </div>;
}
