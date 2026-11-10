import { expect,it } from "vitest";
import { EditorEngine } from "../../src/engine/editor";
import { pdfPages } from "../../src/engine/pdf/pages";
import cases from "../fixtures/native-pdf-export.json";

it.each(cases.filter(entry=>!entry.commands.some(([command])=>command==="image.place")))("matches upstream PDF pages and input validation for $name",async entry=>{
  const engine=new EditorEngine(), last=entry.commands.at(-1)!;
  for (const [command,params] of entry.commands.slice(0,-1)) {
    await engine.executeAsync(String(command),params);
  }
  const {document,selection}=engine.getSnapshot();
  const rendering=()=>pdfPages(document,selection,last[1] as Record<string,unknown>,last[0]==="file.exportFramesPdf");
  if (entry.error) {
    expect(rendering).toThrow(entry.error.replace(/^.*?(?:right now: |parameters for `[^\x60]+`: )/,""));
    return;
  }
  const {pages}=rendering();
  expect(pages).toHaveLength(entry.pages!.length);
  for (const [i,page] of entry.pages!.entries()) for (const key of ["/MediaBox","/TrimBox","/BleedBox"] as const) {
    const bounds=new RegExp(key+" ?\\[([^\\]]+)\\]").exec(pages[i].sheet.boxes)?.[1].split(" ").map(Number);
    const expected=(page.boxes as Record<string,number[]>)[key];
    if (!expected) expect(bounds).toBeUndefined();
    else {
      expect(bounds).toHaveLength(4);
      expected.forEach((n,j)=>expect(bounds![j]).toBeCloseTo(n,3));
    }
  }
});

it("restricts PDF export to the signed-in document and rejects a filesystem destination",async()=>{
  const engine=new EditorEngine();
  engine.execute("frame.create",{width:12,height:6});
  await expect(engine.executeAsync("file.exportFramesPdf",{path:"/private/drawing.pdf"})).rejects.toThrow("browser download");
  const pending=engine.executeAsync("file.export",{format:"pdf"});
  engine.setEditable(false);
  await expect(pending).rejects.toThrow(/Sign in|changed/);
  await expect(engine.executeAsync("file.exportFramesPdf",{})).rejects.toThrow("Sign in");
});
