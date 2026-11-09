import {createHash} from "node:crypto";
import {expect,it} from "vitest";
import {EditorEngine} from "../../src/engine/editor";
import cases from "../fixtures/native-text-flatten.json";

// Each digest includes the native bounds, every vertex and tangent, and all directed region loops.
// Round both implementations to 1e-6 document units to allow floating-point evaluation order.
it("matches 108 pinned Rust text flatten results including warped glyphs, decorations and empty outlines",async ()=>{
  for (const {commands,digest} of cases) {
    const e=new EditorEngine();
    for (const [name,options] of commands) await e.executeAsync(String(name),options);
    if (!digest) {
      const before=e.getSnapshot().document;
      expect(()=>e.execute("vector.flatten",{ids:[2]})).toThrow();
      expect(e.getSnapshot().document).toBe(before);
      continue;
    }
    const {id}=e.execute("vector.flatten",{ids:[2]});
    const n=e.getSnapshot().document.nodes[String(id)];
    if (n.kind!=="vector") throw new Error("Expected the flattened vector");
    const geometry={box:[n.x,n.y,n.width,n.height],vertices:n.network.vertices.map(v=>[v.x,v.y]),
      segments:n.network.segments.map(s=>[s.a,s.b,...s.ta,...s.tb]),regions:n.network.regions.map(r=>[r.winding,r.loops])};
    const wire=JSON.stringify(geometry,(_,v)=>typeof v==="number" ? Math.round(v*1e6)/1e6 : v);
    expect(createHash("sha256").update(wire).digest("hex"),JSON.stringify(commands)).toBe(digest);
  }
});
