import { fromRgba8 } from "./colour";
import { flattenContours } from "./corners";
import { rectanglePaints, withRectanglePaints, type VectorNode } from "./document";
import type { Point } from "./geometry";
import { solidPaint } from "./solid-paint";
import { refitVector } from "./vector-edit";
import { vectorFaceAt, vectorFaces, type VectorFace } from "./vector-faces";
import { freezeNetwork, type VectorNetwork, type VectorRegion } from "./vector-network";
import { pathBounds, vectorFillContains, vectorRegionContains } from "./vector-path";

function interiorPoint(face: VectorFace): Point | undefined {
  const box = pathBounds(face.path);
  if (!box || !(box.width > 0 && box.height > 0) || !Number.isFinite(box.width + box.height)) return;
  const contours = flattenContours(face.path, Math.max(box.width, box.height) * .001);
  let best: Point | undefined, widest = 1e-9;
  for (const fraction of [.5, .3, .7, .15, .85, .05, .95]) {
    const y = box.y + box.height * (fraction + .0001234567);
    const xs = [];
    for (const contour of contours) for (let i = 1; i < contour.length; i++) {
      const a = contour[i - 1], b = contour[i];
      if ((a.y <= y && y < b.y) || (b.y <= y && y < a.y)) {
        const x = a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y);
        if (Number.isFinite(x)) xs.push(x);
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i += 2) {
      const width = xs[i] - xs[i - 1];
      if (width > widest) { widest = width; best = { x: (xs[i] + xs[i - 1]) / 2, y }; }
    }
  }
  return best;
}

const key = (loops: VectorRegion["loops"]) => JSON.stringify(loops.map(loop => [...loop].sort((a, b) => a - b)).sort());
const inheritedRegion = (face: VectorFace): VectorRegion => ({ loops: face.loops, winding: face.loops.length > 1 ? "evenOdd" : "nonZero" });
const legacyRegion = (r: VectorRegion) => r.fills === undefined && r.paintSpace === undefined;

function splitRegions(net: VectorNetwork, faces: readonly VectorFace[], keys: Set<string>): readonly VectorRegion[] {
  if (net.regions.every(r => keys.has(key(r.loops)))) return net.regions;
  const probes = faces.flatMap(face => {
    const point = interiorPoint(face);
    return point ? [{ region: inheritedRegion(face), point }] : [];
  });
  if (net.regions.every(legacyRegion)) return probes.filter(p => vectorFillContains(net, p.point)).map(p => p.region);
  return net.regions.flatMap((source, index) => probes.filter(p => vectorRegionContains(net, index, p.point))
    .map(p => ({ ...source, ...p.region })));
}

/** Local stamps share the action selected by the first face hit. */
export function paintVector(node: VectorNode, stamps: readonly Point[]): { node: VectorNode; filled: boolean } | undefined {
  const faces = vectorFaces(node.network);
  const hits = stamps.flatMap(point => {
    const face = vectorFaceAt(faces, point);
    return face ? [{ face, point }] : [];
  });
  if (!hits.length) return;
  const keys = new Map(faces.map(face => [face, key(face.loops)]));
  const inherited = rectanglePaints(node), inheritedVisible = inherited.some(p => p.visible);
  let net = node.network;
  let regions = splitRegions(net, faces, new Set(keys.values()));
  let filled: boolean | undefined;
  for (const { face, point } of hits) {
    const faceKey = keys.get(face)!;
    const matches = (r: VectorRegion) => key(r.loops) === faceKey;
    if (regions !== net.regions) net = { ...net, regions };
    const visible = regions.every(legacyRegion) ? inheritedVisible && vectorFillContains(net, point)
      : regions.some(r => matches(r) && (r.fills ?? inherited).some(p => p.visible));
    filled ??= !visible;
    if (visible !== filled) {
      regions = regions.filter(r => !matches(r));
      if (filled) regions = [...regions, inheritedRegion(face)];
    }
  }
  if (filled === undefined) return;
  const network = regions === node.network.regions ? node.network : freezeNetwork({ ...node.network, regions });
  let edited = refitVector(Object.freeze({ ...node, network }));
  if (filled && !inheritedVisible) {
    const targeted = new Set<number>();
    const refitted = edited.network;
    for (const point of stamps) {
      for (let i = refitted.regions.length - 1; i >= 0; i--) {
        if (vectorRegionContains(refitted, i, point)) { targeted.add(i); break; }
      }
    }
    regions = refitted.regions.map((r, i) => r.fills === undefined && !targeted.has(i) ? { ...r, fills: [] } : r);
    edited = withRectanglePaints({ ...edited, network: freezeNetwork({ ...refitted, regions }) }, [solidPaint(fromRgba8(217, 217, 217))]);
  }
  return { node: edited, filled };
}
