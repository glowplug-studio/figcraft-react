import { inverse, transformPoint, type Affine } from "./affine";
import { layerTransform, type Document, type NodeId } from "./document";
import type { Point } from "./geometry";
import { HierarchyDraft, worldTransform } from "./hierarchy";
import { parseBoolean, parseNodeId, parseNumber, parseString } from "./parameters";
import { validateChangedGeometry } from "./rotation";
import { strokeCaps, strokeEnum } from "./stroke";
import { wireVectorNetwork } from "./vector-codec";
import { bendSegment, deleteVertices, moveHandles, moveVertices, removeSegments, setHandle, setMirroring, smoothVertices, splitSegment, type VectorHandle } from "./vector-edit-ops";
import { beginVectorEdit, clampVectorEdit, clearVectorSelection, freezeVectorEdit, refitVector, selectVectorParts, selectedVectorPoints, vectorEditOverlay, vectorNetwork, vectorParts, vectorSelectionPosition, type VectorEditPart, type VectorEditState } from "./vector-edit";
import { freezeNetwork, networkMirroring, type VectorNetwork, type VectorVertex } from "./vector-network";
import { pointBoxCentre, pointBoxCorners, pointBoxOnto, pointRotationMatrix, transformVectorPoints, vectorPointBox } from "./vector-point-transform";
import { hitVector } from "./vector-edit-hit";
import { connectVectorPoints, joinVectorPoints } from "./vector-connect";
import { isVectorJoin, type VectorJoinCommand } from "./vector-commands";
import { paintVector } from "./vector-paint";
import { applyPen, planPen } from "./vector-pen";

import { editWidthPoint, widthHandles } from "./vector-width";

export const vectorEditSpecs = Object.freeze({
  "vector.edit.begin": { label: "Edit vector", undo: false },
  "vector.edit.end": { label: "Done editing", undo: false },
  "vector.edit.state": { label: "Vector edit state", undo: false },
  "vector.edit.tool": { label: "Vector edit tool", undo: false },
  "vector.edit.widthPoint": { label: "Width point", undo: true },
  "vector.edit.connect": { label: "Connect points", undo: true },
  "vector.edit.paint": { label: "Paint bucket", undo: true },
  "vector.edit.pen": { label: "Pen point", undo: true },
  "vector.edit.penEnd": { label: "End pen path", undo: false },
  "vector.edit.select": { label: "Select points", undo: false },
  "vector.edit.selectAll": { label: "Select all points", undo: false },
  "vector.edit.moveVertices": { label: "Move points", undo: true },
  "vector.edit.nudge": { label: "Nudge points", undo: true },
  "vector.edit.position": { label: "Point position", undo: true },
  "vector.edit.bounds": { label: "Selected points' bounds", undo: false },
  "vector.edit.resize": { label: "Resize points", undo: true },
  "vector.edit.rotate": { label: "Rotate points", undo: true },
  "vector.edit.transform": { label: "Transform points", undo: true },
  "vector.edit.setHandle": { label: "Set handle", undo: true },
  "vector.edit.moveHandles": { label: "Move handles", undo: true },
  "vector.edit.mirroring": { label: "Handle mirroring", undo: true },
  "vector.edit.smooth": { label: "Smooth or sharpen points", undo: true },
  "vector.edit.bend": { label: "Bend segment", undo: true },
  "vector.edit.addVertex": { label: "Add point", undo: true },
  "vector.edit.delete": { label: "Delete points", undo: true },
  "vector.deleteHeal": { label: "Delete and heal selection", undo: true },
  "vector.edit.cornerRadius": { label: "Point corner radius", undo: true },
  "vector.edit.strokeCap": { label: "Point stroke cap", undo: true },
  "vector.edit.strokeJoin": { label: "Point stroke join", undo: true },
});
export type VectorEditCommand = keyof typeof vectorEditSpecs;
const allowed: Record<VectorEditCommand, readonly string[]> = {
  "vector.edit.begin": ["id", "ids"], "vector.edit.end": [], "vector.edit.state": [], "vector.edit.tool": ["tool"],
  "vector.edit.widthPoint": ["action", "index", "t", "scale", "width", "side"],
  "vector.edit.connect": ["a", "b"],
  "vector.edit.paint": ["x", "y", "points"],
  "vector.edit.pen": ["x", "y", "dx", "dy"], "vector.edit.penEnd": [],
  "vector.edit.select": ["vertices", "segments", "handles", "regions", "id", "add"], "vector.edit.selectAll": [],
  "vector.edit.moveVertices": ["vertices", "dx", "dy"], "vector.edit.nudge": ["dx", "dy"], "vector.edit.position": ["x", "y"],
  "vector.edit.bounds": [], "vector.edit.resize": ["width", "height", "center"], "vector.edit.rotate": ["angle", "cx", "cy"], "vector.edit.transform": ["matrix", "vertices"],
  "vector.edit.setHandle": ["segment", "start", "x", "y", "independent"], "vector.edit.moveHandles": ["dx", "dy", "handles", "independent"],
  "vector.edit.mirroring": ["mode", "vertices"], "vector.edit.smooth": ["vertices", "smooth"], "vector.edit.bend": ["segment", "t", "x", "y"],
  "vector.edit.addVertex": ["segment", "t"], "vector.edit.delete": ["vertices", "segments"], "vector.deleteHeal": ["vertices"],
  "vector.edit.cornerRadius": ["radius", "vertices"], "vector.edit.strokeCap": ["cap", "vertices"], "vector.edit.strokeJoin": ["join", "vertices"],
};
const num = (p: Record<string, unknown>, key: string, fallback: number): number => { try { return parseNumber(p[key], key); } catch { return fallback; } };
function index(value: unknown, key: string): number { const n = parseNumber(value, key); if (n < 0 || n >= 1e9) throw new Error(`${key} out of range`); return Math.trunc(n); }
export function vectorIndices(value: unknown): number[] | undefined {
  return Array.isArray(value) ? value.flatMap(v => { try { return [index(v, "index")]; } catch { return []; } }) : undefined;
}
function handles(value: unknown): VectorHandle[] | undefined {
  return Array.isArray(value) ? value.flatMap(v => {
    if (!Array.isArray(v) || typeof v[1] !== "boolean") return [];
    try { return [[index(v[0], "segment"), v[1]] as VectorHandle]; } catch { return []; }
  }).slice(0, 100_000) : undefined;
}
export function vectorLocalOffset(world: Affine, delta: Point): Point {
  const m = inverse(world), origin = transformPoint(m, { x: 0, y: 0 }), next = transformPoint(m, delta);
  return { x: next.x - origin.x, y: next.y - origin.y };
}
function pointSets(document: Document, state: VectorEditState, p: Record<string, unknown>, ends: boolean): readonly VectorEditPart[] {
  const vertices = vectorIndices(p.vertices); if (vertices) return [{ id: state.id, vertices, segments: [] }];
  return vectorParts(state).flatMap(part => {
    const net = vectorNetwork(document, part.id); if (!net) return [];
    const points = ends ? selectedVectorPoints(net, part) : part.vertices;
    return points.length ? [{ id: part.id, vertices: points, segments: [] }] : [];
  });
}
function pointProperty<K extends "radius" | "cap" | "join">(net: VectorNetwork, indices: readonly number[], key: K, value: VectorVertex[K]): VectorNetwork {
  const selected = new Set(indices); let changed = false;
  const vertices = net.vertices.map((v, i) => {
    if (!selected.has(i) || v[key] === value) return v;
    changed = true; const next = { ...v, [key]: value }; if (value === undefined) delete next[key]; return next;
  });
  return changed ? freezeNetwork({ ...net, vertices }) : net;
}
export interface VectorEditResult { document: Document; selection: readonly NodeId[]; state: VectorEditState | undefined; recordHistory: boolean; result: Record<string, unknown> }
export function executeVectorEdit(command: VectorEditCommand | VectorJoinCommand, document: Document, selection: readonly NodeId[], state: VectorEditState | undefined, p: Record<string, unknown>): VectorEditResult {
  for (const key of Object.keys(p)) if (!isVectorJoin(command) && !allowed[command].includes(key)) throw new Error(`Unsupported ${command} parameter: ${key}`);
  const result: VectorEditResult = { document, selection, state, recordHistory: false, result: { ok: true } };
  if (command === "vector.edit.begin") {
    const id = parseNodeId(p.id), ids = Array.isArray(p.ids) ? p.ids.flatMap(v => { const i = parseNodeId(v); return i === undefined ? [] : [i]; }) : id ? [id] : selection;
    const next = beginVectorEdit(document, ids); return { ...result, ...next, recordHistory: next.document !== document, result: { id: next.state.id, layers: next.selection } };
  }
  if (command === "vector.edit.end") {
    const empty = state ? vectorParts(state).filter(part => vectorNetwork(document, part.id)?.segments.length === 0).map(p => p.id) : [];
    if (empty.length) { const draft = new HierarchyDraft(document); for (const id of empty) draft.remove(id); draft.normaliseGroups(); result.document = draft.finish(); result.selection = Object.freeze(selection.filter(id => result.document.nodes[id])); }
    return { ...result, state: undefined };
  }
  if (!state) throw new Error("Not in vector edit mode");
  if (command === "vector.edit.state") {
    const net = vectorNetwork(document, state.id); if (!net) throw new Error("Not a vector");
    return { ...result, result: { id: state.id, tool: state.tool, overlay: { ...vectorEditOverlay(document, state), anchor: state.anchor ?? null }, network: wireVectorNetwork(net), mirroring: net.vertices.map((_, i) => networkMirroring(net, i)),
      widthPoints: widthHandles(document, state.id, 1), widthPoint: state.widthPoint ?? null,
      layers: vectorParts(state).map(p => p.id), others: state.others, handles: state.handles, regions: state.regions, regionHover: state.regionHover ?? null, regionVertices: state.regionVertices } };
  }
  if (command === "vector.edit.widthPoint") {
    const node = document.nodes[state.id];
    if (node?.kind !== "vector") throw new Error("Not a vector");
    const edited = editWidthPoint(node, p), draft = new HierarchyDraft(document);
    draft.set(edited.node);
    return { ...result, document: draft.finish(), state: freezeVectorEdit({ ...state, widthPoint: edited.index ?? undefined }),
      recordHistory: true, result: { index: edited.index, points: edited.points } };
  }
  if (command === "vector.edit.tool") {
    const tool = parseString(p.tool)?.toLowerCase(); if (tool !== "move" && tool !== "bend" && tool !== "pen" && tool !== "width" && tool !== "paint") throw new Error("This vector tool is not implemented yet");
    return { ...result, state: freezeVectorEdit({ ...state, tool, regionHover: undefined, ...(tool !== "pen" ? { anchor: undefined, penOut: undefined } : {}) }), result: { tool } };
  }
  if (command === "vector.edit.penEnd") return { ...result, state: freezeVectorEdit({ ...state, anchor: undefined, penOut: undefined }) };
  if (command === "vector.edit.select") return { ...result, state: selectVectorParts(document, state, {
    id: parseNodeId(p.id), vertices: vectorIndices(p.vertices), segments: vectorIndices(p.segments), handles: handles(p.handles), regions: vectorIndices(p.regions), add: parseBoolean(p.add),
  }) };
  if (command === "vector.edit.selectAll") {
    const selected = vectorParts(state).map(part => ({ id: part.id, vertices: Array.from({ length: vectorNetwork(document, part.id)?.vertices.length ?? 0 }, (_, i) => i), segments: [] }));
    return { ...result, state: freezeVectorEdit({ ...clearVectorSelection(state), vertices: selected[0].vertices, others: selected.slice(1) }), result: { count: selected.reduce((sum, part) => sum + part.vertices.length, 0) } };
  }
  const selectedBox = () => { const box = vectorPointBox(document, state); if (!box?.points.length) throw new Error("Select points"); return box; };
  if (command === "vector.edit.bounds") {
    const box = selectedBox(), position = vectorSelectionPosition(document, state);
    return { ...result, result: { x: position?.x ?? null, y: position?.y ?? null, width: box.width, height: box.height, corners: pointBoxCorners(box).map(p => [p.x, p.y]), points: box.points } };
  }
  const draft = new HierarchyDraft(document);
  const edit = (id: NodeId, f: (net: VectorNetwork) => VectorNetwork): void => {
    const node = draft.nodes[id]; if (node?.kind !== "vector") throw new Error("Not a vector");
    const network = f(node.network); draft.set(refitVector(network === node.network ? node : { ...node, network }));
  };
  const sets = (ends: boolean, f: (net: VectorNetwork, vertices: readonly number[], world: Affine) => VectorNetwork): void => {
    for (const part of pointSets(document, state, p, ends)) { const world = worldTransform(draft.document, part.id); edit(part.id, net => f(net, part.vertices, world)); }
  };
  switch (command) {
    case "vector.edit.paint": {
      const node = document.nodes[state.id];
      if (node?.kind !== "vector") throw new Error("Not a vector");
      const local = inverse(worldTransform(document, state.id));
      const stamps: Point[] = [];
      if (Array.isArray(p.points)) {
        for (const pair of p.points) {
          if (!Array.isArray(pair)) continue;
          try { stamps.push(transformPoint(local, { x: parseNumber(pair[0]), y: parseNumber(pair[1]) })); }
          catch { continue; }
          if (stamps.length === 10_000) break;
        }
      } else {
        stamps.push(transformPoint(local, { x: parseNumber(p.x, "x"), y: parseNumber(p.y, "y") }));
      }
      const painted = paintVector(node, stamps);
      if (!painted) throw new Error("click inside a closed area");
      draft.set(painted.node);
      result.result = { filled: painted.filled };
      break;
    }
    case "vector.edit.pen": {
      const net = vectorNetwork(document, state.id); if (!net) throw new Error("Not a vector");
      const point = { x: parseNumber(p.x, "x"), y: parseNumber(p.y, "y") }, world = worldTransform(document, state.id);
      const decision = planPen(net, state.anchor, hitVector(document, state, point, 6), transformPoint(inverse(world), point), false);
      if (decision.kind !== "edit") {
        const anchor = decision.kind === "start" ? decision.vertex : undefined;
        return { ...result, state: freezeVectorEdit({ ...state, anchor, penOut: undefined, ...(anchor !== undefined ? { vertices: [anchor], segments: [] } : {}) }), result: { vertex: anchor ?? null } };
      }
      const m = inverse(world), dx = num(p, "dx", 0), dy = num(p, "dy", 0);
      // Native drops an overflowing optional drag, retaining the valid point edit.
      const delta = { x: m[0] * dx + m[2] * dy + m[4] - m[4], y: m[1] * dx + m[3] * dy + m[5] - m[5] };
      const drag = [delta.x, delta.y].every(Number.isFinite) && Math.hypot(delta.x, delta.y) > 1e-9 ? delta : undefined;
      let vertex: number | undefined;
      edit(state.id, network => { const next = applyPen(network, decision.plan, state.penOut, drag); vertex = next.vertex; return next.network; });
      const open = decision.plan.kind === "new";
      result.state = freezeVectorEdit({ ...state, vertices: vertex === undefined ? [] : [vertex], segments: [], anchor: open ? vertex : undefined, penOut: open && drag ? [drag.x, drag.y] : undefined });
      result.result = { vertex: vertex ?? null }; break;
    }
    case "vector.edit.connect": {
      const a = index(p.a, "a"), b = index(p.b, "b");
      edit(state.id, net => {
        const joined = connectVectorPoints(net, a, b);
        if (!joined) throw new Error("can't connect those points");
        result.result = { segment: joined.segment };
        return joined.network;
      });
      break;
    }
    case "vector.join": case "vector.smoothJoin": {
      edit(state.id, net => {
        const joined = joinVectorPoints(net, selectedVectorPoints(net, state), command === "vector.smoothJoin");
        result.result = { joins: joined.joins };
        return joined.network;
      });
      result.state = freezeVectorEdit({ ...state, segments: [] });
      break;
    }
    case "vector.edit.resize": {
      const box = selectedBox();
      const size = (key: string, fallback: number) => { try { return Math.max(0, Math.min(1e7, parseNumber(p[key]))); } catch { return fallback; } };
      const width = size("width", box.width), height = size("height", box.height);
      const centre = parseBoolean(p.center) ?? false, x = centre ? (box.width - width) / 2 : 0, y = centre ? (box.height - height) / 2 : 0;
      transformVectorPoints(draft, state.id, box.points, pointBoxOnto(box, x, y, x + width, y + height)); break;
    }
    case "vector.edit.rotate": {
      const box = selectedBox(), angle = parseNumber(p.angle, "angle"), centre = pointBoxCentre(box);
      transformVectorPoints(draft, state.id, box.points, pointRotationMatrix({ x: num(p, "cx", centre.x), y: num(p, "cy", centre.y) }, angle)); break;
    }
    case "vector.edit.transform": {
      const values = Array.isArray(p.matrix) ? p.matrix.flatMap(v => { try { return [parseNumber(v)]; } catch { return []; } }) : [];
      if (values.length !== 6) throw new Error("matrix must be [a, b, c, d, e, f]");
      const net = vectorNetwork(document, state.id); if (!net) throw new Error("Not a vector");
      const [a, b, c, d, e, f] = values;
      transformVectorPoints(draft, state.id, vectorIndices(p.vertices) ?? selectedVectorPoints(net, state), [a, b, c, d, e, f]); break;
    }
    case "vector.edit.moveVertices": sets(true, (net, points) => moveVertices(net, points, { x: num(p, "dx", 0), y: num(p, "dy", 0) })); break;
    case "vector.edit.nudge": {
      const delta = { x: num(p, "dx", 0), y: num(p, "dy", 0) };
      for (const part of pointSets(document, state, {}, true)) { const local = vectorLocalOffset(worldTransform(draft.document, part.id), delta); edit(part.id, net => moveVertices(net, part.vertices, local)); } break;
    }
    case "vector.edit.position": {
      const current = vectorSelectionPosition(document, state); if (!current) throw new Error("Select points");
      const node = document.nodes[state.id]; if (node.kind !== "vector") throw new Error("Not a vector");
      const delta = vectorLocalOffset(layerTransform(node), { x: num(p, "x", current.x) - current.x, y: num(p, "y", current.y) - current.y });
      edit(state.id, net => moveVertices(net, selectedVectorPoints(net, state), delta)); break;
    }
    case "vector.edit.setHandle": {
      const segment = index(p.segment, "segment"), start = parseBoolean(p.start) ?? true, x = parseNumber(p.x, "x"), y = parseNumber(p.y, "y");
      edit(state.id, net => { const s = net.segments[segment], v = s && net.vertices[start ? s.a : s.b]; return v ? setHandle(net, segment, start, [x - v.x, y - v.y], parseBoolean(p.independent) ?? false) : net; }); break;
    }
    case "vector.edit.moveHandles": {
      const selected = handles(p.handles) ?? state.handles; if (!selected.length) throw new Error("Select handles");
      const delta = vectorLocalOffset(worldTransform(document, state.id), { x: num(p, "dx", 0), y: num(p, "dy", 0) });
      edit(state.id, net => moveHandles(net, selected, delta, parseBoolean(p.independent) ?? false)); break;
    }
    case "vector.edit.mirroring": {
      const mode = (["none", "angle", "angleAndLength"] as const).find(x => x.toLowerCase() === parseString(p.mode)?.toLowerCase()); if (!mode) throw new Error("mode: none, angle or angleAndLength");
      sets(true, (net, points) => setMirroring(net, points, mode)); break;
    }
    case "vector.edit.smooth": sets(false, (net, points) => smoothVertices(net, points, parseBoolean(p.smooth) ?? true)); break;
    case "vector.edit.bend": {
      const segment = index(p.segment, "segment"), point = transformPoint(inverse(worldTransform(document, state.id)), { x: parseNumber(p.x, "x"), y: parseNumber(p.y, "y") });
      edit(state.id, net => bendSegment(net, segment, num(p, "t", .5), point)); break;
    }
    case "vector.edit.addVertex": {
      const segment = index(p.segment, "segment"); let vertex: number | undefined;
      edit(state.id, net => { const next = splitSegment(net, segment, num(p, "t", .5)); if (!next) throw new Error("No such segment"); vertex = next.vertex; return next.network; });
      result.state = freezeVectorEdit({ ...state, vertices: [vertex!], segments: [] }); result.result = { vertex }; break;
    }
    case "vector.edit.delete": case "vector.deleteHeal": {
      const vertices = vectorIndices(p.vertices), segments = vectorIndices(p.segments);
      const parts = command === "vector.deleteHeal" ? pointSets(document, state, p, false) : vertices === undefined && segments === undefined ? vectorParts(state) : [{ id: state.id, vertices: vertices ?? [], segments: segments ?? [] }];
      for (const part of parts) edit(part.id, net => {
        const segs = part.segments.filter(i => { const s = net.segments[i]; return s && !part.vertices.includes(s.a) && !part.vertices.includes(s.b); });
        const points = part.vertices.flatMap(i => net.vertices[i] ? [net.vertices[i]] : []), removed = removeSegments(net, segs);
        const now = points.flatMap(p => { const i = removed.vertices.findIndex(v => v.x === p.x && v.y === p.y); return i < 0 ? [] : [i]; });
        return deleteVertices(removed, now, command === "vector.deleteHeal");
      });
      result.state = freezeVectorEdit({ ...clearVectorSelection(state), anchor: undefined, penOut: undefined }); break;
    }
    case "vector.edit.cornerRadius": { const radius = Math.max(0, Math.min(1e6, parseNumber(p.radius, "radius"))); sets(true, (net, points) => pointProperty(net, points, "radius", radius)); break; }
    case "vector.edit.strokeCap": {
      if (!Object.hasOwn(p, "cap")) throw new Error("cap required (null for the layer's)");
      const cap = p.cap === null ? undefined : strokeEnum(p.cap, strokeCaps); sets(true, (net, points) => pointProperty(net, points, "cap", cap)); break;
    }
    case "vector.edit.strokeJoin": {
      if (!Object.hasOwn(p, "join")) throw new Error("join required (null for the layer's)");
      const join = p.join === null ? undefined : strokeEnum(p.join, ["miter", "bevel", "round"] as const); sets(true, (net, points) => pointProperty(net, points, "join", join)); break;
    }
  }
  draft.normaliseGroups(); result.document = validateChangedGeometry(draft);
  result.state = result.state && clampVectorEdit(result.document, result.state);
  result.recordHistory = result.document !== document;
  return result;
}
