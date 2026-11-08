import { expect, test } from "@playwright/test";
import { build } from "vite";
import type * as OutlineFixture from "../fixtures/outline-stroke";

test("Outline stroke keeps native painted bands, arrows, dashes and brush interiors", async ({ page }) => {
  const built = await build({ configFile: false, logLevel: "silent", build: {
    write: false, lib: { entry: "tests/fixtures/outline-stroke.ts", name: "OutlineFixture", formats: ["iife"] }, minify: true,
  } });
  const output = (Array.isArray(built) ? built[0] : built) as { output: { type: string; code?: string }[] };
  const code = output.output.find(entry => entry.type === "chunk")?.code;
  if (!code) throw Error("Missing outline fixture");
  await page.setContent("<canvas></canvas>");
  await page.addScriptTag({ content: code });
  const scenes = await page.evaluate(() => (window as unknown as { OutlineFixture: typeof OutlineFixture })
    .OutlineFixture.compareOutlines(document.querySelector("canvas")!));
  for (const scene of scenes) {
    expect(scene.dark, JSON.stringify(scene)).toBeGreaterThan(0);
    expect(scene.mismatch, JSON.stringify(scene)).toBe(0);
  }
  const cdp = await page.context().newCDPSession(page);
  const heap = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    return (await cdp.send("Runtime.getHeapUsage")).usedSize;
  };
  const exercise = () => page.evaluate(() => (window as unknown as { OutlineFixture: typeof OutlineFixture }).OutlineFixture.measureOutlineEdits());
  await exercise();
  const before = await heap(), edits = await exercise(), after = await heap();
  expect(edits).toMatchObject({ outlines:32, runs:15, restored:true });
  await test.info().attach("outline-stroke", { body: JSON.stringify({scenes,edits, heapBeforeBytes:before, heapAfterBytes:after}), contentType:"application/json" });
});
