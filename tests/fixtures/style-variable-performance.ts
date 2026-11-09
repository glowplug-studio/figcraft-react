import { renderDocument } from "../../src/engine/canvas";
import { newDocument, type DocumentNode } from "../../src/engine/document";
import { EditorEngine } from "../../src/engine/editor";
import { encodeFigcraft } from "../../src/engine/file-format";
import { base64Bytes } from "../../src/engine/recovery";
import { readSharedStyles } from "../../src/engine/shared-styles";
import { nodeFills } from "../../src/engine/style-application";
import { readVariables } from "../../src/engine/variables";
import native from "./native-style-mode-consumers.json";

export async function styleModePerformance(canvas:HTMLCanvasElement, direct = false) {
  const base=newDocument(),nodes:Record<string,DocumentNode>={...base.nodes};
  const page=base.nodes[base.currentPage];
  if (page.kind!=="page") throw new Error("Expected page");
  const roots:string[]=[];
  const boundVariables=Object.freeze({"fills/0/color":"VariableID:1",cornerRadius:"VariableID:7"});
  const links=Object.freeze({fill:"S:1",stroke:null,effect:null,grid:null,text:null});
  for (let i=0;i<100;i++) {
    const frame=String(2+i*101), children:string[]=[];
    roots.push(frame);
    nodes[frame]={id:frame,kind:"frame",name:"Frame",parent:page.id,x:(i%10)*400,y:Math.floor(i/10)*400,width:380,height:380,
      fill:"transparent",clip:true,children};
    for (let j=0;j<100;j++) {
      const id=String(Number(frame)+1+j);
      children.push(id);
      nodes[id]={id,kind:"rectangle",name:"Swatch",parent:frame,x:(j%10)*38,y:Math.floor(j/10)*38,width:32,height:32,fill:"#000000",...(direct ? {boundVariables} : {styles:links})};
    }
  }
  nodes[page.id]={...page,children:roots};
  const theme=native.variables.collections[0];
  const radius={id:"VariableID:7",name:"Radius",collection:theme.id,resolvedType:"number",
    values:Object.fromEntries(theme.modes.map((mode,i)=>[mode.id,{type:"number",value:i ? 7 : 2}]))};
  const variables=readVariables(direct ? {...native.variables,variables:[...native.variables.variables,radius]} : native.variables);
  const [style]=readSharedStyles(native.styles);
  const styles=[{...style,bound:{"fills/0/color":"VariableID:1"}}];
  const engine=new EditorEngine();
  await engine.executeAsync("file.open",{data:base64Bytes(await encodeFigcraft({...base,nodes,styles,variables},"10102"))});
  const initial=engine.getSnapshot().document, start=performance.now();
  engine.execute("variable.setMode",{ids:[page.id],collection:"Theme",mode:"Dark"});
  const editMs=performance.now()-start, updated=engine.getSnapshot().document;
  let changed=0,rounded=0;
  for (const n of Object.values(updated.nodes)) {
    if (n.kind!=="rectangle") continue;
    if (n.corners?.radii.every(r=>r===7)) rounded++;
    const p=nodeFills(n)[0];
    if (p?.type==="solid" && p.color.a===Math.fround(128/255) && p.color.r===Math.fround(23/255)) changed++;
  }
  const ctx=canvas.getContext("2d")!;
  canvas.width=600;canvas.height=360;
  let publications=0;
  const target="3";
  if (direct) engine.execute("select.set",{ids:[target]});
  const preview=direct ? engine.beginLayoutField("node.set") : undefined;
  const stop=engine.subscribe(()=>publications++);
  const samples:number[]=[];
  for (let i=0;i<65;i++) {
    await new Promise<void>(r=>requestAnimationFrame(()=>r()));
    const t=performance.now();
    preview?.preview({id:target,props:{x:i}});
    const visible=preview ? engine.getRenderDocument() : updated;
    renderDocument(ctx,visible,600,360,[],undefined,{cx:300+i*3,cy:180,vw:600,vh:360,zoom:1});
    if (i>=5) samples.push(performance.now()-t);
  }
  preview?.cancel();
  const previewRestored=engine.getRenderDocument()===updated;
  stop();engine.execute("edit.undo");
  return {changed,rounded,previewRestored,nodes:Object.keys(updated.nodes).length,editMs,publications,frameP95:samples.sort((a,b)=>a-b)[57],
    restored:engine.getSnapshot().document===initial};
}
