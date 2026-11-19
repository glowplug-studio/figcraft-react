import { describe, expect, it } from "vitest";
import { identity } from "../../src/engine/affine";
import { fromRgba8 } from "../../src/engine/colour";
import { cornerPath, type PathCommand } from "../../src/engine/corners";
import { splitCubic, type Cubic } from "../../src/engine/cubic";
import type { VectorNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { CubicFitSource } from "../../src/engine/fit-cubic-source";
import { encodeFigcraft } from "../../src/engine/file-format";
import { lineMoments } from "../../src/engine/fit-polyline";
import { normaliseBooleanPath } from "../../src/engine/path-boolean";
import { measurePath } from "../../src/engine/path-measure";
import { simplifyPath } from "../../src/engine/simplify-path";
import simplifyFixture from "../fixtures/native-simplify-path.json";
import vectorFixture from "../fixtures/native-vector-simplify.json";
import { solidPaint } from "../../src/engine/solid-paint";
import { vectorFillContains, vectorFillPath } from "../../src/engine/vector-path";

const p=(x:number,y:number)=>({x,y});
const cubicCommand=(c:Cubic):PathCommand=>["C",c[1].x,c[1].y,c[2].x,c[2].y,c[3].x,c[3].y];
function area(path:readonly PathCommand[]) {
  return Math.abs(measurePath(path,40000,.0005)!.reduce((total,line)=>{
    const points=line.points;
    return total+points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length]; return sum+(a.x*b.y-a.y*b.x)/2;},0);
  },0));
}
describe("native curve and vector simplification",()=>{
  it("integrates cubic moments over whole, partial and multi-segment intervals",()=>{
    const c:Cubic=[p(0,0),p(1/3,0),p(2/3,0),p(1,1)], source=new CubicFitSource(splitCubic(c,.5));
    for(const [t0,t1] of [[0,1],[0,.25],[.25,.75],[.5,1],[1,1]]) {
      const expected=[(t1**4-t0**4)/4,(t1**5-t0**5)/5,(t1**7-t0**7)/7];
      source.moments(t0,t1).forEach((v,i)=>expect(v).toBeCloseTo(expected[i],12));
    }
    expect(source.sample(.5).point).toEqual(p(.5,.125));
    expect(source.sample(.5).derivative.y).toBeCloseTo(.75,12);
    const line:Cubic=[p(-3,2),p(-1,4),p(1,6),p(3,8)];
    new CubicFitSource([line]).moments(0,1).forEach((v,i)=>expect(v).toBeCloseTo(lineMoments(line[0],line[3])[i],12));
  });
  it("rejoins smooth cubic halves and preserves single segments, corners and independent subpaths",()=>{
    const c:Cubic=[p(0,0),p(20,0),p(80,60),p(100,60)], parts=splitCubic(c,.5);
    const original:PathCommand[]=[["M",0,0],...parts.map(cubicCommand)];
    const result=simplifyPath([...original,["L",100,90],["M",200,0],["L",210,10]],.01);
    expect(result.map(c=>c[0])).toEqual(["M","C","L","M","L"]);
    expect(result.slice(2)).toEqual([["L",100,90],["M",200,0],["L",210,10]]);
    // Native observation at bad07e44: the fitted end is one rounding step off the source's, as Kurbo evaluates it.
    const native=simplifyFixture.cases.find(c=>c.name==="simplify: smooth cubic halves, a corner and a second subpath")!.results[0].native as unknown as PathCommand[];
    expect(result.map(c=>c[0])).toEqual(native.map(c=>c[0]));
    result.forEach((c,i)=>c.slice(1).forEach((v,j)=>expect(v as number).toBeCloseTo(native[i][j+1] as number,10)));
    expect(result[1].slice(-2)).toEqual([100,60.00000000000001]);
    const source=measurePath(original,40000,.001)![0].lengths.at(-1)!;
    const fitted=measurePath(result.slice(0,2),40000,.001)![0].lengths.at(-1)!;
    expect(Math.abs(fitted-source)).toBeLessThan(.05);
    expect(simplifyPath([["M",0,0],cubicCommand(c),["Z"]],.1)).toEqual([["M",0,0],cubicCommand(c),["Z"]]);
  });
  it("keeps loose segments separate, preserves original layer bounds and supports one undo",()=>{
    const e=new EditorEngine(), id=String(e.execute("vector.create",{path:"M0 0H10H20H30V30H0Z M50 0H60H70H80"}).id);
    const before=e.getSnapshot().document, orig=before.nodes[id] as VectorNode;
    const result=e.execute("vector.simplify",{id});
    expect(result).toEqual({ok:true});
    const n=e.getSnapshot().document.nodes[id] as VectorNode;
    // Native observation at bad07e44: Kurbo refits each straight run of lines into more, collinear pieces, so the
    // simplified network has more segments than the drawn one (9 segments and 10 vertices before, 17 and 18 after).
    const observed=vectorFixture.cases.find(c=>c.name==="simplify closed and loose")!.receipts;
    expect([orig.network.vertices.length,orig.network.segments.length]).toEqual([(observed[1] as {vertices:number}).vertices,(observed[1] as {segments:number}).segments]);
    expect(e.execute("node.get",{id,fields:["vertices","segments","x","y","width","height"]})).toEqual(observed[3]);
    expect(n.network.regions).toHaveLength(1);
    expect(n).toMatchObject({x:orig.x,y:orig.y,width:orig.width,height:orig.height});
    e.execute("edit.undo");expect(e.getSnapshot().document).toBe(before);
    e.execute("vector.simplify",{id,tolerance:"invalid"});
    expect((e.getSnapshot().document.nodes[id] as VectorNode).network).toEqual(n.network);
  });
  it("combines inherited mixed winding but preserves independent region fills and reference spaces",async ()=>{
    for(const painted of [false,true]){
      const e=new EditorEngine(), id=String(e.execute("vector.create",{path:"M0 0H100V100H0Z M25 25H75V75H25Z"}).id);
      const doc=e.getSnapshot().document, node=doc.nodes[id] as VectorNode;
      const regions=node.network.regions[0].loops.map((loop,i)=>({loops:[loop],winding:i?"evenOdd" as const:"nonZero" as const,
        ...(painted?{fills:i?[]:[solidPaint(fromRgba8(255,0,0))],paintSpace:{width:120,height:80,transform:identity}}:{})}));
      const data=await encodeFigcraft({...doc,nodes:{...doc.nodes,[id]:{...node,network:{...node.network,regions}}}});
      await e.executeAsync("file.open",{data:Buffer.from(data).toString("base64")});
      e.execute("vector.simplify",{id,tolerance:.01});
      const output=(e.getSnapshot().document.nodes[id] as VectorNode).network;
      if(painted) {
        expect(output.regions.map(r=>[r.winding,r.fills,r.paintSpace])).toEqual(regions.map(r=>[r.winding,r.fills,r.paintSpace]));
      } else {
        expect(output.regions).toHaveLength(1);expect(output.regions[0].winding).toBe("evenOdd");
        expect(vectorFillContains(output,p(50,50))).toBe(false);
      }
    }
  });
  it("retains fitted contours and source winding when normalisation exceeds the crossing budget", () => {
    const engine = new EditorEngine();
    const bars = Array.from({ length: 750 }, (_, i) =>
      `M0 ${4 * i}h3000v2h-3000z M${4 * i} 0h2v3000h-2z`).join(" ");
    const id = String(engine.execute("vector.create", { path: bars }).id);
    const before = engine.getSnapshot().document;
    const source = (before.nodes[id] as VectorNode).network;
    const path = vectorFillPath(source);
    expect(() => normaliseBooleanPath(path)).toThrow("too complex");
    engine.execute("vector.simplify", { id });
    const output = (engine.getSnapshot().document.nodes[id] as VectorNode).network;
    expect(output.regions.map(r => r.winding)).toEqual(source.regions.map(r => r.winding));
    expect(vectorFillPath(output)).toEqual(path);
    engine.execute("edit.undo");
    expect(engine.getSnapshot().document).toBe(before);
  });
  it("places the simplified outline's points where native places them", async () => {
    const { commands, receipts } = vectorFixture.cases.find(c => c.name === "simplify closed and loose")!;
    const engine = new EditorEngine();
    for (const [command, params] of commands.slice(0, 3)) engine.execute(String(command), params as Record<string, unknown>);
    const { data } = await engine.executeAsync("file.exportSvg", {});
    // The end point of every drawn segment, as the exported path rounds it.
    const anchors = (svg: string) => [...new Set([.../ d="([^"]+)"/.exec(svg)![1].matchAll(/[MLC]([^MLCZ]+)/g)].map(m => m[1].trim().split(" ").slice(-2).join(",")))].sort();
    const native = (receipts[4] as { svg: string }).svg, ours = Buffer.from(String(data), "base64").toString("utf8");
    expect(anchors(ours)).toEqual(anchors(native));
    // Known difference, outside this change: native's path normaliser (linesweeper) writes these straight pieces as
    // lines and starts the contour at another vertex; the port's normaliser keeps them as straight cubics.
    expect(native).toContain("L8.438 0L9.888 0"); expect(ours).toContain("C8.921 0 9.404 0 9.888 0");
  });
  it("simplifies an entirely open stroke without introducing a fill", () => {
    const engine = new EditorEngine();
    const id = String(engine.execute("vector.create", { path: "M0 0H10H20H30" }).id);
    engine.execute("vector.simplify", { id, tolerance: 0 });
    const output = (engine.getSnapshot().document.nodes[id] as VectorNode).network;
    expect(output.regions).toHaveLength(0);
    // Native observations at bad07e44: a straight three-line stroke comes back as 13 collinear pieces at tolerance 0
    // and 7 at the default tolerance, never as one segment.
    const observed = vectorFixture.cases.find(c => c.name === "simplify open straight")!.receipts;
    expect(engine.execute("node.get", { id, fields: ["vertices", "segments", "x", "y", "width", "height"] })).toEqual(observed[2]);
    expect(output.vertices.every(v => v.y === 0 && v.x >= 0 && v.x <= 30)).toBe(true);
    const again = new EditorEngine(), other = String(again.execute("vector.create", { path: "M0 0H10H20H30" }).id);
    again.execute("vector.simplify", { id: other });
    expect(again.execute("node.get", { id: other, fields: ["vertices", "segments"] })).toEqual(vectorFixture.cases.find(c => c.name === "simplify open straight default")!.receipts[2]);
  });
  it("rebuilds smoothed corners within the upstream area tolerance",()=>{
    const e=new EditorEngine(),id=String(e.execute("vector.create",{path:"M0 0H100V100H0Z"}).id);
    e.execute("node.set",{id,props:{cornerRadius:20,cornerSmoothing:.6}});
    const v=e.getSnapshot().document.nodes[id] as VectorNode;
    const expected=area(cornerPath({...v,corners:{radii:[20,20,20,20],smoothing:.6}}));
    e.execute("vector.simplify",{id,tolerance:.01});
    const net=(e.getSnapshot().document.nodes[id] as VectorNode).network;
    expect(Math.abs(area(vectorFillPath(net))-expected)).toBeLessThan(1);
    expect(net.vertices.every(v=>!v.radius)).toBe(true);
  });
});
