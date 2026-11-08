import { expect, test, type Page } from "@playwright/test";
import { build } from "vite";
import type { measureRegionFills, measureVectorEdit, measureVectorPathTool, measureWinding } from "../fixtures/vector-edit-performance";

async function openBenchmark(page: Page) {
  const bundle = await build({ configFile: false, logLevel: "silent", build: { write: false, lib: { entry: "tests/fixtures/vector-edit-performance.ts", name: "VectorEditPerformance", formats: ["iife"] }, minify: true } });
  const output = (Array.isArray(bundle) ? bundle[0] : bundle) as { output: { type: string; code?: string }[] };
  const code = output.output.find(chunk => chunk.type === "chunk")?.code; if (!code) throw new Error("Vector edit fixture did not build");
  await page.setContent('<canvas aria-label="Vector editing performance"></canvas>'); await page.addScriptTag({ content: code });
}

for (const operation of ["move", "scale", "rotate", "width", "paint", "region"] as const) test(`vector point ${operation} previews and overlays keep the frame budget across100 edited layers in10000 nodes`, async ({ page }) => {
  await openBenchmark(page);
  const measurement = await page.evaluate(operation => (window as unknown as { VectorEditPerformance: { measureVectorEdit: typeof measureVectorEdit } }).VectorEditPerformance.measureVectorEdit(document.querySelector("canvas")!, operation), operation);
  await test.info().attach("vector-edit-performance", { body: JSON.stringify(measurement), contentType: "application/json" });
  expect(measurement).toMatchObject({ nodes: 10_000, visibleEditedLayers: 100, measuredFrames: 110, rootNotifications: 0, chromeNotifications: 0, restored: true });
  expect(measurement.selectedPoints).toBe(operation === "region" ? 103 : 100);
  if (operation === "paint" || operation === "region") expect(measurement.hoverPanP95).toBeLessThan(16.7);
  expect(measurement.p95).toBeLessThan(16.7); expect(measurement.inputP95).toBeLessThan(16.7);
});

test("selected region fill commands and draw stay within the frame budget in 10000 nodes", async ({ page }) => {
  await openBenchmark(page);
  const result = await page.evaluate(() => (window as unknown as { VectorEditPerformance: { measureRegionFills: typeof measureRegionFills } }).VectorEditPerformance.measureRegionFills(document.querySelector("canvas")!));
  await test.info().attach("region-fill-performance", { body: JSON.stringify(result), contentType: "application/json" });
  expect(result).toMatchObject({ nodes: 10_000, editedLayers: 100, regions: 2, edits: 120, measuredFrames: 110 });
  expect(result.p95).toBeLessThan(16.7); expect(result.inputP95).toBeLessThan(16.7);
});

for (const tool of ["lasso", "cut", "eraser"] as const) test(`vector ${tool} keeps its drag and overlay budget in 10000 nodes`, async ({ page }) => {
  await openBenchmark(page);
  const result = await page.evaluate(tool => (window as unknown as { VectorEditPerformance: { measureVectorPathTool: typeof measureVectorPathTool } }).VectorEditPerformance.measureVectorPathTool(document.querySelector("canvas")!, tool), tool);
  await test.info().attach("vector-path-tool-performance", { body: JSON.stringify(result), contentType: "application/json" });
  expect(result).toMatchObject({ nodes: 10_000, editedLayers: 100, measuredFrames: 110, root: 0, chrome: 0 });
  expect(result.inputP95).toBeLessThan(16.7); expect(result.p95).toBeLessThan(16.7);
});

for (const command of ["vector.fillRule", "vector.reverseLoop"] as const) test(`${command} updates 100 rings within the 10000-node frame budget`, async ({ page }) => {
  await openBenchmark(page);
  const result = await page.evaluate(command => (window as unknown as { VectorEditPerformance: { measureWinding: typeof measureWinding } }).VectorEditPerformance.measureWinding(document.querySelector("canvas")!, command), command);
  await test.info().attach(command, { body: JSON.stringify(result), contentType: "application/json" });
  expect(result).toMatchObject({ nodes: 10_000, rings: 100, edits: 120, frames: 110, undoPixel: 245 });
  expect(result.p95).toBeLessThan(16.7); expect(result.inputP95).toBeLessThan(16.7);
});

test("Offset path rebuilds 32 visible rings in 10000 nodes and undo restores the full scene", async ({ page }) => {
  await openBenchmark(page);
  const result = await page.evaluate(() => (window as unknown as { VectorEditPerformance: {
    measureOffset: typeof import("../fixtures/vector-edit-performance").measureOffset
  } }).VectorEditPerformance.measureOffset(document.querySelector("canvas")!));
  expect(result).toMatchObject({nodes:10000,rings:32,runs:10,holePixel:245});
  expect(result.grownPixel).toBeLessThan(240);
  await test.info().attach("vector.offset", {body:JSON.stringify(result),contentType:"application/json"});
});

test("Simplify vector reduces 32 mixed paths in 10000 nodes without losing their fills or undo",async({page})=>{
  await openBenchmark(page);
  const result=await page.evaluate(()=>(window as unknown as {VectorEditPerformance:{
    measureSimplify:typeof import("../fixtures/vector-edit-performance").measureSimplify
  }}).VectorEditPerformance.measureSimplify(document.querySelector("canvas")!));
  expect(result).toMatchObject({nodes:10000,targets:32,runs:10,sample:217});
  expect(result.afterSegments).toBeLessThan(result.beforeSegments);
  await test.info().attach("vector.simplify",{body:JSON.stringify(result),contentType:"application/json"});
});
