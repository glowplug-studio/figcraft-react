import type { PathCommand } from "./corners";
import { cubicPart, type Cubic } from "./cubic";
import type { Point } from "./geometry";

export type CurveElement = PathCommand | readonly ["Q",number,number,number,number];
type Quad = readonly [Point,Point,Point];

// Approximate the integral of the curvature of a parabola, and its inverse.
// This spaces samples at the same tolerance as the native Kurbo 0.13.1 flattener.
function integral(x:number) {
  return x / (0.33 + Math.sqrt(Math.sqrt(0.67**4 + 0.25*x*x)));
}
function inverseIntegral(x:number) {
  return x * (0.61 + Math.sqrt(0.39**2 + 0.25*x*x));
}

function subdivision(quad:Quad, sqrtTolerance:number) {
  const [a,b,c] = quad;
  const dx0 = b.x-a.x, dy0 = b.y-a.y, dx1 = c.x-b.x, dy1 = c.y-b.y;
  const ddx = dx0-dx1, ddy = dy0-dy1;
  const cross = (c.x-a.x)*ddy-(c.y-a.y)*ddx;
  const x0 = (dx0*ddx+dy0*ddy)/cross, x2 = (dx1*ddx+dy1*ddy)/cross;
  const scale = Math.abs(cross / (Math.hypot(ddx,ddy)*(x2-x0)));
  const a0 = integral(x0), a2 = integral(x2), delta = Math.abs(a2-a0);
  let weight = 0;
  if (Number.isFinite(scale)) {
    const root = Math.sqrt(scale);
    const sign = (v:number) => v<0 || Object.is(v,-0) ? -1 : 1;
    weight = sign(x0)===sign(x2) ? delta*root : sqrtTolerance*delta/integral(sqrtTolerance/root);
  }
  const u0 = inverseIntegral(a0);
  return {quad,weight,a0,a2,u0,uScale:1/(inverseIntegral(a2)-u0)};
}

function sample(params:ReturnType<typeof subdivision>,fraction:number): Point {
  const {quad:[a,b,c],a0,a2,u0,uScale} = params;
  const t = (inverseIntegral(a0+(a2-a0)*fraction)-u0)*uScale, s = 1-t;
  return {x:a.x*s*s + (b.x*s*2+c.x*t)*t, y:a.y*s*s + (b.y*s*2+c.y*t)*t};
}

/** Emit only line endpoints. Refuse an over-budget segment before allocating its sample list. */
export function flattenCurve(curve:Quad | Cubic,tolerance:number,budget:number,emit:(p:Point)=>void): boolean {
  if (budget<1) return false;
  const root = Math.sqrt(tolerance);
  if (curve.length===3) {
    const params = subdivision(curve,root);
    const n = Math.max(1,Math.ceil(0.5*params.weight/root) || 1);
    if (n>budget) return false;
    for (let i=1;i<n;i++) emit(sample(params,i/n));
    emit(curve[2]);
    return true;
  }
  const [a,b,c,d] = curve;
  const dx = (3*c.x-d.x)-(3*b.x-a.x), dy = (3*c.y-d.y)-(3*b.y-a.y);
  const accuracy = tolerance*0.1;
  const pieces = Math.max(1,Math.ceil(((dx*dx+dy*dy)/(432*accuracy*accuracy))**(1/6)));
  // Collinear cubics can need many quadratic pieces but produce only one line.
  // This independent resource limit also bounds hostile tolerances passed by a caller.
  if (pieces>40_000) return false;
  const remaining = root*Math.sqrt(0.9);
  const parts:ReturnType<typeof subdivision>[] = [];
  let total = 0;
  for (let i=0;i<pieces;i++) {
    const [p,q,r,s] = cubicPart(curve,i/pieces,(i+1)/pieces);
    const mid = {x:((3*q.x-p.x)+(3*r.x-s.x))/4,y:((3*q.y-p.y)+(3*r.y-s.y))/4};
    const params = subdivision([p,mid,s],remaining);
    parts.push(params);
    total += params.weight;
  }
  const n = Math.max(1,Math.ceil(0.5*total/remaining) || 1);
  if (n>budget) return false;
  let index = 1, before = 0;
  const step = total/n;
  for (const part of parts) {
    while (index<=n && index*step<before+part.weight) {
      if (index>=budget) return false;
      emit(sample(part,(index*step-before)/part.weight));
      index++;
    }
    before += part.weight;
  }
  emit(d);
  return true;
}
