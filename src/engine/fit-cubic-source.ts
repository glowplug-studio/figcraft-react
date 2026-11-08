// Equal segment intervals and prefix moments follow Kurbo SimplifyBezPath (see NOTICE).
import { cubicDerivative, cubicPoint, type Cubic } from "./cubic";
import type { Moments } from "./fit-polyline";
import type { FitSource } from "./pencil-fit";

// Five-point Gauss–Legendre integrates polynomials through degree nine exactly. For a
// cubic, y dx, xy dx and y² dx have degree at most eight in the curve parameter.
const abscissae = [0, -.5384693101056831, .5384693101056831, -.906179845938664, .906179845938664];
const weights = [.5688888888888889, .4786286704993665, .4786286704993665, .2369268850561891, .2369268850561891];
function integrals(curve: Cubic, from: number, to: number): Moments {
  const half = (to-from)/2, mid = (from+to)/2;
  let a=0, x=0, y=0;
  for (let i=0; i<weights.length; i++) {
    const t=mid + half*abscissae[i], point=cubicPoint(curve,t);
    const weightedY=weights[i]*point.y*cubicDerivative(curve,t).x;
    a+=weightedY; x+=weightedY*point.x; y+=weightedY*point.y;
  }
  return [half*a,half*x,half*y];
}

export class CubicFitSource implements FitSource {
  readonly #prefix: Moments[] = [[0,0,0]];
  constructor(private readonly curves: readonly Cubic[]) {
    if (!curves.length) throw new Error("Curve fitting requires at least one segment");
    for (const curve of curves) {
      const m=integrals(curve,0,1), last=this.#prefix.at(-1)!;
      const sum: Moments=[last[0]+m[0],last[1]+m[1],last[2]+m[2]];
      if (!sum.every(Number.isFinite)) throw new Error("Curve fitting moments overflowed");
      this.#prefix.push(sum);
    }
  }
  #position(t: number) {
    const at=t*this.curves.length, index=Math.min(this.curves.length-1,Math.floor(at));
    return { index, local:at-index };
  }
  sample(t: number) {
    const {index,local}=this.#position(t), curve=this.curves[index], tangent=cubicDerivative(curve,local);
    return { point:cubicPoint(curve,local), tangent, derivative:{x:tangent.x*this.curves.length,y:tangent.y*this.curves.length} };
  }
  moments(from: number, to: number): Moments {
    const a=this.#position(from), b=this.#position(to);
    if (a.index===b.index) return integrals(this.curves[a.index],a.local,b.local);
    const left=integrals(this.curves[a.index],a.local,1), right=integrals(this.curves[b.index],0,b.local);
    const start=this.#prefix[a.index+1], end=this.#prefix[b.index];
    return [left[0]+right[0]+(end[0]-start[0]),left[1]+right[1]+(end[1]-start[1]),left[2]+right[2]+(end[2]-start[2])];
  }
}
