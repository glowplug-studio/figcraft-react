import type { Affine } from "./affine";
import type { CurveElement } from "./curve-flatten";
import type { BlendMode } from "./blend";

export function svgNumber(value: number) {
  return String(Number.isFinite(value) ? Math.sign(value) * Math.round(Math.abs(value) * 1000) / 1000 : 0);
}
export function svgMatrix(transform: Affine) {
  const epsilon = Math.max(1,...transform.slice(0,4).map(Math.abs)) * 1e-12;
  const terms = transform.map((n,i) => i >= 4 ? svgNumber(n) : Math.abs(n) <= epsilon ? "0" : String(Number(n.toPrecision(6))));
  return "matrix(" + terms.join(" ") + ")";
}
export function svgPath(path: readonly CurveElement[], transform?: Affine) {
  return path.map(c => {
    if (c[0] === "Z") return "Z";
    const coordinates = c.slice(1) as number[];
    if (transform) {
      const [a,b,k,d,e,f] = transform;
      for (let i=0;i<coordinates.length;i+=2) {
        const x=coordinates[i], y=coordinates[i+1];
        coordinates[i]=a*x+k*y+e; coordinates[i+1]=b*x+d*y+f;
      }
    }
    return c[0] + coordinates.map(svgNumber).join(" ");
  }).join("");
}
export function xmlText(s: string) {
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/gu,"")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
}
export function svgBlend(mode: BlendMode) {
  return mode === "normal" || mode === "passThrough" ? "" : ' style="mix-blend-mode:' + mode.replace(/[A-Z]/g,s=>"-"+s.toLowerCase()) + '"';
}
