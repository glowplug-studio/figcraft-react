import { expect, test } from "@playwright/test";
import { build } from "vite";
import type { exerciseBooleanPaths, exerciseBooleanEdits } from "../fixtures/boolean-geometry";

test("boolean contours keep exact curved overlap pixels and normalise 4097 disjoint islands", async ({ page }) => {
  const bundle = await build({ configFile: false, logLevel: "silent", build: { write: false, lib: { entry: "tests/fixtures/boolean-geometry.ts", name: "BooleanFixture", formats: ["iife"] }, minify: true } });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle) as { output: { type: string; code?: string }[] };
  const code = output.output.find(entry=>entry.type==="chunk")?.code;
  if (!code) throw Error("Boolean fixture did not build");
  await page.setContent("<canvas></canvas>"); await page.addScriptTag({content:code});
  const result = await page.evaluate(()=>(window as unknown as { BooleanFixture: { exerciseBooleanPaths: typeof exerciseBooleanPaths } }).BooleanFixture.exerciseBooleanPaths(document.querySelector("canvas")!));
  expect(result.hits).toEqual([[255,255,255],[255,0,0],[0,255,0],[255,0,255]]);
  expect(result.contours).toBe(4097); expect(Math.abs(result.last)).toBe(1);
  const cdp = await page.context().newCDPSession(page);
  const retainedHeap = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    return (await cdp.send("Runtime.getHeapUsage")).usedSize;
  };
  const measure = () => page.evaluate(() => (window as unknown as {
    BooleanFixture: { exerciseBooleanEdits: typeof exerciseBooleanEdits }
  }).BooleanFixture.exerciseBooleanEdits());
  await measure();
  const before = await retainedHeap();
  const edits = await measure();
  const after = await retainedHeap();
  expect(edits.vertices).toBeGreaterThan(48);
  await test.info().attach("boolean-edits", { body: JSON.stringify({ ...edits, heapBeforeBytes: before, heapAfterBytes: after }), contentType: "application/json" });
  await test.info().attach("boolean-geometry",{body:JSON.stringify(result),contentType:"application/json"});
});
