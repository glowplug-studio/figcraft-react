import {expect,test,type Page} from "@playwright/test";
import {openTextFixture} from "../fixtures/serve-text-module";

async function openEditor(page:Page) {
  await openTextFixture(page,"tests/fixtures/text-edit-browser.ts");
  const entry="/editor.js";
  const id=await page.evaluate(async url=>{
    const api:typeof import("../fixtures/text-edit-browser")=await import(url);
    return api.start();
  },entry);
  const input=page.getByRole("textbox",{name:"Edit text layer"});
  const run=(command:string,params:Record<string,unknown>={})=>page.evaluate(async ({entry,command,params})=>{
    const {engine}:typeof import("../fixtures/text-edit-browser")=await import(entry);
    return engine.executeAsync(command,params);
  },{entry,command,params});
  return {entry,id,input,run};
}

test("public text-edit commands share the browser textarea, composition and undo",async ({page})=>{
  const {entry,id,input,run}=await openEditor(page);
  await expect(input).toBeFocused();
  expect(await input.evaluate((e:HTMLTextAreaElement)=>[e.selectionStart,e.selectionEnd])).toEqual([0,5]);
  await run("text.edit.caret",{index:3});
  await run("text.edit.caret",{index:1,extend:true});
  expect(await input.evaluate((e:HTMLTextAreaElement)=>[e.selectionStart,e.selectionEnd,e.selectionDirection])).toEqual([1,4,"backward"]);
  await page.keyboard.insertText("Ω");
  expect(await run("text.edit.selection")).toEqual({id:Number(id),anchor:2,caret:2,text:"",preedit:null});
  await expect(input).toHaveValue("AΩC");
  await run("text.edit.preedit",{text:"日本",cursor:1});
  expect(await run("text.edit.selection")).toMatchObject({preedit:{text:"日本",cursor:1}});
  await expect(input).toHaveValue("AΩC");
  await run("text.edit.insert",{text:"日"});
  await expect(input).toHaveValue("AΩ日C");
  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await run("edit.undo");
  expect(await page.evaluate(async url=>{
    const {engine}:typeof import("../fixtures/text-edit-browser")=await import(url);
    const node=engine.getSnapshot().document.nodes["2"];
    return node.kind==="text" && node.text.characters;
  },entry)).toBe("A🙂BC");
});

test("Chromium IME replacement retains the logical selection, provisional cursor and normalised insertion boundary",async ({page})=>{
  const {input,run}=await openEditor(page);
  const ime=await page.context().newCDPSession(page);
  await run("text.edit.caret",{index:3});await run("text.edit.caret",{index:1,extend:true});
  await ime.send("Input.insertText",{text:"\u0001"});
  await expect(input).toHaveValue("A🙂BC");
  expect(await run("text.edit.selection")).toMatchObject({anchor:3,caret:1,text:"🙂B"});
  await run("text.edit.caret",{index:1});
  await ime.send("Input.insertText",{text:"Ω\u0001Z\u2028"});
  await expect(input).toHaveValue("AΩZ\n🙂BC");
  expect(await run("text.edit.selection")).toMatchObject({anchor:4,caret:4,text:""});
  await run("text.edit.caret",{index:7});
  // Chromium replacement offsets count UTF-16 units. Replace the emoji and B before the caret.
  await ime.send("Input.imeSetComposition",{text:"候🙂補",selectionStart:3,selectionEnd:3,replacementStart:4,replacementEnd:7});
  await expect(input).toHaveValue("AΩZ\n候🙂補C");
  expect(await run("text.edit.selection")).toMatchObject({anchor:4,caret:4,preedit:{text:"候🙂補",cursor:2}});
  await ime.send("Input.imeSetComposition",{text:"候🙂補",selectionStart:1,selectionEnd:1});
  expect(await run("text.edit.selection")).toMatchObject({preedit:{text:"候🙂補",cursor:1}});
  await ime.send("Input.insertText",{text:"日"});
  await expect(input).toHaveValue("AΩZ\n日C");
  expect(await run("text.edit.selection")).toMatchObject({anchor:5,caret:5,preedit:null});
  await ime.send("Input.imeSetComposition",{text:"仮",selectionStart:1,selectionEnd:1});
  await ime.send("Input.imeSetComposition",{text:"",selectionStart:0,selectionEnd:0});
  await expect(input).toHaveValue("AΩZ\n日C");
  expect(await run("text.edit.selection")).toMatchObject({anchor:5,caret:5,preedit:null});
});
