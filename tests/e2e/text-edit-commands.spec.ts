import {expect,test} from "@playwright/test";
import {build} from "vite";

test("public text-edit commands share the browser textarea, composition and undo",async ({page})=>{
  const built=await build({configFile:false,logLevel:"silent",build:{write:false,target:"esnext",assetsInlineLimit:0,
    rolldownOptions:{input:"tests/fixtures/text-edit-browser.ts",preserveEntrySignatures:"strict",output:{entryFileNames:"editor.js"}}}});
  if (Array.isArray(built) || !("output" in built)) throw new Error("Expected one browser build");
  const files=new Map(built.output.map(chunk=>["/"+chunk.fileName,chunk]));
  await page.route("https://editor.test/**",route=>{
    const path=new URL(route.request().url()).pathname;
    if (path==="/") return route.fulfill({contentType:"text/html",body:'<!doctype html><canvas tabindex="0" style="width:600px;height:300px"></canvas>'});
    const chunk=files.get(path);
    if (!chunk) return route.fulfill({status:404});
    if (chunk.type==="chunk") return route.fulfill({contentType:"text/javascript",body:chunk.code});
    return route.fulfill({contentType:path.endsWith(".wasm") ? "application/wasm" : "application/octet-stream",body:Buffer.from(chunk.source)});
  });
  await page.goto("https://editor.test/");
  const entry="/editor.js";
  const id=await page.evaluate(async url=>{
    const api:typeof import("../fixtures/text-edit-browser")=await import(url);
    return api.start();
  },entry);
  const input=page.getByRole("textbox",{name:"Edit text layer"});
  await expect(input).toBeFocused();
  expect(await input.evaluate((e:HTMLTextAreaElement)=>[e.selectionStart,e.selectionEnd])).toEqual([0,5]);
  const run=(command:string,params:Record<string,unknown>={})=>page.evaluate(async ({entry,command,params})=>{
    const {engine}:typeof import("../fixtures/text-edit-browser")=await import(entry);
    return engine.executeAsync(command,params);
  },{entry,command,params});
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
