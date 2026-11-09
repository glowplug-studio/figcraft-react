import type {Page} from "@playwright/test";
import {build} from "vite";

/** Serve the package's real browser modules, including separately requested wasm and font assets. */
export async function openTextFixture(page:Page,entry:string) {
  const built=await build({configFile:false,logLevel:"silent",build:{write:false,target:"esnext",assetsInlineLimit:0,
    rolldownOptions:{input:entry,preserveEntrySignatures:"strict",output:{entryFileNames:"editor.js"}}}});
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
}
