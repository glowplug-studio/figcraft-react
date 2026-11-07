// Numerical methods adapted independently to TypeScript from Kurbo 0.13.1 common.rs.
// Copyright 2022 the Kurbo Authors. SPDX-License-Identifier: Apache-2.0 OR MIT
import { fitMultiplyAdd } from "./fit-fma";
const signed = (magnitude: number, sign: number): number => sign < 0 || Object.is(sign, -0) ? -Math.abs(magnitude) : Math.abs(magnitude);

/** Ascending coefficients; stable real quadratic roots, including linear/constant degeneracy. */
export function fitQuadratic(c0: number, c1: number, c2: number): number[] {
  const a = c0 / c2, b = c1 / c2;
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    const root = -c0 / c1;
    return Number.isFinite(root) ? [root] : c0 === 0 && c1 === 0 ? [0] : [];
  }
  const disc = b * b - 4 * a;
  if (disc < 0) return [];
  if (disc === 0) return [-.5 * b];
  const first = Number.isFinite(disc) ? -.5 * (b + signed(Math.sqrt(disc), b)) : -b, second = a / first;
  return Number.isFinite(second) ? [first, second].sort((x, y) => x - y) : [first];
}

/** Native candidate ordering is retained; the fitter breaks equal errors by this order. */
export function fitCubicRoots(c0: number, c1: number, c2: number, c3: number): number[] {
  const inverse = 1 / c3, a = c0 * inverse, b = c1 * (inverse / 3), c = c2 * (inverse / 3);
  if (![a, b, c].every(Number.isFinite)) return fitQuadratic(c0, c1, c2);
  const d0 = fitMultiplyAdd(-c, c, b), d1 = fitMultiplyAdd(-b, c, a), d2 = c * a - b * b;
  const disc = 4 * d0 * d2 - d1 * d1, depressed = fitMultiplyAdd(-2 * c, d0, d1);
  if (disc < 0) { const r = -.5 * depressed, s = Math.sqrt(-.25 * disc); return [Math.cbrt(r + s) + Math.cbrt(r - s) - c]; }
  if (disc === 0) { const t = signed(Math.sqrt(-d0), depressed); return [t - c, -2 * t - c]; }
  const angle = Math.atan2(Math.sqrt(disc), -depressed) / 3, cosine = Math.cos(angle), sine = Math.sin(angle) * Math.sqrt(3), scale = 2 * Math.sqrt(-d0);
  return [cosine, .5 * (-cosine + sine), .5 * (-cosine - sine)].map(root => fitMultiplyAdd(scale, root, -c));
}

const relativeError = (actual: number, expected: number) => expected === 0 ? Math.abs(actual) : Math.abs((actual - expected) / expected);
/** Orellana/De Michele dominant depressed-cubic root, with overflow-aware initialisation. */
function dominantRoot(g: number, h: number): number {
  const q = -g / 3, r = h / 2;
  const k = Math.abs(q) < 1e102 && Math.abs(r) < 1e154 ? undefined
    : Math.abs(q) < Math.abs(r) ? 1 - q * (q / r) ** 2 : Math.sign(q) * ((r / q) ** 2 / q - 1);
  let x: number;
  if (k !== undefined && r === 0) x = g > 0 ? 0 : Math.sqrt(-g);
  else if (k === undefined ? r * r < q ** 3 : k < 0) {
    const t = k === undefined ? r / Math.sqrt(q ** 3) : r / q / Math.sqrt(q);
    x = -2 * Math.sqrt(q) * signed(Math.cos(Math.acos(Math.abs(t)) / 3), t);
  } else {
    const v = k === undefined ? -r - signed(Math.sqrt(r * r - q ** 3), r)
      : Math.abs(q) < Math.abs(r) ? -r * (1 + Math.sqrt(k)) : -r - signed(Math.sqrt(Math.abs(q)) * q * Math.sqrt(k), r);
    const a = Math.cbrt(v); x = a + (a === 0 ? 0 : q / a);
  }
  let value = (x * x + g) * x + h;
  if (Math.abs(value) < 2.22045e-16 * Math.max(x ** 3, g * x, h)) return x;
  for (let i = 0; i < 8; i++) {
    const derivative = 3 * x * x + g; if (derivative === 0) break;
    const next = x - value / derivative, residual = (next * next + g) * next + h;
    if (residual === 0) return next;
    if (Math.abs(residual) >= Math.abs(value)) break;
    x = next; value = residual;
  }
  return x;
}

type Factors = readonly [readonly [number, number], readonly [number, number]];
/** Factors x⁴+ax³+bx²+cx+d as (x²+α₁x+β₁)(x²+α₂x+β₂).
 * The fitting path uses the unscaled native branch, including conjugate-pair factors. */
export function fitQuarticFactors(a: number, b: number, c: number, d: number): Factors | undefined {
  const error3 = (a1: number, b1: number, a2: number, b2: number) => relativeError(a1 + a2, a) + relativeError(b1 + a1 * a2 + b2, b) + relativeError(b1 * a2 + a1 * b2, c);
  const error4 = (a1: number, b1: number, a2: number, b2: number) => error3(a1, b1, a2, b2) + relativeError(b1 * b2, d);
  const disc = 9 * a * a - 24 * b, shift = disc >= 0 ? -2 * b / (3 * a + signed(Math.sqrt(disc), a)) : -.25 * a;
  const ap = a + 4 * shift, bp = b + 3 * shift * (a + 2 * shift);
  const cp = c + shift * (2 * b + shift * (3 * a + 4 * shift)), dp = d + shift * (c + shift * (b + shift * (a + shift)));
  const g = ap * cp - 4 * dp - bp * bp / 3, h = (ap * cp + 8 * dp - 2 / 9 * bp * bp) * bp / 3 - cp * cp - ap * ap * dp;
  if (!Number.isFinite(g) || !Number.isFinite(h)) return;
  const phi = dominantRoot(g, h), l1 = a / 2, l3 = b / 6 + phi / 2, delta = c - a * l3;
  const firstD = 2 / 3 * b - phi - l1 * l1, firstL = .5 * delta / firstD, secondL = 2 * (d - l3 * l3) / delta;
  const candidates = [[firstD, firstL], [.5 * delta / secondL, secondL], [firstD, secondL]];
  let bestD = 0, bestL = 0, bestError = 0;
  candidates.forEach(([candidateD, candidateL], i) => {
    const error = relativeError(candidateD + l1 * l1 + 2 * l3, b) + relativeError(2 * (candidateD * candidateL + l1 * l3), c) + relativeError(candidateD * candidateL * candidateL + l3 * l3, d);
    if (i === 0 || error < bestError) { bestD = candidateD; bestL = candidateL; bestError = error; }
  });
  let a1: number, b1: number, a2: number, b2: number;
  if (bestD < 0) {
    const square = Math.sqrt(-bestD); a1 = l1 + square; b1 = l3 + square * bestL; a2 = l1 - square; b2 = l3 - square * bestL;
    if (Math.abs(b2) < Math.abs(b1)) b2 = d / b1; else if (Math.abs(b2) > Math.abs(b1)) b1 = d / b2;
    if (Math.abs(a1) !== Math.abs(a2)) {
      const options = Math.abs(a1) < Math.abs(a2) ? [[a - a2, a2], [(c - b1 * a2) / b2, a2], [(b - b2 - b1) / a2, a2]]
        : [[a1, a - a1], [a1, (c - a1 * b2) / b1], [a1, (b - b2 - b1) / a1]];
      let best = 0;
      options.forEach(([x, y], i) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const error = error3(x, b1, y, b2); if (i === 0 || error < best) { a1 = x; a2 = y; best = error; }
      });
    }
  } else if (bestD === 0) {
    const square = Math.sqrt(-(d - l3 * l3)); a1 = a2 = l1; b1 = l3 + square; b2 = l3 - square;
    if (Math.abs(b1) > Math.abs(b2)) b2 = d / b1; else if (Math.abs(b2) > Math.abs(b1)) b1 = d / b2;
  } else return;
  let error = error4(a1, b1, a2, b2);
  for (let i = 0; i < 8 && error !== 0; i++) {
    const f0 = b1 * b2 - d, f1 = b1 * a2 + a1 * b2 - c, f2 = b1 + a1 * a2 + b2 - b, f3 = a1 + a2 - a;
    const c1 = a1 - a2, determinant = b1 * b1 - b1 * (a2 * c1 + 2 * b2) + b2 * (a1 * c1 + b2);
    if (determinant === 0) break;
    const c2 = b2 - b1, c3 = b1 * a2 - a1 * b2;
    const da1 = c1 * f0 + c2 * f1 + c3 * f2 - (b1 * c2 + a1 * c3) * f3;
    const db1 = (a1 * c1 + c2) * f0 - b1 * c1 * f1 - b1 * c2 * f2 - b1 * c3 * f3;
    const da2 = -c1 * f0 - c2 * f1 - c3 * f2 + (a2 * c3 + b2 * c2) * f3;
    const db2 = -(a2 * c1 + c2) * f0 + b2 * c1 * f1 + b2 * c2 * f2 + b2 * c3 * f3;
    const x1 = a1 - da1 / determinant, y1 = b1 - db1 / determinant, x2 = a2 - da2 / determinant, y2 = b2 - db2 / determinant;
    const nextError = error4(x1, y1, x2, y2); if (!(nextError < error)) break;
    a1 = x1; b1 = y1; a2 = x2; b2 = y2; error = nextError;
  }
  return [a1, b1, a2, b2].every(Number.isFinite) ? [[a1, b1], [a2, b2]] : undefined;
}
