// Area/moment fitting equations from Kurbo 0.13.1 fit.rs, adapted to independent TypeScript.
// Copyright 2022 the Kurbo Authors. SPDX-License-Identifier: Apache-2.0 OR MIT
import type { Cubic } from "./cubic";
import { fitCubicRoots, fitQuadratic, fitQuarticFactors } from "./fit-polynomial";

export interface CubicFitCandidate { readonly curve: Cubic; readonly startArm: number; readonly endArm: number }
/** Unit chord candidates preserving endpoint directions, signed area and chord-axis moment. */
export function cubicFitCandidates(startAngle: number, endAngle: number, area: number, moment: number): CubicFitCandidate[] {
  const s0 = Math.sin(startAngle), c0 = Math.cos(startAngle), s1 = Math.sin(endAngle), c1 = Math.cos(endAngle), mx = moment;
  const a4 = -9 * c0 * (((2 * s1 * c1 * c0 + s0 * (2 * c1 * c1 - 1)) * c0 - 2 * s1 * c1) * c0 - c1 * c1 * s0);
  const a3 = 12 * ((((c1 * (30 * area * c1 - s1) - 15 * area) * c0 + 2 * s0 - c1 * s0 * (c1 + 30 * area * s1)) * c0 + c1 * (s1 - 15 * area * c1)) * c0 - s0 * c1 * c1);
  const a2 = 12 * ((((70 * mx + 15 * area) * s1 * s1 + c1 * (9 * s1 - 70 * c1 * mx - 5 * c1 * area)) * c0 - 5 * s0 * s1 * (3 * s1 - 4 * c1 * (7 * mx + area))) * c0 - c1 * (9 * s1 - 70 * c1 * mx - 5 * c1 * area));
  const a1 = 16 * (((12 * s0 - 5 * c0 * (42 * mx - 17 * area)) * s1 - 70 * c1 * (3 * mx - area) * s0 - 75 * c0 * c1 * area * area) * s1 - 75 * c1 * c1 * area * area * s0);
  const a0 = 80 * s1 * (42 * s1 * mx - 25 * area * (s1 - c1 * area));
  let roots: number[];
  const epsilon = 1e-12;
  if (Math.abs(a4) > epsilon) roots = (fitQuarticFactors(a3 / a4, a2 / a4, a1 / a4, a0 / a4) ?? []).flatMap(([a, b]) => {
    const real = fitQuadratic(b, a, 1); return real.length ? real : [-.5 * a];
  });
  else if (Math.abs(a3) > epsilon) roots = fitCubicRoots(a0, a1, a2, a3);
  else if (Math.abs(a2) > epsilon || Math.abs(a1) > epsilon || Math.abs(a0) > epsilon) roots = fitQuadratic(a0, a1, a2);
  else return [{ curve: [{ x: 0, y: 0 }, { x: 1 / 3, y: 0 }, { x: 2 / 3, y: 0 }, { x: 1, y: 0 }], startArm: 1 / 3, endArm: 1 / 3 }];
  const s01 = s0 * c1 + s1 * c0, result: CubicFitCandidate[] = [];
  for (const root of roots) {
    let startArm: number, endArm: number;
    if (root > 0) {
      const end = (root * s0 - area * (10 / 3)) / (.5 * root * s01 - s1);
      if (end > 0) { startArm = root; endArm = end; } else { startArm = s1 / s01; endArm = 0; }
    } else { startArm = 0; endArm = s0 / s01; }
    if (startArm >= 0 && endArm >= 0) result.push({ curve: [{ x: 0, y: 0 }, { x: startArm * c0, y: startArm * s0 }, { x: 1 - endArm * c1, y: endArm * s1 }, { x: 1, y: 0 }], startArm, endArm });
  }
  return result;
}
